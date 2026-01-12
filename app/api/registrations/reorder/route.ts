import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabaseServer'

export async function PATCH(req: NextRequest) {
  if (!requireAdmin(req)) return new NextResponse('Unauthorized', { status: 401 })

  try {
    const body = await req.json()
    const tournament_id = String(body?.tournament_id || '').trim()
    const ids: string[] = Array.isArray(body?.orderedRegistrationIds) ? body.orderedRegistrationIds : []

    if (!tournament_id || !ids.length) {
      return NextResponse.json({ error: 'Parametri mancanti' }, { status: 400 })
    }

    const s = supabaseAdmin()

    // opzionale: valida che gli ids appartengano davvero alla tappa
    const { data: check, error: eCheck } = await s
      .from('registrations')
      .select('id')
      .eq('tournament_id', tournament_id)
      .in('id', ids)

    if (eCheck) return NextResponse.json({ error: eCheck.message }, { status: 500 })
    if ((check?.length ?? 0) !== ids.length) {
      return NextResponse.json({ error: 'Alcune registrazioni non appartengono alla tappa' }, { status: 400 })
    }

    // aggiorna gli order_index in sequenza (spaziati, utile per inserimenti futuri in mezzo)
    let idx = 10
    for (const id of ids) {
      const { error } = await s
        .from('registrations')
        .update({ order_index: idx })
        .eq('id', id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      idx += 10
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    const msg = (err && typeof err.message === 'string') ? err.message : 'Errore'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
