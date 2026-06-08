"use client"

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'

interface Team { name: string; flag: string; group_letter?: string; }
interface Matchup { team1: Team | null; team2: Team | null; }

const API_TOKEN = 'TU_API_KEY_AQUI' 

const TeamFlag = ({ flag, name, className = "w-5 h-5 md:w-6 md:h-6" }: { flag?: string, name?: string, className?: string }) => {
  if (!flag) return <span className="text-base">❔</span>
  if (flag.startsWith('http')) return <img src={flag} alt={name} className={`object-contain ${className}`} />
  return <span className="text-base">{flag}</span>
}

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
  
  // NUEVO ESTADO PARA PREMIOS OFICIALES
  const [officialAwards, setOfficialAwards] = useState({
    champion: '', runner_up: '', mvp: '', golden_boot: '', golden_glove: ''
  })

  useEffect(() => {
    const initAdmin = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/'); return }

      const { data } = await supabase.from('profiles').select('role').eq('id', session.user.id).single()
      if (data?.role !== 'admin') { router.push('/dashboard'); return }

      // Cargar Equipos
      const { data: teamsData } = await supabase.from('teams').select('*').order('group_letter', { ascending: true })
      if (teamsData) {
        const grouped: Record<string, Team[]> = {}
        teamsData.forEach((team) => {
          if (!grouped[team.group_letter]) grouped[team.group_letter] = []
          grouped[team.group_letter].push({ name: team.name, flag: team.flag, group_letter: team.group_letter })
        })
        setGroups(grouped)
      }

      // Cargar Premios Oficiales ya guardados (si existen)
      const { data: officialData } = await supabase.from('official_bracket').select('awards').eq('id', 1).single()
      if (officialData && officialData.awards) {
        setOfficialAwards({
          champion: officialData.awards.champion || '',
          runner_up: officialData.awards.runner_up || '',
          mvp: officialData.awards.mvp || '',
          golden_boot: officialData.awards.golden_boot || '',
          golden_glove: officialData.awards.golden_glove || ''
        })
      }

      setLoading(false)
    }
    initAdmin()
  }, [router])

  const handleApiSync = async () => {
    setSyncing(true)
    try {
      const res = await fetch('https://api.football-data.org/v4/competitions/2000/standings', { headers: { 'X-Auth-Token': API_TOKEN } })
      if (!res.ok) throw new Error("Error en la conexión con la API.")
      alert("¡Conexión exitosa a football-data.org! Los datos se sincronizarán cuando el torneo esté activo.")
    } catch (error: unknown) {
      if (error instanceof Error) alert("Aviso: " + error.message)
      else alert("Ocurrió un error desconocido.")
    } finally {
      setSyncing(false)
    }
  }

  const handleAwardChange = (field: string, value: string) => {
    setOfficialAwards(prev => ({ ...prev, [field]: value }))
  }

  const handlePublishOfficialResults = async () => {
    setSaving(true)
    const champion = picks[4] && picks[4][0] ? picks[4][0].name : null

    const { error: officialError } = await supabase.from('official_bracket').upsert({
      id: 1, group_standings: groups, selected_thirds: selectedThirds, knockout_picks: picks, champion: champion, awards: officialAwards, updated_at: new Date().toISOString()
    })
    if (officialError) { alert("Error: " + officialError.message); setSaving(false); return }

    const { data: allBrackets } = await supabase.from('brackets').select('*')
    const { data: allMatchPreds } = await supabase.from('match_predictions').select('*')
    const { data: realMatches } = await supabase.from('matches').select('*').eq('status', 'finished')
    const { data: allUserAwards } = await supabase.from('tournament_predictions').select('*')
    
    if (allBrackets) {
      const updates = []

      for (const userBracket of allBrackets) {
        let pointsBracket = 0
        let pointsQuiniela = 0 
        let pointsPremios = 0

        // 1. EVALUAR GRUPOS (+5)
        Object.keys(groups).forEach(letter => {
          const officialGroup = groups[letter]
          const userGroup = userBracket.group_standings[letter] || []
          let perfect = true
          for (let i = 0; i < 4; i++) { if (officialGroup[i]?.name !== userGroup[i]?.name) perfect = false }
          if (perfect) pointsQuiniela += 5 
        })

        // 2. EVALUAR ELIMINATORIAS
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

        // 3. EVALUAR PARTIDOS DIARIOS (Corregido a sistema 3-2-1)
        const userMatches = allMatchPreds?.filter(p => p.user_id === userBracket.user_id) || []
        userMatches.forEach(pred => {
          const realMatch = realMatches?.find(m => m.id === pred.match_id)
          if (realMatch && realMatch.score_a !== null && realMatch.score_b !== null) {
            
            const acertoMarcadorExacto = pred.pred_a === realMatch.score_a && pred.pred_b === realMatch.score_b;
            const acertoGanador = (pred.pred_a > pred.pred_b && realMatch.score_a > realMatch.score_b) || (pred.pred_a < pred.pred_b && realMatch.score_a < realMatch.score_b) || (pred.pred_a === pred.pred_b && realMatch.score_a === realMatch.score_b);
            const acertoGolesDeUnEquipo = pred.pred_a === realMatch.score_a || pred.pred_b === realMatch.score_b;

            if (acertoMarcadorExacto) pointsQuiniela += 3;
            else if (acertoGanador && acertoGolesDeUnEquipo) pointsQuiniela += 2;
            else if (acertoGanador) pointsQuiniela += 1;
          }
        })

        // 4. EVALUAR PREMIOS INDIVIDUALES (+10 por acierto)
        const userAward = allUserAwards?.find(a => a.user_id === userBracket.user_id)
        if (userAward) {
          const checkAward = (official: string, userValue: string) => {
            // Comparamos convirtiendo a minúsculas para perdonar mayúsculas/minúsculas
            if (official && userValue && official.toLowerCase().trim() === userValue.toLowerCase().trim()) return 10;
            return 0;
          }
          pointsPremios += checkAward(officialAwards.champion, userAward.champion)
          pointsPremios += checkAward(officialAwards.runner_up, userAward.runner_up)
          pointsPremios += checkAward(officialAwards.mvp, userAward.mvp)
          pointsPremios += checkAward(officialAwards.golden_boot, userAward.golden_boot)
          pointsPremios += checkAward(officialAwards.golden_glove, userAward.golden_glove)
        }

        updates.push({ id: userBracket.user_id, points_bracket: pointsBracket, points_quiniela: pointsQuiniela, points_premios: pointsPremios })
      }

      for (const update of updates) {
        await supabase.from('profiles').update({
          points_bracket: update.points_bracket,
          points_quiniela: update.points_quiniela,
          points_premios: update.points_premios,
          total_points: update.points_bracket + update.points_quiniela + update.points_premios
        }).eq('id', update.id)
      }
    }

    alert("🚨 ¡SISTEMA ACTUALIZADO!\n\nSe han guardado los premios, el bracket oficial y se recalcularon correctamente todas las puntuaciones bajo el sistema 3-2-1.")
    setSaving(false)
  }

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
            <div><h2 className="text-xl font-bold text-emerald-400 flex items-center gap-2"><span>📢</span> Publicar y Puntear</h2><p className="text-slate-400 text-sm mt-1">Guarda el bracket, los premios y recalcula TODOS los puntos.</p></div>
            <button onClick={handlePublishOfficialResults} disabled={saving} className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 px-6 rounded-xl transition-all shadow-lg disabled:opacity-50">{saving ? 'Calculando...' : 'Hacer Oficial 🌍'}</button>
          </div>
        </div>

        {/* SECCIÓN NUEVA: VALIDACIÓN DE PREMIOS */}
        <h3 className="text-2xl font-bold text-slate-300 mb-6 border-b border-slate-800 pb-2">Resultados Oficiales de Premios</h3>
        <div className="bg-slate-900 border border-amber-900/50 rounded-2xl p-6 mb-12 shadow-xl">
          <p className="text-slate-400 text-sm mb-6">Escribe los resultados oficiales al final del torneo. El sistema comparará estas respuestas con las de los usuarios (ignorando mayúsculas) y otorgará 10 pts por acierto.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-amber-400">🏆 Campeón del Mundo</label>
              <input type="text" value={officialAwards.champion} onChange={(e) => handleAwardChange('champion', e.target.value)} className="bg-slate-950 border border-slate-700 rounded-lg p-3 text-white focus:border-amber-500 outline-none" placeholder="País campeón" />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-slate-300">🥈 Subcampeón</label>
              <input type="text" value={officialAwards.runner_up} onChange={(e) => handleAwardChange('runner_up', e.target.value)} className="bg-slate-950 border border-slate-700 rounded-lg p-3 text-white focus:border-amber-500 outline-none" placeholder="País subcampeón" />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-slate-300">⭐ Balón de Oro</label>
              <input type="text" value={officialAwards.mvp} onChange={(e) => handleAwardChange('mvp', e.target.value)} className="bg-slate-950 border border-slate-700 rounded-lg p-3 text-white focus:border-amber-500 outline-none" placeholder="Nombre exacto" />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-slate-300">⚽ Bota de Oro</label>
              <input type="text" value={officialAwards.golden_boot} onChange={(e) => handleAwardChange('golden_boot', e.target.value)} className="bg-slate-950 border border-slate-700 rounded-lg p-3 text-white focus:border-amber-500 outline-none" placeholder="Nombre exacto" />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-slate-300">🧤 Guante de Oro</label>
              <input type="text" value={officialAwards.golden_glove} onChange={(e) => handleAwardChange('golden_glove', e.target.value)} className="bg-slate-950 border border-slate-700 rounded-lg p-3 text-white focus:border-amber-500 outline-none" placeholder="Nombre exacto" />
            </div>
          </div>
        </div>

        {/* EL BRACKET MAESTRO */}
        <h3 className="text-2xl font-bold text-slate-300 mb-6 border-b border-slate-800 pb-2">Configuración Manual del Torneo Real</h3>

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