import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabaseServer'

export async function GET(req: NextRequest) {
  const tourId = new URL(req.url).searchParams.get('tour_id') || ''
  if (!tourId) return NextResponse.json({ items: [] })
  const s = supabaseAdmin()
  const { data, error } = await s
    .from('tappe')
    .select('id,title,date,multiplier,total_teams')
    .eq('tour_id', tourId)
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
}

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) return new NextResponse('Unauthorized', { status: 401 })
  const b = await req.json()
  const payload = {
    tour_id: b.tour_id,
    title: (b.title || '').trim(),
    date: (b.date || '').trim(),
    multiplier: Number(b.multiplier) || 1,
    total_teams: Number(b.total_teams) || 8,
  }
  if (!payload.tour_id || !payload.title) return NextResponse.json({ error: 'Dati mancanti' }, { status: 400 })
  const s = supabaseAdmin()
  const { data, error } = await s.from('tappe').insert(payload).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
}

export async function DELETE(req: NextRequest) {
  if (!requireAdmin(req)) return new NextResponse('Unauthorized', { status: 401 })
  const id = new URL(req.url).searchParams.get('id') || ''
  if (!id) return NextResponse.json({ error: 'id mancante' }, { status: 400 })
  const s = supabaseAdmin()
  const { error } = await s.from('tappe').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
