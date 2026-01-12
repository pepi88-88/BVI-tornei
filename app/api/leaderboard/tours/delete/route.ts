import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseServer'
import { requireAdmin } from '@/lib/auth'

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { tour } = await req.json().catch(() => ({} as any))
  const name = String(tour || '').trim()
  if (!name) return NextResponse.json({ error: 'Missing tour' }, { status: 400 })

  const s = supabaseAdmin()
  const { error } = await s.from('leaderboard_snapshots').delete().eq('tour', name)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
