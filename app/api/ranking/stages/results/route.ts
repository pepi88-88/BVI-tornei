import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const edition_id = String(searchParams.get('edition_id') || '')
    if (!edition_id) {
      return NextResponse.json({ ok:false, error:'edition_id required' }, { status:400 })
    }

    // 1) prendi le tappe dell’edizione
    const { data: stages, error: e1 } = await supabaseAdmin
      .from('rank_stage')
      .select('id')
      .eq('edition_id', edition_id)

    if (e1) return NextResponse.json({ ok:false, error:e1.message }, { status:500 })
    const ids = (stages||[]).map(s=>s.id)
    if (ids.length === 0) return NextResponse.json({ ok:true, items: [] })

    // 2) prendi i risultati di quelle tappe
    const { data: rows, error: e2 } = await supabaseAdmin
      .from('rank_stage_result')
      .select('stage_id, player_id, position')
      .in('stage_id', ids)

    if (e2) return NextResponse.json({ ok:false, error:e2.message }, { status:500 })

    return NextResponse.json({ ok:true, items: rows ?? [] })
  } catch (e:any) {
    return NextResponse.json({ ok:false, error:String(e) }, { status:500 })
  }
}
