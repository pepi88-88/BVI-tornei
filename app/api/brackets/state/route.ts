// app/api/brackets/state/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseServer'
import { requireAdmin } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const isAdmin = requireAdmin(req)            // <-- può essere false ora
  const s = supabaseAdmin()
  const sp = new URL(req.url).searchParams
  const tournament_id = sp.get('tournament_id') || ''
  if (!tournament_id) {
    return NextResponse.json({ error: 'Missing tournament_id' }, { status: 400 })
  }

  const { data, error } = await s
    .from('bracket_states')
    .select('state, is_public')
    .eq('tournament_id', tournament_id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Se non admin: mostra solo se is_public === true
  if (!isAdmin) {
    if (data?.is_public) {
      return NextResponse.json({ state: data.state ?? {}, is_public: true })
    }
    // non pubblici -> ritorna vuoto
    return NextResponse.json({ state: {}, is_public: false })
  }

  // Admin: ritorna sempre
  return NextResponse.json({ state: data?.state || {}, is_public: data?.is_public ?? false })
}

export async function PUT(req: NextRequest) {
  if (!requireAdmin(req)) return new NextResponse('Unauthorized', { status: 401 })
  const s = supabaseAdmin()
  const body = await req.json().catch(()=>null) as { tournament_id?: string; state?: any; is_public?: boolean }
  const tournament_id = String(body?.tournament_id || '').trim()
  const state = body?.state ?? {}
  const is_public = typeof body?.is_public === 'boolean' ? body.is_public : undefined

  if (!tournament_id) {
    return NextResponse.json({ error: 'Missing tournament_id' }, { status: 400 })
  }

  const payload: any = { tournament_id, state, updated_at: new Date().toISOString() }
  if (is_public !== undefined) payload.is_public = is_public   // opzionale

  const { error } = await s.from('bracket_states').upsert(payload)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
