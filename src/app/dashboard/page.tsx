"use client"

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { User } from '@supabase/supabase-js'
import Image from 'next/image'

// Interfaces para TypeScript
interface Match {
  id: string;
  team_a: string;
  team_b: string;
  home_logo: string;
  away_logo: string;
  kickoff_time: string;
  status: string;
  score_a: number | null;
  score_b: number | null;
}

interface GroupPrediction {
  match_id: string;
  pred_a: number;
  pred_b: number;
  profiles: {
    username: string;
    avatar_url: string;
  };
}

export default function Dashboard() {
  const [user, setUser] = useState<User | null>(null)
  const [totalPoints, setTotalPoints] = useState(0)
  const [role, setRole] = useState<string>('user') // NUEVO: Estado para el rol
  const [matches, setMatches] = useState<Match[]>([])
  const [predictions, setPredictions] = useState<Record<string, { pred_a: string, pred_b: string }>>({})
  
  const [groupPredictions, setGroupPredictions] = useState<GroupPrediction[]>([])
  const [expandedMatch, setExpandedMatch] = useState<string | null>(null)
  
  const router = useRouter()

  useEffect(() => {
    const fetchData = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.push('/')
        return
      }
      setUser(session.user)
      
      // NUEVO: Traemos el rol junto con los puntos
      const { data: profile } = await supabase.from('profiles').select('total_points, role').eq('id', session.user.id).single()
      if (profile) {
        setTotalPoints(profile.total_points)
        setRole(profile.role)
      }

      // 1. Traer los partidos
      const { data: matchesData } = await supabase
        .from('matches')
        .select('*')
        .order('kickoff_time', { ascending: true })

      if (matchesData) setMatches(matchesData)

      // 2. Traer TUS predicciones
      const { data: predsData } = await supabase
        .from('match_predictions')
        .select('*')
        .eq('user_id', session.user.id)

      if (predsData) {
        const loadedPreds: Record<string, { pred_a: string, pred_b: string }> = {}
        predsData.forEach(p => {
          loadedPreds[p.match_id] = { pred_a: p.pred_a.toString(), pred_b: p.pred_b.toString() }
        })
        setPredictions(loadedPreds)
      }

      // 3. Traer TODAS las predicciones
      const { data: allPreds } = await supabase
        .from('match_predictions')
        .select('match_id, pred_a, pred_b, profiles(username, avatar_url)')
      
      if (allPreds) {
        setGroupPredictions(allPreds as unknown as GroupPrediction[])
      }
    }
    fetchData()

    // ESCUCHAR CAMBIOS EN TIEMPO REAL
    const channel = supabase
      .channel('partidos-en-vivo')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'matches' },
        (payload) => {
          setMatches((prevMatches) =>
            prevMatches.map((match) =>
              match.id === payload.new.id ? { ...match, ...payload.new } : match
            )
          )
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [router])

  const handleInputChange = (matchId: string, team: 'a' | 'b', value: string) => {
    setPredictions(prev => ({
      ...prev,
      [matchId]: {
        ...(prev[matchId] || { pred_a: '', pred_b: '' }),
        [`pred_${team}`]: value
      }
    }))
  }

  const savePrediction = async (matchId: string) => {
    const pred = predictions[matchId]
    if (!pred || pred.pred_a === '' || pred.pred_b === '') {
      alert('Por favor ingresa ambos resultados')
      return
    }

    const { error } = await supabase
      .from('match_predictions')
      .upsert({
        user_id: user?.id,
        match_id: matchId,
        pred_a: parseInt(pred.pred_a),
        pred_b: parseInt(pred.pred_b)
      }, { onConflict: 'user_id,match_id' })

    if (error) {
      alert('Error al guardar: ' + error.message)
    } else {
      alert('¡Predicción guardada! ⚽')
      const { data: allPreds } = await supabase.from('match_predictions').select('match_id, pred_a, pred_b, profiles(username, avatar_url)')
      if (allPreds) setGroupPredictions(allPreds as unknown as GroupPrediction[])
    }
  }

  if (!user) return <p className="min-h-screen bg-slate-900 text-white p-8">Cargando tu quiniela...</p>

  return (
    <main className="min-h-screen bg-slate-900 text-white p-8">
      <div className="max-w-4xl mx-auto">
        
        {/* Cabecera del Usuario */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-slate-800 p-4 rounded-xl mb-6 shadow-md gap-4">
          <div className="flex items-center gap-4">
            {user.user_metadata.avatar_url && (
              <Image src={user.user_metadata.avatar_url} alt="Avatar" width={48} height={48} className="rounded-full border-2 border-emerald-400" />
            )}
            <div>
              <h2 className="text-xl font-bold">Hola, {user.user_metadata.full_name}</h2>
              <p className="text-emerald-400 font-semibold">{totalPoints} Puntos acumulados</p>
            </div>
          </div>
          
          <div className="flex flex-wrap gap-2 md:gap-3 justify-start md:justify-end w-full md:w-auto">
            {/* NUEVO: Botón del Bracket */}
            <button onClick={() => router.push('/bracket')} className="bg-sky-500/10 text-sky-400 px-4 py-2 rounded-lg hover:bg-sky-500/20 transition-colors font-semibold border border-sky-500/20 text-sm md:text-base flex-1 md:flex-none">
              Bracket 🌳
            </button>
            <button onClick={() => router.push('/premios')} className="bg-amber-500/10 text-amber-400 px-4 py-2 rounded-lg hover:bg-amber-500/20 transition-colors font-semibold border border-amber-500/20 text-sm md:text-base flex-1 md:flex-none">
              Premios 🌟
            </button>
            <button onClick={() => router.push('/ranking')} className="bg-emerald-500/10 text-emerald-400 px-4 py-2 rounded-lg hover:bg-emerald-500/20 transition-colors font-semibold border border-emerald-500/20 text-sm md:text-base flex-1 md:flex-none">
              Ranking 🏆
            </button>
            <button onClick={async () => { await supabase.auth.signOut(); router.push('/'); }} className="bg-red-500/10 text-red-400 px-4 py-2 rounded-lg hover:bg-red-500/20 transition-colors border border-red-500/20 text-sm md:text-base w-full md:w-auto">
              Salir
            </button>
          </div>
        </div>

        {/* NUEVO: BANNER DE ADMINISTRADOR */}
        {role === 'admin' && (
          <div className="mb-8 p-4 bg-emerald-900/30 border border-emerald-500/50 rounded-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="flex items-center gap-3">
              <span className="text-3xl">👑</span>
              <div>
                <h2 className="font-bold text-emerald-400">Modo Administrador Activo</h2>
                <p className="text-sm text-emerald-200/70">Tienes acceso al panel de control y sincronización de APIs.</p>
              </div>
            </div>
            <button 
              onClick={() => router.push('/admin')} 
              className="w-full md:w-auto bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 px-6 rounded-lg transition-all shadow-lg shadow-emerald-900/50"
            >
              Ir al Panel Maestro
            </button>
          </div>
        )}

        <h3 className="text-2xl font-bold mb-4 border-b border-slate-700 pb-2">Calendario Oficial</h3>
        
        <div className="flex flex-col gap-4">
          {matches.map((match) => {
            const hasStarted = new Date(match.kickoff_time) < new Date()
            const pred = predictions[match.id] || { pred_a: '', pred_b: '' }
            const matchGroupPreds = groupPredictions.filter(p => p.match_id === match.id)

            return (
              <div key={match.id} className="bg-slate-800 rounded-xl border border-slate-700 shadow-sm flex flex-col overflow-hidden">
                
                <div className={`p-4 md:p-6 flex flex-col md:flex-row items-center gap-4 ${hasStarted ? 'bg-slate-800/50' : ''}`}>
                  
                  <div className="w-full md:w-44 shrink-0 flex flex-row justify-between items-center md:flex-col md:items-start text-sm text-slate-400 mb-2 md:mb-0 border-b border-slate-700/50 md:border-none pb-2 md:pb-0">
                    <div className="flex items-center md:items-start md:flex-col gap-1 md:gap-0">
                      <span>{new Date(match.kickoff_time).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}</span>
                      <span className="md:hidden">•</span>
                      <span>{new Date(match.kickoff_time).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    {hasStarted && (
                      <p className="text-red-400 font-bold mt-0 md:mt-1">
                        {match.status === 'finished' ? 'Finalizado 🏁' : 'En juego 🔒'}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 md:gap-4 text-xl font-bold flex-1 justify-center">
                    <span className="text-right w-20 md:w-24 text-sm md:text-lg">{match.team_a}</span>
                    {match.home_logo && <img src={match.home_logo} alt="logo" className="w-8 h-8 object-contain" />}
                    
                    {!hasStarted ? (
                      <>
                        <input 
                          type="number" min="0" value={pred.pred_a ?? ''} onChange={(e) => handleInputChange(match.id, 'a', e.target.value)}
                          className="w-12 h-12 text-center bg-slate-900 border border-slate-600 rounded-lg text-white focus:border-emerald-500 outline-none" 
                        />
                        <span className="text-slate-500">-</span>
                        <input 
                          type="number" min="0" value={pred.pred_b ?? ''} onChange={(e) => handleInputChange(match.id, 'b', e.target.value)}
                          className="w-12 h-12 text-center bg-slate-900 border border-slate-600 rounded-lg text-white focus:border-emerald-500 outline-none" 
                        />
                      </>
                    ) : (
                      <div className="flex flex-col items-center justify-center min-w-[100px]">
                        <div className="text-2xl md:text-3xl text-white tracking-widest bg-slate-950 px-4 py-2 rounded-lg border border-slate-700 w-full text-center shadow-inner">
                          {match.score_a ?? 0} - {match.score_b ?? 0}
                        </div>
                        <div className="mt-2 text-xs md:text-sm font-medium text-emerald-400 bg-emerald-900/20 px-3 py-1 rounded-full border border-emerald-800/50 whitespace-nowrap">
                          Pronóstico: {(pred.pred_a !== '' && pred.pred_a !== undefined) ? `${pred.pred_a} - ${pred.pred_b}` : 'Ninguno'}
                        </div>
                      </div>
                    )}
                    
                    {match.away_logo && <img src={match.away_logo} alt="logo" className="w-8 h-8 object-contain" />}
                    <span className="text-left w-20 md:w-24 text-sm md:text-lg">{match.team_b}</span>
                  </div>

                  <div className="w-full md:w-44 shrink-0 flex justify-center md:justify-end">
                    {!hasStarted ? (
                      <button onClick={() => savePrediction(match.id)} className="bg-emerald-500 text-slate-900 font-bold py-2 px-6 rounded-lg hover:bg-emerald-400 transition-colors w-full md:w-auto">
                        Guardar
                      </button>
                    ) : (
                      <button 
                        onClick={() => setExpandedMatch(expandedMatch === match.id ? null : match.id)} 
                        className="bg-slate-700 text-slate-300 font-semibold py-2 px-6 rounded-lg hover:bg-slate-600 transition-colors w-full md:w-auto"
                      >
                        {expandedMatch === match.id ? 'Ocultar grupo' : 'Ver al grupo 👀'}
                      </button>
                    )}
                  </div>
                </div>

                {hasStarted && expandedMatch === match.id && (
                  <div className="bg-slate-900/50 p-4 border-t border-slate-700 flex flex-wrap gap-4">
                    {matchGroupPreds.length > 0 ? (
                      matchGroupPreds.map((p, idx) => (
                        <div key={idx} className="flex items-center gap-2 bg-slate-800 px-3 py-2 rounded-lg border border-slate-700">
                          {p.profiles?.avatar_url ? (
                            <img src={p.profiles.avatar_url} alt="avatar" className="w-6 h-6 rounded-full" />
                          ) : (
                            <div className="w-6 h-6 rounded-full bg-slate-600" />
                          )}
                          <span className="text-sm font-semibold text-slate-300">{p.profiles?.username?.split(' ')[0]}</span>
                          <span className="text-emerald-400 font-bold ml-2">{p.pred_a} - {p.pred_b}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-slate-500 w-full text-center">Nadie hizo predicciones para este partido 😴</p>
                    )}
                  </div>
                )}

              </div>
            )
          })}
        </div>

      </div>
    </main>
  )
}