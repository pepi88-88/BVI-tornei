// app/api/players/route.ts
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseServer'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  // supporta sia ?search= che ?q=
  const q = (searchParams.get('search') || searchParams.get('q') || '').trim()

  const sb = supabaseAdmin()

  // selezioniamo solo ciò che ci serve e costruiamo display_name lato API
  let query = sb
    .from('players')
    .select('id, first_name, last_name, email')  // display_name lo costruiamo noi
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true })
    .limit(200)

  if (q) {
    query = sb
      .from('players')
      .select('id, first_name, last_name, email')
      .or(`last_name.ilike.%${q}%,first_name.ilike.%${q}%,email.ilike.%${q}%`)
      .order('last_name', { ascending: true })
      .order('first_name', { ascending: true })
      .limit(200)
  }

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // costruisci display_name: "Cognome Nome"
  const items = (data || []).map((r: any) => ({
    id: r.id,
    display_name: [r.last_name, r.first_name].filter(Boolean).join(' ').trim()
  }))

  return NextResponse.json({ items })
}


export async function POST(req: Request) {
  const body = await req.json()
  const sb = supabaseAdmin()
  const payload = {
    first_name: String(body.first_name || '').trim(),
    last_name:  String(body.last_name  || '').trim(),
    gender:     body.gender === 'F' ? 'F' : 'M',
    phone:      body.phone ? String(body.phone).trim() : null,
    email:      body.email ? String(body.email).trim() : null,
  }
  const { data, error } = await sb.from('players').insert(payload).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
}

export async function PATCH(req: Request) {
  const body = await req.json()
  const id = String(body.id || '')
  if (!id) return NextResponse.json({ error: 'id mancante' }, { status: 400 })

  const sb = supabaseAdmin()
  const updates: Record<string, any> = {}
  ;(['first_name','last_name','gender','phone','email'] as const).forEach(k => {
    if (body[k] !== undefined) updates[k] = body[k]
  })

  const { data, error } = await sb.from('players').update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url)
  const id = String(searchParams.get('id') || '')
  if (!id) return NextResponse.json({ error: 'id mancante' }, { status: 400 })

  const sb = supabaseAdmin()
  const { error } = await sb.from('players').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
