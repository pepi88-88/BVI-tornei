import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseServer'
// import { requireAdmin } from '@/lib/auth'  // ← usalo solo per metodi scriventi

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const s = supabaseAdmin()
    const sp = new URL(req.url).searchParams
    const tournament_id = sp.get('tournament_id')
    if (!tournament_id) {
      return new NextResponse('Missing tournament_id', { status: 400 })
    }

    // 1) Registrations (ordinate come prima)
    const { data: regs, error: regsErr } = await s
      .from('registrations')
      .select('id, order_index, partner_status, paid_a, paid_b, team_id, created_at, tournament_id')
      .eq('tournament_id', tournament_id)
      .order('order_index', { ascending: true })
      .order('created_at',  { ascending: true })

    if (regsErr) return NextResponse.json({ error: regsErr.message }, { status: 500 })

    if (!regs?.length) {
      return NextResponse.json({ items: [] })
    }

    // 2) Teams in bulk
    const teamIds = Array.from(new Set(regs.map(r => r.team_id).filter(Boolean)))
    const { data: teams, error: teamsErr } = await s
      .from('teams')
      .select('id, player_a, player_b')
      .in('id', teamIds)

    if (teamsErr) return NextResponse.json({ error: teamsErr.message }, { status: 500 })
    const teamMap = new Map<string, { player_a: string|null; player_b: string|null }>()
    for (const t of (teams ?? [])) teamMap.set(t.id, { player_a: t.player_a, player_b: t.player_b })

    // 3) Players in bulk (A + B)
    const playerIds = Array.from(new Set(
      (teams ?? []).flatMap(t => [t.player_a, t.player_b]).filter(Boolean) as string[]
    ))

    const { data: players, error: playersErr } = await s
      .from('players')
      .select('id, first_name, last_name, is_placeholder')
      .in('id', playerIds)

    if (playersErr) return NextResponse.json({ error: playersErr.message }, { status: 500 })
    const playerMap = new Map<string, { first_name?:string; last_name?:string; is_placeholder?:boolean }>()
    for (const p of (players ?? [])) playerMap.set(p.id, p)

    // 4) Costruisci output
    const out: Array<{ id: string; label: string; paid: boolean }> = []

    for (const r of regs) {
      const t = r.team_id ? teamMap.get(r.team_id) : undefined

      const a = t?.player_a ? playerMap.get(t.player_a) : undefined
      const b = t?.player_b ? playerMap.get(t.player_b) : undefined

      const aLast = a?.last_name ?? ''
      const aFirst = a?.first_name ?? ''

      let bLabel = ''
      if (r.partner_status === 'looking') bLabel = 'IN CERCA'
      else if (r.partner_status === 'cdc') bLabel = 'CDC'
      else bLabel = `${b?.last_name ?? ''} ${b?.first_name ?? ''}`.trim()

      const label = `${aLast} ${aFirst} — ${bLabel}`.trim()

      out.push({
        id: r.id,
        label,
        paid: Boolean(r.paid_a && r.paid_b),
      })
    }

    return NextResponse.json({ items: out })
  } catch (e:any) {
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 })
  }
}

/* Se in futuro servono metodi scriventi, tengono il gate admin:

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // ...logica scrivente...
  return NextResponse.json({ ok: true })
}
*/
