// app/login-staff/page.tsx
'use client'

import * as React from 'react'
import Link from 'next/link'

export default function LoginStaffPage() {
  const [err, setErr] = React.useState<string | undefined>()
  const [loading, setLoading] = React.useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (loading) return
    setErr(undefined)
    setLoading(true)

    try {
      const fd = new FormData(e.currentTarget)
      const r = await fetch('/api/auth/login', { method: 'POST', body: fd })
      const js = await r.json().catch(() => ({} as any))

      if (!r.ok || !js?.ok) {
        setErr(js?.error || 'Login fallito')
        return
      }

      // --- Normalizza il ruolo per l'AppHeader (che accetta solo 'admin' o 'coach')
      const serverRole = String(js.role ?? '').toLowerCase()
      const uiRole: 'admin' | 'coach' =
        serverRole === 'admin' ? 'admin'
        : serverRole === 'coach' ? 'coach'
        : serverRole === 'staff' ? 'coach'
        : 'coach' // fallback

      localStorage.setItem('role', uiRole)

      // Redirect richiesto
      location.assign('/admin/tour')
    } catch {
      setErr('Errore di rete')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-[url('/bg-texture.svg')] bg-cover">
      <div className="card p-8 w-[90%] max-w-md space-y-6">
        <h1 className="text-xl font-semibold text-center">Login Staff</h1>

        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <div className="text-xs mb-1">Utente</div>
            <input
              name="user"
              className="input w-full"
              autoComplete="username"
              disabled={loading}
              required
            />
          </div>

          <div>
            <div className="text-xs mb-1">Password</div>
            <input
              name="pass"
              type="password"
              className="input w-full"
              autoComplete="current-password"
              disabled={loading}
              required
            />
          </div>

          {err && <div className="text-sm text-red-400">{err}</div>}

          <button type="submit" className="btn w-full" disabled={loading}>
            {loading ? 'Accesso…' : 'Entra'}
          </button>
        </form>

        {/* Link per tornare alla home */}
        <div className="pt-2 text-center">
          <Link href="/" className="text-xs text-neutral-500 hover:text-neutral-300">
            ← Torna alla home
          </Link>
        </div>
      </div>
    </main>
  )
}
