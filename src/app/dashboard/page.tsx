"use client"

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { User } from '@supabase/supabase-js'
import Image from 'next/image'

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
  const [role, setRole] = useState<string>('user')
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
      
      const { data: profile } = await supabase.from('profiles').select('total_points, role').eq('id', session.user.id).single()
      if (profile) {
        setTotalPoints(profile.total_points)
        setRole(profile.role)
      }

      const { data: matchesData } = await supabase
        .from('matches')
        .select('*')
        .order('kickoff_time', { ascending: true })

      if (matchesData) setMatches(matchesData)

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

      const { data: allPreds } = await supabase
        .from('match_predictions')
        .select('match_id, pred_a, pred_b, profiles(username, avatar_url)')
      
      if (allPreds) {
        setGroupPredictions(allPreds as unknown as GroupPrediction[])
      }
    }
    fetchData()

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

  const saveAllPredictions = async () => {
    const validPredictions = Object.entries(predictions)
      .filter(([_, pred]) => pred.pred_a !== '' && pred.pred_b !== '')
      .map(([matchId, pred]) => ({
        user_id: user?.id,
        match_id: matchId,
        pred_a: parseInt(pred.pred_a),
        pred_b: parseInt(pred.pred_b)
      }));

    if (validPredictions.length === 0) {
      alert('Por favor ingresa ambos resultados en al menos un partido antes de guardar.')
      return
    }

    const { error } = await supabase
      .from('match_predictions')
      .upsert(validPredictions, { onConflict: 'user_id,match_id' })

    if (error) {
      alert('Error al guardar: ' + error.message)
    } else {
      alert(`¡${validPredictions.length} predicciones guardadas con éxito! ⚽`)
      const { data: allPreds } = await supabase.from('match_predictions').select('match_id, pred_a, pred_b, profiles(username, avatar_url)')
      if (allPreds) setGroupPredictions(allPreds as unknown as GroupPrediction[])
    }
  }

  if (!user) return <p className="min-h-screen bg-black text-white p-8 flex items-center justify-center font-sztos font-black text-3xl tracking-widest">CARGANDO...</p>

  return (
    <main className="min-h-screen bg-black text-white p-4 md:p-8 font-sans">
      <div className="max-w-5xl mx-auto">
        
        {/* CABECERA AL ESTILO 26 */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-[#111] border-4 border-white p-6 mb-8 gap-6 rounded-none shadow-[8px_8px_0px_#ccff00]">
          <div className="flex items-center gap-4">
            {user.user_metadata.avatar_url && (
              <Image src={user.user_metadata.avatar_url} alt="Avatar" width={56} height={56} className="border-2 border-white object-cover rounded-full" />
            )}
            <div>
              <h2 className="text-2xl font-sztos font-black uppercase tracking-wider">{user.user_metadata.full_name}</h2>
              <p className="text-[#ccff00] font-black text-lg mt-1">{totalPoints} PTS</p>
            </div>
          </div>
          
          <div className="flex flex-wrap gap-3 w-full md:w-auto font-sztos font-black">
            <button onClick={() => router.push('/bracket')} className="bg-[#5500ff] text-white px-5 py-2 uppercase tracking-wider border-2 border-white hover:bg-white hover:text-black transition-colors flex-1 md:flex-none">
              Bracket
            </button>
            <button onClick={() => router.push('/premios')} className="bg-[#ff004d] text-white px-5 py-2 uppercase tracking-wider border-2 border-white hover:bg-white hover:text-black transition-colors flex-1 md:flex-none">
              Premios
            </button>
            <button onClick={() => router.push('/ranking')} className="bg-[#00e5ff] text-black px-5 py-2 uppercase tracking-wider border-2 border-white hover:bg-white hover:text-black transition-colors flex-1 md:flex-none">
              Ranking
            </button>
            <button onClick={async () => { await supabase.auth.signOut(); router.push('/'); }} className="bg-transparent text-white px-5 py-2 uppercase tracking-wider border-2 border-white hover:bg-red-600 transition-colors w-full md:w-auto">
              Salir
            </button>
          </div>
        </div>

        {role === 'admin' && (
          <div className="mb-8 p-4 bg-white text-black border-4 border-black flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-[6px_6px_0px_#ff004d]">
            <div className="flex items-center gap-3">
              <span className="text-3xl">⚙️</span>
              <div>
                <h2 className="font-sztos font-black uppercase tracking-tighter text-2xl">Modo Admin</h2>
                <p className="text-sm font-bold text-gray-600 font-sans">Acceso al Centro de Mando.</p>
              </div>
            </div>
            <button onClick={() => router.push('/admin')} className="w-full md:w-auto bg-black text-white font-sztos font-black text-xl py-2 px-6 hover:bg-[#ff004d] transition-colors">
              ENTRAR
            </button>
          </div>
        )}

        <div className="flex justify-between items-end mb-6 border-b-4 border-white pb-3">
          <h3 className="text-3xl md:text-4xl font-sztos font-black text-white tracking-wide">CALENDARIO OFICIAL</h3>
          <button onClick={saveAllPredictions} className="hidden md:block bg-[#ccff00] text-black font-sztos font-black text-xl py-2 px-6 border-2 border-white hover:bg-white transition-colors">
            GUARDAR TODO
          </button>
        </div>
        
        <div className="flex flex-col gap-6">
          {matches.map((match) => {
            const hasStarted = new Date(match.kickoff_time) < new Date()
            const pred = predictions[match.id] || { pred_a: '', pred_b: '' }
            const matchGroupPreds = groupPredictions.filter(p => p.match_id === match.id)

            return (
              <div key={match.id} className="bg-[#0a0a0a] border-4 border-[#222] hover:border-white transition-colors flex flex-col overflow-hidden relative">
                
                <div className="h-2 w-full bg-gradient-to-r from-[#5500ff] via-[#ff004d] to-[#00e5ff]" />

                <div className="p-4 md:p-6 flex flex-col xl:flex-row items-center justify-between gap-6">
                  
                  <div className="w-full xl:w-48 shrink-0 flex flex-row xl:flex-col justify-between xl:justify-center items-center xl:items-start border-b-2 border-[#333] xl:border-none pb-3 xl:pb-0">
                    <div className="font-black text-gray-400 uppercase tracking-widest text-sm xl:text-base">
                      {new Date(match.kickoff_time).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })} <span className="text-white mx-1">•</span> {new Date(match.kickoff_time).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    {hasStarted && (
                      <div className={`mt-1 font-sztos font-black tracking-widest text-lg px-3 py-1 inline-block border-2 border-white ${match.status === 'finished' ? 'bg-white text-black' : 'bg-[#ccff00] text-black animate-pulse'}`}>
                        {match.status === 'finished' ? 'FINAL' : 'EN VIVO'}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col md:flex-row items-stretch md:items-center bg-[#111] border-2 border-white rounded-2xl md:rounded-full flex-1 max-w-2xl w-full justify-center shadow-lg overflow-hidden">
                    
                    {/* EQUIPO A - Usando font-normal para que no se deforme */}
                    <div className="flex items-center justify-center md:justify-end gap-3 flex-1 py-3 px-4 bg-[#1a1a1a] md:bg-transparent border-b-2 md:border-b-0 md:border-r-2 border-[#333]">
                      <span className="font-sztos font-normal tracking-wider text-2xl md:text-3xl text-white truncate max-w-[120px] md:max-w-none">{match.team_a.substring(0, 3).toUpperCase()}</span>
                      {match.home_logo && <img src={match.home_logo} alt="logo" className="w-8 h-8 md:w-10 md:h-10 object-contain bg-white rounded-full p-0.5" />}
                    </div>
                    
                    {/* ZONA CENTRAL DE NÚMEROS - Usando font-black original */}
                    <div className="flex items-center justify-center gap-3 px-6 py-4 bg-white border-y-2 md:border-y-0 border-white min-w-[160px]">
                      {!hasStarted ? (
                        <>
                          <input 
                            type="number" min="0" value={pred.pred_a ?? ''} onChange={(e) => handleInputChange(match.id, 'a', e.target.value)}
                            className="w-12 h-12 md:w-14 md:h-14 text-center bg-black border-2 border-black font-sztos font-black text-2xl md:text-3xl text-white focus:border-[#ff004d] outline-none transition-all rounded-md" 
                          />
                          <span className="text-black font-black text-xl">-</span>
                          <input 
                            type="number" min="0" value={pred.pred_b ?? ''} onChange={(e) => handleInputChange(match.id, 'b', e.target.value)}
                            className="w-12 h-12 md:w-14 md:h-14 text-center bg-black border-2 border-black font-sztos font-black text-2xl md:text-3xl text-white focus:border-[#ff004d] outline-none transition-all rounded-md" 
                          />
                        </>
                      ) : (
                        <div className="flex flex-col items-center">
                          <div className="flex items-center gap-3 text-black font-sztos font-black text-4xl md:text-5xl">
                            <span>{match.score_a ?? 0}</span>
                            <span className="text-gray-300 text-2xl">-</span>
                            <span>{match.score_b ?? 0}</span>
                          </div>
                        </div>
                      )}
                    </div>
                    
                    {/* EQUIPO B - Usando font-normal para que no se deforme */}
                    <div className="flex items-center justify-center md:justify-start gap-3 flex-1 py-3 px-4 bg-[#1a1a1a] md:bg-transparent border-t-2 md:border-t-0 md:border-l-2 border-[#333]">
                      {match.away_logo && <img src={match.away_logo} alt="logo" className="w-8 h-8 md:w-10 md:h-10 object-contain bg-white rounded-full p-0.5" />}
                      <span className="font-sztos font-normal tracking-wider text-2xl md:text-3xl text-white truncate max-w-[120px] md:max-w-none">{match.team_b.substring(0, 3).toUpperCase()}</span>
                    </div>
                  </div>

                  <div className="w-full xl:w-48 shrink-0 flex flex-col items-center xl:items-end justify-center mt-2 xl:mt-0 gap-2">
                    {hasStarted && (
                      <div className="text-xs font-black uppercase text-white tracking-widest bg-[#333] px-3 py-1 rounded-full text-center">
                        Tu Pick: {(pred.pred_a !== '' && pred.pred_a !== undefined) ? `${pred.pred_a} - ${pred.pred_b}` : 'N/A'}
                      </div>
                    )}

                    {!hasStarted ? (
                      <button onClick={saveAllPredictions} className="w-full md:w-auto bg-white text-black font-sztos font-black text-lg tracking-widest py-2 px-6 border-2 border-black hover:bg-[#ccff00] transition-colors mt-2 xl:mt-0">
                        GUARDAR
                      </button>
                    ) : (
                      <button 
                        onClick={() => setExpandedMatch(expandedMatch === match.id ? null : match.id)} 
                        className="w-full md:w-auto bg-[#222] text-white font-sztos font-black py-2 px-4 border-2 border-[#444] hover:bg-white hover:text-black transition-colors uppercase text-sm tracking-widest mt-2"
                      >
                        {expandedMatch === match.id ? 'CERRAR' : 'VER GRUPO'}
                      </button>
                    )}
                  </div>
                </div>

                {hasStarted && expandedMatch === match.id && (
                  <div className="bg-[#111] p-6 border-t-4 border-[#222] flex flex-wrap gap-4">
                    {matchGroupPreds.length > 0 ? (
                      matchGroupPreds.map((p, idx) => {
                        let pts: number | null = null;
                        let colorClass = "bg-[#222] border-[#444] text-gray-400"; 
                        let textClass = "text-white";

                        if (match.score_a !== null && match.score_b !== null) {
                          const acertoMarcador = p.pred_a === match.score_a && p.pred_b === match.score_b;
                          const acertoGanador = 
                            (p.pred_a > p.pred_b && match.score_a > match.score_b) || 
                            (p.pred_a < p.pred_b && match.score_a < match.score_b) || 
                            (p.pred_a === p.pred_b && match.score_a === match.score_b);
                          const acertoGoles = p.pred_a === match.score_a || p.pred_b === match.score_b;

                          if (acertoMarcador) pts = 3;
                          else if (acertoGanador && acertoGoles) pts = 2;
                          else if (acertoGanador) pts = 1;
                          else pts = 0;

                          if (pts === 3) {
                            colorClass = "bg-[#ccff00]/10 border-[#ccff00]"; 
                            textClass = "text-[#ccff00]";
                          } else if (pts > 0) {
                            colorClass = "bg-[#ff5500]/10 border-[#ff5500]"; 
                            textClass = "text-[#ff5500]";
                          } else {
                            colorClass = "bg-[#ff004d]/10 border-[#ff004d]"; 
                            textClass = "text-[#ff004d]";
                          }
                        }

                        return (
                          <div key={idx} className={`flex items-center gap-3 px-4 py-2 border-2 transition-all ${colorClass}`}>
                            {p.profiles?.avatar_url ? (
                              <img src={p.profiles.avatar_url} alt="avatar" className="w-8 h-8 rounded-full border border-white/20 object-cover" />
                            ) : (
                              <div className="w-8 h-8 bg-[#333] flex items-center justify-center font-sztos font-black text-white border border-white/20 rounded-full">
                                {p.profiles?.username?.charAt(0).toUpperCase()}
                              </div>
                            )}
                            <span className="font-bold uppercase tracking-wider text-white text-sm">{p.profiles?.username?.split(' ')[0]}</span>
                            <span className={`font-sztos font-black text-2xl tracking-widest ${textClass}`}>{p.pred_a} - {p.pred_b}</span>
                            
                            {pts !== null && (
                              <span className={`font-sztos font-black text-lg ml-2 px-2 py-0.5 border ${
                                pts === 3 ? 'bg-[#ccff00] text-black border-[#ccff00]' : 
                                pts > 0 ? 'bg-[#ff5500] text-white border-[#ff5500]' : 
                                'bg-[#ff004d] text-white border-[#ff004d]'
                              }`}>
                                +{pts}
                              </span>
                            )}
                          </div>
                        )
                      })
                    ) : (
                      <p className="font-bold uppercase tracking-widest text-gray-500 w-full text-center py-4">Nadie jugó este partido.</p>
                    )}
                  </div>
                )}

              </div>
            )
          })}
        </div>

        <button 
          onClick={saveAllPredictions} 
          className="md:hidden fixed bottom-6 right-6 bg-[#ccff00] text-black font-sztos font-black text-2xl p-4 shadow-[4px_4px_0px_#fff] border-2 border-black z-50 active:translate-y-1 active:shadow-none transition-all"
        >
          💾
        </button>

      </div>
    </main>
  )
}