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