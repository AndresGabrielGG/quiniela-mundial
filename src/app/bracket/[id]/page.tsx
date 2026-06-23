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
    <div key={title + startIndex} className="flex flex-col h-full shrink-0 w-32 md:w-36 lg:w-40 xl:w-44 px-2">
      <div className="text-center font-sztos font-bold text-[#ff004d] mb-2 uppercase tracking-widest text-sm h-6">{title}</div>
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

  if (loading) return <div className="min-h-screen bg-black text-[#00e5ff] flex items-center justify-center font-sztos font-bold text-4xl animate-pulse tracking-widest">Buscando...</div>

  if (isLocked) return (
    <main className="min-h-screen bg-black text-white p-8 flex flex-col items-center justify-center font-sans">
      <div className="text-8xl mb-6 animate-bounce">🔒</div>
      <h1 className="text-4xl md:text-5xl font-sztos font-bold text-white mb-4 text-center uppercase tracking-widest">¡Top Secret!</h1>
      <p className="text-gray-400 max-w-md text-center mb-10 text-lg">El bracket de <strong className="text-[#00e5ff] font-sztos uppercase">{profile?.username}</strong> es secreto hasta que empiece el Mundial.</p>
      <Link href="/ranking" className="bg-[#ccff00] text-black font-sztos font-bold px-8 py-3 border-2 border-white hover:bg-white uppercase tracking-widest text-xl">Volver al Ranking</Link>
    </main>
  )

  return (
    <main className="min-h-screen bg-black text-white p-4 md:p-8 font-sans">
      <div className="max-w-[1600px] mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-[#111] p-6 border-4 border-white mb-8 shadow-[8px_8px_0px_#00e5ff] gap-6">
          <div className="flex items-center gap-4">
            {profile?.avatar_url ? (
              <Image src={profile.avatar_url} alt="Avatar" width={64} height={64} className="rounded-full border-2 border-white object-cover w-16 h-16" />
            ) : (
              <div className="w-16 h-16 rounded-full bg-[#333] border-2 border-white flex items-center justify-center text-3xl font-sztos font-bold text-white">{profile?.username?.charAt(0).toUpperCase()}</div>
            )}
            <div>
              <p className="text-gray-400 text-sm font-bold uppercase tracking-widest">Bracket Oficial de</p>
              <h1 className="text-3xl md:text-4xl font-sztos font-bold text-white uppercase tracking-wider">{profile?.username}</h1>
            </div>
          </div>
          <Link href="/ranking" className="bg-[#5500ff] text-white px-6 py-3 border-2 border-white hover:bg-white hover:text-black transition-colors font-sztos font-bold uppercase tracking-widest text-xl w-full md:w-auto text-center">Volver</Link>
        </div>

        {!bracket ? (
          <div className="text-center py-24 bg-[#111] border-4 border-[#333] border-dashed">
            <span className="text-6xl mb-4 block opacity-50">👻</span>
            <h2 className="text-3xl font-sztos font-bold text-gray-500 uppercase tracking-widest">Bracket Vacío</h2>
          </div>
        ) : (
          <div className="w-full overflow-x-auto bg-[#0a0a0a] border-4 border-white shadow-[10px_10px_0px_#00e5ff] scrollbar-thin scrollbar-thumb-[#00e5ff] scrollbar-track-black p-4 md:p-8">
            <div className="flex flex-row justify-between min-w-[1200px] xl:min-w-[1400px] h-[1200px] mx-auto relative">
              {renderRoundColumn("16AVOS", 0, 0, 8)}
              {renderRoundColumn("OCTAVOS", 1, 0, 4)}
              {renderRoundColumn("CUARTOS", 2, 0, 2)}
              {renderRoundColumn("SEMIS", 3, 0, 1)}

              <div className="flex flex-col justify-center items-center h-full w-48 shrink-0 px-2 relative">
                <div className="text-center absolute top-12"><span className="text-6xl drop-shadow-[0_0_15px_#00e5ff]">🏆</span><h3 className="text-2xl font-sztos font-bold text-[#00e5ff] tracking-widest mt-2 uppercase">FINAL</h3></div>
                <div className="w-full relative z-10"><MatchupNode match={getMatch(4, 0)} winner={bracket.knockout_picks[4]?.[0] || null} /></div>
                <div className="absolute bottom-28 w-full flex flex-col items-center">
                  <h4 className="text-white font-sztos font-bold text-xl mb-3 uppercase tracking-widest">CAMPEÓN</h4>
                  <div className={`border-4 p-4 flex flex-col items-center justify-center w-40 h-32 ${bracket.champion ? 'bg-[#5500ff]/20 border-[#5500ff] scale-110' : 'bg-black border-[#444] border-dashed'}`}>
                    <TeamFlag flag={bracket.knockout_picks[4]?.[0]?.flag} name={bracket.knockout_picks[4]?.[0]?.name} className="w-16 h-16 mb-2" />
                    <span className="text-lg font-sztos font-bold text-white tracking-wider truncate w-full text-center uppercase">{bracket.champion?.substring(0, 3) || '???'}</span>
                  </div>
                </div>
              </div>

              {renderRoundColumn("SEMIS", 3, 1, 1)}
              {renderRoundColumn("CUARTOS", 2, 2, 2)}
              {renderRoundColumn("OCTAVOS", 1, 4, 4)}
              {renderRoundColumn("16AVOS", 0, 8, 8)}
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
    if (!team) return 'opacity-30 bg-black text-gray-600'
    // Color Cyan / Púrpura para indicar al ganador en el perfil ajeno
    if (winner?.name === team.name) return 'bg-[#00e5ff] text-black'
    return 'bg-[#111] text-white' 
  }

  return (
    <div className="flex flex-col bg-black border-2 border-white w-full shrink-0 overflow-hidden shadow-sm cursor-default">
      <div className={`flex items-center gap-3 p-3 transition-colors ${getBtnClass(t1)}`}>
        <TeamFlag flag={t1?.flag} name={t1?.name} className="w-6 h-6" />
        <span className="truncate font-sztos font-normal text-sm md:text-base tracking-wider uppercase">{t1 ? t1.name.substring(0, 3) : 'TBD'}</span>
      </div>
      <div className="h-[2px] bg-white w-full" />
      <div className={`flex items-center gap-3 p-3 transition-colors ${getBtnClass(t2)}`}>
        <TeamFlag flag={t2?.flag} name={t2?.name} className="w-6 h-6" />
        <span className="truncate font-sztos font-normal text-sm md:text-base tracking-wider uppercase">{t2 ? t2.name.substring(0, 3) : 'TBD'}</span>
      </div>
    </div>
  )
}