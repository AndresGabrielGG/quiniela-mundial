"use client"

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'

interface Team { name: string; flag: string; group_letter?: string; }
interface Matchup { team1: Team | null; team2: Team | null; }

// NOTA: Reemplaza esto con tu token real de football-data.org o usa un .env (process.env.NEXT_PUBLIC_FOOTBALL_API_KEY)
const API_TOKEN = 'TU_API_KEY_AQUI' 

// 1. SOLUCIÓN AL TEAMFLAG: Declarado arriba para que todo el archivo lo pueda usar
const TeamFlag = ({ flag, name, className = "w-5 h-5 md:w-6 md:h-6" }: { flag?: string, name?: string, className?: string }) => {
  if (!flag) return <span className="text-base">❔</span>
  if (flag.startsWith('http')) return <img src={flag} alt={name} className={`object-contain ${className}`} />
  return <span className="text-base">{flag}</span>
}

// 2. FUNCIÓN DE MATRIZ DE LA FIFA
const solveThirdPlaceMatrix = (thirds: Team[]): Team[] => {
  const slots = [['A','B','C','D','F'], ['C','D','F','G','H'], ['C','E','F','H','I'], ['E','H','I','J','K'], ['B','E','F','I','J'], ['A','E','H','I','J'], ['E','F','G','I','J'], ['D','E','I','J','L']]
  let result: Team[] | null = null;
  const backtrack = (index: number, current: Team[], used: Set<string>) => {
    if (result) return;
    if (index === 8) { result = [...current]; return; }
    for (const team of thirds) {
      const letter = team.group_letter || '';
      if (!used.has(letter) && slots[index].includes(letter)) {
        used.add(letter); current.push(team); backtrack(index + 1, current, used); current.pop(); used.delete(letter);
      }
    }
  }
  backtrack(0, [], new Set());
  return result || thirds;
}

export default function AdminPanel() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [saving, setSaving] = useState(false)

  const [groups, setGroups] = useState<Record<string, Team[]>>({})
  const [selectedThirds, setSelectedThirds] = useState<Team[]>([])
  const [roundOf32, setRoundOf32] = useState<Matchup[]>([])
  const [picks, setPicks] = useState<(Team | null)[][]>([])

  useEffect(() => {
    const initAdmin = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/'); return }

      const { data } = await supabase.from('profiles').select('role').eq('id', session.user.id).single()
      if (data?.role !== 'admin') { router.push('/dashboard'); return }

      const { data: teamsData } = await supabase.from('teams').select('*').order('group_letter', { ascending: true })
      if (teamsData) {
        const grouped: Record<string, Team[]> = {}
        teamsData.forEach((team) => {
          if (!grouped[team.group_letter]) grouped[team.group_letter] = []
          grouped[team.group_letter].push({ name: team.name, flag: team.flag, group_letter: team.group_letter })
        })
        setGroups(grouped)
      }
      setLoading(false)
    }
    initAdmin()
  }, [router])

  // --- CONEXIÓN REAL A LA API DE FOOTBALL-DATA.ORG ---
  const handleApiSync = async () => {
    setSyncing(true)
    try {
      const res = await fetch('https://api.football-data.org/v4/competitions/2000/standings', {
        headers: { 'X-Auth-Token': API_TOKEN }
      })
      
      if (!res.ok) throw new Error("Error en la conexión con la API o competición no disponible aún.")
      const apiData = await res.json()
      console.log("Datos de la API:", apiData)
      alert("¡Conexión exitosa a football-data.org! Los datos se sincronizarán cuando el torneo esté activo.")
    } catch (error: unknown) {
      // 3. SOLUCIÓN TYPESCRIPT: Cambiado de "any" a "unknown"
      if (error instanceof Error) {
        alert("Aviso de Sincronización: " + error.message + " \nAsegúrate de que tu API Key sea válida.")
      } else {
        alert("Ocurrió un error desconocido durante la sincronización.")
      }
    } finally {
      setSyncing(false)
    }
  }

  // --- EL MOTOR DE PUNTUACIÓN TOTAL ---
  const handlePublishOfficialResults = async () => {
    setSaving(true)
    const champion = picks[4] && picks[4][0] ? picks[4][0].name : null

    // 1. Guardar Bracket Oficial
    const { error: officialError } = await supabase.from('official_bracket').upsert({
      id: 1, group_standings: groups, selected_thirds: selectedThirds, knockout_picks: picks, champion: champion, updated_at: new Date().toISOString()
    })
    if (officialError) { alert("Error: " + officialError.message); setSaving(false); return }

    // 2. Extraer datos para comparar
    const { data: allBrackets } = await supabase.from('brackets').select('*')
    const { data: allMatchPreds } = await supabase.from('match_predictions').select('*')
    const { data: realMatches } = await supabase.from('matches').select('*').eq('status', 'finished')
    
    if (allBrackets) {
      const updates = []

      for (const userBracket of allBrackets) {
        let pointsBracket = 0
        let pointsQuiniela = 0 

        // A) EVALUAR FASE DE GRUPOS (Bono de +5 pts por grupo perfecto)
        Object.keys(groups).forEach(letter => {
          const officialGroup = groups[letter]
          const userGroup = userBracket.group_standings[letter] || []
          
          let perfect = true
          for (let i = 0; i < 4; i++) {
            if (officialGroup[i]?.name !== userGroup[i]?.name) perfect = false
          }
          if (perfect) pointsQuiniela += 5 
        })

        // B) EVALUAR ELIMINATORIAS (2, 4, 8, 16, 32 pts)
        const roundPoints = [2, 4, 8, 16, 32]
        for (let round = 0; round < picks.length; round++) {
          const officialRound = picks[round]
          const userRound = userBracket.knockout_picks[round] || []

          for (let match = 0; match < officialRound.length; match++) {
            if (officialRound[match]?.name && officialRound[match]?.name === userRound[match]?.name) {
              pointsBracket += roundPoints[round]
            }
          }
        }

        // C) EVALUAR PARTIDOS DIARIOS (Dashboard)
        const userMatches = allMatchPreds?.filter(p => p.user_id === userBracket.user_id) || []
        userMatches.forEach(pred => {
          const realMatch = realMatches?.find(m => m.id === pred.match_id)
          if (realMatch && realMatch.score_a !== null && realMatch.score_b !== null) {
            if (pred.pred_a === realMatch.score_a && pred.pred_b === realMatch.score_b) {
              pointsQuiniela += 3
            } else {
              const realDiff = realMatch.score_a - realMatch.score_b
              const predDiff = pred.pred_a - pred.pred_b
              if ((realDiff > 0 && predDiff > 0) || (realDiff < 0 && predDiff < 0) || (realDiff === 0 && predDiff === 0)) {
                pointsQuiniela += 1
              }
            }
          }
        })

        updates.push({ id: userBracket.user_id, points_bracket: pointsBracket, points_quiniela: pointsQuiniela })
      }

      // 3. Actualizar la BD
      for (const update of updates) {
        await supabase.from('profiles').update({
          points_bracket: update.points_bracket,
          points_quiniela: update.points_quiniela,
          total_points: update.points_bracket + update.points_quiniela 
        }).eq('id', update.id)
      }
    }

    alert("🚨 ¡SISTEMA ACTUALIZADO!\n\n1. Bracket oficial guardado.\n2. Bonos de grupo aplicados.\n3. Puntos de partidos diarios sumados.\n4. Ranking global recalculado.")
    setSaving(false)
  }

  // --- ARRASTRAR Y SOLTAR ---
  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return
    const newGroups = { ...groups }
    const groupTeams = Array.from(newGroups[result.source.droppableId])
    const [moved] = groupTeams.splice(result.source.index, 1)
    groupTeams.splice(result.destination.index, 0, moved)
    newGroups[result.source.droppableId] = groupTeams
    setGroups(newGroups); setSelectedThirds([]); setRoundOf32([]); setPicks([])
  }

  const toggleThirdPlace = (team: Team) => {
    if (selectedThirds.some(t => t.name === team.name)) setSelectedThirds(selectedThirds.filter(t => t.name !== team.name))
    else if (selectedThirds.length < 8) setSelectedThirds([...selectedThirds, team])
  }

  const generateBracket = () => {
    const t = (letter: string, pos: number) => groups[letter][pos]
    const thirdsMap = solveThirdPlaceMatrix(selectedThirds)
    const t3 = (slotIndex: number) => thirdsMap[slotIndex]
    
    setRoundOf32([
      { team1: t('E', 0), team2: t3(0) }, { team1: t('I', 0), team2: t3(1) }, { team1: t('A', 1), team2: t('B', 1) }, { team1: t('F', 0), team2: t('C', 1) },
      { team1: t('K', 1), team2: t('L', 1) }, { team1: t('H', 0), team2: t('J', 1) }, { team1: t('D', 0), team2: t3(4) }, { team1: t('G', 0), team2: t3(5) },
      { team1: t('C', 0), team2: t('F', 1) }, { team1: t('E', 1), team2: t('I', 1) }, { team1: t('A', 0), team2: t3(2) }, { team1: t('L', 0), team2: t3(3) },
      { team1: t('J', 0), team2: t('H', 1) }, { team1: t('D', 1), team2: t('G', 1) }, { team1: t('B', 0), team2: t3(6) }, { team1: t('K', 0), team2: t3(7) }
    ])
    setPicks([Array(16).fill(null), Array(8).fill(null), Array(4).fill(null), Array(2).fill(null), Array(1).fill(null)])
  }

  const selectWinner = (roundIndex: number, matchIndex: number, winner: Team) => {
    const newPicks = [...picks.map(r => [...r])]; newPicks[roundIndex][matchIndex] = winner
    for (let r = roundIndex + 1; r < newPicks.length; r++) newPicks[r][Math.floor(matchIndex / Math.pow(2, r - roundIndex))] = null
    setPicks(newPicks)
  }

  const getMatch = (roundIndex: number, matchIndex: number): Matchup => {
    if (roundIndex === 0) return roundOf32[matchIndex]
    return { team1: picks[roundIndex - 1][matchIndex * 2] || null, team2: picks[roundIndex - 1][matchIndex * 2 + 1] || null }
  }

  const renderRoundColumn = (title: string, roundIndex: number, startIndex: number, count: number) => (
    <div key={title + startIndex} className="flex flex-col h-full shrink-0 w-28 md:w-32 lg:w-32 xl:w-36 px-1 lg:px-2">
      <div className="text-center font-bold text-slate-500 mb-2 uppercase tracking-wider text-[10px] xl:text-xs h-5">{title}</div>
      <div className="flex flex-col justify-around flex-1 py-8">
        {Array.from({length: count}).map((_, i) => (
          <div key={i} className="flex items-center justify-center w-full">
            <MatchupNode match={getMatch(roundIndex, startIndex + i)} winner={picks[roundIndex] ? picks[roundIndex][startIndex + i] : null} onSelect={(t) => selectWinner(roundIndex, startIndex + i, t)} />
          </div>
        ))}
      </div>
    </div>
  )

  if (loading) return <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center font-bold text-xl animate-pulse">Verificando seguridad... 🔐</div>

  return (
    <main className="min-h-screen bg-slate-950 text-white p-4 md:p-8">
      <div className="max-w-[1600px] mx-auto">
        
        <div className="flex justify-between items-center mb-8 border-b border-slate-800 pb-6">
          <div><h1 className="text-3xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-500">Centro de Mando</h1><p className="text-slate-400 mt-2 font-mono text-sm">ADMINISTRADOR</p></div>
          <Link href="/dashboard" className="bg-slate-900 text-slate-300 px-4 py-2 rounded-lg border border-slate-700 hover:bg-slate-800 transition-colors">Volver</Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex items-center justify-between">
            <div><h2 className="text-xl font-bold text-white flex items-center gap-2"><span>📡</span> Sincronización API</h2><p className="text-slate-400 text-sm mt-1">Conecta con football-data.org para extraer resultados reales.</p></div>
            <button onClick={handleApiSync} disabled={syncing} className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-6 rounded-xl transition-all shadow-lg flex items-center gap-2 disabled:opacity-50">{syncing ? 'Conectando...' : 'Extraer API'}</button>
          </div>
          <div className="bg-slate-900 border border-emerald-900/50 rounded-2xl p-6 shadow-xl flex items-center justify-between">
            <div><h2 className="text-xl font-bold text-emerald-400 flex items-center gap-2"><span>📢</span> Publicar y Puntear</h2><p className="text-slate-400 text-sm mt-1">Guarda el bracket y recalcula TODOS los puntos de los usuarios.</p></div>
            <button onClick={handlePublishOfficialResults} disabled={saving} className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 px-6 rounded-xl transition-all shadow-lg disabled:opacity-50">{saving ? 'Calculando...' : 'Hacer Oficial 🌍'}</button>
          </div>
        </div>

        {Object.keys(groups).length > 0 && (
          <DragDropContext onDragEnd={onDragEnd}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-8">
              {Object.entries(groups).map(([letter, teams]) => (
                <div key={letter} className="bg-slate-900/50 rounded-xl p-3 border border-slate-800">
                  <h3 className="text-base font-bold text-amber-500 mb-2 border-b border-slate-800 pb-1">Grupo {letter}</h3>
                  <Droppable droppableId={letter}>
                    {(provided) => (
                      <div {...provided.droppableProps} ref={provided.innerRef} className="flex flex-col gap-1.5 min-h-[140px]">
                        {teams.map((team, idx) => (
                          <Draggable key={team.name} draggableId={team.name} index={idx}>
                            {(provided, snapshot) => (
                              <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps} className={`flex items-center gap-3 p-2 rounded border transition-colors text-sm ${snapshot.isDragging ? 'bg-slate-700 border-sky-500 z-50' : 'bg-slate-800 border-slate-700'}`}>
                                <span className={`font-bold w-4 text-center ${idx < 2 ? 'text-emerald-500' : idx === 2 ? 'text-amber-500' : 'text-slate-600'}`}>{idx + 1}</span>
                                <TeamFlag flag={team.flag} name={team.name} />
                                <span className="flex-1 truncate">{team.name}</span><span className="text-slate-500 cursor-grab px-1">≡</span>
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </div>
              ))}
            </div>
          </DragDropContext>
        )}

        <div className="flex flex-wrap gap-2 mb-8 bg-slate-900/50 p-4 rounded-xl border border-slate-800 justify-center">
          {Object.entries(groups).map(([letter, teams]) => {
            const third = teams[2]
            if (!third) return null
            const isSelected = selectedThirds.some(t => t.name === third.name)
            return (
              <button key={letter} onClick={() => toggleThirdPlace(third)} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors border ${isSelected ? 'bg-amber-500 text-slate-900 font-bold border-amber-400' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
                <TeamFlag flag={third.flag} name={third.name} className="w-4 h-4 md:w-5 md:h-5" /><span className="truncate">{third.name}</span>
              </button>
            )
          })}
        </div>

        <div className="flex justify-center pb-8 border-b border-slate-800">
          <button onClick={generateBracket} disabled={selectedThirds.length !== 8} className="bg-sky-600 text-white font-bold py-3 px-8 rounded-xl hover:bg-sky-500 transition-colors disabled:bg-slate-800 disabled:text-slate-600 shadow-lg">
            {selectedThirds.length === 8 ? 'Generar Árbol de Eliminatorias 🌳' : `Faltan terceros (${selectedThirds.length}/8)`}
          </button>
        </div>

        {roundOf32.length > 0 && (
          <div className="mt-8 pb-16 w-full">
            <h2 className="text-3xl font-black mb-6 text-center text-slate-400 tracking-wider">RESULTADOS OFICIALES</h2>
            <div className="w-full overflow-x-auto bg-slate-900/40 rounded-3xl border border-slate-800 scrollbar-thin scrollbar-thumb-sky-600 scrollbar-track-transparent">
              <div className="flex flex-row justify-between min-w-[1100px] xl:min-w-[1300px] h-[1150px] p-4 md:p-8 mx-auto relative">
                {renderRoundColumn("16avos", 0, 0, 8)} {renderRoundColumn("Octavos", 1, 0, 4)} {renderRoundColumn("Cuartos", 2, 0, 2)} {renderRoundColumn("Semis", 3, 0, 1)}
                <div className="flex flex-col justify-center items-center h-full w-44 shrink-0 px-2 relative">
                  <div className="text-center absolute top-12"><span className="text-5xl drop-shadow-xl shadow-amber-500">🏆</span><h3 className="text-lg font-black text-amber-400 tracking-widest mt-2">GRAN FINAL</h3></div>
                  <div className="w-full relative z-10"><MatchupNode match={getMatch(4, 0)} winner={picks[4] ? picks[4][0] : null} onSelect={(t) => selectWinner(4, 0, t)} /></div>
                  <div className="absolute bottom-24 w-full flex flex-col items-center">
                    <h4 className="text-emerald-400 font-bold mb-2">CAMPEÓN OFICIAL</h4>
                    <div className={`border-2 rounded-xl p-3 flex flex-col items-center justify-center w-32 h-28 shadow-lg mb-6 ${picks[4]?.[0] ? 'bg-emerald-900 border-emerald-500' : 'bg-slate-800 border-slate-700 border-dashed'}`}>
                      <TeamFlag flag={picks[4]?.[0]?.flag} name={picks[4]?.[0]?.name} className="w-12 h-12 mb-2" /><span className="text-xs font-bold truncate w-full text-center">{picks[4]?.[0]?.name || '...'}</span>
                    </div>
                  </div>
                </div>
                {renderRoundColumn("Semis", 3, 1, 1)} {renderRoundColumn("Cuartos", 2, 2, 2)} {renderRoundColumn("Octavos", 1, 4, 4)} {renderRoundColumn("16avos", 0, 8, 8)}
              </div>
            </div>
          </div>
        )}

      </div>
    </main>
  )
}

function MatchupNode({ match, winner, onSelect }: { match: Matchup, winner: Team | null, onSelect: (t: Team) => void }) {
  const t1 = match?.team1; const t2 = match?.team2;
  const getBtnClass = (team: Team | null) => {
    if (!team) return 'opacity-40 cursor-not-allowed bg-slate-900 text-slate-700'
    if (winner?.name === team.name) return 'bg-emerald-600 text-white font-bold border-emerald-500'
    return 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
  }

  return (
    <div className="flex flex-col rounded-md w-full shadow-md shrink-0 overflow-hidden">
      <button onClick={() => t1 && t2 && onSelect(t1)} disabled={!t1 || !t2} className={`flex items-center gap-2 p-2 border transition-colors ${getBtnClass(t1)} rounded-t-md border-b-0`}>
        <TeamFlag flag={t1?.flag} name={t1?.name} /><span className="truncate text-[11px] md:text-xs">{t1 ? t1.name : 'Por definir'}</span>
      </button>
      <div className="h-[1px] bg-slate-900 w-full" />
      <button onClick={() => t1 && t2 && onSelect(t2)} disabled={!t1 || !t2} className={`flex items-center gap-2 p-2 border transition-colors ${getBtnClass(t2)} rounded-b-md border-t-0`}>
        <TeamFlag flag={t2?.flag} name={t2?.name} /><span className="truncate text-[11px] md:text-xs">{t2 ? t2.name : 'Por definir'}</span>
      </button>
    </div>
  )
}

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

"use client"

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import Image from 'next/image'

const TOURNAMENT_START = new Date('2026-06-11T00:00:00Z')

interface Profile { id: string; username: string; avatar_url: string; }
interface Team { name: string; flag: string; group_letter?: string; }
interface Matchup { team1: Team | null; team2: Team | null; }
interface BracketData { champion: string | null; knockout_picks: (Team | null)[][]; group_standings: Record<string, Team[]>; selected_thirds: Team[]; }

// 1. SOLUCIÓN AL TEAMFLAG: Lo declaramos afuera y arriba para que todo el archivo lo vea
const TeamFlag = ({ flag, name, className = "w-4 h-4 md:w-5 md:h-5" }: { flag?: string, name?: string, className?: string }) => {
  if (!flag) return <span className="text-base">❔</span>
  if (flag.startsWith('http')) return <img src={flag} alt={name} className={`object-contain ${className}`} />
  return <span className="text-base">{flag}</span>
}

// 2. SOLUCIÓN AL ORDEN DE LA FUNCIÓN: La sacamos del componente principal
// Al estar aquí arriba, el useEffect de abajo puede usarla sin problemas.
const solveThirdPlaceMatrix = (thirds: Team[]): Team[] => {
  const slots = [['A','B','C','D','F'], ['C','D','F','G','H'], ['C','E','F','H','I'], ['E','H','I','J','K'], ['B','E','F','I','J'], ['A','E','H','I','J'], ['E','F','G','I','J'], ['D','E','I','J','L']]
  let result: Team[] | null = null;
  const backtrack = (index: number, current: Team[], used: Set<string>) => {
    if (result) return;
    if (index === 8) { result = [...current]; return; }
    for (const team of thirds) {
      const letter = team.group_letter || '';
      if (!used.has(letter) && slots[index].includes(letter)) {
        used.add(letter); current.push(team); backtrack(index + 1, current, used); current.pop(); used.delete(letter);
      }
    }
  }
  backtrack(0, [], new Set());
  return result || thirds;
}

export default function PublicBracket() {
  const params = useParams()
  const router = useRouter()
  const userId = params.id as string

  const [loading, setLoading] = useState(true)
  const [isLocked, setIsLocked] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [bracket, setBracket] = useState<BracketData | null>(null)
  const [roundOf32, setRoundOf32] = useState<Matchup[]>([])

  useEffect(() => {
    const fetchPublicBracket = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      
      const { data: userProfile } = await supabase.from('profiles').select('*').eq('id', userId).single()
      if (!userProfile) { router.push('/ranking'); return }
      setProfile(userProfile)

      const now = new Date()
      if (now < TOURNAMENT_START && (!session || session.user.id !== userId)) {
        setIsLocked(true); setLoading(false); return
      }

      const { data: userBracket } = await supabase.from('brackets').select('*').eq('user_id', userId).single()
      
      if (userBracket) {
        setBracket(userBracket)
        
        const g = userBracket.group_standings
        const t3 = solveThirdPlaceMatrix(userBracket.selected_thirds)
        const t = (letter: string, pos: number) => g[letter]?.[pos] || null
        
        setRoundOf32([
          { team1: t('E', 0), team2: t3[0] }, { team1: t('I', 0), team2: t3[1] },
          { team1: t('A', 1), team2: t('B', 1) }, { team1: t('F', 0), team2: t('C', 1) },
          { team1: t('K', 1), team2: t('L', 1) }, { team1: t('H', 0), team2: t('J', 1) },
          { team1: t('D', 0), team2: t3[4] }, { team1: t('G', 0), team2: t3[5] },
          { team1: t('C', 0), team2: t('F', 1) }, { team1: t('E', 1), team2: t('I', 1) },
          { team1: t('A', 0), team2: t3[2] }, { team1: t('L', 0), team2: t3[3] },
          { team1: t('J', 0), team2: t('H', 1) }, { team1: t('D', 1), team2: t('G', 1) },
          { team1: t('B', 0), team2: t3[6] }, { team1: t('K', 0), team2: t3[7] }
        ])
      }
      setLoading(false)
    }
    fetchPublicBracket()
  }, [userId, router])

  const getMatch = (roundIndex: number, matchIndex: number): Matchup => {
    if (roundIndex === 0) return roundOf32[matchIndex] || {team1: null, team2: null}
    const picks = bracket?.knockout_picks || []
    return { team1: picks[roundIndex - 1]?.[matchIndex * 2] || null, team2: picks[roundIndex - 1]?.[matchIndex * 2 + 1] || null }
  }

  const renderRoundColumn = (title: string, roundIndex: number, startIndex: number, count: number) => (
    <div key={title + startIndex} className="flex flex-col h-full shrink-0 w-28 md:w-32 lg:w-32 xl:w-36 px-1 lg:px-2">
      <div className="text-center font-bold text-slate-500 mb-2 uppercase tracking-wider text-[10px] xl:text-xs h-5">{title}</div>
      <div className="flex flex-col justify-around flex-1 py-8">
        {Array.from({length: count}).map((_, i) => {
          const matchIndex = startIndex + i;
          const match = getMatch(roundIndex, matchIndex);
          const winner = bracket?.knockout_picks?.[roundIndex]?.[matchIndex] || null;
          return (
            <div key={i} className="flex items-center justify-center w-full">
              <MatchupNode match={match} winner={winner} />
            </div>
          )
        })}
      </div>
    </div>
  )

  if (loading) return <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center font-bold">Cargando pronóstico...</div>

  if (isLocked) return (
    <main className="min-h-screen bg-slate-900 text-white p-8 flex flex-col items-center justify-center">
      <div className="text-8xl mb-6 animate-bounce">🔒</div>
      <h1 className="text-3xl font-bold text-amber-400 mb-2 text-center">¡Pronóstico Oculto!</h1>
      <p className="text-slate-400 max-w-md text-center mb-8">El bracket de {profile?.username} es secreto hasta el 11 de Junio de 2026.</p>
      <Link href="/ranking" className="bg-slate-800 px-6 py-3 rounded-xl border border-slate-700 hover:bg-slate-700 font-bold">Volver al Ranking</Link>
    </main>
  )

  return (
    <main className="min-h-screen bg-slate-900 text-white p-4 md:p-8">
      <div className="max-w-[1600px] mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-center bg-slate-800 p-6 rounded-2xl mb-8 border border-slate-700 shadow-xl">
          <div className="flex items-center gap-4 mb-4 md:mb-0">
            {profile?.avatar_url ? (
              <Image src={profile.avatar_url} alt="Avatar" width={64} height={64} className="rounded-full border-2 border-emerald-400 object-cover" />
            ) : (
              <div className="w-16 h-16 rounded-full bg-slate-700 flex items-center justify-center text-2xl font-bold">{profile?.username?.charAt(0).toUpperCase()}</div>
            )}
            <div>
              <p className="text-slate-400 text-sm font-bold uppercase tracking-widest">Bracket Oficial de</p>
              <h1 className="text-2xl md:text-3xl font-black text-white">{profile?.username}</h1>
            </div>
          </div>
          <Link href="/ranking" className="bg-slate-900 text-slate-300 px-6 py-3 rounded-xl border border-slate-700 hover:bg-slate-950 transition-colors font-bold">Volver al Ranking</Link>
        </div>

        {!bracket ? (
          <div className="text-center py-20 bg-slate-800/50 rounded-2xl border border-slate-700 border-dashed">
            <span className="text-6xl mb-4 block">👻</span>
            <h2 className="text-2xl font-bold text-slate-400">Este usuario aún no ha armado su bracket.</h2>
          </div>
        ) : (
          <div className="w-full overflow-x-auto bg-slate-900/40 rounded-3xl border border-slate-800 scrollbar-thin scrollbar-thumb-sky-600 scrollbar-track-transparent">
            <div className="flex flex-row justify-between min-w-[1100px] xl:min-w-[1300px] h-[1150px] p-4 md:p-8 mx-auto relative">
              {renderRoundColumn("16avos", 0, 0, 8)}
              {renderRoundColumn("Octavos", 1, 0, 4)}
              {renderRoundColumn("Cuartos", 2, 0, 2)}
              {renderRoundColumn("Semis", 3, 0, 1)}

              <div className="flex flex-col justify-center items-center h-full w-44 shrink-0 px-2 relative">
                <div className="text-center absolute top-12"><span className="text-5xl drop-shadow-xl shadow-amber-500">🏆</span><h3 className="text-lg font-black text-amber-400 tracking-widest mt-2">GRAN FINAL</h3></div>
                <div className="w-full relative z-10"><MatchupNode match={getMatch(4, 0)} winner={bracket.knockout_picks[4]?.[0] || null} /></div>
                <div className="absolute bottom-24 w-full flex flex-col items-center">
                  <h4 className="text-emerald-400 font-bold mb-2">CAMPEÓN</h4>
                  <div className={`border-2 rounded-xl p-3 flex flex-col items-center justify-center w-32 h-28 shadow-lg mb-6 ${bracket.champion ? 'bg-emerald-900 border-emerald-500' : 'bg-slate-800 border-slate-700 border-dashed'}`}>
                    <TeamFlag flag={bracket.knockout_picks[4]?.[0]?.flag} name={bracket.knockout_picks[4]?.[0]?.name} className="w-12 h-12 mb-2" />
                    <span className="text-xs font-bold truncate w-full text-center">{bracket.champion || '...'}</span>
                  </div>
                </div>
              </div>

              {renderRoundColumn("Semis", 3, 1, 1)}
              {renderRoundColumn("Cuartos", 2, 2, 2)}
              {renderRoundColumn("Octavos", 1, 4, 4)}
              {renderRoundColumn("16avos", 0, 8, 8)}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}

function MatchupNode({ match, winner }: { match: Matchup, winner: Team | null }) {
  const t1 = match?.team1; const t2 = match?.team2;
  const getBtnClass = (team: Team | null) => {
    if (!team) return 'opacity-40 cursor-not-allowed bg-slate-900 text-slate-700'
    if (winner?.name === team.name) return 'bg-emerald-600 text-white font-bold border-emerald-500'
    return 'bg-slate-800 text-slate-300 border-slate-700 opacity-60' 
  }

  return (
    <div className="flex flex-col rounded-md w-full shadow-md shrink-0 overflow-hidden cursor-default">
      <div className={`flex items-center gap-2 p-2 border ${getBtnClass(t1)} rounded-t-md border-b-0`}>
        <TeamFlag flag={t1?.flag} name={t1?.name} />
        <span className="truncate text-[11px] md:text-xs">{t1 ? t1.name : 'Por definir'}</span>
      </div>
      <div className="h-[1px] bg-slate-900 w-full" />
      <div className={`flex items-center gap-2 p-2 border ${getBtnClass(t2)} rounded-b-md border-t-0`}>
        <TeamFlag flag={t2?.flag} name={t2?.name} />
        <span className="truncate text-[11px] md:text-xs">{t2 ? t2.name : 'Por definir'}</span>
      </div>
    </div>
  )
}

"use client"

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'
import { supabase } from '@/lib/supabase'

interface Team { name: string; flag: string; group_letter?: string; }
interface Matchup { team1: Team | null; team2: Team | null; }

const TeamFlag = ({ flag, name, className = "w-5 h-5 md:w-6 md:h-6" }: { flag?: string, name?: string, className?: string }) => {
  if (!flag) return <span className="text-base">❔</span>
  if (flag.startsWith('http')) return <img src={flag} alt={name} className={`object-contain ${className}`} />
  return <span className="text-base">{flag}</span>
}

// Fallback por si acaso, aunque los leeremos de Supabase
const INITIAL_GROUPS: Record<string, Team[]> = {
  A: [{name: 'México', flag: '🇲🇽', group_letter: 'A'}, {name: 'Alemania', flag: '🇩🇪', group_letter: 'A'}],
}

export default function BracketPredictor() {
  const router = useRouter()
  const [isBrowser, setIsBrowser] = useState(false)
  const [groups, setGroups] = useState<Record<string, Team[]>>(INITIAL_GROUPS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  
  const [selectedThirds, setSelectedThirds] = useState<Team[]>([])
  const [roundOf32, setRoundOf32] = useState<Matchup[]>([])
  const [picks, setPicks] = useState<(Team | null)[][]>([])

  useEffect(() => {
    const timer = setTimeout(() => setIsBrowser(true), 0)
    
    const fetchTeams = async () => {
      const { data, error } = await supabase.from('teams').select('*').order('group_letter', { ascending: true })
      if (data && !error && data.length > 0) {
        const grouped: Record<string, Team[]> = {}
        data.forEach((team) => {
          if (!grouped[team.group_letter]) grouped[team.group_letter] = []
          grouped[team.group_letter].push({ name: team.name, flag: team.flag, group_letter: team.group_letter })
        })
        setGroups(grouped)
      }
      setLoading(false)
    }

    fetchTeams()
    return () => clearTimeout(timer)
  }, [])

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return
    const { source, destination } = result
    const groupLetter = source.droppableId
    const newGroups = { ...groups }
    const groupTeams = Array.from(newGroups[groupLetter])
    const [movedTeam] = groupTeams.splice(source.index, 1)
    groupTeams.splice(destination.index, 0, movedTeam)
    newGroups[groupLetter] = groupTeams
    setGroups(newGroups)
    setSelectedThirds([]) 
    setRoundOf32([]) 
    setPicks([])
  }

  const toggleThirdPlace = (team: Team) => {
    const isSelected = selectedThirds.some(t => t.name === team.name)
    if (isSelected) {
      setSelectedThirds(selectedThirds.filter(t => t.name !== team.name))
    } else {
      if (selectedThirds.length < 8) setSelectedThirds([...selectedThirds, team])
      else alert("Ya seleccionaste a los 8 mejores terceros.")
    }
  }

  // EL CEREBRO DE LA FIFA: Simula la matriz de 495 combinaciones en tiempo real
  const solveThirdPlaceMatrix = (thirds: Team[]): Team[] => {
    const slots = [
      ['A','B','C','D','F'], // M74
      ['C','D','F','G','H'], // M77
      ['C','E','F','H','I'], // M79
      ['E','H','I','J','K'], // M80
      ['B','E','F','I','J'], // M81
      ['A','E','H','I','J'], // M82
      ['E','F','G','I','J'], // M85
      ['D','E','I','J','L']  // M87
    ]
    let result: Team[] | null = null;
    const backtrack = (index: number, current: Team[], used: Set<string>) => {
      if (result) return;
      if (index === 8) { result = [...current]; return; }
      for (const team of thirds) {
        const letter = team.group_letter || '';
        if (!used.has(letter) && slots[index].includes(letter)) {
          used.add(letter); current.push(team); backtrack(index + 1, current, used); current.pop(); used.delete(letter);
        }
      }
    }
    backtrack(0, [], new Set());
    return result || thirds;
  }

  const generateBracket = () => {
    const t = (letter: string, pos: number) => groups[letter][pos]
    const thirdsMap = solveThirdPlaceMatrix(selectedThirds)
    const t3 = (slotIndex: number) => thirdsMap[slotIndex]

    const matches: Matchup[] = []

    // --- LADO IZQUIERDO DEL ÁRBOL (Partidos: 74, 77, 73, 75, 83, 84, 81, 82) ---
    matches.push({ team1: t('E', 0), team2: t3(0) })          // M74
    matches.push({ team1: t('I', 0), team2: t3(1) })          // M77
    matches.push({ team1: t('A', 1), team2: t('B', 1) })      // M73
    matches.push({ team1: t('F', 0), team2: t('C', 1) })      // M75
    matches.push({ team1: t('K', 1), team2: t('L', 1) })      // M83
    matches.push({ team1: t('H', 0), team2: t('J', 1) })      // M84
    matches.push({ team1: t('D', 0), team2: t3(4) })          // M81
    matches.push({ team1: t('G', 0), team2: t3(5) })          // M82

    // --- LADO DERECHO DEL ÁRBOL (Partidos: 76, 78, 79, 80, 86, 88, 85, 87) ---
    // NOTA: El cruce M76 oficial es 1C vs 2F (arreglado del error de tipeo en tu fuente)
    matches.push({ team1: t('C', 0), team2: t('F', 1) })      // M76
    matches.push({ team1: t('E', 1), team2: t('I', 1) })      // M78
    matches.push({ team1: t('A', 0), team2: t3(2) })          // M79
    matches.push({ team1: t('L', 0), team2: t3(3) })          // M80
    matches.push({ team1: t('J', 0), team2: t('H', 1) })      // M86
    matches.push({ team1: t('D', 1), team2: t('G', 1) })      // M88
    matches.push({ team1: t('B', 0), team2: t3(6) })          // M85
    matches.push({ team1: t('K', 0), team2: t3(7) })          // M87

    setRoundOf32(matches)
    setPicks([
      Array(16).fill(null), Array(8).fill(null), Array(4).fill(null), Array(2).fill(null), Array(1).fill(null)
    ])
    setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 100)
  }

  const selectWinner = (roundIndex: number, matchIndex: number, winner: Team) => {
    const newPicks = [...picks.map(r => [...r])]
    newPicks[roundIndex][matchIndex] = winner
    for (let r = roundIndex + 1; r < newPicks.length; r++) {
      const nextMatchIndex = Math.floor(matchIndex / Math.pow(2, r - roundIndex))
      newPicks[r][nextMatchIndex] = null
    }
    setPicks(newPicks)
  }

  const getMatch = (roundIndex: number, matchIndex: number): Matchup => {
    if (roundIndex === 0) return roundOf32[matchIndex]
    return {
      team1: picks[roundIndex - 1][matchIndex * 2] || null,
      team2: picks[roundIndex - 1][matchIndex * 2 + 1] || null
    }
  }

  const handleSaveBracket = async () => {
    setSaving(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { alert("Debes iniciar sesión para guardar."); setSaving(false); return; }
    const champion = picks[4] && picks[4][0] ? picks[4][0].name : null
    if (!champion && !confirm("Aún no has elegido al Campeón. ¿Guardar incompleto?")) { setSaving(false); return; }

    const { error } = await supabase.from('brackets').upsert({
      user_id: session.user.id, group_standings: groups, selected_thirds: selectedThirds, knockout_picks: picks, champion: champion, updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' })

    if (error) alert("Error al guardar: " + error.message)
    else alert("¡Tu Simulador ha sido guardado exitosamente! 🏆💾")
    setSaving(false)
  }

  const renderRoundColumn = (title: string, roundIndex: number, startIndex: number, count: number) => (
    <div key={title + startIndex} className="flex flex-col h-full shrink-0 w-28 md:w-32 lg:w-32 xl:w-36 px-1 lg:px-2">
      <div className="text-center font-bold text-slate-500 mb-2 uppercase tracking-wider text-[10px] xl:text-xs h-5">{title}</div>
      <div className="flex flex-col justify-around flex-1 py-8">
        {Array.from({length: count}).map((_, i) => {
          const matchIndex = startIndex + i;
          const match = getMatch(roundIndex, matchIndex);
          const winner = picks[roundIndex] ? picks[roundIndex][matchIndex] : null;
          return (
            <div key={i} className="flex items-center justify-center w-full">
              <MatchupNode match={match} winner={winner} onSelect={(t) => selectWinner(roundIndex, matchIndex, t)} />
            </div>
          )
        })}
      </div>
    </div>
  )

  if (!isBrowser) return null
  if (loading) return <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center font-bold text-xl animate-pulse">Cargando datos oficiales de la FIFA...</div>

  return (
    <main className="min-h-screen bg-slate-900 text-white p-2 md:p-6">
      <div className="max-w-[1600px] mx-auto">
        <div className="flex justify-between items-center mb-6 px-2">
          <h1 className="text-2xl md:text-4xl font-bold text-sky-400">Bracket Simulator 🏆</h1>
          <Link href="/dashboard" className="bg-slate-800 text-slate-300 px-4 py-2 rounded-lg border border-slate-600 hover:bg-slate-700 font-semibold">Volver</Link>
        </div>

        {Object.keys(groups).length > 0 && (
          <DragDropContext onDragEnd={onDragEnd}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-8 px-2">
              {Object.entries(groups).map(([letter, teams]) => (
                <div key={letter} className="bg-slate-800 rounded-xl p-3 border border-slate-700 shadow-lg">
                  <h3 className="text-base font-bold text-amber-400 mb-2 border-b border-slate-700 pb-1">Grupo {letter}</h3>
                  <Droppable droppableId={letter}>
                    {(provided) => (
                      <div {...provided.droppableProps} ref={provided.innerRef} className="flex flex-col gap-1.5 min-h-[140px]">
                        {teams.map((team, idx) => (
                          <Draggable key={team.name} draggableId={team.name} index={idx}>
                            {(provided, snapshot) => (
                              <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}
                                className={`flex items-center gap-3 p-2 rounded border transition-colors text-sm ${snapshot.isDragging ? 'bg-slate-700 border-sky-500 z-50 shadow-xl' : 'bg-slate-900'} ${idx < 2 && !snapshot.isDragging ? 'border-emerald-500/50' : idx === 2 && !snapshot.isDragging ? 'border-amber-500/50' : 'border-slate-700'}`}>
                                <span className={`font-bold w-4 text-center ${idx < 2 ? 'text-emerald-400' : idx === 2 ? 'text-amber-400' : 'text-slate-600'}`}>{idx + 1}</span>
                                <TeamFlag flag={team.flag} name={team.name} />
                                <span className="flex-1 truncate">{team.name}</span>
                                <span className="text-slate-500 cursor-grab px-1">≡</span>
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </div>
              ))}
            </div>
          </DragDropContext>
        )}

        <div className="flex flex-wrap gap-2 mb-8 bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-lg justify-center mx-2">
          {Object.entries(groups).map(([letter, teams]) => {
            const third = teams[2]
            if (!third) return null
            const isSelected = selectedThirds.some(t => t.name === third.name)
            return (
              <button key={letter} onClick={() => toggleThirdPlace(third)} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors border ${isSelected ? 'bg-amber-500 text-slate-900 font-bold border-amber-400' : 'bg-slate-900 text-slate-300 border-slate-600 hover:border-amber-500/50'}`}>
                <TeamFlag flag={third.flag} name={third.name} className="w-4 h-4 md:w-5 md:h-5" />
                <span className="truncate">{third.name}</span>
              </button>
            )
          })}
        </div>

        <div className="flex justify-center pb-8 border-b-2 border-slate-700 mx-2">
          <button onClick={generateBracket} disabled={selectedThirds.length !== 8} className="bg-sky-500 text-slate-900 font-bold py-3 px-8 rounded-xl hover:bg-sky-400 transition-colors disabled:bg-slate-700 disabled:text-slate-500 shadow-lg w-full md:w-auto">
            {selectedThirds.length === 8 ? 'Generar Fase Eliminatoria 🌳' : `Faltan terceros (${selectedThirds.length}/8)`}
          </button>
        </div>

        {roundOf32.length > 0 && (
          <div className="mt-8 pb-16 w-full px-2">
            <h2 className="text-2xl md:text-4xl font-black mb-4 text-center text-slate-300 tracking-wider">ELIMINATORIAS</h2>
            <p className="text-center text-sky-400 animate-pulse text-sm mb-6 lg:hidden">← Desliza hacia los lados para ver el árbol completo →</p>
            
            <div className="w-full overflow-x-auto bg-slate-950/40 rounded-3xl border border-slate-800/50 scrollbar-thin scrollbar-thumb-sky-600 scrollbar-track-transparent">
              <div className="flex flex-row justify-between min-w-[1100px] xl:min-w-[1300px] h-[1150px] p-4 md:p-8 mx-auto relative">
                
                {renderRoundColumn("16avos", 0, 0, 8)}
                {renderRoundColumn("Octavos", 1, 0, 4)}
                {renderRoundColumn("Cuartos", 2, 0, 2)}
                {renderRoundColumn("Semis", 3, 0, 1)}

                <div className="flex flex-col justify-center items-center h-full w-44 shrink-0 px-2 relative">
                  <div className="text-center absolute top-12">
                    <span className="text-5xl drop-shadow-xl shadow-amber-500">🏆</span>
                    <h3 className="text-lg font-black text-amber-400 tracking-widest mt-2">GRAN FINAL</h3>
                  </div>
                  
                  <div className="w-full relative z-10">
                    <MatchupNode match={getMatch(4, 0)} winner={picks[4] ? picks[4][0] : null} onSelect={(t) => selectWinner(4, 0, t)} />
                  </div>

                  <div className="absolute bottom-24 w-full flex flex-col items-center">
                    <h4 className="text-emerald-400 font-bold mb-2">CAMPEÓN</h4>
                    <div className={`border-2 rounded-xl p-3 flex flex-col items-center justify-center w-32 h-28 shadow-lg transition-all duration-500 mb-6 ${picks[4]?.[0] ? 'bg-emerald-900 border-emerald-500 shadow-emerald-900/50 scale-110' : 'bg-slate-800 border-slate-700 border-dashed'}`}>
                      <TeamFlag flag={picks[4]?.[0]?.flag} name={picks[4]?.[0]?.name} className="w-12 h-12 mb-2" />
                      <span className="text-xs font-bold truncate w-full text-center">{picks[4]?.[0]?.name || '...'}</span>
                    </div>

                    <button onClick={handleSaveBracket} disabled={saving} className="w-full bg-emerald-500 text-emerald-950 font-black py-3 px-4 rounded-xl shadow-lg hover:bg-emerald-400 hover:-translate-y-1 transition-all disabled:opacity-50">
                      {saving ? 'Guardando...' : '💾 GUARDAR BRACKET'}
                    </button>
                  </div>
                </div>

                {renderRoundColumn("Semis", 3, 1, 1)}
                {renderRoundColumn("Cuartos", 2, 2, 2)}
                {renderRoundColumn("Octavos", 1, 4, 4)}
                {renderRoundColumn("16avos", 0, 8, 8)}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}

function MatchupNode({ match, winner, onSelect }: { match: Matchup, winner: Team | null, onSelect: (t: Team) => void }) {
  const t1 = match?.team1; const t2 = match?.team2;
  const getBtnClass = (team: Team | null) => {
    if (!team) return 'opacity-40 cursor-not-allowed bg-slate-900 text-slate-600'
    if (winner?.name === team.name) return 'bg-sky-600 text-white font-bold'
    return 'hover:bg-slate-700 text-slate-300'
  }

  return (
    <div className="flex flex-col bg-slate-800 border border-slate-700 rounded-md w-full shadow-md shrink-0 overflow-hidden">
      <button onClick={() => t1 && t2 && onSelect(t1)} disabled={!t1 || !t2} className={`flex items-center gap-2 p-2 transition-colors ${getBtnClass(t1)}`}>
        <TeamFlag flag={t1?.flag} name={t1?.name} className="w-5 h-5" />
        <span className="truncate text-[11px] md:text-xs">{t1 ? t1.name : 'Por definir'}</span>
      </button>
      <div className="h-[1px] bg-slate-900 w-full" />
      <button onClick={() => t1 && t2 && onSelect(t2)} disabled={!t1 || !t2} className={`flex items-center gap-2 p-2 transition-colors ${getBtnClass(t2)}`}>
        <TeamFlag flag={t2?.flag} name={t2?.name} className="w-5 h-5" />
        <span className="truncate text-[11px] md:text-xs">{t2 ? t2.name : 'Por definir'}</span>
      </button>
    </div>
  )
}

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

"use client"

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function Premios() {
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const WORLD_CUP_TEAMS = [
  "Alemania", "Arabia Saudita", "Argelia", "Argentina", "Australia", "Austria", 
  "Bosnia y Herzegovina", "Brasil", "Bélgica", "Cabo Verde", "Canadá", "Catar", 
  "Colombia", "Corea del Sur", "Costa de Marfil", "Croacia", "Curazao", "Ecuador", 
  "Egipto", "Escocia", "España", "Estados Unidos", "Francia", "Ghana", "Haití", 
  "Irak", "Irán", "Inglaterra", "Japón", "Jordania", "Marruecos", "México", 
  "Noruega", "Nueva Zelanda", "Países Bajos", "Panamá", "Paraguay", "Portugal", 
  "República Checa", "República Democrática del Congo", "Senegal", "Sudáfrica", 
  "Suecia", "Suiza", "Turquía", "Túnez", "Uruguay", "Uzbekistán"
];
  // Fecha en la que arranca el Mundial (Ajusta esto según el calendario oficial)
  const TOURNAMENT_START = new Date('2026-06-11T15:00:00Z')
  const isLocked = new Date() > TOURNAMENT_START

  const [awards, setAwards] = useState({
    champion: '',
    runner_up: '',
    mvp: '',
    golden_boot: '',
    golden_glove: ''
  })

  const router = useRouter()

  useEffect(() => {
    const fetchAwards = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.push('/')
        return
      }
      setUserId(session.user.id)

      // Buscar si el usuario ya había guardado sus predicciones
      const { data } = await supabase
        .from('tournament_predictions')
        .select('*')
        .eq('user_id', session.user.id)
        .single()

      if (data) {
        setAwards({
          champion: data.champion || '',
          runner_up: data.runner_up || '',
          mvp: data.mvp || '',
          golden_boot: data.golden_boot || '',
          golden_glove: data.golden_glove || ''
        })
      }
      setLoading(false)
    }

    fetchAwards()
  }, [router])

  const handleChange = (field: string, value: string) => {
    setAwards(prev => ({ ...prev, [field]: value }))
  }

  const handleSave = async () => {
    if (!userId) return

    const { error } = await supabase
      .from('tournament_predictions')
      .upsert({
        user_id: userId,
        ...awards
      }, { onConflict: 'user_id' })

    if (error) {
      alert('Error al guardar: ' + error.message)
    } else {
      alert('¡Predicciones del torneo guardadas con éxito! 🏆')
    }
  }

  if (loading) return <p className="min-h-screen bg-slate-900 text-white p-8">Cargando premios...</p>

  return (
    <main className="min-h-screen bg-slate-900 text-white p-8">
      <div className="max-w-2xl mx-auto">
        
        {/* Navegación */}
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl md:text-4xl font-bold text-amber-400">Premios Finales 🌟</h1>
          <Link href="/dashboard" className="bg-slate-800 text-slate-300 px-4 py-2 rounded-lg hover:bg-slate-700 transition-colors border border-slate-600">
            Volver
          </Link>
        </div>

        <div className="bg-slate-800 p-6 md:p-8 rounded-xl border border-slate-700 shadow-xl">
          {isLocked && (
            <div className="bg-red-900/20 border border-red-800 text-red-300 p-4 rounded-lg mb-6 text-center">
              El torneo ya ha comenzado. Estas predicciones están bloqueadas 🔒
            </div>
          )}

          <div className="flex flex-col gap-6">
            <AwardInput label="🏆 Campeón del Mundo" value={awards.champion} onChange={(v: string) => handleChange('champion', v)} disabled={isLocked} placeholder="Selecciona un país" options={WORLD_CUP_TEAMS} />
            <AwardInput label="🥈 Subcampeón" value={awards.runner_up} onChange={(v: string) => handleChange('runner_up', v)} disabled={isLocked} placeholder="Selecciona un país" options={WORLD_CUP_TEAMS} />
            <AwardInput label="⭐ Balón de Oro (Mejor Jugador)" value={awards.mvp} onChange={(v: string) => handleChange('mvp', v)} disabled={isLocked} placeholder="Ej: Lionel Messi" />
            <AwardInput label="⚽ Bota de Oro (Goleador)" value={awards.golden_boot} onChange={(v: string) => handleChange('golden_boot', v)} disabled={isLocked} placeholder="Ej: Kylian Mbappé" />
            <AwardInput label="🧤 Guante de Oro (Mejor Portero)" value={awards.golden_glove} onChange={(v: string) => handleChange('golden_glove', v)} disabled={isLocked} placeholder="Ej: Dibu Martínez" />
          </div>

          {!isLocked && (
            <button 
              onClick={handleSave}
              className="mt-8 w-full bg-amber-500 text-slate-900 font-bold py-3 px-6 rounded-lg hover:bg-amber-400 transition-colors text-lg"
            >
              Guardar Predicciones
            </button>
          )}
        </div>

      </div>
    </main>
  )
}
// Interfaz actualizada
interface AwardInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  placeholder: string;
  options?: string[]; // Hacemos que sea opcional usando el signo de interrogación
}

// Componente inteligente
function AwardInput({ label, value, onChange, disabled, placeholder, options }: AwardInputProps) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-lg font-semibold text-slate-300">{label}</label>
      
      {options ? (
        // Si le pasamos opciones, dibuja un menú desplegable
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="bg-slate-900 border border-slate-600 rounded-lg p-3 text-white focus:border-amber-500 outline-none disabled:bg-slate-950 disabled:text-slate-500 appearance-none cursor-pointer"
        >
          <option value="" disabled>{placeholder}</option>
          {options.map((team) => (
            <option key={team} value={team}>{team}</option>
          ))}
        </select>
      ) : (
        // Si NO le pasamos opciones, dibuja el cuadro de texto normal
        <input 
          type="text" 
          value={value} 
          onChange={(e) => onChange(e.target.value)} 
          disabled={disabled}
          placeholder={placeholder}
          className="bg-slate-900 border border-slate-600 rounded-lg p-3 text-white focus:border-amber-500 outline-none disabled:bg-slate-950 disabled:text-slate-500"
        />
      )}
    </div>
  )
}

"use client"

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'

interface Profile {
  id: string
  username: string
  avatar_url: string
  total_points: number
  points_quiniela: number
  points_bracket: number
  points_premios: number
}

type TabCategory = 'total' | 'quiniela' | 'bracket' | 'premios'

export default function Ranking() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabCategory>('total')
  const router = useRouter()

  useEffect(() => {
    const fetchRanking = async () => {
      setLoading(true)
      
      // Determinamos qué columna usar para ordenar dependiendo de la pestaña activa
      const orderColumn = 
        activeTab === 'total' ? 'total_points' : 
        activeTab === 'quiniela' ? 'points_quiniela' : 
        activeTab === 'bracket' ? 'points_bracket' : 'points_premios'

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order(orderColumn, { ascending: false })

      if (data) {
        setProfiles(data)
      }
      setLoading(false)
    }

    fetchRanking()
  }, [activeTab]) // Se vuelve a ejecutar cada vez que cambiamos de pestaña

  // Función para obtener el puntaje correcto a mostrar según la pestaña
  const getDisplayPoints = (profile: Profile) => {
    switch (activeTab) {
      case 'quiniela': return profile.points_quiniela
      case 'bracket': return profile.points_bracket
      case 'premios': return profile.points_premios
      default: return profile.total_points
    }
  }

  return (
    <main className="min-h-screen bg-slate-900 text-white p-4 md:p-8">
      <div className="max-w-3xl mx-auto">
        
        {/* Navegación */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <h1 className="text-3xl md:text-4xl font-bold text-emerald-400">Tabla de Posiciones 🏆</h1>
          <Link href="/dashboard" className="bg-slate-800 text-slate-300 px-4 py-2 rounded-lg hover:bg-slate-700 transition-colors border border-slate-600 w-full md:w-auto text-center font-semibold">
            Volver
          </Link>
        </div>

        {/* --- PESTAÑAS (TABS) --- */}
        <div className="flex overflow-x-auto bg-slate-800 rounded-t-xl border border-slate-700 border-b-0 hide-scrollbar">
          <button 
            onClick={() => setActiveTab('total')}
            className={`flex-1 py-4 px-4 text-sm md:text-base font-bold whitespace-nowrap transition-colors ${activeTab === 'total' ? 'text-emerald-400 border-b-2 border-emerald-400 bg-slate-800/80' : 'text-slate-400 hover:text-slate-200'}`}
          >
            Clasificación General
          </button>
          <button 
            onClick={() => setActiveTab('quiniela')}
            className={`flex-1 py-4 px-4 text-sm md:text-base font-bold whitespace-nowrap transition-colors ${activeTab === 'quiniela' ? 'text-emerald-400 border-b-2 border-emerald-400 bg-slate-800/80' : 'text-slate-400 hover:text-slate-200'}`}
          >
            Quiniela
          </button>
          <button 
            onClick={() => setActiveTab('bracket')}
            className={`flex-1 py-4 px-4 text-sm md:text-base font-bold whitespace-nowrap transition-colors ${activeTab === 'bracket' ? 'text-emerald-400 border-b-2 border-emerald-400 bg-slate-800/80' : 'text-slate-400 hover:text-slate-200'}`}
          >
            Bracket
          </button>
          <button 
            onClick={() => setActiveTab('premios')}
            className={`flex-1 py-4 px-4 text-sm md:text-base font-bold whitespace-nowrap transition-colors ${activeTab === 'premios' ? 'text-emerald-400 border-b-2 border-emerald-400 bg-slate-800/80' : 'text-slate-400 hover:text-slate-200'}`}
          >
            Premios
          </button>
        </div>

        {/* --- TABLA DE USUARIOS --- */}
        <div className="bg-slate-800 rounded-b-xl border border-slate-700 overflow-hidden shadow-xl min-h-[400px]">
          {loading ? (
            <div className="flex justify-center items-center h-48">
              <span className="text-slate-400 animate-pulse font-semibold">Cargando clasificación...</span>
            </div>
          ) : (
            <>
              {profiles.map((profile, index) => {
                const points = getDisplayPoints(profile)
                
                return (
                  <div 
                    key={profile.id}
                    onClick={() => router.push(`/bracket/${profile.id}`)}
                    className={`flex items-center justify-between p-4 border-b border-slate-700/50 cursor-pointer hover:bg-slate-700/50 transition-colors group ${index === 0 ? 'bg-emerald-900/10' : ''}`}
                    title="Hacer clic para ver el Bracket de este usuario"
                  >
                    <div className="flex items-center gap-3 md:gap-4">
                      <span className={`text-xl md:text-2xl font-bold w-6 md:w-8 text-center ${index === 0 ? 'text-yellow-400 drop-shadow-md' : index === 1 ? 'text-slate-300' : index === 2 ? 'text-amber-600' : 'text-slate-500'}`}>
                        {index + 1}
                      </span>
                      
                      {profile.avatar_url ? (
                        <Image src={profile.avatar_url} alt={profile.username} width={40} height={40} className="rounded-full border border-slate-600 object-cover w-10 h-10" />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-slate-700 border border-slate-600 flex items-center justify-center text-slate-400 font-bold">
                          {profile.username?.charAt(0).toUpperCase()}
                        </div>
                      )}
                      
                      <div className="flex flex-col">
                        <span className="text-base md:text-lg font-semibold group-hover:text-emerald-300 transition-colors">
                          {profile.username}
                        </span>
                        <span className="text-xs text-slate-500 md:hidden">Ver pronóstico 👀</span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4">
                      <div className="text-2xl md:text-3xl font-black text-emerald-400 tracking-tighter">
                        {points} <span className="text-xs md:text-sm text-slate-500 font-bold tracking-normal">PTS</span>
                      </div>
                      <span className="hidden md:block text-slate-600 group-hover:text-emerald-400 transition-colors">
                        ➔
                      </span>
                    </div>
                  </div>
                )
              })}
              
              {profiles.length === 0 && (
                <p className="p-12 text-center text-slate-500 font-semibold">Aún no hay puntos registrados en esta categoría.</p>
              )}
            </>
          )}
        </div>

      </div>
    </main>
  )
}

"use client"

import { supabase } from '@/lib/supabase'

export default function Home() {
  
  const iniciarSesionConGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // Esto los enviará al dashboard una vez que Google los acepte
        redirectTo: `${location.origin}/dashboard` 
      }
    })
  }

  return (
    <main className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-4">
      <h1 className="text-5xl font-bold mb-4 text-emerald-400">
        Quiniela Mundial 🏆
      </h1>
      <p className="text-lg text-slate-300 mb-8 text-center max-w-md">
        Demuestra quién sabe más de fútbol. Predice los resultados y llévate la gloria.
      </p>
      
      <div className="bg-slate-800 p-8 rounded-xl shadow-lg w-full max-w-sm flex justify-center">
        <button 
          onClick={iniciarSesionConGoogle}
          className="bg-white text-slate-900 font-bold py-3 px-6 rounded-lg flex items-center gap-3 hover:bg-slate-200 transition-colors w-full justify-center"
        >
          <svg className="w-6 h-6" viewBox="0 0 24 24">
            <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Entrar con Google
        </button>
      </div>
    </main>
  )
}