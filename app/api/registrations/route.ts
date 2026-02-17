// app/api/registrations/route.ts
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseServer'

type Body =
  | {
      tournament_id: string
      team_name?: string
      team_format?: number
      a: { id: string }
      b: { existingId: string } | { mode: 'looking' | 'cdc' }
      c?: { existingId: string }
      d?: { existingId: string } | null
    }

// ...imports invariati...

// =======================
// POST /api/registrations
// =======================
export async function POST(req: Request) {
  const s = supabaseAdmin()
  let createdTeamId: string | null = null

  try {
    const b = (await req.json()) as Body
    const tournament_id = String((b as any)?.tournament_id || '').trim()
    const aId = String((b as any)?.a?.id || '').trim()
    const team_name = String((b as any)?.team_name || '').trim() || null
const team_format_raw = Number((b as any)?.team_format)
const team_format = Number.isFinite(team_format_raw) ? team_format_raw : null
const cObj = (b as any)?.c
const dObj = (b as any)?.d

const cId = String(cObj?.existingId || '').trim() || null
const dId = String(dObj?.existingId || '').trim() || null

const c_status: 'paired' | 'looking' | 'cdc' | null =
  cObj?.mode === 'looking' ? 'looking' :
  cObj?.mode === 'cdc' ? 'cdc' :
  cId ? 'paired' : null

const d_status: 'paired' | 'looking' | 'cdc' | null =
  dObj?.mode === 'looking' ? 'looking' :
  dObj?.mode === 'cdc' ? 'cdc' :
  dId ? 'paired' : null

    if (!tournament_id || !aId) {
      return NextResponse.json({ error: 'Dati mancanti' }, { status: 400 })
    }

    // --- blocco doppi iscritti (NO join con teams: più stabile) ---
{
  // elenco giocatori da controllare (A sempre, poi B/C/D se presenti)
  const idsToCheck = [aId]
  const isBPlayer =
    'existingId' in (b as any).b && String((b as any).b.existingId || '').trim()

  if (isBPlayer) {
    idsToCheck.push(String((b as any).b.existingId).trim())
  }
  if (cId) idsToCheck.push(cId)
  if (dId) idsToCheck.push(dId)

  const uniqueIds = Array.from(new Set(idsToCheck)).filter(Boolean)
  const idsCsv = uniqueIds.join(',')

  // 1) Trovo i team che contengono uno di questi giocatori (A o B del team)
  let teamIds: string[] = []
  if (uniqueIds.length) {
    const { data: tdup, error: tdupErr } = await s
      .from('teams')
      .select('id')
      .or(`player_a.in.(${idsCsv}),player_b.in.(${idsCsv})`)

    if (tdupErr) return NextResponse.json({ error: tdupErr.message }, { status: 500 })
    teamIds = (tdup ?? []).map(x => x.id)
  }

  // 2) Controllo registrations della tappa:
  //    - team_id già presente
  //    - oppure c_player_id / d_player_id già presente (per 3x3/4x4)
  const orParts: string[] = []
  if (teamIds.length) orParts.push(`team_id.in.(${teamIds.join(',')})`)
  if (uniqueIds.length) {
    orParts.push(`c_player_id.in.(${idsCsv})`)
    orParts.push(`d_player_id.in.(${idsCsv})`)
  }

  if (orParts.length) {
    const { data: dup, error: dupErr } = await s
      .from('registrations')
      .select('id')
      .eq('tournament_id', tournament_id)
      .or(orParts.join(','))

    if (dupErr) return NextResponse.json({ error: dupErr.message }, { status: 500 })
    if (dup?.length) {
      return NextResponse.json({ error: 'Giocatore già iscritto a questa tappa' }, { status: 409 })
    }
  }
}


    // --- leggo nomi A/B per etichetta ---
    const { data: pa, error: eA } = await s
      .from('players').select('id, first_name, last_name').eq('id', aId).maybeSingle()
    if (eA || !pa?.id) throw eA || new Error('Giocatore A inesistente')

    let pb: { id?: string; first_name?: string; last_name?: string } | null = null
    let labelB = ''
    let partner_status: 'looking' | 'cdc' | 'paired' = 'paired'
    if ('existingId' in (b as any).b) {
      const bId = String((b as any).b.existingId || '').trim()
      if (!bId) return NextResponse.json({ error: 'Giocatore B mancante' }, { status: 400 })
      const { data, error } = await s
        .from('players').select('id, first_name, last_name').eq('id', bId).maybeSingle()
      if (error || !data?.id) throw error || new Error('Giocatore B inesistente')
      pb = data
      labelB = `${pb.last_name} ${pb.first_name}`
      partner_status = 'paired'  // B è un vero giocatore
    } else if ('mode' in (b as any).b) {
      partner_status = (b as any).b.mode === 'looking' ? 'looking' : 'cdc'
      labelB = partner_status === 'looking' ? 'In cerca compagno' : 'CDC'
    } else {
      return NextResponse.json({ error: 'Formato B non valido' }, { status: 400 })
    }

    const labelA = `${pa.last_name} ${pa.first_name}`
    const label = `${labelA} — ${labelB}`.trim()

    // --- crea team ---
    {
      const { data: team, error: eT } = await s
        .from('teams')
        .insert({ player_a: pa.id, player_b: pb?.id ?? null })
        .select('id')
        .single()
      if (eT) throw eT
      createdTeamId = team.id
    }

    // --- crea registration (usa order_index, paid_a/b) ---
   const { data: reg, error: eR } = await s
  .from('registrations')
  .insert({
    team_id: createdTeamId,
    tournament_id,
    partner_status,           // 'paired' | 'looking' | 'cdc' (mai null)
    order_index: 1_000_000,   // inizialmente in fondo
    paid_a: false,
    paid_b: false,
    label,                    // se hai una colonna label e la usi in UI

    // ✅ nuovi campi 3x3 / 4x4 (se non arrivano restano null)
    team_name,
    team_format,
    c_player_id: cId,
    d_player_id: dId,
    // ✅ nuovi status
    c_status,
    d_status,
  })

      .select('id')
      .single()
    if (eR) throw eR

    return NextResponse.json({ item: reg })
  } catch (err: any) {
    // rollback team orfano se creato
    if (createdTeamId) {
      await supabaseAdmin().from('teams').delete().eq('id', createdTeamId)
    }
    const msg = (err && typeof err.message === 'string') ? err.message : 'Errore'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}


// =========================
// DELETE /api/registrations
// =========================
// app/api/registrations/route.ts
export async function DELETE(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get('id')?.trim()
    if (!id) return NextResponse.json({ error: 'id mancante' }, { status: 400 })

    const s = supabaseAdmin()

    // 1) leggo il team_id
    const { data: r, error: e1 } = await s
      .from('registrations')
      .select('team_id')
      .eq('id', id)
      .single()
    if (e1 || !r?.team_id) return NextResponse.json({ error: 'registration non trovata' }, { status: 404 })

    // 2) elimino la registration
    const { error: e2 } = await s.from('registrations').delete().eq('id', id)
    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })

    // 3) elimino il team orfano
    const { error: e3 } = await s.from('teams').delete().eq('id', r.team_id)
    if (e3) return NextResponse.json({ error: e3.message }, { status: 500 })

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    const msg = (err && typeof err.message === 'string') ? err.message : 'Errore'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
