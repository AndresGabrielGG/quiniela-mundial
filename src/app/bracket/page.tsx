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

// Sacamos el cerebro de la FIFA afuera para que el useEffect pueda usarlo al cargar
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

export default function BracketPredictor() {
  const router = useRouter()
  const [isBrowser, setIsBrowser] = useState(false)
  const [groups, setGroups] = useState<Record<string, Team[]>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  
  const [selectedThirds, setSelectedThirds] = useState<Team[]>([])
  const [roundOf32, setRoundOf32] = useState<Matchup[]>([])
  const [picks, setPicks] = useState<(Team | null)[][]>([])

  useEffect(() => {
    const timer = setTimeout(() => setIsBrowser(true), 0)
    
    const fetchInitialData = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.push('/')
        return
      }

      // 1. Cargamos los equipos base oficiales
      const { data: teamsData, error } = await supabase.from('teams').select('*').order('group_letter', { ascending: true })
      let currentGroups: Record<string, Team[]> = {}
      
      if (teamsData && !error && teamsData.length > 0) {
        teamsData.forEach((team) => {
          if (!currentGroups[team.group_letter]) currentGroups[team.group_letter] = []
          currentGroups[team.group_letter].push({ name: team.name, flag: team.flag, group_letter: team.group_letter })
        })
        setGroups(currentGroups)
      }

      // 2. LÓGICA DE RECUPERACIÓN: Buscamos si el usuario ya tiene un bracket guardado
      const { data: userBracket } = await supabase.from('brackets').select('*').eq('user_id', session.user.id).single()
      
      if (userBracket) {
        // Restauramos los grupos y los terceros
        if (userBracket.group_standings) {
          setGroups(userBracket.group_standings)
          currentGroups = userBracket.group_standings // Usamos esto para el árbol
        }
        if (userBracket.selected_thirds) setSelectedThirds(userBracket.selected_thirds)
        if (userBracket.knockout_picks) setPicks(userBracket.knockout_picks)

        // Si ya había generado el árbol (tenía 8 terceros), lo reconstruimos visualmente
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

  const generateBracket = () => {
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
          const winner = picks[roundIndex]?.[matchIndex] || null;
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
  if (loading) return <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center font-bold text-xl animate-pulse">Cargando tu progreso...</div>

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