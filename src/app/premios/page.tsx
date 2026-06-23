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
  const TOURNAMENT_START = new Date('2026-06-12T15:00:00Z')
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

  if (loading) return <p className="min-h-screen bg-black text-[#00e5ff] flex items-center justify-center font-black text-3xl tracking-widest animate-pulse">CARGANDO...</p>

  return (
    <main className="min-h-screen bg-black text-white p-4 md:p-8 font-sans">
      <div className="max-w-3xl mx-auto">
        
        {/* NAVEGACIÓN */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 border-b-4 border-white pb-4">
          <h1 className="text-4xl md:text-5xl font-black text-white uppercase tracking-wide">
            Premios <span className="text-[#ff004d]">Finales</span>
          </h1>
          <Link href="/dashboard" className="bg-[#ccff00] text-black px-6 py-2 border-2 border-white hover:bg-white transition-colors w-full md:w-auto text-center font-bold uppercase tracking-wider text-xl">
            Volver
          </Link>
        </div>

        <div className="bg-[#111] p-6 md:p-10 border-4 border-white shadow-[10px_10px_0px_#00e5ff]">
          {isLocked && (
            <div className="bg-[#ff004d] text-white p-4 border-4 border-white mb-8 text-center font-bold text-xl uppercase tracking-widest shadow-[6px_6px_0px_#fff]">
              EL TORNEO HA COMENZADO. ESTAS PREDICCIONES ESTÁN BLOQUEADAS 🔒
            </div>
          )}

          <div className="flex flex-col gap-8">
            <AwardInput label="🏆 Campeón del Mundo" color="#ccff00" value={awards.champion} onChange={(v: string) => handleChange('champion', v)} disabled={isLocked} placeholder="Selecciona un país" options={WORLD_CUP_TEAMS} />
            <AwardInput label="🥈 Subcampeón" color="#00e5ff" value={awards.runner_up} onChange={(v: string) => handleChange('runner_up', v)} disabled={isLocked} placeholder="Selecciona un país" options={WORLD_CUP_TEAMS} />
            <div className="h-1 w-full bg-[#333] my-2" /> {/* Separador visual */}
            <AwardInput label="⭐ Balón de Oro (Mejor Jugador)" color="#ff004d" value={awards.mvp} onChange={(v: string) => handleChange('mvp', v)} disabled={isLocked} placeholder="Ej: Lionel Messi" />
            <AwardInput label="⚽ Bota de Oro (Goleador)" color="#5500ff" value={awards.golden_boot} onChange={(v: string) => handleChange('golden_boot', v)} disabled={isLocked} placeholder="Ej: Kylian Mbappé" />
            <AwardInput label="🧤 Guante de Oro (Mejor Portero)" color="#ff5500" value={awards.golden_glove} onChange={(v: string) => handleChange('golden_glove', v)} disabled={isLocked} placeholder="Ej: Dibu Martínez" />
          </div>

          {!isLocked && (
            <button 
              onClick={handleSave}
              className="mt-12 w-full bg-[#ccff00] text-black font-black uppercase tracking-widest py-4 px-6 border-4 border-white shadow-[6px_6px_0px_#fff] hover:bg-white hover:translate-y-1 hover:shadow-none transition-all text-xl md:text-2xl"
            >
              GUARDAR PREDICCIONES
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
  color: string; // Nuevo prop para darle acentos de color dinámicos
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  placeholder: string;
  options?: string[];
}

// Componente inteligente rediseñado
function AwardInput({ label, color, value, onChange, disabled, placeholder, options }: AwardInputProps) {
  return (
    <div className="flex flex-col gap-3">
      <label className="text-xl md:text-2xl font-black uppercase tracking-widest" style={{ color: color }}>
        {label}
      </label>
      
      {options ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="bg-black border-4 border-[#333] p-4 text-white font-bold text-lg md:text-xl uppercase tracking-wider focus:border-white outline-none disabled:opacity-50 disabled:cursor-not-allowed appearance-none cursor-pointer transition-colors"
        >
          <option value="" disabled className="text-gray-500">{placeholder}</option>
          {options.map((team) => (
            <option key={team} value={team}>{team}</option>
          ))}
        </select>
      ) : (
        <input 
          type="text" 
          value={value} 
          onChange={(e) => onChange(e.target.value)} 
          disabled={disabled}
          placeholder={placeholder}
          className="bg-black border-4 border-[#333] p-4 text-white font-bold text-lg md:text-xl uppercase tracking-wider focus:border-white outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-colors placeholder:text-gray-600"
        />
      )}
    </div>
  )
}