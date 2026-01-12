import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const raw =
    process.env.NEXT_PUBLIC_SUPABASE_URL
    || process.env.SUPABASE_URL
    || ''

  // estrae il project-ref (la prima parte del dominio *.supabase.co)
  const projectRef = raw.replace(/^https?:\/\//,'').split('.')[0] || null

  return NextResponse.json({ projectRef })
}
