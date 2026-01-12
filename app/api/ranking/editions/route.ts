// app/api/ranking/editions/route.ts
import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

const supabase = getSupabaseAdmin()

/** GET /api/ranking/editions?tour_id=GLOBAL&gender=M */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const tour_id = String(searchParams.get('tour_id') || 'GLOBAL')
    const gender  = (String(searchParams.get('gender') || 'M').toUpperCase() as 'M'|'F')

    const { data, error } = await supabase
      .from('rank_edition')
      .select('id,name')
      .eq('tour_id', tour_id)
      .eq('gender', gender)
      .eq('is_archived', false)
      .order('created_at', { ascending: false })

    if (error) throw error
    return NextResponse.json({ ok: true, items: data ?? [] })
  } catch (e:any) {
    return NextResponse.json({ ok:false, error:String(e?.message||e) }, { status:500 })
  }
}

/** POST /api/ranking/editions  { tour_id, gender, name } */
export async function POST(req: Request) {
  try {
    const b = await req.json()
    const tour_id = String(b?.tour_id || 'GLOBAL')
    const gender  = (String(b?.gender || 'M').toUpperCase() as 'M'|'F')
    const name    = String(b?.name || '').trim()
    if (!name) return NextResponse.json({ ok:false, error:'name required' }, { status:400 })

    const { data, error } = await supabase
      .from('rank_edition')
      .insert({ tour_id, gender, name, is_archived: false })
      .select('id,name')
      .single()

    if (error) throw error
    return NextResponse.json({ ok:true, id: data.id, item: data })
  } catch (e:any) {
    return NextResponse.json({ ok:false, error:String(e?.message||e) }, { status:500 })
  }
}

/** PUT /api/ranking/editions  { edition_id, name } */
export async function PUT(req: Request) {
  try {
    const b = await req.json()
    const edition_id = String(b?.edition_id || '')
    const name = String(b?.name || '').trim()
    if (!edition_id) return NextResponse.json({ ok:false, error:'edition_id required' }, { status:400 })
    if (!name)       return NextResponse.json({ ok:false, error:'name required' }, { status:400 })

    const { error } = await supabase
      .from('rank_edition')
      .update({ name })
      .eq('id', edition_id)

    if (error) throw error
    return NextResponse.json({ ok:true })
  } catch (e:any) {
    return NextResponse.json({ ok:false, error:String(e?.message||e) }, { status:500 })
  }
}

/** DELETE /api/ranking/editions  { edition_id }
 *  Soft-delete: is_archived=true (evita problemi di FK).
 *  Se vuoi hard-delete, dimmelo e ti do la variante con cancellazioni figlie.
 */
export async function DELETE(req: Request) {
  try {
    const b = await req.json()
    const edition_id = String(b?.edition_id || '')
    if (!edition_id) return NextResponse.json({ ok:false, error:'edition_id required' }, { status:400 })

    const { error } = await supabase
      .from('rank_edition')
      .update({ is_archived: true })
      .eq('id', edition_id)

    if (error) throw error
    return NextResponse.json({ ok:true })
  } catch (e:any) {
    return NextResponse.json({ ok:false, error:String(e?.message||e) }, { status:500 })
  }
}
