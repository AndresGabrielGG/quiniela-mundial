"use client"

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import Image from 'next/image'

interface Profile { id: string; username: string; avatar_url: string; points_quiniela: number; }
interface Match { id: string; team_a: string; team_b: string; home_logo: string; away_logo: string; kickoff_time: string; status: string; score_a: number | null; score_b: number | null; }
interface Prediction { match_id: string; pred_a: number; pred_b: number; }

export default function UserPredictionsViewer() {
  const params = useParams()
  const router = useRouter()
  const targetUserId = params.id as string

  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [matches, setMatches] = useState<Match[]>([])
  const [predictions, setPredictions] = useState<Record<string, Prediction>>({})
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  useEffect(() => {
    const fetchUserData = async () => {
      // Identificar quién está mirando la pantalla (para saber si puede levantar el candado de seguridad)
      const { data: { session } } = await supabase.auth.getSession()
      if (session) setCurrentUserId(session.user.id)

      // Traer perfil inspeccionado
      const { data: userProfile } = await supabase.from('profiles').select('id, username, avatar_url, points_quiniela').eq('id', targetUserId).single()
      if (!userProfile) { router.push('/ranking'); return }
      setProfile(userProfile)

      // Traer todos los partidos del calendario oficial
      const { data: matchesData } = await supabase.from('matches').select('*').order('kickoff_time', { ascending: false })
      if (matchesData) setMatches(matchesData)

      // Traer las predicciones del usuario inspeccionado
      const { data: predsData } = await supabase.from('match_predictions').select('*').eq('user_id', targetUserId)
      if (predsData) {
        const mappedPreds: Record<string, Prediction> = {}
        predsData.forEach(p => { mappedPreds[p.match_id] = p })
        setPredictions(mappedPreds)
      }

      setLoading(false)
    }
    fetchUserData()
  }, [targetUserId, router])

  if (loading) return <div className="min-h-screen bg-black text-[#00e5ff] flex items-center justify-center font-black text-3xl tracking-widest animate-pulse">REVISANDO HISTORIAL...</div>

  return (
    <main className="min-h-screen bg-black text-white p-4 md:p-8 font-sans">
      <div className="max-w-4xl mx-auto">
        
        {/* ENCABEZADO CON DESGLOSE DE RIVAL */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-[#111] border-4 border-white p-6 mb-8 gap-6 shadow-[8px_8px_0px_#00e5ff]">
          <div className="flex items-center gap-4">
            {profile?.avatar_url ? (
              <Image src={profile.avatar_url} alt="Avatar" width={56} height={56} className="border-2 border-white object-cover rounded-full" />
            ) : (
              <div className="w-14 h-14 rounded-full bg-[#222] border-2 border-white flex items-center justify-center font-bold text-2xl">{profile?.username?.charAt(0).toUpperCase()}</div>
            )}
            <div>
              <p className="text-gray-400 text-xs font-bold uppercase tracking-widest">Historial de Quiniela</p>
              <h2 className="text-2xl font-black uppercase tracking-wider mt-0.5">{profile?.username}</h2>
            </div>
          </div>
          <div className="flex items-center justify-between md:justify-end gap-6 w-full md:w-auto w-full">
            <div className="text-right">
              <span className="text-[#ccff00] font-black text-3xl tracking-wider">{profile?.points_quiniela || 0}</span>
              <span className="text-xs text-gray-500 font-bold tracking-widest uppercase block">PTS QUINIELA</span>
            </div>
            <Link href="/ranking" className="bg-[#ff004d] text-white px-5 py-2 border-2 border-white font-bold uppercase tracking-wider text-sm hover:bg-white hover:text-black transition-colors text-center">
              Volver
            </Link>
          </div>
        </div>

        {/* LISTADO DE TARJETAS COMPACTAS Y EFICIENTES */}
        <div className="flex flex-col gap-4">
          {matches.map((match) => {
            const matchPrediction = predictions[match.id]
            const isMatchUpcoming = new Date(match.kickoff_time) > new Date()
            
            // Candado de seguridad: Bloqueado si el partido no ha empezado Y el que mira NO es el dueño de la quiniela
            const isSecret = isMatchUpcoming && currentUserId !== targetUserId

            let ptsEarned: number | null = null
            let badgeStyle = "bg-[#222] text-gray-400 border-[#333]"

            // Lógica matemática de puntos en tiempo real para partidos finalizados
            if (match.status === 'finished' && matchPrediction && match.score_a !== null && match.score_b !== null) {
              const exact = matchPrediction.pred_a === match.score_a && matchPrediction.pred_b === match.score_b
              const winner = (matchPrediction.pred_a > matchPrediction.pred_b && match.score_a > match.score_b) ||
                             (matchPrediction.pred_a < matchPrediction.pred_b && match.score_a < match.score_b) ||
                             (matchPrediction.pred_a === matchPrediction.pred_b && match.score_a === match.score_b)
              const goals = matchPrediction.pred_a === match.score_a || matchPrediction.pred_b === match.score_b

              if (exact) { ptsEarned = 3; badgeStyle = "bg-[#ccff00] text-black border-[#ccff00] shadow-[0_0_10px_rgba(204,255,0,0.2)]"; }
              else if (winner && goals) { ptsEarned = 2; badgeStyle = "bg-[#ff5500] text-white border-[#ff5500]"; }
              else if (winner) { ptsEarned = 1; badgeStyle = "bg-[#ff5500]/40 text-white border-[#ff5500]/50"; }
              else { ptsEarned = 0; badgeStyle = "bg-[#ff004d]/10 text-[#ff004d] border-[#ff004d]/40"; }
            }

            return (
              <div key={match.id} className="bg-[#0e0e0e] border-2 border-[#222] p-3 md:p-4 flex flex-col md:flex-row items-center justify-between gap-4 rounded-none">
                
                {/* Info básica del partido */}
                <div className="text-center md:text-left min-w-[120px]">
                  <span className="text-xs font-black text-gray-500 uppercase block tracking-wider">
                    {new Date(match.kickoff_time).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })} • {new Date(match.kickoff_time).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="text-[10px] font-bold text-gray-600 uppercase tracking-widest block mt-0.5">
                    {match.status === 'finished' ? 'Fase Terminada' : 'No Iniciado'}
                  </span>
                </div>

                {/* Bloque central: Equipos y Marcadores comparados */}
                <div className="flex items-center justify-center bg-[#151515] border border-[#222] rounded-xl md:rounded-full px-4 py-2 flex-1 max-w-xl w-full gap-2 md:gap-4 overflow-hidden">
                  
                  {/* Team A */}
                  <div className="flex items-center justify-end gap-2 flex-1 min-w-0">
                    <span className="font-bold text-sm md:text-base text-gray-300 uppercase truncate">{match.team_a.substring(0, 3)}</span>
                    {match.home_logo && <img src={match.home_logo} alt="L" className="w-5 h-5 object-contain bg-white rounded-full p-0.5 shrink-0" />}
                  </div>

                  {/* Comparativa Gráfica Eficiente */}
                  <div className="flex items-center gap-2 px-2 shrink-0">
                    {/* CUADRO 1: Resultado de la Vida Real */}
                    <div className="flex items-center justify-center bg-white text-black font-black text-base md:text-lg px-3 py-1 border border-black rounded min-w-[54px]" title="Resultado Oficial Real">
                      {match.score_a !== null ? `${match.score_a}-${match.score_b}` : 'Pending'}
                    </div>

                    <span className="text-gray-600 font-bold text-xs uppercase tracking-tighter">vs</span>

                    {/* CUADRO 2: Lo que puso el usuario */}
                    <div className="flex items-center justify-center bg-black text-white border-2 border-white font-black text-base md:text-lg px-3 py-1 rounded min-w-[54px]" title="Pick del Usuario">
                      {isSecret ? (
                        <span className="text-xs" title="Pronóstico bloqueado temporalmente">🔒</span>
                      ) : matchPrediction ? (
                        `${matchPrediction.pred_a}-${matchPrediction.pred_b}`
                      ) : (
                        <span className="text-xs text-gray-600 font-bold">N/A</span>
                      )}
                    </div>
                  </div>

                  {/* Team B */}
                  <div className="flex items-center justify-start gap-2 flex-1 min-w-0">
                    {match.away_logo && <img src={match.away_logo} alt="L" className="w-5 h-5 object-contain bg-white rounded-full p-0.5 shrink-0" />}
                    <span className="font-bold text-sm md:text-base text-gray-300 uppercase truncate">{match.team_b.substring(0, 3)}</span>
                  </div>

                </div>

                {/* Medalla del puntaje ganado */}
                <div className="w-full md:w-20 flex justify-center md:justify-end shrink-0">
                  {ptsEarned !== null ? (
                    <span className={`font-black text-sm md:text-base px-3 py-1 border-2 tracking-wider uppercase text-center w-full md:w-auto ${badgeStyle}`}>
                      +{ptsEarned} PTS
                    </span>
                  ) : (
                    <span className="font-bold text-xs text-gray-600 uppercase tracking-widest text-center w-full md:w-auto">
                      {isSecret ? 'Oculto' : 'Sin Pick'}
                    </span>
                  )}
                </div>

              </div>
            )
          })}
          
          {matches.length === 0 && (
            <p className="text-gray-500 font-bold uppercase tracking-widest text-center py-12">No hay partidos registrados en el sistema.</p>
          )}
        </div>

      </div>
    </main>
  )
}