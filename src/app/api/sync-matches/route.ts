import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

interface FDataMatch {
  id: number;
  utcDate: string;
  status: string;
  homeTeam: { name: string; crest: string };
  awayTeam: { name: string; crest: string };
  score: {
    fullTime?: { home: number | null; away: number | null };
    regularTime?: { home: number | null; away: number | null };
    extraTime?: { home: number | null; away: number | null }; // Añadimos la prórroga
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const secret = url.searchParams.get('secret')

    if (secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: "No tienes permiso para hacer esto" }, { status: 401 })
    }
    
    const response = await fetch('https://api.football-data.org/v4/competitions/WC/matches', {
      headers: {
        'X-Auth-Token': process.env.FOOTBALL_DATA_KEY as string,
      },
      cache: 'no-store' 
    });
    
    const data = await response.json();

    if (!data.matches || data.matches.length === 0) {
      return NextResponse.json({ error: "No se encontraron partidos" }, { status: 400 });
    }

    // 1. TRAER PARTIDOS ACTUALES DE LA BD PARA COMPARAR
    const { data: existingMatches } = await supabase
      .from('matches')
      .select('api_fixture_id, score_a, score_b');

    let hayPartidosTerminados = false;

    // 2. FORMATEAMOS LOS DATOS
    const matchesToInsert = data.matches.map((match: FDataMatch) => {
      const teamA = match.homeTeam?.name || 'Por definir';
      const teamB = match.awayTeam?.name || 'Por definir';
      const logoA = match.homeTeam?.crest || '';
      const logoB = match.awayTeam?.crest || '';
      
      // --- FILTRO ANTI-PENALES ---
      let apiScoreA: number | null | undefined = null;
      let apiScoreB: number | null | undefined = null;

      // Prioridad 1: Marcador al finalizar la prórroga (120 min)
      if (match.score?.extraTime && match.score.extraTime.home !== null) {
        apiScoreA = match.score.extraTime.home;
        apiScoreB = match.score.extraTime.away;
      } 
      // Prioridad 2: Marcador al finalizar el tiempo regular (90 min)
      else if (match.score?.regularTime && match.score.regularTime.home !== null) {
        apiScoreA = match.score.regularTime.home;
        apiScoreB = match.score.regularTime.away;
      } 
      // Prioridad 3: Fallback (Solo por si la API omite los otros y manda fullTime directo)
      else {
        apiScoreA = match.score?.fullTime?.home ?? null;
        apiScoreB = match.score?.fullTime?.away ?? null;
      }
      
      // BUSCAMOS SI YA TENÍAMOS DATOS EN NUESTRA BD
      const existingMatch = existingMatches?.find(m => m.api_fixture_id === match.id);

      // EL ESCUDO ANTI-NULL: Si la API trae null pero tú pusiste un número, conservamos tu número.
      if (apiScoreA === null && existingMatch?.score_a !== null && existingMatch?.score_a !== undefined) {
        apiScoreA = existingMatch.score_a;
      }
      if (apiScoreB === null && existingMatch?.score_b !== null && existingMatch?.score_b !== undefined) {
        apiScoreB = existingMatch.score_b;
      }
      
      const status = match.status === 'FINISHED' ? 'finished' : 'pending';

      // Avisamos si este robot acaba de encontrar un partido que finalizó (y que ya tiene goles válidos)
      if (status === 'finished' && apiScoreA !== null && apiScoreB !== null) {
        hayPartidosTerminados = true;
      }

      return {
        api_fixture_id: match.id,
        team_a: teamA,
        team_b: teamB,
        home_logo: logoA,
        away_logo: logoB,
        kickoff_time: match.utcDate,
        score_a: apiScoreA,
        score_b: apiScoreB,
        match_minute: null, 
        full_status: match.status,
        status: status
      };
    });

    // 3. GUARDAMOS EN LA BASE DE DATOS
    const { error } = await supabase
      .from('matches')
      .upsert(matchesToInsert, { onConflict: 'api_fixture_id' });

    if (error) throw error;

    // 4. EL ARREGLO DE LOS PUNTOS: Auto-cálculo si hay partidos terminados
    if (hayPartidosTerminados) {
      const calculateUrl = `${url.origin}/api/calculate-points?secret=${secret}`;
      fetch(calculateUrl).catch(e => console.error("Error al autocalcular puntos:", e));
    }

    return NextResponse.json({ 
      success: true, 
      message: `¡Sincronización exitosa! Se procesaron ${matchesToInsert.length} partidos, filtrando resultados de penales.` 
    });

  } catch (error) {
    console.error("Error en el servidor:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}