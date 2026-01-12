'use client'

import * as React from 'react'
import { useRouter, usePathname } from 'next/navigation'

/** Helper client-side: legge il ruolo da localStorage */
function getRole(): 'admin' | 'coach' | 'athlete' | null {
  if (typeof window === 'undefined') return null
  const v = localStorage.getItem('role')
  return v === 'admin' || v === 'coach' || v === 'athlete' ? v : null
}

export default function AdminGate({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [mounted, setMounted] = React.useState(false)

  // evita hydration mismatch
  React.useEffect(() => setMounted(true), [])

  // guard
  React.useEffect(() => {
    if (!mounted) return
    const role = getRole()

    // solo admin/coach possono vedere /admin/*
    if (pathname?.startsWith('/admin')) {
      if (role === 'admin' || role === 'coach') return
      const next = encodeURIComponent(pathname || '/admin')
router.replace(`/login-staff?next=${next}`)
    }
  }, [mounted, pathname, router])

  if (!mounted) return null
  return <>{children}</>
}
