// app/api/groups/public/state/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'
// opzionale: hard no-cache
export const revalidate = 0

export async function GET(req: NextRequest) {
  const sb = getSupabaseAdmin()
  const tid = new URL(req.url).searchParams.get('tournament_id')?.trim()
  if (!tid) {
    return NextResponse.json({ is_public: false, state: null, error: 'Missing tournament_id' }, { status: 400 })
  }

  const { data, error } = await sb
    .from('group_states')              // 👈 conferma che il nome tabella è proprio questo
    .select('state, is_public')
    .eq('tournament_id', tid)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ is_public: false, state: null, error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ is_public: false, state: null }, { status: 404 })
  }

  // Se non è pubblico, NON 403: restituisci il contratto che la UI atleta si aspetta
  const flagPublic = !!data.is_public || !!data.state?.isPublic
  if (!flagPublic) {
    return NextResponse.json({ is_public: false, state: null })
  }

  // Per sicurezza restituisci solo i campi necessari alla UI atleta
  const st = (data.state || {}) as any
  const safeState = {
    groupsCount: st.groupsCount ?? 0,
    meta: st.meta ?? {},
    assign: st.assign ?? {},
    times: st.times ?? {},
    gField: st.gField ?? {},
    scores: st.scores ?? {},
    labels: st.labels ?? {},
  }

  return NextResponse.json({ is_public: true, state: safeState })
}
