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
    extraTime?: { home: number | null; away: number | null };
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

    const { data: existingMatches } = await supabase
      .from('matches')
      .select('api_fixture_id, score_a, score_b');

    let hayPartidosTerminados = false;

    const matchesToInsert = data.matches.map((match: FDataMatch) => {
      const teamA = match.homeTeam?.name || 'Por definir';
      const teamB = match.awayTeam?.name || 'Por definir';
      const logoA = match.homeTeam?.crest || '';
      const logoB = match.awayTeam?.crest || '';
      
      let apiScoreA: number | null | undefined = null;
      let apiScoreB: number | null | undefined = null;

      // --- LA MAGIA MATEMÁTICA PARA LA QUINIELA ---
      if (match.score?.regularTime && match.score.regularTime.home !== null && match.score.regularTime.away) {
        // 1. Tomamos los goles de los 90 minutos
        apiScoreA = match.score.regularTime.home;
        apiScoreB = match.score.regularTime.away;

        // 2. Si hubo prórroga, LE SUMAMOS los goles que ocurrieron en esos 30 minutos
        if (match.score?.extraTime && match.score.extraTime.home !== null && match.score.extraTime.away !== null) {
          apiScoreA += match.score.extraTime.home;
          apiScoreB += match.score.extraTime.away;
        }
      } 
      // 3. Fallback (por si acaso la API omite regularTime)
      else if (match.score?.fullTime && match.score.fullTime.home !== null) {
        apiScoreA = match.score.fullTime.home;
        apiScoreB = match.score.fullTime.away;
      }
      
      const existingMatch = existingMatches?.find(m => m.api_fixture_id === match.id);

      if (apiScoreA === null && existingMatch?.score_a !== null && existingMatch?.score_a !== undefined) {
        apiScoreA = existingMatch.score_a;
      }
      if (apiScoreB === null && existingMatch?.score_b !== null && existingMatch?.score_b !== undefined) {
        apiScoreB = existingMatch.score_b;
      }
      
      const status = match.status === 'FINISHED' ? 'finished' : 'pending';

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

    const { error } = await supabase
      .from('matches')
      .upsert(matchesToInsert, { onConflict: 'api_fixture_id' });

    if (error) throw error;

    if (hayPartidosTerminados) {
      const calculateUrl = `${url.origin}/api/calculate-points?secret=${secret}`;
      fetch(calculateUrl).catch(e => console.error("Error al autocalcular puntos:", e));
    }

    return NextResponse.json({ 
      success: true, 
      message: `¡Sincronización exitosa! Se procesaron ${matchesToInsert.length} partidos, sumando prórrogas y evadiendo penales.` 
    });

  } catch (error) {
    console.error("Error en el servidor:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}