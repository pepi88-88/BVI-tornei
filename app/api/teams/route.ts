// app/api/teams/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseServer'
import { requireStaff } from '@/lib/auth'

export async function GET(req: NextRequest) {
  if (!requireStaff(req)) return new NextResponse('Unauthorized', { status: 401 })
  const s = supabaseAdmin()
  const sp = new URL(req.url).searchParams
  const q = (sp.get('q') || '').trim()

  let query = s.from('teams')
    .select('id, name, notes, team_players(player_id, is_captain, players!inner(id, first_name, last_name, gender))')
    .order('created_at', { ascending: false })

  if (q) query = query.ilike('name', `%${q}%`)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
}

export async function POST(req: NextRequest) {
  if (!requireStaff(req)) return new NextResponse('Unauthorized', { status: 401 })
  const s = supabaseAdmin()
  const b = await req.json()
  const name = String(b.name || '').trim()
  const players: string[] = Array.isArray(b.players) ? b.players : [] // array di player_id (2)
  const notes = b.notes ? String(b.notes) : null

  if (!name || players.length < 2) {
    return NextResponse.json({ error: 'Nome squadra e almeno 2 giocatori' }, { status: 400 })
  }

  const { data: team, error: e1 } = await s.from('teams').insert({ name, notes }).select().single()
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })

  // inserisci i membri (primo capitano)
  const rows = players.map((pid, i) => ({ team_id: team.id, player_id: pid, is_captain: i === 0 }))
  const { error: e2 } = await s.from('team_players').insert(rows)
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })

  return NextResponse.json({ item: team })
}

export async function DELETE(req: NextRequest) {
  if (!requireStaff(req)) return new NextResponse('Unauthorized', { status: 401 })
  const s = supabaseAdmin()
  const id = new URL(req.url).searchParams.get('id') || ''
  if (!id) return NextResponse.json({ error: 'id mancante' }, { status: 400 })
  const { error } = await s.from('teams').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
