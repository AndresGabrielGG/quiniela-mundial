import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// 1. La estructura exacta de Football-Data.org
interface FDataMatch {
  id: number;
  utcDate: string;
  status: string;
  homeTeam: { name: string; crest: string };
  awayTeam: { name: string; crest: string };
  score: {
    fullTime: { home: number | null; away: number | null };
  };
}

export async function GET(request: Request) {
  try {
    // 1. VERIFICACIÓN DE SEGURIDAD
    // Leemos la URL para buscar la contraseña (ej: /api/sync-matches?secret=mi_super_contraseña...)
    const { searchParams } = new URL(request.url)
    const secret = searchParams.get('secret')

    if (secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: "No tienes permiso para hacer esto" }, { status: 401 })
    }
    // El código 'WC' es el identificador universal para la Copa del Mundo aquí
    const response = await fetch('https://api.football-data.org/v4/competitions/WC/matches', {
      headers: {
        'X-Auth-Token': process.env.FOOTBALL_DATA_KEY as string,
      },
      cache: 'no-store' 
    });
    
    const data = await response.json();

    if (!data.matches || data.matches.length === 0) {
      console.error("Respuesta de la API:", data);
      return NextResponse.json({ error: "No se encontraron partidos" }, { status: 400 });
    }

    // 2. Formateamos los datos
    const matchesToInsert = data.matches.map((match: FDataMatch) => {
      // Manejamos los equipos que aún no están definidos (ej. Octavos de final)
      const teamA = match.homeTeam?.name || 'Por definir';
      const teamB = match.awayTeam?.name || 'Por definir';
      const logoA = match.homeTeam?.crest || '';
      const logoB = match.awayTeam?.crest || '';
      
      return {
        api_fixture_id: match.id,
        team_a: teamA,
        team_b: teamB,
        home_logo: logoA,
        away_logo: logoB,
        kickoff_time: match.utcDate,
        // Trae los goles en vivo
        score_a: match.score?.fullTime?.home ?? null,
        score_b: match.score?.fullTime?.away ?? null,
        // Nota realista: Esta API gratis te da el estado y goles en vivo, pero no el cronómetro minuto a minuto
        match_minute: null, 
        full_status: match.status,
        // Traducimos su estado al nuestro
        status: match.status === 'FINISHED' ? 'finished' : 'pending'
      };
    });

    // 3. Guardamos en la Base de Datos
    const { error } = await supabase
      .from('matches')
      .upsert(matchesToInsert, { onConflict: 'api_fixture_id' });

    if (error) throw error;

    return NextResponse.json({ 
      success: true, 
      message: `¡Sincronización exitosa! Se procesaron ${matchesToInsert.length} partidos del Mundial 2026.` 
    });

  } catch (error) {
    console.error("Error en el servidor:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}