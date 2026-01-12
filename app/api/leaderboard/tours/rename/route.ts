// app/api/leaderboard/tours/rename/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseServer'
import { requireAdmin } from '@/lib/auth'

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) return new NextResponse('Unauthorized', { status: 401 })

  const body = await req.json().catch(()=>null) as { oldName?: string; newName?: string }
  const oldName = String(body?.oldName || '').trim()
  const newName = String(body?.newName || '').trim()
  if (!oldName || !newName) {
    return NextResponse.json({ error: 'Missing oldName or newName' }, { status: 400 })
  }

  const s = supabaseAdmin()

  // update in bulk (tutte le entries con quel tour)
  const { error } = await s
    .from('leaderboard_snapshots')
    .update({ tour: newName })
    .eq('tour', oldName)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
