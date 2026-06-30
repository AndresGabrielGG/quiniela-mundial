"use client"

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'

interface Team { name: string; flag: string; group_letter?: string; }
interface Matchup { team1: Team | null; team2: Team | null; }

const TeamFlag = ({ flag, name, className = "w-5 h-5 md:w-6 md:h-6" }: { flag?: string, name?: string, className?: string }) => {
  if (!flag) return <span className="text-base">❔</span>
  if (flag.startsWith('http')) return <img src={flag} alt={name} className={`object-contain bg-white rounded-full p-0.5 ${className}`} />
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
  // PROTECCIÓN CONTRA CRASH DE NEXT.JS
  const [isBrowser, setIsBrowser] = useState(false)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [saving, setSaving] = useState(false)

  const [groups, setGroups] = useState<Record<string, Team[]>>({})
  const [selectedThirds, setSelectedThirds] = useState<Team[]>([])
  const [roundOf32, setRoundOf32] = useState<Matchup[]>([])
  const [picks, setPicks] = useState<(Team | null)[][]>([])
  
  const [officialAwards, setOfficialAwards] = useState({
    champion: '', runner_up: '', mvp: '', golden_boot: '', golden_glove: ''
  })

  const qualifiedTeams = [
    ...Object.values(groups).flatMap(g => g.slice(0, 2)),
    ...selectedThirds
  ];

  useEffect(() => {
    // Activamos el renderizado seguro
    const timer = setTimeout(() => setIsBrowser(true), 0)

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

      const { data: officialData } = await supabase.from('official_bracket').select('awards, group_standings, selected_thirds, knockout_picks').eq('id', 1).single()
      if (officialData) {
        if (officialData.awards) {
          setOfficialAwards({
            champion: officialData.awards.champion || '',
            runner_up: officialData.awards.runner_up || '',
            mvp: officialData.awards.mvp || '',
            golden_boot: officialData.awards.golden_boot || '',
            golden_glove: officialData.awards.golden_glove || ''
          })
        }
        if (officialData.group_standings) setGroups(officialData.group_standings)
        if (officialData.selected_thirds) setSelectedThirds(officialData.selected_thirds)
        if (officialData.knockout_picks) {
          setPicks(officialData.knockout_picks)
          const firstRound = officialData.knockout_picks[0] || []
          const matches: Matchup[] = []
          for(let i=0; i<8; i++) {
            matches.push({ team1: firstRound[i*2] || null, team2: firstRound[i*2+1] || null })
          }
          setRoundOf32(matches)
        }
      }

      setLoading(false)
    }
    initAdmin()
    return () => clearTimeout(timer)
  }, [router])

  const handleApiSync = async () => {
    setSyncing(true)
    try {
      const res = await fetch('/api/sync-matches?secret=mi_super_contraseña_secreta_123')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Error al conectar con la API de sincronización.")
      alert("✅ " + data.message)
    } catch (error: unknown) {
      if (error instanceof Error) {
        alert("Aviso de Sincronización: " + error.message)
      } else {
        alert("Ocurrió un error desconocido durante la sincronización.")
      }
    } finally {
      setSyncing(false)
    }
  }

  const handleAwardChange = (field: string, value: string) => {
    setOfficialAwards(prev => ({ ...prev, [field]: value }))
  }

  const handleSaveOfficialBracket = async () => {
    setSaving(true)
    const champion = picks[4] && picks[4][0] ? picks[4][0].name : null

    const firstRoundPicks = roundOf32.flatMap(m => [m.team1, m.team2])
    const newPicks = [...picks]
    newPicks[0] = firstRoundPicks

    const { error: officialError } = await supabase.from('official_bracket').upsert({
      id: 1, group_standings: groups, selected_thirds: selectedThirds, knockout_picks: newPicks, champion: champion, awards: officialAwards, updated_at: new Date().toISOString()
    })
    
    if (officialError) { alert("Error: " + officialError.message); setSaving(false); return }
    
    alert("💾 Datos Oficiales guardados con éxito. Presiona 'Recalcular Puntos' para aplicar los cambios a los usuarios.")
    setSaving(false)
  }

  const handleRecalculatePoints = async () => {
    setSaving(true)
    try {
      const { data: profiles } = await supabase.from('profiles').select('id, username')
      const { data: officialData } = await supabase.from('official_bracket').select('*').eq('id', 1).single()
      const { data: allBrackets } = await supabase.from('brackets').select('*')
      const { data: allMatchPreds } = await supabase.from('match_predictions').select('*')
      const { data: realMatches } = await supabase.from('matches').select('*').eq('status', 'finished')
      const { data: allUserAwards } = await supabase.from('tournament_predictions').select('*')
      
      if (!profiles) throw new Error("No se encontraron perfiles")

      let count = 0;

      for (const profile of profiles) {
        let pQuiniela = 0
        let pBracket = 0
        let pPremios = 0

        const userMatches = allMatchPreds?.filter(p => p.user_id === profile.id) || []
        userMatches.forEach(pred => {
          const realMatch = realMatches?.find(m => m.id === pred.match_id)
          if (realMatch && realMatch.score_a !== null && realMatch.score_b !== null) {
            const acertoMarcadorExacto = pred.pred_a === realMatch.score_a && pred.pred_b === realMatch.score_b;
            const acertoGanador = (pred.pred_a > pred.pred_b && realMatch.score_a > realMatch.score_b) || 
                                  (pred.pred_a < pred.pred_b && realMatch.score_a < realMatch.score_b) || 
                                  (pred.pred_a === pred.pred_b && realMatch.score_a === realMatch.score_b);
            const acertoGoles = pred.pred_a === realMatch.score_a || pred.pred_b === realMatch.score_b;

            if (acertoMarcadorExacto) pQuiniela += 3;
            else if (acertoGanador && acertoGoles) pQuiniela += 2;
            else if (acertoGanador) pQuiniela += 1;
          }
        })

        if (officialData) {
          const userBracket = allBrackets?.find(b => b.user_id === profile.id)
          
          if (userBracket) {
            if (officialData.group_standings && userBracket.group_standings) {
              Object.keys(officialData.group_standings).forEach(letter => {
                const officialGroup = officialData.group_standings[letter] || []
                const userGroup = userBracket.group_standings[letter] || []
                let perfect = true
                for (let i = 0; i < 4; i++) { 
                  if (officialGroup[i]?.name !== userGroup[i]?.name) perfect = false 
                }
                if (perfect && officialGroup.length === 4 && officialGroup[0]?.name) {
                  pBracket += 5 
                }
              })
            }

            const roundPoints = [2, 4, 8, 16, 32]
            if (officialData.knockout_picks && userBracket.knockout_picks) {
              for (let round = 0; round < officialData.knockout_picks.length; round++) {
                const officialRound = officialData.knockout_picks[round] || []
                const userRound = userBracket.knockout_picks[round] || []
                for (let match = 0; match < officialRound.length; match++) {
                  if (officialRound[match]?.name && officialRound[match]?.name === userRound[match]?.name) {
                    pBracket += roundPoints[round]
                  }
                }
              }
            }
          }

          const userAward = allUserAwards?.find(a => a.user_id === profile.id)
          if (userAward && officialData.awards) {
            const checkAward = (official: string, userValue: string) => {
              if (official && userValue && official.toLowerCase().trim() === userValue.toLowerCase().trim()) return 10;
              return 0;
            }
            pPremios += checkAward(officialData.awards.champion, userAward.champion)
            pPremios += checkAward(officialData.awards.runner_up, userAward.runner_up)
            pPremios += checkAward(officialData.awards.mvp, userAward.mvp)
            pPremios += checkAward(officialData.awards.golden_boot, userAward.golden_boot)
            pPremios += checkAward(officialData.awards.golden_glove, userAward.golden_glove)
          }
        }

        await supabase.from('profiles').update({
          points_quiniela: pQuiniela,
          points_bracket: pBracket,
          points_premios: pPremios,
          total_points: pQuiniela + pBracket + pPremios
        }).eq('id', profile.id)

        count++;
      }

      alert(`✅ ¡Recálculo Exitoso!\nSe han corregido y distribuido correctamente los puntos de los ${count} usuarios de la plataforma.`)
    } catch (error: unknown) {
      if (error instanceof Error) {
        alert("Error al recalcular: " + error.message)
      } else {
        alert("Ocurrió un error desconocido al recalcular.")
      }
    } finally {
      setSaving(false)
    }
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

  const handleRoundOf32Change = (matchIndex: number, slot: 'team1' | 'team2', teamName: string) => {
    const selectedTeam = qualifiedTeams.find(t => t.name === teamName) || null;
    setRoundOf32(prev => {
      const next = [...prev];
      next[matchIndex] = { ...next[matchIndex], [slot]: selectedTeam };
      return next;
    });
    setPicks([Array(16).fill(null), Array(8).fill(null), Array(4).fill(null), Array(2).fill(null), Array(1).fill(null)]);
  }

  const selectWinner = (roundIndex: number, matchIndex: number, winner: Team) => {
    const newPicks = [...picks.map(r => [...r])]; newPicks[roundIndex][matchIndex] = winner
    for (let r = roundIndex + 1; r < newPicks.length; r++) newPicks[r][Math.floor(matchIndex / Math.pow(2, r - roundIndex))] = null
    setPicks(newPicks)
  }

  // AQUÍ ESTABA EL ERROR (Faltaban los signos de interrogación para proteger de datos vacíos)
  const getMatch = (roundIndex: number, matchIndex: number): Matchup => {
    if (roundIndex === 0) return roundOf32[matchIndex] || {team1: null, team2: null}
    return { 
      team1: picks[roundIndex - 1]?.[matchIndex * 2] || null, 
      team2: picks[roundIndex - 1]?.[matchIndex * 2 + 1] || null 
    }
  }

  const renderRoundColumn = (title: string, roundIndex: number, startIndex: number, count: number) => (
    <div key={title + startIndex} className="flex flex-col h-full shrink-0 w-28 md:w-32 lg:w-32 xl:w-36 px-1 lg:px-2">
      <div className="text-center font-bold text-slate-500 mb-2 uppercase tracking-wider text-[10px] xl:text-xs h-5">{title}</div>
      <div className="flex flex-col justify-around flex-1 py-8">
        {Array.from({length: count}).map((_, i) => (
          <div key={i} className="flex items-center justify-center w-full">
            <MatchupNode 
              match={getMatch(roundIndex, startIndex + i)} 
              winner={picks[roundIndex] ? picks[roundIndex][startIndex + i] : null} 
              onSelect={(t) => selectWinner(roundIndex, startIndex + i, t)} 
              isRoundOf32={roundIndex === 0}
              qualifiedTeams={qualifiedTeams}
              onTeamChange={(slot, teamName) => handleRoundOf32Change(startIndex + i, slot, teamName)}
            />
          </div>
        ))}
      </div>
    </div>
  )

  if (!isBrowser) return null
  if (loading) return <div className="min-h-screen bg-black text-[#00e5ff] flex items-center justify-center font-black text-3xl tracking-widest animate-pulse">VERIFICANDO...</div>

  return (
    <main className="min-h-screen bg-black text-white p-4 md:p-8 font-sans">
      <div className="max-w-[1600px] mx-auto">
        
        {/* CABECERA ADMIN */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 border-b-4 border-white pb-4">
          <div>
            <h1 className="text-4xl md:text-5xl font-black text-white uppercase tracking-wide">Centro de <span className="text-[#ff004d]">Mando</span></h1>
            <p className="text-gray-400 mt-2 font-bold uppercase tracking-widest">PANEL DE ADMINISTRADOR</p>
          </div>
          <Link href="/dashboard" className="bg-[#ccff00] text-black px-6 py-2 border-2 border-white hover:bg-white transition-colors w-full md:w-auto text-center font-bold uppercase tracking-wider text-xl">
            Volver
          </Link>
        </div>

        {/* PANEL DE 3 BOTONES */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <div className="bg-[#111] border-4 border-white p-6 shadow-[8px_8px_0px_#5500ff] flex flex-col justify-between">
            <div>
              <h2 className="text-2xl font-black text-white uppercase tracking-wider">📡 Goles</h2>
              <p className="text-gray-400 text-sm mt-2 font-bold uppercase tracking-widest">Sincroniza fase de grupos.</p>
            </div>
            <button onClick={handleApiSync} disabled={syncing || saving} className="mt-6 w-full bg-[#5500ff] text-white font-bold uppercase tracking-widest py-3 px-6 border-2 border-white hover:bg-white hover:text-black transition-colors disabled:opacity-50">{syncing ? 'Conectando...' : 'Sincronizar'}</button>
          </div>
          
          <div className="bg-[#111] border-4 border-white p-6 shadow-[8px_8px_0px_#ff5500] flex flex-col justify-between">
            <div>
              <h2 className="text-2xl font-black text-[#ff5500] uppercase tracking-wider">💾 Guardar</h2>
              <p className="text-gray-400 text-sm mt-2 font-bold uppercase tracking-widest">Guarda tu bracket/premios aquí debajo.</p>
            </div>
            <button onClick={handleSaveOfficialBracket} disabled={saving || syncing} className="mt-6 w-full bg-[#ff5500] text-black font-bold uppercase tracking-widest py-3 px-6 border-2 border-white hover:bg-white transition-colors disabled:opacity-50">{saving ? 'Guardando...' : 'Guardar Datos'}</button>
          </div>

          <div className="bg-[#111] border-4 border-white p-6 shadow-[8px_8px_0px_#00e5ff] flex flex-col justify-between">
            <div>
              <h2 className="text-2xl font-black text-[#00e5ff] uppercase tracking-wider">🔄 Recalcular</h2>
              <p className="text-gray-400 text-sm mt-2 font-bold uppercase tracking-widest">Reparte los puntos a todos los usuarios.</p>
            </div>
            <button onClick={handleRecalculatePoints} disabled={saving || syncing} className="mt-6 w-full bg-[#00e5ff] text-black font-bold uppercase tracking-widest py-3 px-6 border-2 border-white hover:bg-white transition-colors disabled:opacity-50">{saving ? 'Calculando...' : 'Recalcular Puntos'}</button>
          </div>
        </div>

        <h3 className="text-3xl font-black text-white mb-6 border-b-4 border-white pb-2 inline-block uppercase tracking-widest">Premios Oficiales</h3>
        <div className="bg-[#111] border-4 border-white p-6 md:p-8 mb-12 shadow-[8px_8px_0px_#ff004d]">
          <p className="text-gray-400 font-bold uppercase tracking-widest text-sm mb-6">Escribe los nombres exactos para otorgar 10 pts.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-black text-[#ccff00] uppercase tracking-widest">🏆 Campeón</label>
              <input type="text" value={officialAwards.champion} onChange={(e) => handleAwardChange('champion', e.target.value)} className="bg-black border-2 border-[#333] p-3 text-white font-bold uppercase focus:border-white outline-none" placeholder="País campeón" />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-black text-[#00e5ff] uppercase tracking-widest">🥈 Subcampeón</label>
              <input type="text" value={officialAwards.runner_up} onChange={(e) => handleAwardChange('runner_up', e.target.value)} className="bg-black border-2 border-[#333] p-3 text-white font-bold uppercase focus:border-white outline-none" placeholder="País subcampeón" />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-black text-[#ff004d] uppercase tracking-widest">⭐ Balón de Oro</label>
              <input type="text" value={officialAwards.mvp} onChange={(e) => handleAwardChange('mvp', e.target.value)} className="bg-black border-2 border-[#333] p-3 text-white font-bold uppercase focus:border-white outline-none" placeholder="Nombre exacto" />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-black text-[#5500ff] uppercase tracking-widest">⚽ Bota de Oro</label>
              <input type="text" value={officialAwards.golden_boot} onChange={(e) => handleAwardChange('golden_boot', e.target.value)} className="bg-black border-2 border-[#333] p-3 text-white font-bold uppercase focus:border-white outline-none" placeholder="Nombre exacto" />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-black text-[#ff5500] uppercase tracking-widest">🧤 Guante de Oro</label>
              <input type="text" value={officialAwards.golden_glove} onChange={(e) => handleAwardChange('golden_glove', e.target.value)} className="bg-black border-2 border-[#333] p-3 text-white font-bold uppercase focus:border-white outline-none" placeholder="Nombre exacto" />
            </div>
          </div>
        </div>

        <h3 className="text-3xl font-black text-white mb-6 border-b-4 border-white pb-2 inline-block uppercase tracking-widest">Bracket Oficial</h3>

        {Object.keys(groups).length > 0 && (
          <DragDropContext onDragEnd={onDragEnd}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-10 px-2 mt-4">
              {Object.entries(groups).map(([letter, teams]) => (
                <div key={letter} className="bg-[#111] p-4 border-4 border-[#222] shadow-[6px_6px_0px_#00e5ff]">
                  <h3 className="text-xl font-black text-[#00e5ff] mb-3 border-b-2 border-[#333] pb-2 uppercase tracking-widest">Grupo {letter}</h3>
                  <Droppable droppableId={letter}>
                    {(provided) => (
                      <div {...provided.droppableProps} ref={provided.innerRef} className="flex flex-col gap-2 min-h-[140px]">
                        {teams.map((team, idx) => (
                          <Draggable key={team.name} draggableId={team.name} index={idx}>
                            {(provided, snapshot) => (
                              <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps} className={`flex items-center gap-3 p-2 border-2 transition-all ${snapshot.isDragging ? 'bg-[#111] border-[#ccff00] z-50 shadow-[4px_4px_0px_#ccff00]' : 'bg-black border-[#444]'} ${idx < 2 && !snapshot.isDragging ? 'border-[#00e5ff]' : idx === 2 && !snapshot.isDragging ? 'border-[#ff5500]' : ''}`}>
                                <span className={`font-black w-6 text-center text-xl ${idx < 2 ? 'text-[#00e5ff]' : idx === 2 ? 'text-[#ff5500]' : 'text-gray-500'}`}>{idx + 1}</span>
                                <TeamFlag flag={team.flag} name={team.name} />
                                <span className="flex-1 truncate font-bold text-lg tracking-wider uppercase">{team.name.substring(0, 3)}</span>
                                <span className="text-gray-600 cursor-grab px-1 text-xl">≡</span>
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

        <div className="flex flex-col items-center mb-10 px-2">
          <h4 className="font-black text-xl text-white mb-4 uppercase tracking-widest">Selecciona los 8 Mejores Terceros</h4>
          <div className="flex flex-wrap gap-3 bg-[#111] p-6 border-4 border-[#222] shadow-[6px_6px_0px_#ff5500] justify-center w-full">
            {Object.entries(groups).map(([letter, teams]) => {
              const third = teams[2]
              if (!third) return null
              const isSelected = selectedThirds.some(t => t.name === third.name)
              return (
                <button key={letter} onClick={() => toggleThirdPlace(third)} className={`flex items-center gap-2 px-4 py-2 text-lg transition-all border-2 font-bold tracking-wider uppercase ${isSelected ? 'bg-[#ff5500] text-black border-[#ff5500]' : 'bg-black text-white border-[#444] hover:border-[#ff5500]'}`}>
                  <TeamFlag flag={third.flag} name={third.name} className="w-5 h-5 md:w-6 md:h-6" /><span className="truncate">{third.name.substring(0, 3)}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex justify-center pb-10 border-b-4 border-[#333] mx-2">
          <button onClick={generateBracket} disabled={selectedThirds.length !== 8} className="bg-[#ccff00] text-black font-black text-xl uppercase tracking-widest py-4 px-10 border-2 border-white hover:bg-white transition-colors disabled:bg-[#333] disabled:text-gray-500 disabled:border-[#444] shadow-[6px_6px_0px_#fff] w-full md:w-auto">
            {selectedThirds.length === 8 ? 'GenerAR FASE FINAL' : `FALTAN TERCEROS (${selectedThirds.length}/8)`}
          </button>
        </div>

        {roundOf32.length > 0 && (
          <div className="mt-12 pb-16 w-full px-2">
            <h2 className="text-4xl md:text-6xl font-black mb-8 text-center text-white tracking-widest uppercase">ELIMINATORIAS</h2>
            <div className="w-full overflow-x-auto bg-[#0a0a0a] border-4 border-white shadow-[10px_10px_0px_#ff004d] scrollbar-thin scrollbar-thumb-[#ff004d] scrollbar-track-black p-4 md:p-8">
              <div className="flex flex-row justify-between min-w-[1200px] xl:min-w-[1400px] h-[1200px] mx-auto relative">
                {renderRoundColumn("16AVOS", 0, 0, 8)} {renderRoundColumn("OCTAVOS", 1, 0, 4)} {renderRoundColumn("CUARTOS", 2, 0, 2)} {renderRoundColumn("SEMIS", 3, 0, 1)}
                <div className="flex flex-col justify-center items-center h-full w-48 shrink-0 px-2 relative">
                  <div className="text-center absolute top-12"><span className="text-6xl drop-shadow-[0_0_15px_#ccff00]">🏆</span><h3 className="text-2xl font-black text-[#ccff00] tracking-widest mt-2 uppercase">FINAL</h3></div>
                  <div className="w-full relative z-10">
                    <MatchupNode 
                      match={getMatch(4, 0)} 
                      winner={picks[4] ? picks[4][0] : null} 
                      onSelect={(t) => selectWinner(4, 0, t)} 
                    />
                  </div>
                  <div className="absolute bottom-24 w-full flex flex-col items-center">
                    <h4 className="text-white font-black text-xl mb-3 uppercase tracking-widest">CAMPEÓN</h4>
                    <div className={`border-4 p-4 flex flex-col items-center justify-center w-40 h-32 mb-8 transition-all ${picks[4]?.[0] ? 'bg-[#ff004d]/20 border-[#ff004d] scale-110' : 'bg-black border-[#444] border-dashed'}`}>
                      <TeamFlag flag={picks[4]?.[0]?.flag} name={picks[4]?.[0]?.name} className="w-16 h-16 mb-2" /><span className="text-lg font-bold text-white tracking-wider truncate w-full text-center uppercase">{picks[4]?.[0]?.name.substring(0, 3) || '???'}</span>
                    </div>
                  </div>
                </div>
                {renderRoundColumn("SEMIS", 3, 1, 1)} {renderRoundColumn("CUARTOS", 2, 2, 2)} {renderRoundColumn("OCTAVOS", 1, 4, 4)} {renderRoundColumn("16AVOS", 0, 8, 8)}
              </div>
            </div>
          </div>
        )}

      </div>
    </main>
  )
}

function MatchupNode({ match, winner, onSelect, isRoundOf32, qualifiedTeams, onTeamChange }: { match: Matchup, winner: Team | null, onSelect: (t: Team) => void, isRoundOf32?: boolean, qualifiedTeams?: Team[], onTeamChange?: (slot: 'team1' | 'team2', teamName: string) => void }) {
  const t1 = match?.team1; const t2 = match?.team2;
  const getBtnClass = (team: Team | null) => {
    if (!team) return 'opacity-30 cursor-not-allowed bg-black text-gray-600'
    if (winner?.name === team.name) return 'bg-[#ccff00] text-black'
    return 'bg-[#111] text-white hover:bg-[#222]'
  }

  return (
    <div className="flex flex-col bg-black border-2 border-white w-full shrink-0 overflow-hidden shadow-sm">
      <button onClick={(e) => { if ((e.target as HTMLElement).tagName !== 'SELECT') { t1 && t2 && onSelect(t1) } }} disabled={!t1 || !t2} className={`flex items-center gap-3 p-3 transition-colors ${getBtnClass(t1)}`}>
        <TeamFlag flag={t1?.flag} name={t1?.name} className="w-6 h-6" />
        {isRoundOf32 && onTeamChange ? (
          <select value={t1?.name || ''} onChange={(e) => onTeamChange('team1', e.target.value)} onClick={(e) => e.stopPropagation()} className="bg-black text-white text-xs outline-none w-full border border-[#444] rounded p-1 font-bold uppercase tracking-wider">
            <option value="">TBD</option>
            {qualifiedTeams?.map(t => <option key={t.name} value={t.name}>{t.name.substring(0, 3)}</option>)}
          </select>
        ) : (
          <span className="truncate font-bold text-sm md:text-base tracking-wider uppercase">{t1 ? t1.name.substring(0, 3) : 'TBD'}</span>
        )}
      </button>
      <div className="h-[2px] bg-white w-full" />
      <button onClick={(e) => { if ((e.target as HTMLElement).tagName !== 'SELECT') { t1 && t2 && onSelect(t2) } }} disabled={!t1 || !t2} className={`flex items-center gap-3 p-3 transition-colors ${getBtnClass(t2)}`}>
        <TeamFlag flag={t2?.flag} name={t2?.name} className="w-6 h-6" />
        {isRoundOf32 && onTeamChange ? (
          <select value={t2?.name || ''} onChange={(e) => onTeamChange('team2', e.target.value)} onClick={(e) => e.stopPropagation()} className="bg-black text-white text-xs outline-none w-full border border-[#444] rounded p-1 font-bold uppercase tracking-wider">
            <option value="">TBD</option>
            {qualifiedTeams?.map(t => <option key={t.name} value={t.name}>{t.name.substring(0, 3)}</option>)}
          </select>
        ) : (
          <span className="truncate font-bold text-sm md:text-base tracking-wider uppercase">{t2 ? t2.name.substring(0, 3) : 'TBD'}</span>
        )}
      </button>
    </div>
  )
}