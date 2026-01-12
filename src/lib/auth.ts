import { NextRequest } from 'next/server'

export type StaffRole = 'admin' | 'coach'

/**
 * Ritorna il ruolo staff se autenticato, altrimenti null.
 * - Supporta cookie-based (middleware) e header per chiamate server-to-server.
 */
export function getStaffRole(req: NextRequest): StaffRole | null {
  // 1) cookie-based (middleware / login-staff imposta admin_session=1 e opzionale admin_role)
  const sess = req.cookies.get('admin_session')?.value
  if (sess === '1') {
    const role = (req.cookies.get('admin_role')?.value as StaffRole) || 'admin'
    return role
  }

  // 2) header-based (per test / chiamate interne da admin UI)
  const headerRole = (req.headers.get('x-role') || '').toLowerCase()
  if (headerRole === 'admin' || headerRole === 'coach') {
    return headerRole as StaffRole
  }

  // 3) fallback: Basic Auth opzionale per ambienti protetti
  const auth = req.headers.get('authorization') || ''
  if (auth.startsWith('Basic ')) {
    try {
      const [, b64] = auth.split(' ')
      const [u, p] = Buffer.from(b64, 'base64').toString().split(':')
      if (u === process.env.ADMIN_USER && p === process.env.ADMIN_PASS) {
        return 'admin'
      }
    } catch {}
  }

  return null
}

/**
 * Verifica accesso staff. Lancia Response 401/403 se non autorizzato.
 * Ritorna `{ role }` se ok.
 */
export function requireStaff(req: NextRequest, requiredRole?: StaffRole) {
  const role = getStaffRole(req)
  if (!role) {
    throw new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (requiredRole === 'admin' && role !== 'admin') {
    throw new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return { role }
}

/**
 * Retro-compatibilità: alcuni file possono ancora usare requireAdmin.
 * Usa lo stesso meccanismo di requireStaff('admin').
 */
export function requireAdmin(req: NextRequest) {
  return requireStaff(req, 'admin')
}
