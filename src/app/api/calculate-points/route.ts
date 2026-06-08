import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const secret = searchParams.get('secret')

    if (secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: "No tienes permiso" }, { status: 401 })
    }

    const { data: finishedMatches, error: matchError } = await supabase
      .from('matches')
      .select('id, score_a, score_b')
      .eq('status', 'finished')
      .eq('points_calculated', false)

    if (matchError || !finishedMatches || finishedMatches.length === 0) {
      return NextResponse.json({ message: "No hay partidos nuevos para calcular" })
    }

    let partidosProcesados = 0;

    for (const match of finishedMatches) {
      if (match.score_a === null || match.score_b === null) continue;

      const { data: predictions } = await supabase
        .from('match_predictions')
        .select('user_id, pred_a, pred_b')
        .eq('match_id', match.id)

      if (predictions) {
        for (const pred of predictions) {
          let puntosGanados = 0;

          // Variables de ayuda para que el código sea fácil de leer
          const acertoMarcadorExacto = pred.pred_a === match.score_a && pred.pred_b === match.score_b;
          
          const acertoGanador = 
            (pred.pred_a > pred.pred_b && match.score_a > match.score_b) || 
            (pred.pred_a < pred.pred_b && match.score_a < match.score_b) || 
            (pred.pred_a === pred.pred_b && match.score_a === match.score_b);
            
          const acertoGolesDeUnEquipo = pred.pred_a === match.score_a || pred.pred_b === match.score_b;

          // --- EL NUEVO SISTEMA DE PUNTOS 3-2-1 ---
          if (acertoMarcadorExacto) {
            puntosGanados = 3; // Nivel 1: Perfección
          } 
          else if (acertoGanador && acertoGolesDeUnEquipo) {
            puntosGanados = 2; // Nivel 2: Ganador + 1 Marcador
          } 
          else if (acertoGanador) {
            puntosGanados = 1; // Nivel 3: Solo el ganador
          }

          // Si ganó algo, se lo sumamos
          if (puntosGanados > 0) {
            const { data: userProfile } = await supabase
              .from('profiles')
              .select('total_points')
              .eq('id', pred.user_id)
              .single()

            const currentPoints = userProfile?.total_points || 0;

            await supabase
              .from('profiles')
              .update({ total_points: currentPoints + puntosGanados })
              .eq('id', pred.user_id)
          }
        }
      }

      // Marcamos el partido como calculado
      await supabase
        .from('matches')
        .update({ points_calculated: true })
        .eq('id', match.id)
        
      partidosProcesados++;
    }

    return NextResponse.json({ 
      success: true, 
      message: `Se calcularon los puntos de ${partidosProcesados} partidos finalizados.` 
    })

  } catch (error) {
    console.error("Error al calcular puntos:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}