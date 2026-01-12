// app/api/sources/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseServer' // <-- il tuo file esistente

type Meta   = Record<string, { capacity: number; format?: 'pool'|'ita' }>
type Assign = Record<string, string>   // "A-1" -> team_id
type Labels = Record<string, string>   // team_id -> "CognomeA / CognomeB"

export async function GET(req: NextRequest) {
  const tappa_id =
    req.nextUrl.searchParams.get('tappa_id') ||
    req.nextUrl.searchParams.get('tournament_id')

  if (!tappa_id) {
    return NextResponse.json({ error: 'missing tappa_id' }, { status: 400 })
  }

  const sb = supabaseAdmin()

  // ==== 1) GROUPS (prendo * e mappo il campo "lettera")
  // Accetto: letter | group | code | key | name | label
  const { data: groups, error: gErr } = await sb
    .from('groups')
    .select('*')
    .eq('tournament_id', tappa_id)

  if (gErr) return NextResponse.json({ error: gErr.message }, { status: 500 })

  const pickLetter = (g: any) =>
    (g.letter ?? g.group ?? g.code ?? g.key ?? g.name ?? g.label ?? '')
      .toString()
      .toUpperCase()
      .trim()

  const byLetter: Record<string, { id: string; cap: number }> = {}
  for (const g of (groups ?? [])) {
    const L = pickLetter(g)
    if (!L) continue
    byLetter[L] = {
      id: String(g.id),
      cap: Number(g.capacity ?? g.size ?? g.teams ?? 0)
    }
  }
  const groupIds = Object.values(byLetter).map(v => v.id)

  // ==== 2) ASSIGN (group_registrations)
  // Accetto: slot | position | index
  const { data: regs, error: rErr } = groupIds.length
    ? await sb.from('group_registrations').select('*').in('group_id', groupIds)
    : { data: [] as any[] } // <-- niente "error" qui

  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 })

  const getSlot = (r: any) =>
    Number(r.slot ?? r.position ?? r.index ?? 0)

  // ==== 3) LABELS: teams -> team_players -> players
  const teamIds = Array.from(new Set((regs ?? []).map(r => r.team_id).filter(Boolean)))

  // --- FIX: niente ternario con { error } nel ramo else ---
  let teamPlayers: Array<{ team_id: string; player_id: string }> = []
  if (teamIds.length) {
    const { data } = await sb
      .from('team_players')
      .select('team_id, player_id')
      .in('team_id', teamIds)
    teamPlayers = data ?? []
  }

  const playerIds = Array.from(new Set(teamPlayers.map(tp => tp.player_id).filter(Boolean)))

  let players: Array<{ id: string; first_name?: string; last_name?: string; name?: string }> = []
  if (playerIds.length) {
    const { data } = await sb
      .from('players')
      .select('id, first_name, last_name, name')
      .in('id', playerIds)
    players = data ?? []
  }

  const playersById: Record<string, any> = {}
  for (const p of (players ?? [])) playersById[String(p.id)] = p

  const last = (p: any) =>
    (p?.last_name || p?.name?.split(' ')?.slice(-1)[0] || '').trim()

  const labelFromTeam = (tid: string) => {
    const tps = (teamPlayers ?? []).filter(tp => String(tp.team_id) === String(tid))
    const names = tps.map(tp => last(playersById[String(tp.player_id)])).filter(Boolean)
    if (names.length >= 2) return `${names[0]} / ${names[1]}`
    if (names.length === 1) return names[0]
    return ''
  }

  // ==== 4) Costruisci meta / assign / labels
  const meta: Meta = {}
  const assign: Assign = {}
  const labels: Labels = {}
  const maxSlot: Record<string, number> = {}

  // capacity iniziale (se presente in groups)
  for (const [L, v] of Object.entries(byLetter)) {
    meta[L] = { capacity: Math.max(0, Number(v.cap) || 0), format: 'pool' }
  }

  // popola assign e calcola max slot per lettera
  for (const r of (regs ?? [])) {
    const entry = Object.entries(byLetter).find(([, v]) => String(v.id) === String(r.group_id))
    if (!entry) continue
    const L = entry[0]
    const slot = getSlot(r)
    const tid  = String(r.team_id || '')
    if (slot > 0 && tid) {
      assign[`${L}-${slot}`] = tid
      maxSlot[L] = Math.max(maxSlot[L] || 0, slot)
    }
  }

  // se capacity non è valorizzata, usa maxSlot
  for (const L of Object.keys(byLetter)) {
    if (!meta[L]) meta[L] = { capacity: 0, format: 'pool' }
    if (!meta[L].capacity) meta[L].capacity = maxSlot[L] || 0
  }

  // etichette per team
  for (const tid of teamIds) {
    const lab = labelFromTeam(String(tid))
    if (lab) labels[String(tid)] = lab
  }

  return NextResponse.json({ meta, assign, labels })
}
