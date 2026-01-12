'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

// ---- ruolo da localStorage
function useRole(): 'admin' | 'coach' | 'athlete' | undefined {
  const [role, setRole] = React.useState<'admin'|'coach'|'athlete'|undefined>()
  React.useEffect(() => {
    try {
      const v = localStorage.getItem('role')
      setRole(v === 'admin' || v === 'coach' || v === 'athlete' ? v : undefined)
    } catch { setRole(undefined) }
  }, [])
  return role
}

// ---- menu
type Item = { href: string; label: string; roles: Array<'admin'|'coach'> }
const ITEMS: Item[] = [
  { href: '/admin/tour',          label: 'Gestione Tour/Tappa',          roles: ['admin'] },
  { href: '/admin/giocatori',     label: 'Crea giocatore',               roles: ['admin','coach'] },
  { href: '/admin/iscrizioni',    label: 'Iscrizioni',                   roles: ['admin','coach'] },
  { href: '/admin/pagamenti',     label: 'Pagamenti',                    roles: ['admin','coach'] },
  { href: '/admin/gironi',        label: 'Crea Gironi',                  roles: ['admin','coach'] },
  { href: '/admin/crea-tabellone',label: 'Creazione Tabellone',          roles: ['admin'] },
  { href: '/admin/risultati',     label: 'Risultati Girone/Tabellone',   roles: ['admin','coach'] },
  { href: '/admin/classifica',    label: 'Classifica',                   roles: ['admin','coach'] },
  { href: '/admin/stampa',        label: 'Stampa',                       roles: ['admin'] },
  { href: '/admin/gestione',      label: 'Gestione torneo Test',         roles: ['admin'] },
]

// ---- type guard
function isStaffRole(r: unknown): r is 'admin'|'coach' {
  return r === 'admin' || r === 'coach'
}

export default function AdminNav() {
  const role = useRole()
  const pathname = usePathname()

  // evita flash finché non conosciamo il ruolo
  if (role === undefined) return null

  // niente sidebar per athlete o ruoli non-ammessi
  if (!isStaffRole(role)) return null

  // da qui role è ristretto a 'admin' | 'coach'
  const visible = ITEMS.filter(it => it.roles.includes(role))

  return (
    <aside className="w-40 shrink-0 p-2 border-r border-neutral-800">
      <div className="text-xs uppercase tracking-wide text-neutral-500 mb-2">Staff</div>
      <nav className="flex flex-col gap-2">
        {visible.map(it => {
          const active = pathname?.startsWith(it.href)
          const cls = [
            'btn w-full justify-start btn-ghost btn-sm',
            active ? 'bg-neutral-800/60 ring-1 ring-neutral-700' : ''
          ].join(' ')
          return (
            <Link key={it.href} href={it.href} className={cls} aria-current={active ? 'page' : undefined}>
              {it.label}
            </Link>
          )
        })}
      </nav>

      <div className="mt-4">
        <button
          className="btn btn-ghost btn-xs w-full text-neutral-400"
          onClick={() => { localStorage.removeItem('role'); location.href='/' }}
          title="Esci allo schermo iniziale"
        >
          Esci
        </button>
      </div>
    </aside>
  )
}
