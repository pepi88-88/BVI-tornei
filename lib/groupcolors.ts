import type { NextRequest } from 'next/server'

export function requireAdmin(_req?: NextRequest): boolean {
  if (process.env.NODE_ENV !== 'production') return true
  // TODO: sostituire con controllo login staff (cookie/sessione)
  return true
}
