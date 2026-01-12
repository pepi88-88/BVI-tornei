'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Image from 'next/image'

const ORANGE = 'rgb(240,125,0)'

function NavBtn({ href, label }:{ href:string; label:string }) {
  const pathname = usePathname()
  const active = pathname?.startsWith(href)
  return (
    <Link
      href={href}
      className={[
        'inline-flex items-center justify-center',
        'h-11 px-4 rounded-md my-2',
        'min-w-[180px] md:min-w-[160px] sm:min-w-[140px] xs:min-w-[120px]',
        'bg-[--brand-navy] border border-neutral-700',
        'text-[15px] font-medium hover:border-neutral-500 transition-colors',
      ].join(' ')}
      style={active ? { borderColor: ORANGE } : undefined}
    >
      <span className="truncate">{label}</span>
    </Link>
  )
}

function ExitBtn(){
  return (
    <button
      className="inline-flex items-center justify-center h-11 px-4 rounded-md my-2
                 min-w-[180px] md:min-w-[160px] sm:min-w-[140px] xs:min-w-[120px]
                 bg-transparent border border-neutral-700 hover:border-neutral-500"
      onClick={()=>{ localStorage.removeItem('role'); location.href='/' }}
      title="Esci"
    >
      Esci
    </button>
  )
}

export default function AthleteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header sticky identico allo staff */}
      <header
        className="sticky top-0 z-40 bg-neutral-950/95 backdrop-blur header-shadow"
        style={{ borderBottom: '1px solid rgba(255,255,255,.06)' }}
      >
        <div className="container-admin mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex flex-wrap gap-2">
            <NavBtn href="/atleta/tornei" label="Tornei attivi" />
            <NavBtn href="/atleta/classifica" label="Classifica generale" />
            <ExitBtn />
          </nav>
        </div>
        <div className="brand-strip" />
      </header>

      {/* Logo sotto (non-sticky) */}
      <div className="container-admin mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-center py-4">
          <Image
            src="/logo2.png"
            alt="Mattabel"
            width={160}
            height={160}
            className="h-16 w-auto opacity-95"
            onError={(e)=>{ (e.currentTarget as any).style.display='none' }}
          />
        </div>
      </div>

      {/* Contenuto */}
      <main className="flex-1 container-admin mx-auto px-4 sm:px-6 lg:px-8 py-4">
        {children}
      </main>
    </div>
  )
}
