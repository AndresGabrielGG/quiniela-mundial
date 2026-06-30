"use client"

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'
import { supabase } from '@/lib/supabase'

interface Team { name: string; flag: string; group_letter?: string; }
interface Matchup { team1: Team | null; team2: Team | null; }

const TOURNAMENT_START = new Date('2026-06-12T00:00:00Z')

const TeamFlag = ({ flag, name, className = "w-5 h-5 md:w-6 md:h-6" }: { flag?: string, name?: string, className?: string }) => {
  if (!flag) return <span className="text-base">❔</span>
  if (flag.startsWith('http')) return <img src={flag} alt={name} className={`object-contain bg-white rounded-full p-0.5 ${className}`} />
  return <span className="text-base">{flag}</span>
}

const solveThirdPlaceMatrix = (thirds: Team[]): Team[] => {
  const slots = [
    ['A','B','C','D','F'], ['C','D','F','G','H'], ['C','E','F','H','I'], ['E','H','I','J','K'], 
    ['B','E','F','I','J'], ['A','E','H','I','J'], ['E','F','G','I','J'], ['D','E','I','J','L']
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

export default function BracketPredictor() {
  const router = useRouter()
  const [isBrowser, setIsBrowser] = useState(false)
  const [groups, setGroups] = useState<Record<string, Team[]>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [officialGroups, setOfficialGroups] = useState<Record<string, Team[]> | null>(null)
  
  const [selectedThirds, setSelectedThirds] = useState<Team[]>([])
  const [roundOf32, setRoundOf32] = useState<Matchup[]>([])
  const [picks, setPicks] = useState<(Team | null)[][]>([])

  const isLocked = new Date() > TOURNAMENT_START

  useEffect(() => {
    const timer = setTimeout(() => setIsBrowser(true), 0)
    
    const fetchInitialData = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/'); return }

      // Cargar equipos base
      const { data: teamsData, error } = await supabase.from('teams').select('*').order('group_letter', { ascending: true })
      let currentGroups: Record<string, Team[]> = {}
      
      if (teamsData && !error && teamsData.length > 0) {
        teamsData.forEach((team) => {
          if (!currentGroups[team.group_letter]) currentGroups[team.group_letter] = []
          currentGroups[team.group_letter].push({ name: team.name, flag: team.flag, group_letter: team.group_letter })
        })
        setGroups(currentGroups)
      }

      // Cargar resultados oficiales (si existen)
      const { data: officialData } = await supabase.from('official_bracket').select('group_standings').eq('id', 1).single()
      if (officialData && officialData.group_standings) {
        setOfficialGroups(officialData.group_standings)
      }

      // Cargar el bracket guardado del usuario
      const { data: userBracket } = await supabase.from('brackets').select('*').eq('user_id', session.user.id).single()
      
      if (userBracket) {
        if (userBracket.group_standings) {
          setGroups(userBracket.group_standings)
          currentGroups = userBracket.group_standings 
        }
        if (userBracket.selected_thirds) setSelectedThirds(userBracket.selected_thirds)
        if (userBracket.knockout_picks) setPicks(userBracket.knockout_picks)

        if (userBracket.selected_thirds && userBracket.selected_thirds.length === 8) {
          const t = (letter: string, pos: number) => currentGroups[letter]?.[pos] || null
          const thirdsMap = solveThirdPlaceMatrix(userBracket.selected_thirds)
          const t3 = (slotIndex: number) => thirdsMap[slotIndex]

          const matches: Matchup[] = []
          matches.push({ team1: t('E', 0), team2: t3(0) })          
          matches.push({ team1: t('I', 0), team2: t3(1) })          
          matches.push({ team1: t('A', 1), team2: t('B', 1) })      
          matches.push({ team1: t('F', 0), team2: t('C', 1) })      
          matches.push({ team1: t('K', 1), team2: t('L', 1) })      
          matches.push({ team1: t('H', 0), team2: t('J', 1) })      
          matches.push({ team1: t('D', 0), team2: t3(4) })          
          matches.push({ team1: t('G', 0), team2: t3(5) })          

          matches.push({ team1: t('C', 0), team2: t('F', 1) })      
          matches.push({ team1: t('E', 1), team2: t('I', 1) })      
          matches.push({ team1: t('A', 0), team2: t3(2) })          
          matches.push({ team1: t('L', 0), team2: t3(3) })          
          matches.push({ team1: t('J', 0), team2: t('H', 1) })      
          matches.push({ team1: t('D', 1), team2: t('G', 1) })      
          matches.push({ team1: t('B', 0), team2: t3(6) })          
          matches.push({ team1: t('K', 0), team2: t3(7) })          

          setRoundOf32(matches)
        }
      }
      setLoading(false)
    }

    fetchInitialData()
    return () => clearTimeout(timer)
  }, [router])

  const onDragEnd = (result: DropResult) => {
    if (!result.destination || isLocked) return
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
    if (isLocked) return
    const isSelected = selectedThirds.some(t => t.name === team.name)
    if (isSelected) {
      setSelectedThirds(selectedThirds.filter(t => t.name !== team.name))
    } else {
      if (selectedThirds.length < 8) setSelectedThirds([...selectedThirds, team])
      else alert("Ya seleccionaste a los 8 mejores terceros.")
    }
  }

  const generateBracket = () => {
    if (isLocked) return
    const t = (letter: string, pos: number) => groups[letter][pos]
    const thirdsMap = solveThirdPlaceMatrix(selectedThirds)
    const t3 = (slotIndex: number) => thirdsMap[slotIndex]

    const matches: Matchup[] = []
    matches.push({ team1: t('E', 0), team2: t3(0) })          
    matches.push({ team1: t('I', 0), team2: t3(1) })          
    matches.push({ team1: t('A', 1), team2: t('B', 1) })      
    matches.push({ team1: t('F', 0), team2: t('C', 1) })      
    matches.push({ team1: t('K', 1), team2: t('L', 1) })      
    matches.push({ team1: t('H', 0), team2: t('J', 1) })      
    matches.push({ team1: t('D', 0), team2: t3(4) })          
    matches.push({ team1: t('G', 0), team2: t3(5) })          

    matches.push({ team1: t('C', 0), team2: t('F', 1) })      
    matches.push({ team1: t('E', 1), team2: t('I', 1) })      
    matches.push({ team1: t('A', 0), team2: t3(2) })          
    matches.push({ team1: t('L', 0), team2: t3(3) })          
    matches.push({ team1: t('J', 0), team2: t('H', 1) })      
    matches.push({ team1: t('D', 1), team2: t('G', 1) })      
    matches.push({ team1: t('B', 0), team2: t3(6) })          
    matches.push({ team1: t('K', 0), team2: t3(7) })          

    setRoundOf32(matches)
    setPicks([
      Array(16).fill(null), Array(8).fill(null), Array(4).fill(null), Array(2).fill(null), Array(1).fill(null)
    ])
    setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 100)
  }

  const selectWinner = (roundIndex: number, matchIndex: number, winner: Team) => {
    if (isLocked) return
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
      team1: picks[roundIndex - 1]?.[matchIndex * 2] || null,
      team2: picks[roundIndex - 1]?.[matchIndex * 2 + 1] || null
    }
  }

  const handleSaveBracket = async () => {
    if (isLocked) { alert("El torneo ya empezó. No se pueden guardar cambios."); return; }
    setSaving(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { alert("Debes iniciar sesión para guardar."); setSaving(false); return; }
    const champion = picks[4] && picks[4][0] ? picks[4][0].name : null
    if (!champion && !confirm("Aún no has elegido al Campeón. ¿Guardar incompleto?")) { setSaving(false); return; }

    const { error } = await supabase.from('brackets').upsert({
      user_id: session.user.id, group_standings: groups, selected_thirds: selectedThirds, knockout_picks: picks, champion: champion, updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' })

    if (error) alert("Error al guardar: " + error.message)
    else alert("¡Tu Simulador ha sido guardado exitosamente! 🏆")
    setSaving(false)
  }

  const renderRoundColumn = (title: string, roundIndex: number, startIndex: number, count: number) => (
    <div key={title + startIndex} className="flex flex-col h-full shrink-0 w-32 md:w-36 lg:w-40 xl:w-44 px-2">
      <div className="text-center font-black text-[#00e5ff] mb-2 uppercase tracking-widest text-sm h-6">{title}</div>
      <div className="flex flex-col justify-around flex-1 py-8">
        {Array.from({length: count}).map((_, i) => {
          const matchIndex = startIndex + i;
          const match = getMatch(roundIndex, matchIndex);
          const winner = picks[roundIndex]?.[matchIndex] || null;
          return (
            <div key={i} className="flex items-center justify-center w-full">
              <MatchupNode match={match} winner={winner} onSelect={(t) => selectWinner(roundIndex, matchIndex, t)} isLocked={isLocked} />
            </div>
          )
        })}
      </div>
    </div>
  )

  if (!isBrowser) return null
  if (loading) return <div className="min-h-screen bg-black text-white flex items-center justify-center font-black text-4xl animate-pulse">CARGANDO...</div>

  return (
    <main className="min-h-screen bg-black text-white p-2 md:p-6 font-sans">
      <div className="max-w-[1600px] mx-auto">
        
        {/* HEADER */}
        <div className="flex flex-col md:flex-row justify-between items-center mb-8 px-2 border-b-4 border-white pb-4 gap-4">
          <h1 className="text-4xl md:text-5xl font-black text-white uppercase tracking-wider">Bracket <span className="text-[#5500ff]">Simulator</span></h1>
          <Link href="/dashboard" className="bg-[#ccff00] text-black px-6 py-2 border-2 border-white hover:bg-white transition-colors font-bold uppercase tracking-wider text-xl w-full md:w-auto text-center">
            Volver
          </Link>
        </div>

        {isLocked && (
          <div className="bg-[#ff004d] text-white p-4 border-4 border-white mb-8 text-center font-bold text-xl uppercase tracking-widest shadow-[6px_6px_0px_#fff]">
            EL TORNEO HA COMENZADO. TU BRACKET ESTÁ BLOQUEADO 🔒
          </div>
        )}

        {Object.keys(groups).length > 0 && (
          <DragDropContext onDragEnd={onDragEnd}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-10 px-2">
              {Object.entries(groups).map(([letter, teams]) => {
                
                // Lógica de calificación si el torneo ya empezó
                let isGroupPerfect = false;
                if (isLocked && officialGroups && officialGroups[letter]) {
                  const officialTeamNames = officialGroups[letter].map(t => t.name);
                  const userTeamNames = teams.map(t => t.name);
                  if (officialTeamNames.join(',') === userTeamNames.join(',')) {
                    isGroupPerfect = true;
                  }
                }

                return (
                  <div key={letter} className={`bg-[#111] p-4 border-4 shadow-[6px_6px_0px_#00e5ff] ${isLocked && isGroupPerfect ? 'border-[#ccff00] shadow-[6px_6px_0px_#ccff00]' : isLocked ? 'border-[#222] shadow-[6px_6px_0px_#ff004d]' : 'border-[#222]'}`}>
                    <div className="flex justify-between items-center mb-3 border-b-2 border-[#333] pb-2">
                      <h3 className="text-xl font-black text-[#00e5ff] uppercase tracking-widest">Grupo {letter}</h3>
                      {isLocked && isGroupPerfect && officialGroups && (
                        <span className="bg-[#ccff00] text-black text-xs font-black px-2 py-1">+5 PTS</span>
                      )}
                    </div>
                    
                    <Droppable droppableId={letter} isDropDisabled={isLocked}>
                      {(provided) => (
                        <div {...provided.droppableProps} ref={provided.innerRef} className="flex flex-col gap-2 min-h-[140px]">
                          {teams.map((team, idx) => {
                            
                            // Color por defecto mientras no empiece
                            let positionStatusColor = idx < 2 ? 'text-[#00e5ff]' : idx === 2 ? 'text-[#ff5500]' : 'text-gray-500';
                            
                            // Si está bloqueado y hay datos oficiales, calificar
                            if (isLocked) {
                              if (officialGroups && officialGroups[letter]) {
                                const officialTeamInThisPosition = officialGroups[letter][idx]?.name;
                                if (officialTeamInThisPosition === team.name) {
                                  positionStatusColor = 'text-[#ccff00]'; 
                                } else {
                                  positionStatusColor = 'text-[#ff004d]'; 
                                }
                              } else {
                                positionStatusColor = 'text-gray-500';
                              }
                            }

                            return (
                              <Draggable key={team.name} draggableId={team.name} index={idx} isDragDisabled={isLocked}>
                                {(provided, snapshot) => (
                                  <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}
                                    className={`flex items-center gap-3 p-2 border-2 transition-all ${snapshot.isDragging ? 'bg-[#111] border-[#ccff00] z-50 shadow-[4px_4px_0px_#ccff00]' : 'bg-black border-[#444]'} ${!isLocked && idx < 2 && !snapshot.isDragging ? 'border-[#00e5ff]' : !isLocked && idx === 2 && !snapshot.isDragging ? 'border-[#ff5500]' : ''}`}>
                                    <span className={`font-black w-6 text-center text-xl ${positionStatusColor}`}>{idx + 1}</span>
                                    <TeamFlag flag={team.flag} name={team.name} />
                                    <span className="flex-1 truncate font-bold text-lg tracking-wider uppercase">{team.name.substring(0, 3)}</span>
                                    {!isLocked && <span className="text-gray-600 cursor-grab px-1 text-xl">≡</span>}
                                  </div>
                                )}
                              </Draggable>
                            )
                          })}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  </div>
                )
              })}
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
                <button key={letter} onClick={() => toggleThirdPlace(third)} disabled={isLocked} className={`flex items-center gap-2 px-4 py-2 text-lg transition-all border-2 font-bold tracking-wider uppercase ${isSelected ? 'bg-[#ff5500] text-black border-[#ff5500]' : 'bg-black text-white border-[#444]'} ${!isLocked && !isSelected ? 'hover:border-[#ff5500]' : ''} ${isLocked ? 'cursor-not-allowed opacity-80' : ''}`}>
                  <TeamFlag flag={third.flag} name={third.name} className="w-5 h-5 md:w-6 md:h-6" />
                  <span className="truncate">{third.name.substring(0, 3)}</span>
                </button>
              )
            })}
          </div>
        </div>

        {!isLocked && (
          <div className="flex justify-center pb-10 border-b-4 border-[#333] mx-2">
            <button onClick={generateBracket} disabled={selectedThirds.length !== 8} className="bg-[#ccff00] text-black font-black text-xl uppercase tracking-widest py-4 px-10 border-2 border-white hover:bg-white transition-colors disabled:bg-[#333] disabled:text-gray-500 disabled:border-[#444] shadow-[6px_6px_0px_#fff] w-full md:w-auto">
              {selectedThirds.length === 8 ? 'GENERAR FASE FINAL' : `FALTAN TERCEROS (${selectedThirds.length}/8)`}
            </button>
          </div>
        )}

        {roundOf32.length > 0 && (
          <div className="mt-12 pb-16 w-full px-2">
            <h2 className="text-4xl md:text-6xl font-black mb-8 text-center text-white tracking-widest uppercase">ELIMINATORIAS</h2>
            <p className="text-center text-[#00e5ff] font-bold uppercase tracking-widest animate-pulse text-sm mb-6 lg:hidden">← Desliza para ver el árbol →</p>
            
            <div className="w-full overflow-x-auto bg-[#0a0a0a] border-4 border-white shadow-[10px_10px_0px_#ff004d] scrollbar-thin scrollbar-thumb-[#ff004d] scrollbar-track-black p-4 md:p-8">
              <div className="flex flex-row justify-between min-w-[1200px] xl:min-w-[1400px] h-[1200px] mx-auto relative">
                
                {renderRoundColumn("16AVOS", 0, 0, 8)}
                {renderRoundColumn("OCTAVOS", 1, 0, 4)}
                {renderRoundColumn("CUARTOS", 2, 0, 2)}
                {renderRoundColumn("SEMIS", 3, 0, 1)}

                <div className="flex flex-col justify-center items-center h-full w-48 shrink-0 px-2 relative">
                  <div className="text-center absolute top-12">
                    <span className="text-6xl drop-shadow-[0_0_15px_#ccff00]">🏆</span>
                    <h3 className="text-2xl font-black text-[#ccff00] tracking-widest mt-2 uppercase">FINAL</h3>
                  </div>
                  
                  <div className="w-full relative z-10">
                    <MatchupNode match={getMatch(4, 0)} winner={picks[4] ? picks[4][0] : null} onSelect={(t) => selectWinner(4, 0, t)} isLocked={isLocked} />
                  </div>

                  <div className="absolute bottom-24 w-full flex flex-col items-center">
                    <h4 className="text-white font-black text-xl mb-3 uppercase tracking-widest">CAMPEÓN</h4>
                    <div className={`border-4 p-4 flex flex-col items-center justify-center w-40 h-32 mb-8 transition-all ${picks[4]?.[0] ? 'bg-[#ff004d]/20 border-[#ff004d] scale-110' : 'bg-black border-[#444] border-dashed'}`}>
                      <TeamFlag flag={picks[4]?.[0]?.flag} name={picks[4]?.[0]?.name} className="w-16 h-16 mb-2" />
                      <span className="text-lg font-bold text-white tracking-wider truncate w-full text-center uppercase">{picks[4]?.[0]?.name.substring(0, 3) || '???'}</span>
                    </div>

                    {!isLocked && (
                      <button onClick={handleSaveBracket} disabled={saving} className="w-full bg-white text-black font-black uppercase tracking-widest py-4 px-4 border-2 border-black shadow-[4px_4px_0px_#ccff00] hover:bg-[#ccff00] transition-colors disabled:opacity-50">
                        {saving ? 'GUARDANDO...' : 'GUARDAR BRACKET'}
                      </button>
                    )}
                  </div>
                </div>

                {renderRoundColumn("SEMIS", 3, 1, 1)}
                {renderRoundColumn("CUARTOS", 2, 2, 2)}
                {renderRoundColumn("OCTAVOS", 1, 4, 4)}
                {renderRoundColumn("16AVOS", 0, 8, 8)}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}

function MatchupNode({ match, winner, onSelect, isLocked }: { match: Matchup, winner: Team | null, onSelect: (t: Team) => void, isLocked: boolean }) {
  const t1 = match?.team1; const t2 = match?.team2;
  const getBtnClass = (team: Team | null) => {
    if (!team) return 'opacity-30 cursor-not-allowed bg-black text-gray-600'
    if (winner?.name === team.name) return 'bg-[#ccff00] text-black'
    return isLocked ? 'bg-[#111] text-white' : 'bg-black text-white hover:bg-[#222]'
  }

  return (
    <div className="flex flex-col bg-black border-2 border-white w-full shrink-0 overflow-hidden shadow-sm">
      <button onClick={() => !isLocked && t1 && t2 && onSelect(t1)} disabled={!t1 || !t2 || isLocked} className={`flex items-center gap-3 p-3 transition-colors ${getBtnClass(t1)} ${isLocked ? 'cursor-default' : ''}`}>
        <TeamFlag flag={t1?.flag} name={t1?.name} className="w-6 h-6" />
        <span className="truncate font-bold text-sm md:text-base tracking-wider uppercase">{t1 ? t1.name.substring(0, 3) : 'TBD'}</span>
      </button>
      <div className="h-[2px] bg-white w-full" />
      <button onClick={() => !isLocked && t1 && t2 && onSelect(t2)} disabled={!t1 || !t2 || isLocked} className={`flex items-center gap-3 p-3 transition-colors ${getBtnClass(t2)} ${isLocked ? 'cursor-default' : ''}`}>
        <TeamFlag flag={t2?.flag} name={t2?.name} className="w-6 h-6" />
        <span className="truncate font-bold text-sm md:text-base tracking-wider uppercase">{t2 ? t2.name.substring(0, 3) : 'TBD'}</span>
      </button>
    </div>
  )
}