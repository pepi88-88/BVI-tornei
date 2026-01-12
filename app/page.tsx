// app/page.tsx
'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'

export default function Home() {
  const router = useRouter()

  function goAthlete() {
    localStorage.setItem('role', 'athlete')
    router.replace('/atleta/tornei') // o la tua pagina pubblica preferita
  }

  function goStaff() {
    router.replace('/login-staff')
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-[url('/bg-texture.svg')] bg-cover">
      <div className="card p-8 text-center space-y-6 max-w-xl w-[90%]">
        <div className="flex justify-center">
          <Image
            src="/logo-mattabel.png"
            width={220}
            height={220}
            alt="Mattabel Beach Volley"
            priority
          />
        </div>

        <h1 className="text-2xl font-semibold">Benvenuto</h1>
        <p className="text-neutral-400">Scegli il tuo accesso:</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button className="btn" onClick={goAthlete}>Atleta</button>
          <button className="btn" onClick={goStaff}>Staff</button>
        </div>
      </div>
    </main>
  )
}
