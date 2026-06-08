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