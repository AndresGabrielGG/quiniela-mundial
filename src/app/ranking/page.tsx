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

// NUEVO ORDEN LÓGICO
type TabCategory = 'quiniela' | 'total' | 'bracket' | 'premios'

export default function Ranking() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  
  // POR DEFECTO: La pestaña de Quiniela arranca primero
  const [activeTab, setActiveTab] = useState<TabCategory>('quiniela')
  
  const router = useRouter()

  useEffect(() => {
    const fetchRanking = async () => {
      setLoading(true)
      
      const orderColumn = 
        activeTab === 'total' ? 'total_points' : 
        activeTab === 'quiniela' ? 'points_quiniela' : 
        activeTab === 'bracket' ? 'points_bracket' : 'points_premios'

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order(orderColumn, { ascending: false })

      if (data) setProfiles(data)
      setLoading(false)
    }

    fetchRanking()
  }, [activeTab])

  const getDisplayPoints = (profile: Profile) => {
    switch (activeTab) {
      case 'quiniela': return profile.points_quiniela
      case 'bracket': return profile.points_bracket
      case 'premios': return profile.points_premios
      default: return profile.total_points
    }
  }

  return (
    <main className="min-h-screen bg-black text-white p-4 md:p-8 font-sans">
      <div className="max-w-4xl mx-auto">
        
        {/* NAVEGACIÓN */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 border-b-4 border-white pb-4">
          <h1 className="text-4xl md:text-5xl font-black text-white uppercase tracking-wide">Ranking <span className="text-[#ccff00]">Mundial</span></h1>
          <Link href="/dashboard" className="bg-[#ff004d] text-white px-6 py-2 border-2 border-white hover:bg-white hover:text-black transition-colors w-full md:w-auto text-center font-bold uppercase tracking-wider text-xl">
            Volver
          </Link>
        </div>

        {/* --- PESTAÑAS (NUEVO ORDEN: QUINIELA PRIMERO) --- */}
        <div className="flex overflow-x-auto bg-black border-4 border-white border-b-0 hide-scrollbar">
          <button 
            onClick={() => setActiveTab('quiniela')}
            className={`flex-1 py-4 px-4 text-sm md:text-lg font-bold uppercase tracking-wider whitespace-nowrap border-r-4 border-white transition-colors ${activeTab === 'quiniela' ? 'bg-[#00e5ff] text-black' : 'bg-[#111] text-white hover:bg-[#222]'}`}
          >
            Quiniela
          </button>
          <button 
            onClick={() => setActiveTab('total')}
            className={`flex-1 py-4 px-4 text-sm md:text-lg font-bold uppercase tracking-wider whitespace-nowrap border-r-4 border-white transition-colors ${activeTab === 'total' ? 'bg-[#ccff00] text-black' : 'bg-[#111] text-white hover:bg-[#222]'}`}
          >
            General
          </button>
          <button 
            onClick={() => setActiveTab('bracket')}
            className={`flex-1 py-4 px-4 text-sm md:text-lg font-bold uppercase tracking-wider whitespace-nowrap border-r-4 border-white transition-colors ${activeTab === 'bracket' ? 'bg-[#5500ff] text-white' : 'bg-[#111] text-white hover:bg-[#222]'}`}
          >
            Bracket
          </button>
          <button 
            onClick={() => setActiveTab('premios')}
            className={`flex-1 py-4 px-4 text-sm md:text-lg font-bold uppercase tracking-wider whitespace-nowrap transition-colors ${activeTab === 'premios' ? 'bg-[#ff004d] text-white' : 'bg-[#111] text-white hover:bg-[#222]'}`}
          >
            Premios
          </button>
        </div>

        {/* --- TABLA DE USUARIOS --- */}
        <div className="bg-[#0a0a0a] border-4 border-white shadow-[8px_8px_0px_#5500ff] min-h-[400px]">
          {loading ? (
            <div className="flex justify-center items-center h-48">
              <span className="text-[#00e5ff] font-black text-3xl animate-pulse tracking-widest">CARGANDO...</span>
            </div>
          ) : (
            <>
              {profiles.map((profile, index) => {
                const points = getDisplayPoints(profile)
                
                return (
                  <div 
                    key={profile.id}
                    onClick={() => router.push(`/bracket/${profile.id}`)}
                    className={`flex items-center justify-between p-4 md:p-6 border-b-4 border-[#333] last:border-b-0 cursor-pointer hover:bg-[#1a1a1a] transition-colors group ${index === 0 ? 'bg-[#ccff00]/5' : ''}`}
                    title="Ver Bracket"
                  >
                    <div className="flex items-center gap-4 md:gap-6">
                      <span className={`font-black text-3xl md:text-4xl w-8 text-center ${index === 0 ? 'text-[#ccff00]' : index === 1 ? 'text-[#00e5ff]' : index === 2 ? 'text-[#ff004d]' : 'text-gray-500'}`}>
                        {index + 1}
                      </span>
                      
                      {profile.avatar_url ? (
                        <Image src={profile.avatar_url} alt={profile.username} width={48} height={48} className="rounded-full border-2 border-white object-cover w-12 h-12" />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-[#222] border-2 border-white flex items-center justify-center font-bold text-xl text-white">
                          {profile.username?.charAt(0).toUpperCase()}
                        </div>
                      )}
                      
                      <div className="flex flex-col">
                        <span className="text-xl md:text-2xl font-bold uppercase tracking-wider group-hover:text-[#ccff00] transition-colors">
                          {profile.username}
                        </span>
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-widest md:hidden">VER BRACKET ➔</span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-6">
                      <div className="text-3xl md:text-4xl font-black text-white tracking-wider flex items-baseline gap-1">
                        {points} <span className="text-lg text-[#00e5ff] tracking-widest font-bold">PTS</span>
                      </div>
                      <span className="hidden md:block font-black text-2xl text-[#333] group-hover:text-[#ccff00] transition-colors">
                        ➔
                      </span>
                    </div>
                  </div>
                )
              })}
              
              {profiles.length === 0 && (
                <p className="p-12 text-center text-gray-500 font-bold text-2xl uppercase">No hay puntos aún.</p>
              )}
            </>
          )}
        </div>

      </div>
    </main>
  )
}