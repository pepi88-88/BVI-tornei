// middleware.ts (o .js)
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// 401 con WWW-Authenticate (fa apparire il prompt basic auth)
function unauthorized(realm = 'Restricted Area') {
  return new NextResponse('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': `Basic realm="${realm}", charset="UTF-8"` },
  })
}

// Basic Auth compatibile con Edge Runtime (usa atob)
function checkBasicAuth(req: NextRequest, user?: string, pass?: string) {
  if (!user || !pass) return false
  const h = req.headers.get('authorization') || ''
  if (!h.toLowerCase().startsWith('basic ')) return false
  const base64 = h.slice(6).trim()
  // atob è disponibile in runtime edge
  try {
    const decoded = atob(base64)
    const i = decoded.indexOf(':')
    const u = decoded.slice(0, i)
    const p = decoded.slice(i + 1)
    return u === user && p === pass
  } catch {
    return false
  }
}

export function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname

  // regole rotte
  const isAdminPage = pathname.startsWith('/admin')
  const isCoachPage = pathname.startsWith('/coach')
  const isApi = pathname.startsWith('/api')

 // ✅ API pubbliche (SOLO lettura) usate dalle pagine atleta
const PUBLIC_API_PREFIXES = [
  '/api/tournaments',
  '/api/leaderboard',
  '/api/groups',
  '/api/brackets',
  '/api/atleta',
  '/api/tours',
  '/api/players',
  '/api/ranking',
]

// ⬇️ AGGIUNGI QUESTO BLOCCO
const PUBLIC_API_KEYWORDS = ['iscritti', 'entries', 'registrations']

const isReadOnlyMethod = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS'

const isWhitelistedGet =
  isReadOnlyMethod && PUBLIC_API_PREFIXES.some(p => pathname.startsWith(p))

const isKeywordPublic =
  isReadOnlyMethod && PUBLIC_API_KEYWORDS.some(k => pathname.includes(k))

  // 🔓 Consideriamo pubbliche anche: /api/auth, /api/public/*, oppure path che contengono /public/
const isApiPublic =
  pathname.startsWith('/api/auth') ||
  pathname.startsWith('/api/public') ||
  pathname.includes('/public/') ||
  isWhitelistedGet ||
  isKeywordPublic


  // Se non è /admin, /coach o /api protette → passa
  if (!isAdminPage && !isCoachPage && !(isApi && !isApiPublic)) {
    return NextResponse.next()
  }

  // 1) ADMIN o API protette: richiedi cookie o basic admin
  if (isAdminPage || (isApi && !isApiPublic)) {
    const cookieOk = req.cookies.get('admin_session')?.value === '1'
    const basicOk = checkBasicAuth(req, process.env.ADMIN_USER, process.env.ADMIN_PASS)
    if (cookieOk || basicOk) return NextResponse.next()

    if (isApi && !isApiPublic) {
          console.warn('[MW BLOCKED]', req.method, pathname)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }


    const u = req.nextUrl.clone()
    u.pathname = '/login-staff'
    return NextResponse.redirect(u)
  }

  // 2) COACH: basic auth dedicata
  if (isCoachPage) {
    const coachOk = checkBasicAuth(req, process.env.COACH_USER, process.env.COACH_PASS)
    if (coachOk) return NextResponse.next()
    return unauthorized('Coach Area')
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*', '/coach/:path*', '/api/:path*'],
}
