import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

/** PUT {edition_id, player_id, delta_points, note?} */
export async function PUT(req: Request) {
  const b = await req.json()
  const edition_id = String(b?.edition_id||'')
  const player_id = String(b?.player_id||'')
  const delta_points = Number(b?.delta_points ?? 0)
  const note = b?.note ?? null
  if (!edition_id || !player_id) return NextResponse.json({ ok:false, error:'edition_id & player_id required' }, { status:400 })

  const { error } = await supabaseAdmin
    .from('rank_adjustment')
    .upsert({ edition_id, player_id, delta_points, note }, { onConflict: 'edition_id,player_id' })

  if (error) return NextResponse.json({ ok:false, error:error.message }, { status:500 })
  return NextResponse.json({ ok:true })
}
