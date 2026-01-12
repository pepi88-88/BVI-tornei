import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseServer'
import { requireAdmin } from '@/lib/auth'

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return new NextResponse('Unauthorized', { status: 401 })
  const s = supabaseAdmin()
  const sp = new URL(req.url).searchParams
  const tournament_id = sp.get('tournament_id') || ''
  if (!tournament_id) return NextResponse.json({ error: 'Missing tournament_id' }, { status: 400 })

  const { data, error } = await s
  .from('group_states')
  .select('state, is_public')
  .eq('tournament_id', tournament_id)
  .maybeSingle()


  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ state: data?.state || {} })
}

export async function PUT(req: NextRequest) {
  if (!requireAdmin(req)) return new NextResponse('Unauthorized', { status: 401 })
  const s = supabaseAdmin()

  const body = await req.json().catch(() => null) as { tournament_id?: string; state?: any }
  const tournament_id = String(body?.tournament_id || '').trim()
  const state = body?.state ?? {}
  if (!tournament_id) {
    return NextResponse.json({ error: 'Missing tournament_id' }, { status: 400 })
  }

  // 👇 prende il flag dalla UI admin (state.isPublic)
  const is_public = Boolean(state?.isPublic)

  const { error } = await s
    .from('group_states')
    .upsert(
      { tournament_id, state, is_public, updated_at: new Date().toISOString() },
      { onConflict: 'tournament_id' }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

