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
  const TOURNAMENT_START = new Date('2026-06-11T15:00:00Z')
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

  if (loading) return <p className="min-h-screen bg-slate-900 text-white p-8">Cargando premios...</p>

  return (
    <main className="min-h-screen bg-slate-900 text-white p-8">
      <div className="max-w-2xl mx-auto">
        
        {/* Navegación */}
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl md:text-4xl font-bold text-amber-400">Premios Finales 🌟</h1>
          <Link href="/dashboard" className="bg-slate-800 text-slate-300 px-4 py-2 rounded-lg hover:bg-slate-700 transition-colors border border-slate-600">
            Volver
          </Link>
        </div>

        <div className="bg-slate-800 p-6 md:p-8 rounded-xl border border-slate-700 shadow-xl">
          {isLocked && (
            <div className="bg-red-900/20 border border-red-800 text-red-300 p-4 rounded-lg mb-6 text-center">
              El torneo ya ha comenzado. Estas predicciones están bloqueadas 🔒
            </div>
          )}

          <div className="flex flex-col gap-6">
            <AwardInput label="🏆 Campeón del Mundo" value={awards.champion} onChange={(v: string) => handleChange('champion', v)} disabled={isLocked} placeholder="Selecciona un país" options={WORLD_CUP_TEAMS} />
            <AwardInput label="🥈 Subcampeón" value={awards.runner_up} onChange={(v: string) => handleChange('runner_up', v)} disabled={isLocked} placeholder="Selecciona un país" options={WORLD_CUP_TEAMS} />
            <AwardInput label="⭐ Balón de Oro (Mejor Jugador)" value={awards.mvp} onChange={(v: string) => handleChange('mvp', v)} disabled={isLocked} placeholder="Ej: Lionel Messi" />
            <AwardInput label="⚽ Bota de Oro (Goleador)" value={awards.golden_boot} onChange={(v: string) => handleChange('golden_boot', v)} disabled={isLocked} placeholder="Ej: Kylian Mbappé" />
            <AwardInput label="🧤 Guante de Oro (Mejor Portero)" value={awards.golden_glove} onChange={(v: string) => handleChange('golden_glove', v)} disabled={isLocked} placeholder="Ej: Dibu Martínez" />
          </div>

          {!isLocked && (
            <button 
              onClick={handleSave}
              className="mt-8 w-full bg-amber-500 text-slate-900 font-bold py-3 px-6 rounded-lg hover:bg-amber-400 transition-colors text-lg"
            >
              Guardar Predicciones
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
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  placeholder: string;
  options?: string[]; // Hacemos que sea opcional usando el signo de interrogación
}

// Componente inteligente
function AwardInput({ label, value, onChange, disabled, placeholder, options }: AwardInputProps) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-lg font-semibold text-slate-300">{label}</label>
      
      {options ? (
        // Si le pasamos opciones, dibuja un menú desplegable
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="bg-slate-900 border border-slate-600 rounded-lg p-3 text-white focus:border-amber-500 outline-none disabled:bg-slate-950 disabled:text-slate-500 appearance-none cursor-pointer"
        >
          <option value="" disabled>{placeholder}</option>
          {options.map((team) => (
            <option key={team} value={team}>{team}</option>
          ))}
        </select>
      ) : (
        // Si NO le pasamos opciones, dibuja el cuadro de texto normal
        <input 
          type="text" 
          value={value} 
          onChange={(e) => onChange(e.target.value)} 
          disabled={disabled}
          placeholder={placeholder}
          className="bg-slate-900 border border-slate-600 rounded-lg p-3 text-white focus:border-amber-500 outline-none disabled:bg-slate-950 disabled:text-slate-500"
        />
      )}
    </div>
  )
}