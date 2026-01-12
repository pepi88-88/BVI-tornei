import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseServer' // o il tuo path reale

// GET: ritorna players, tappe, results, scoreSettings
export async function GET(
  _req: Request,
  { params }: { params: { tour: string; gender: 'M'|'F' } }
){
  const { tour, gender } = params
  const supa = supabaseAdmin()

  const [players, tappe, results, settings] = await Promise.all([
    supa.from('leaderboard_players').select('player_id, player_name').eq('tour', tour).eq('gender', gender).order('player_name'),
    supa.from('leaderboard_tappe').select('id, title, event_date, multiplier, total_teams, pos').eq('tour', tour).eq('gender', gender).order('pos'),
    supa.from('leaderboard_results').select('tappa_id, player_id, pos').eq('tour', tour).eq('gender', gender),
    supa.from('score_settings').select('*').eq('tour', tour).eq('gender', gender).maybeSingle(),
  ])

  return NextResponse.json({
    players: players.data ?? [],
    tappe:   tappe.data   ?? [],
    results: results.data ?? [],
    score:   settings.data ?? null,
    error: players.error?.message || tappe.error?.message || results.error?.message || settings.error?.message || null
  })
}

// PUT: salva snapshot completo (players, tappe, results, settings)
export async function PUT(
  req: Request,
  { params }: { params: { tour: string; gender: 'M'|'F' } }
){
  const body = await req.json()
  const { tour, gender } = params
  const supa = supabaseAdmin()

  const { players, tappe, results, score } = body as {
    players: Array<{ player_id: string; player_name: string }>,
    tappe:   Array<{ id?: string; title: string; event_date?: string; multiplier: number; total_teams: number; pos: number }>,
    results: Array<{ tappa_id: string; player_id: string; pos?: number }>,
    score?:  any
  }

  // transazione "manuale": puliamo e ricarichiamo (semplice e sicuro)
  // 1) wipe
  await supa.from('leaderboard_results').delete().eq('tour', tour).eq('gender', gender)
  await supa.from('leaderboard_players').delete().eq('tour', tour).eq('gender', gender)
  await supa.from('leaderboard_tappe').delete().eq('tour', tour).eq('gender', gender)

  // 2) insert tappe → dobbiamo recuperare gli id
  const { data: tappeInserted, error: tappeErr } = await supa
    .from('leaderboard_tappe')
    .insert(tappe.map(t => ({ ...t, id: t.id, tour, gender })))
    .select('id, title')

  if (tappeErr) return NextResponse.json({ error: tappeErr.message }, { status: 500 })

  // 3) insert players
  const { error: playersErr } = await supa
    .from('leaderboard_players')
    .insert(players.map(p => ({ tour, gender, player_id: p.player_id, player_name: p.player_name })))
  if (playersErr) return NextResponse.json({ error: playersErr.message }, { status: 500 })

  // 4) insert results
  const { error: resultsErr } = await supa
    .from('leaderboard_results')
    .insert(results.map(r => ({ tour, gender, ...r })))
  if (resultsErr) return NextResponse.json({ error: resultsErr.message }, { status: 500 })

  // 5) upsert score settings (opzionale)
  if (score) {
    const payload = {
      tour, gender,
      s_base: score.S.base,  s_min_last: score.S.minLast,  s_curve_percent: score.S.curvePercent,
      m_base: score.M.base,  m_min_last: score.M.minLast,  m_curve_percent: score.M.curvePercent,
      l_base: score.L.base,  l_min_last: score.L.minLast,  l_curve_percent: score.L.curvePercent,
      xl_base: score.XL.base, xl_min_last: score.XL.minLast, xl_curve_percent: score.XL.curvePercent,
      updated_at: new Date().toISOString()
    }
    const { error: scoreErr } = await supa
      .from('score_settings')
      .upsert(payload, { onConflict: 'tour,gender' })
    if (scoreErr) return NextResponse.json({ error: scoreErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
