import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

/** GET ?edition_id=... -> lista giocatori inclusi */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const edition_id = searchParams.get('edition_id') || ''
  if (!edition_id) return NextResponse.json({ ok:false, error:'edition_id required' }, { status:400 })

  const { data, error } = await supabaseAdmin
    .from('rank_player')
    .select('player_id, player_ref, display_name, lock, note')
    .eq('edition_id', edition_id)
    .order('display_name', { ascending: true })

  if (error) return NextResponse.json({ ok:false, error:error.message }, { status:500 })
  return NextResponse.json({ ok:true, items: data })
}

/** POST {edition_id, display_name, player_ref?} -> aggiungi giocatore */
export async function POST(req: Request) {
  const b = await req.json()
  const edition_id = String(b?.edition_id||'')
  const display_name = String(b?.display_name||'').trim()
  const player_ref = b?.player_ref ?? null
  if (!edition_id || !display_name) return NextResponse.json({ ok:false, error:'edition_id & display_name required' }, { status:400 })

  const { data, error } = await supabaseAdmin
    .from('rank_player')
    .insert({ edition_id, display_name, player_ref })
    .select('player_id')
    .maybeSingle()

  if (error) return NextResponse.json({ ok:false, error:error.message }, { status:500 })
  return NextResponse.json({ ok:true, player_id: data?.player_id })
}

/** DELETE {edition_id, player_id} -> rimuovi giocatore */
export async function DELETE(req: Request) {
  const b = await req.json()
  const edition_id = String(b?.edition_id||'')
  const player_id = String(b?.player_id||'')
  if (!edition_id || !player_id) return NextResponse.json({ ok:false, error:'edition_id & player_id required' }, { status:400 })

  const { error } = await supabaseAdmin
    .from('rank_player')
    .delete()
    .eq('edition_id', edition_id)
    .eq('player_id', player_id)

  if (error) return NextResponse.json({ ok:false, error:error.message }, { status:500 })
  return NextResponse.json({ ok:true })
}
