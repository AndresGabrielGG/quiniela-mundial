import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// 1. Estructura ampliada para encontrar los goles en vivo
interface FDataMatch {
  id: number;
  utcDate: string;
  status: string;
  homeTeam: { name: string; crest: string };
  awayTeam: { name: string; crest: string };
  score: {
    fullTime?: { home: number | null; away: number | null };
    regularTime?: { home: number | null; away: number | null }; // <- Aquí están los goles en vivo
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

    let hayPartidosTerminados = false;

    // 2. Formateamos los datos
    const matchesToInsert = data.matches.map((match: FDataMatch) => {
      const teamA = match.homeTeam?.name || 'Por definir';
      const teamB = match.awayTeam?.name || 'Por definir';
      const logoA = match.homeTeam?.crest || '';
      const logoB = match.awayTeam?.crest || '';
      
      // EL ARREGLO DEL MARCADOR: Buscamos primero en fullTime (si terminó), si no, en regularTime (si está en vivo)
      const scoreA = match.score?.fullTime?.home ?? match.score?.regularTime?.home ?? null;
      const scoreB = match.score?.fullTime?.away ?? match.score?.regularTime?.away ?? null;
      
      const status = match.status === 'FINISHED' ? 'finished' : 'pending';

      // Avisamos si este robot acaba de encontrar un partido que finalizó
      if (status === 'finished') {
        hayPartidosTerminados = true;
      }

      return {
        api_fixture_id: match.id,
        team_a: teamA,
        team_b: teamB,
        home_logo: logoA,
        away_logo: logoB,
        kickoff_time: match.utcDate,
        score_a: scoreA,
        score_b: scoreB,
        match_minute: null, 
        full_status: match.status,
        status: status
      };
    });

    // 3. Guardamos en la Base de Datos
    const { error } = await supabase
      .from('matches')
      .upsert(matchesToInsert, { onConflict: 'api_fixture_id' });

    if (error) throw error;

    // 4. EL ARREGLO DE LOS PUNTOS: Si hay partidos terminados, llamamos automáticamente a la API de puntos
    if (hayPartidosTerminados) {
      const calculateUrl = `${url.origin}/api/calculate-points?secret=${secret}`;
      // Hacemos el llamado sin esperar respuesta (fire-and-forget) para que sea instantáneo
      fetch(calculateUrl).catch(e => console.error("Error al autocalcular puntos:", e));
    }

    return NextResponse.json({ 
      success: true, 
      message: `¡Sincronización exitosa! Se procesaron ${matchesToInsert.length} partidos y los marcadores están actualizados.` 
    });

  } catch (error) {
    console.error("Error en el servidor:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}