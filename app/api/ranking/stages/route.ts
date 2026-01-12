// app/api/ranking/stages/route.ts
import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
const supabase = getSupabaseAdmin()

/** GET ?edition_id=... -> lista tappe ordinate */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const edition_id = String(searchParams.get('edition_id') || '')
    if (!edition_id) {
      return NextResponse.json({ ok:false, error:'edition_id required' }, { status:400 })
    }

    const { data, error } = await supabase
      .from('rank_stage')
      .select('id, edition_id, name, day, month, multiplier, total_teams, created_at')
      .eq('edition_id', edition_id)
      .order('month', { ascending: true })
      .order('day',   { ascending: true })
      .order('created_at', { ascending: true })

    if (error) {
      // esponiamo l’errore per capire subito la causa (RLS/permessi/colonne)
      return NextResponse.json({ ok:false, error: error.message }, { status:500 })
    }
    return NextResponse.json({ ok:true, items: data ?? [] })
  } catch (e:any) {
    return NextResponse.json({ ok:false, error:String(e?.message || e) }, { status:500 })
  }
}

/** POST {edition_id, name, day, month, multiplier, total_teams} -> crea tappa */
export async function POST(req: Request) {
  try {
    const b = await req.json()
    const payload = {
      edition_id: String(b?.edition_id || ''),
      name:       String(b?.name || '').trim(),
      day:        Number(b?.day || 0),
      month:      Number(b?.month || 0),
      multiplier: Number(b?.multiplier || 1),
      total_teams:Number(b?.total_teams || 0),
    }
    if (!payload.edition_id || !payload.name || !payload.day || !payload.month || !payload.total_teams) {
      return NextResponse.json({ ok:false, error:'missing fields' }, { status:400 })
    }

    const { data, error } = await supabase
      .from('rank_stage')
      .insert(payload)
      .select('id')
      .single()

    if (error) return NextResponse.json({ ok:false, error: error.message }, { status:500 })
    return NextResponse.json({ ok:true, item:data })
  } catch (e:any) {
    return NextResponse.json({ ok:false, error:String(e?.message || e) }, { status:500 })
  }
}

/** DELETE {stage_id} -> elimina tappa */
export async function DELETE(req: Request) {
  try {
    const b = await req.json().catch(()=>null)
    const stage_id = String(b?.stage_id || '')
    if (!stage_id) {
      return NextResponse.json({ ok:false, error:'stage_id required' }, { status:400 })
    }

    // se non hai ON DELETE CASCADE sulle tabelle figlie (placements), avvisami e aggiungiamo le delete “figlie” qui.
    const { error } = await supabase.from('rank_stage').delete().eq('id', stage_id)
    if (error) return NextResponse.json({ ok:false, error:error.message }, { status:500 })
    return NextResponse.json({ ok:true })
  } catch (e:any) {
    return NextResponse.json({ ok:false, error:String(e?.message || e) }, { status:500 })
  }
}

