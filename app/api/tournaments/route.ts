// app/api/tournaments/route.ts
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseServer'

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const tour_id = sp.get('tour_id') || sp.get('tourId') || ''
  const s = supabaseAdmin()
  let q = s.from('tournaments').select('*').order('event_date', { ascending: true }).order('created_at', { ascending: true })
  if (tour_id) q = q.eq('tour_id', tour_id)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
}

export async function POST(req: Request) {
  const b = await req.json()
  const s = supabaseAdmin()
  const payload = {
    tour_id: b.tour_id,
    name: String(b.name || '').trim(),
    event_date: b.event_date ?? null,
    multiplier: Number(b.multiplier ?? 1) || 1,
    max_teams: b.max_teams ?? null,
  }
  if (!payload.tour_id || !payload.name) {
    return NextResponse.json({ error: 'tour_id e name obbligatori' }, { status: 400 })
  }
  const { data, error } = await s.from('tournaments').insert(payload).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
}

export async function PATCH(req: Request) {
  const b = await req.json()
  const id = String(b.id || '')
  if (!id) return NextResponse.json({ error: 'id mancante' }, { status: 400 })
  const upd: any = {}
  ;['name','event_date','multiplier','max_teams','status','archived','closed_at','tour_id'].forEach(k=>{
    if (b[k] !== undefined) upd[k] = b[k]
  })
  const s = supabaseAdmin()
  const { data, error } = await s.from('tournaments').update(upd).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
}

export async function DELETE(req: Request) {
  const sp = new URL(req.url).searchParams
  const id = sp.get('id')
  if (!id) return NextResponse.json({ error: 'id mancante' }, { status: 400 })
  const s = supabaseAdmin()
  const { error } = await s.from('tournaments').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
