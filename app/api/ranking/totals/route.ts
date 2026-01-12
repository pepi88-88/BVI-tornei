import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

/** GET ?edition_id=... -> classifica ordinata per totale */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const edition_id = searchParams.get('edition_id') || ''
  if (!edition_id) return NextResponse.json({ ok:false, error:'edition_id required' }, { status:400 })

  const { data, error } = await supabaseAdmin
    .from('rank_totals_v')
    .select('player_id, display_name, points_from_stages, delta_points, total_points')
    .eq('edition_id', edition_id)
    .order('total_points', { ascending: false })

  if (error) return NextResponse.json({ ok:false, error:error.message }, { status:500 })
  return NextResponse.json({ ok:true, items: data })
}
