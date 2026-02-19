import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseServer'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const s = supabaseAdmin()
    const sp = new URL(req.url).searchParams
    const tournament_id = sp.get('tournament_id')
    if (!tournament_id) return new NextResponse('Missing tournament_id', { status: 400 })

    // 1) Registrations + campi extra
    const { data: regs, error: regsErr } = await s
      .from('registrations')
      .select(
        'id, order_index, partner_status, paid_a, paid_b, team_id, created_at, tournament_id, team_name, team_format, c_player_id, d_player_id, c_status, d_status'
      )
      .eq('tournament_id', tournament_id)
      .order('order_index', { ascending: true })
      .order('created_at', { ascending: true })

    if (regsErr) return NextResponse.json({ error: regsErr.message }, { status: 500 })
    if (!regs?.length) return NextResponse.json({ items: [] })

    // 2) Teams in bulk
    const teamIds = Array.from(new Set(regs.map(r => r.team_id).filter(Boolean)))
    const { data: teams, error: teamsErr } = await s
      .from('teams')
      .select('id, player_a, player_b')
      .in('id', teamIds)

    if (teamsErr) return NextResponse.json({ error: teamsErr.message }, { status: 500 })

    const teamMap = new Map<string, { player_a: string | null; player_b: string | null }>()
    for (const t of teams ?? []) teamMap.set(t.id, { player_a: t.player_a, player_b: t.player_b })

    // 3) Players in bulk (A+B dai teams) + (C+D dalle registrations)
    const playerIds = Array.from(
      new Set(
        [
          ...(teams ?? []).flatMap(t => [t.player_a, t.player_b]),
          ...regs.flatMap(r => [r.c_player_id, r.d_player_id]),
        ].filter(Boolean) as string[]
      )
    )

    const { data: players, error: playersErr } = await s
      .from('players')
      .select('id, first_name, last_name, is_placeholder')
      .in('id', playerIds)

    if (playersErr) return NextResponse.json({ error: playersErr.message }, { status: 500 })

    const playerMap = new Map<string, { first_name?: string; last_name?: string; is_placeholder?: boolean }>()
    for (const p of players ?? []) playerMap.set(p.id, p)

    // helper
    const fullName = (pid?: string | null) => {
      if (!pid) return ''
      const p = playerMap.get(pid)
      if (!p) return ''
      return `${p.last_name ?? ''} ${p.first_name ?? ''}`.trim()
    }
    const lastNameOnly = (pid?: string | null) => {
      if (!pid) return ''
      const p = playerMap.get(pid)
      if (!p) return ''
      return `${p.last_name ?? ''}`.trim()
    }

    // 4) Output: label (lungo) + label_short (per gironi / atleta)
    const out: Array<{
      id: string
      label: string
      label_short: string
      paid: boolean
      team_name?: string | null
      team_format?: number | null
    }> = []

    for (const r of regs as any[]) {
      const t = r.team_id ? teamMap.get(r.team_id) : undefined

      // ids
      const aId = t?.player_a ?? null
      const bId = t?.player_b ?? null

      // nomi completi (solo per label lunga)
      const aName = fullName(aId)
      const bName = fullName(bId)

      const cNameRaw = fullName(r.c_player_id ?? null)
      const dNameRaw = fullName(r.d_player_id ?? null)

      const cName =
        cNameRaw || (r.c_status === 'looking' ? 'IN CERCA' : r.c_status === 'cdc' ? 'CDC' : '')
      const dName =
        dNameRaw || (r.d_status === 'looking' ? 'IN CERCA' : r.d_status === 'cdc' ? 'CDC' : '')

      // --- LABEL LUNGA (come admin / iscrizioni)
      let label = ''

      if (r.team_name && String(r.team_name).trim().length) {
        const team = String(r.team_name).trim()
        const names = [aName, bName, cName, dName].filter(Boolean)
        label = names.length ? `${team} — ${names.join(', ')}` : team
      } else {
        let bLabel = ''
        if (r.partner_status === 'looking') bLabel = 'IN CERCA'
        else if (r.partner_status === 'cdc') bLabel = 'CDC'
        else bLabel = bName
        label = `${aName} — ${bLabel}`.trim()
      }

      // --- LABEL CORTA (gironi/atleta): team_name oppure SOLO COGNOMI
      let label_short = ''

      const hasTeam = !!(r.team_name && String(r.team_name).trim().length)
      if (hasTeam) {
        label_short = String(r.team_name).trim() // 👈 SOLO nome squadra
      } else {
        const aLast = lastNameOnly(aId)
        let bShort = ''
        if (r.partner_status === 'looking') bShort = 'IN CERCA'
        else if (r.partner_status === 'cdc') bShort = 'CDC'
        else bShort = lastNameOnly(bId)

        // se b vuoto, mostra solo A
        label_short = bShort ? `${aLast} / ${bShort}` : aLast
      }

      out.push({
        id: r.id,
        label,
        label_short,
        paid: Boolean(r.paid_a && r.paid_b),
        team_name: r.team_name ?? null,
        team_format: r.team_format ?? null,
      })
    }

    return NextResponse.json({ items: out })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 })
  }
}
