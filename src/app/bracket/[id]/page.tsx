"use client"

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import Image from 'next/image'

const TOURNAMENT_START = new Date('2026-06-12T00:00:00Z')

interface Profile { id: string; username: string; avatar_url: string; }
interface Team { name: string; flag: string; group_letter?: string; }
interface Matchup { team1: Team | null; team2: Team | null; }
interface BracketData { champion: string | null; knockout_picks: (Team | null)[][]; group_standings: Record<string, Team[]>; selected_thirds: Team[]; }

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

export default function PublicBracket() {
  const params = useParams()
  const router = useRouter()
  const userId = params.id as string

  const [loading, setLoading] = useState(true)
  const [isLocked, setIsLocked] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [bracket, setBracket] = useState<BracketData | null>(null)
  const [officialGroups, setOfficialGroups] = useState<Record<string, Team[]> | null>(null)
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
      const { data: officialData } = await supabase.from('official_bracket').select('group_standings').eq('id', 1).single()
      
      if (officialData && officialData.group_standings) {
        setOfficialGroups(officialData.group_standings)
      }

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
    <div key={title + startIndex} className="flex flex-col h-full shrink-0 w-32 md:w-36 lg:w-40 xl:w-44 px-2">
      <div className="text-center font-black text-[#ff004d] mb-2 uppercase tracking-widest text-sm h-6">{title}</div>
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

  if (loading) return <div className="min-h-screen bg-black text-[#00e5ff] flex items-center justify-center font-black text-4xl animate-pulse tracking-widest">Buscando...</div>

  if (isLocked) return (
    <main className="min-h-screen bg-black text-white p-8 flex flex-col items-center justify-center font-sans">
      <div className="text-8xl mb-6 animate-bounce">🔒</div>
      <h1 className="text-4xl md:text-5xl font-black text-white mb-4 text-center uppercase tracking-widest">¡Top Secret!</h1>
      <p className="text-gray-400 max-w-md text-center mb-10 text-lg">El bracket de <strong className="text-[#00e5ff] uppercase">{profile?.username}</strong> es secreto hasta que empiece el Mundial.</p>
      <Link href="/ranking" className="bg-[#ccff00] text-black font-bold px-8 py-3 border-2 border-white hover:bg-white uppercase tracking-widest text-xl">Volver al Ranking</Link>
    </main>
  )

  return (
    <main className="min-h-screen bg-black text-white p-4 md:p-8 font-sans">
      <div className="max-w-[1600px] mx-auto">
        
        {/* HEADER */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-[#111] p-6 border-4 border-white mb-8 shadow-[8px_8px_0px_#00e5ff] gap-6">
          <div className="flex items-center gap-4">
            {profile?.avatar_url ? (
              <Image src={profile.avatar_url} alt="Avatar" width={64} height={64} className="rounded-full border-2 border-white object-cover w-16 h-16" />
            ) : (
              <div className="w-16 h-16 rounded-full bg-[#333] border-2 border-white flex items-center justify-center text-3xl font-bold text-white">{profile?.username?.charAt(0).toUpperCase()}</div>
            )}
            <div>
              <p className="text-gray-400 text-sm font-bold uppercase tracking-widest">Bracket Oficial de</p>
              <h1 className="text-3xl md:text-4xl font-black text-white uppercase tracking-wider">{profile?.username}</h1>
            </div>
          </div>
          <Link href="/ranking" className="bg-[#5500ff] text-white px-6 py-3 border-2 border-white hover:bg-white hover:text-black transition-colors font-bold uppercase tracking-widest text-xl w-full md:w-auto text-center">Volver</Link>
        </div>

        {!bracket ? (
          <div className="text-center py-24 bg-[#111] border-4 border-[#333] border-dashed">
            <span className="text-6xl mb-4 block opacity-50">👻</span>
            <h2 className="text-3xl font-black text-gray-500 uppercase tracking-widest">Bracket Vacío</h2>
          </div>
        ) : (
          <>
            {/* SECCIÓN 1: FASE DE GRUPOS DEL USUARIO (CON COLORES Y PUNTOS) */}
            <div className="mb-16">
              <h2 className="text-3xl font-black mb-6 text-white tracking-widest uppercase border-b-4 border-white pb-2 inline-block">Fase de Grupos</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 px-2 mt-4">
                {Object.entries(bracket.group_standings).map(([letter, teams]) => {
                  let isGroupPerfect = false;
                  
                  if (officialGroups && officialGroups[letter]) {
                    const officialTeamNames = officialGroups[letter].map(t => t.name);
                    const userTeamNames = teams.map(t => t.name);
                    if (officialTeamNames.join(',') === userTeamNames.join(',')) {
                      isGroupPerfect = true;
                    }
                  }

                  return (
                    <div key={letter} className={`bg-[#111] p-4 border-4 shadow-lg ${isGroupPerfect ? 'border-[#ccff00] shadow-[6px_6px_0px_#ccff00]' : 'border-[#222] shadow-[6px_6px_0px_#ff004d]'}`}>
                      <div className="flex justify-between items-center mb-3 border-b-2 border-[#333] pb-2">
                        <h3 className="text-xl font-black text-[#00e5ff] uppercase tracking-widest">Grupo {letter}</h3>
                        {isGroupPerfect && officialGroups && (
                          <span className="bg-[#ccff00] text-black text-xs font-black px-2 py-1">+5 PTS</span>
                        )}
                      </div>
                      
                      <div className="flex flex-col gap-2 min-h-[140px]">
                        {teams.map((team, idx) => {
                          let positionStatusColor = 'text-gray-500';
                          
                          if (officialGroups && officialGroups[letter]) {
                            const officialTeamInThisPosition = officialGroups[letter][idx]?.name;
                            if (officialTeamInThisPosition === team.name) {
                              positionStatusColor = 'text-[#ccff00]'; 
                            } else {
                              positionStatusColor = 'text-[#ff004d]'; 
                            }
                          } else {
                            positionStatusColor = idx < 2 ? 'text-[#00e5ff]' : idx === 2 ? 'text-[#ff5500]' : 'text-gray-500';
                          }

                          return (
                            <div key={team.name} className="flex items-center gap-3 p-2 border-2 bg-black border-[#444]">
                              <span className={`font-black w-6 text-center text-xl ${positionStatusColor}`}>{idx + 1}</span>
                              <TeamFlag flag={team.flag} name={team.name} />
                              <span className="flex-1 truncate font-bold text-lg tracking-wider uppercase">{team.name.substring(0, 3)}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* SECCIÓN 2: ELIMINATORIAS */}
            <div className="mb-16 w-full px-2">
              <h2 className="text-3xl font-black mb-6 text-white tracking-widest uppercase border-b-4 border-white pb-2 inline-block">ELIMINATORIAS</h2>
              <div className="w-full overflow-x-auto bg-[#0a0a0a] border-4 border-white shadow-[10px_10px_0px_#00e5ff] scrollbar-thin scrollbar-thumb-[#00e5ff] scrollbar-track-black p-4 md:p-8 mt-4">
                <div className="flex flex-row justify-between min-w-[1200px] xl:min-w-[1400px] h-[1200px] mx-auto relative">
                  {renderRoundColumn("16AVOS", 0, 0, 8)}
                  {renderRoundColumn("OCTAVOS", 1, 0, 4)}
                  {renderRoundColumn("CUARTOS", 2, 0, 2)}
                  {renderRoundColumn("SEMIS", 3, 0, 1)}

                  <div className="flex flex-col justify-center items-center h-full w-48 shrink-0 px-2 relative">
                    <div className="text-center absolute top-12"><span className="text-6xl drop-shadow-[0_0_15px_#00e5ff]">🏆</span><h3 className="text-2xl font-black text-[#00e5ff] tracking-widest mt-2 uppercase">FINAL</h3></div>
                    <div className="w-full relative z-10"><MatchupNode match={getMatch(4, 0)} winner={bracket.knockout_picks[4]?.[0] || null} /></div>
                    <div className="absolute bottom-28 w-full flex flex-col items-center">
                      <h4 className="text-white font-black text-xl mb-3 uppercase tracking-widest">CAMPEÓN</h4>
                      <div className={`border-4 p-4 flex flex-col items-center justify-center w-40 h-32 ${bracket.champion ? 'bg-[#5500ff]/20 border-[#5500ff] scale-110' : 'bg-black border-[#444] border-dashed'}`}>
                        <TeamFlag flag={bracket.knockout_picks[4]?.[0]?.flag} name={bracket.knockout_picks[4]?.[0]?.name} className="w-16 h-16 mb-2" />
                        <span className="text-lg font-bold text-white tracking-wider truncate w-full text-center uppercase">{bracket.champion?.substring(0, 3) || '???'}</span>
                      </div>
                    </div>
                  </div>

                  {renderRoundColumn("SEMIS", 3, 1, 1)}
                  {renderRoundColumn("CUARTOS", 2, 2, 2)}
                  {renderRoundColumn("OCTAVOS", 1, 4, 4)}
                  {renderRoundColumn("16AVOS", 0, 8, 8)}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  )
}

function MatchupNode({ match, winner }: { match: Matchup, winner: Team | null }) {
  const t1 = match?.team1; const t2 = match?.team2;
  const getBtnClass = (team: Team | null) => {
    if (!team) return 'opacity-30 bg-black text-gray-600'
    if (winner?.name === team.name) return 'bg-[#00e5ff] text-black'
    return 'bg-[#111] text-white' 
  }

  return (
    <div className="flex flex-col bg-black border-2 border-white w-full shrink-0 overflow-hidden shadow-sm cursor-default">
      <div className={`flex items-center gap-3 p-3 transition-colors ${getBtnClass(t1)}`}>
        <TeamFlag flag={t1?.flag} name={t1?.name} className="w-6 h-6" />
        <span className="truncate font-bold text-sm md:text-base tracking-wider uppercase">{t1 ? t1.name.substring(0, 3) : 'TBD'}</span>
      </div>
      <div className="h-[2px] bg-white w-full" />
      <div className={`flex items-center gap-3 p-3 transition-colors ${getBtnClass(t2)}`}>
        <TeamFlag flag={t2?.flag} name={t2?.name} className="w-6 h-6" />
        <span className="truncate font-bold text-sm md:text-base tracking-wider uppercase">{t2 ? t2.name.substring(0, 3) : 'TBD'}</span>
      </div>
    </div>
  )
}