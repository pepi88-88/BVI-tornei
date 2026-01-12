// app/api/registrations/route.ts
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseServer'

type Body =
  | { tournament_id: string; a: { id: string }; b: { existingId: string } }
  | { tournament_id: string; a: { id: string }; b: { mode: 'looking' | 'cdc' } }

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
    if (!tournament_id || !aId) {
      return NextResponse.json({ error: 'Dati mancanti' }, { status: 400 })
    }

    // --- blocco doppi iscritti (come ce l’hai ora, teniamolo) ---
    {
      const orParts = [`player_a.eq.${aId}`, `player_b.eq.${aId}`]
      const isBPlayer =
        'existingId' in (b as any).b && String((b as any).b.existingId || '').trim()
      if (isBPlayer) {
        const bId = String((b as any).b.existingId).trim()
        orParts.push(`player_a.eq.${bId}`, `player_b.eq.${bId}`)
      }
      const { data: dup, error: dupErr } = await s
        .from('registrations')
        .select('id, teams!inner(player_a, player_b)')
        .eq('tournament_id', tournament_id)
        .or(orParts.join(','), { foreignTable: 'teams' })
      if (dupErr) return NextResponse.json({ error: dupErr.message }, { status: 500 })
      if (dup?.length) {
        return NextResponse.json({ error: 'Giocatore già iscritto a questa tappa' }, { status: 409 })
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
