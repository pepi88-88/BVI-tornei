// app/api/registrations/for-payments/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseServer'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const s = supabaseAdmin()
    const sp = new URL(req.url).searchParams
    const tournament_id = sp.get('tournament_id')?.trim()
    if (!tournament_id) return new NextResponse('Missing tournament_id', { status: 400 })

    // 1) leggo max_teams
    const { data: t, error: eT } = await s
      .from('tournaments')
      .select('max_teams')
      .eq('id', tournament_id)
      .single()
    if (eT) return NextResponse.json({ error: eT.message }, { status: 500 })
    const max = Number.isFinite(+t?.max_teams) ? Math.max(0, +t!.max_teams) : 0

    // 2) leggo registrations ordinate + ids player
    const { data: regs, error: eR } = await s
      .from('registrations')
      .select('id, order_index, partner_status, paid_a, paid_b, team_id')
      .eq('tournament_id', tournament_id)
      .order('order_index', { ascending: true })
    if (eR) return NextResponse.json({ error: eR.message }, { status: 500 })

    if (!regs || regs.length === 0) return NextResponse.json({ items: [] })

    // 3) prendo tutti i team in un colpo
    const teamIds = regs.map(r => r.team_id)
    const { data: teams, error: eTeams } = await s
      .from('teams')
      .select('id, player_a, player_b')
      .in('id', teamIds)
    if (eTeams) return NextResponse.json({ error: eTeams.message }, { status: 500 })
    const teamById = new Map(teams!.map(t => [t.id, t]))

    // 4) prendo tutti i player coinvolti (A+B) in un colpo
    const playerIds = Array.from(
      new Set(
        teams!.flatMap(t => [t.player_a, t.player_b].filter(Boolean) as string[])
      )
    )
    let playersById = new Map<string, { first_name: string; last_name: string }>()
    if (playerIds.length) {
      const { data: players, error: eP } = await s
        .from('players')
        .select('id, first_name, last_name')
        .in('id', playerIds)
      if (eP) return NextResponse.json({ error: eP.message }, { status: 500 })
      playersById = new Map(players!.map(p => [p.id, { first_name: p.first_name, last_name: p.last_name }]))
    }

    // 5) costruisco output + filtro “in attesa” (idx >= max)
    const items: Array<{ id: string; a: string; b: string; paid_a: boolean; paid_b: boolean }> = []
    regs.forEach((r, idx) => {
      // escludi attesa solo se max > 0
      if (max > 0 && idx >= max) return

      const team = teamById.get(r.team_id)
      const a = team?.player_a ? playersById.get(team.player_a) : null
      const b = team?.player_b ? playersById.get(team.player_b) : null

      const aLabel = a ? `${a.last_name} ${a.first_name}`.trim() : ''
      let bLabel = ''
      if (r.partner_status === 'looking') bLabel = 'IN CERCA'
      else if (r.partner_status === 'cdc') bLabel = 'CDC'
      else bLabel = b ? `${b.last_name} ${b.first_name}`.trim() : ''

      items.push({
        id: r.id,
        a: aLabel,
        b: bLabel,
        paid_a: !!r.paid_a,
        paid_b: !!r.paid_b,
      })
    })

    return NextResponse.json({ items })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Errore' }, { status: 500 })
  }
}
