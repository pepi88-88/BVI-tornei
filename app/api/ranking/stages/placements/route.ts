import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export async function PUT(req: Request) {
  const b = await req.json().catch(()=> ({}))
  const stage_id = String(b?.stage_id || '')
  const items: Array<{ player_id:string; position:number }> = Array.isArray(b?.items) ? b.items : []

  if (!stage_id) {
    return NextResponse.json({ ok:false, error:'stage_id required' }, { status:400 })
  }

  const sb = supabaseAdmin

  // 1) Stage
  const { data: stg, error: e1 } = await sb
    .from('rank_stage')
    .select('id, total_teams, multiplier')
    .eq('id', stage_id)
    .maybeSingle()
  if (e1 || !stg) {
    return NextResponse.json({ ok:false, error: e1?.message || 'stage not found' }, { status:404 })
  }

  const total_teams = Number(stg.total_teams || 0)
  const multiplier  = Number(stg.multiplier  || 1)

  // 2) pulizia input (accetta pari merito)
  const cleaned = items
    .map(x => ({ player_id: String(x.player_id), position: Number(x.position) }))
    .filter(x => x.player_id && Number.isFinite(x.position) && x.position >= 1 && x.position <= total_teams)

  // 3) legenda unica (per total_teams)
  const { data: legend, error: e2 } = await sb
    .from('rank_legend')
    .select('position, points')
    .eq('total_teams', total_teams)
    .order('position', { ascending:true })
  if (e2) return NextResponse.json({ ok:false, error:e2.message }, { status:500 })

  const pointsByPos = new Map<number, number>(legend.map(r => [Number(r.position), Number(r.points)]))

  const rows = cleaned.map(it => {
    const base = Number(pointsByPos.get(it.position) || 0)
    return {
      stage_id,
      player_id: it.player_id,
      position: it.position,
      base_points: base,
      multiplier,
      points_awarded: base * multiplier,
    }
  })

  // 4) transazione semplice: sostituisci completamente i risultati della tappa
  //    (l’autosave manda lo snapshot completo corrente)
  {
    const { error } = await sb.from('rank_stage_result').delete().eq('stage_id', stage_id)
    if (error) return NextResponse.json({ ok:false, error: error.message }, { status:500 })
  }
  if (rows.length) {
    const { error } = await sb.from('rank_stage_result').insert(rows)
    if (error) return NextResponse.json({ ok:false, error: error.message }, { status:500 })
  }

  return NextResponse.json({ ok:true, count: rows.length })
}
