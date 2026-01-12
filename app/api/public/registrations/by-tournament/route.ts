// app/api/public/registrations/by-tournament/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const s = getSupabaseAdmin()
    const sp = new URL(req.url).searchParams
    const tournamentId = sp.get('tournament_id') || ''

    if (!tournamentId) {
      return NextResponse.json({ error: 'Missing tournament_id' }, { status: 400 })
    }

    const { data: regs, error } = await s
      .from('registrations')
      .select('id, order_index, partner_status, team_id')
      .eq('tournament_id', tournamentId)
      .order('order_index', { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const out: Array<{ id: string; label: string }> = []

    for (const r of regs ?? []) {
      const { data: team } = await s
        .from('teams')
        .select('player_a, player_b')
        .eq('id', r.team_id ?? '')
        .maybeSingle()

      const { data: a } = await s
        .from('players')
        .select('first_name, last_name')
        .eq('id', team?.player_a ?? '')
        .maybeSingle()

      const { data: b } = await s
        .from('players')
        .select('first_name, last_name')
        .eq('id', team?.player_b ?? '')
        .maybeSingle()

      // label pulita; se B non c'è, mostra lo stato partner_status (es. "LOOKING"/"CDC")
      const labelB =
        (b?.last_name && b?.first_name)
          ? `${b.last_name} ${b.first_name}`
          : (r.partner_status ? String(r.partner_status).toUpperCase() : '—')

      const label = `${a?.last_name ?? ''} ${a?.first_name ?? ''} — ${labelB}`.trim()

      out.push({ id: String(r.id), label })
    }

    return NextResponse.json({ items: out })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  }
}
