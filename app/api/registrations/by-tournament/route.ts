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

    // 1) Registrations (ordinate come prima) + NUOVI CAMPI 3x3/4x4
    const { data: regs, error: regsErr } = await s
      .from('registrations')
      .select('id, order_index, partner_status, paid_a, paid_b, team_id, created_at, tournament_id, team_name, team_format, c_player_id, d_player_id, c_status, d_status')
      .eq('tournament_id', tournament_id)
      .order('order_index', { ascending: true })
      .order('created_at',  { ascending: true })

    if (regsErr) return NextResponse.json({ error: regsErr.message }, { status: 500 })
    if (!regs?.length) return NextResponse.json({ items: [] })

    // 2) Teams in bulk
    const teamIds = Array.from(new Set(regs.map(r => r.team_id).filter(Boolean)))
    const { data: teams, error: teamsErr } = await s
      .from('teams')
      .select('id, player_a, player_b')
      .in('id', teamIds)

    if (teamsErr) return NextResponse.json({ error: teamsErr.message }, { status: 500 })

    const teamMap = new Map<string, { player_a: string|null; player_b: string|null }>()
    for (const t of (teams ?? [])) teamMap.set(t.id, { player_a: t.player_a, player_b: t.player_b })

    // 3) Players in bulk (A + B + C + D)
    const playerIds = Array.from(new Set(
      [
        ...(teams ?? []).flatMap(t => [t.player_a, t.player_b]),
        ...regs.flatMap(r => [r.c_player_id, r.d_player_id]),
      ].filter(Boolean) as string[]
    ))

    const { data: players, error: playersErr } = await s
      .from('players')
      .select('id, first_name, last_name, is_placeholder')
      .in('id', playerIds)

    if (playersErr) return NextResponse.json({ error: playersErr.message }, { status: 500 })

    const playerMap = new Map<string, { first_name?:string; last_name?:string; is_placeholder?:boolean }>()
    for (const p of (players ?? [])) playerMap.set(p.id, p)

    // helper: "Cognome Nome"
    const fullName = (pid?: string | null) => {
      if (!pid) return ''
      const p = playerMap.get(pid)
      if (!p) return ''
      return `${p.last_name ?? ''} ${p.first_name ?? ''}`.trim()
    }

    // 4) Costruisci output
    const out: Array<{ id: string; label: string; paid: boolean }> = []

    for (const r of regs as any[]) {
      const t = r.team_id ? teamMap.get(r.team_id) : undefined

      // A/B vengono da teams (come prima)
      const aName = fullName(t?.player_a ?? null)
      const bName = fullName(t?.player_b ?? null)

      // C/D vengono da registrations (nuove colonne)
   const cNameRaw = fullName(r.c_player_id ?? null)
const dNameRaw = fullName(r.d_player_id ?? null)

const cName =
  cNameRaw || (r.c_status === 'looking' ? 'IN CERCA' : r.c_status === 'cdc' ? 'CDC' : '')

const dName =
  dNameRaw || (r.d_status === 'looking' ? 'IN CERCA' : r.d_status === 'cdc' ? 'CDC' : '')

      let label = ''

      // ✅ Se ho team_name → modalità squadra (3x3/4x4)
      if (r.team_name && String(r.team_name).trim().length) {
        const team = String(r.team_name).trim()
        const names = [aName, bName, cName, dName].filter(Boolean)
        // label compatta e leggibile in lista
        label = names.length ? `${team} — ${names.join(', ')}` : team
      } else {
        // ✅ Fallback vecchio 2x2 con partner_status
        let bLabel = ''
        if (r.partner_status === 'looking') bLabel = 'IN CERCA'
        else if (r.partner_status === 'cdc') bLabel = 'CDC'
        else bLabel = bName

        label = `${aName} — ${bLabel}`.trim()
      }

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
