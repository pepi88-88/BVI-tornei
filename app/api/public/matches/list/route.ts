// app/api/public/matches/list/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const s = getSupabaseAdmin()
    const sp = new URL(req.url).searchParams
    const tournamentId = sp.get('tournament_id') || ''
    const round = (sp.get('round') || 'group').toLowerCase()

    if (!tournamentId) {
      return NextResponse.json({ error: 'Missing tournament_id' }, { status: 400 })
    }

    // prendo le partite del torneo (round opzionale, default 'group')
    const { data: ms, error } = await s
      .from('matches')
      .select('id, team1_registration_id, team2_registration_id, round')
      .eq('tournament_id', tournamentId)
      .eq('round', round)
      .order('created_at', { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const items: Array<{ id: string; label: string }> = []

    // N.B.: si può ottimizzare con view/join; qui restiamo semplici e robusti.
    for (const m of ms ?? []) {
      const { data: r1 } = await s
        .from('registrations')
        .select('team_id')
        .eq('id', m.team1_registration_id)
        .maybeSingle()

      const { data: r2 } = await s
        .from('registrations')
        .select('team_id')
        .eq('id', m.team2_registration_id)
        .maybeSingle()

      const { data: t1 } = await s
        .from('teams')
        .select('player_a, player_b')
        .eq('id', r1?.team_id ?? '')
        .maybeSingle()

      const { data: t2 } = await s
        .from('teams')
        .select('player_a, player_b')
        .eq('id', r2?.team_id ?? '')
        .maybeSingle()

      const { data: p1a } = await s.from('players').select('last_name').eq('id', t1?.player_a ?? '').maybeSingle()
      const { data: p1b } = await s.from('players').select('last_name').eq('id', t1?.player_b ?? '').maybeSingle()
      const { data: p2a } = await s.from('players').select('last_name').eq('id', t2?.player_a ?? '').maybeSingle()
      const { data: p2b } = await s.from('players').select('last_name').eq('id', t2?.player_b ?? '').maybeSingle()

      const team1 = [p1a?.last_name, p1b?.last_name].filter(Boolean).join('/')
      const team2 = [p2a?.last_name, p2b?.last_name].filter(Boolean).join('/')

      items.push({
        id: String(m.id),
        label: `${team1 || '—'} vs ${team2 || '—'}`,
      })
    }

    return NextResponse.json({ items })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  }
}
