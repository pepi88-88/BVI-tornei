// app/api/registrations/pay/route.ts
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseServer'

export async function PATCH(req: Request) {
  try {
    const b = await req.json()
    const id = String(b?.id || '').trim()
    if (!id) return NextResponse.json({ error: 'id mancante' }, { status: 400 })

    const updates: any = {}
    if (typeof b.paid_a === 'boolean') updates.paid_a = b.paid_a
    if (typeof b.paid_b === 'boolean') updates.paid_b = b.paid_b
    if (!('paid_a' in updates) && !('paid_b' in updates)) {
      return NextResponse.json({ error: 'Nessun campo da aggiornare' }, { status: 400 })
    }

    const s = supabaseAdmin()
    const { error } = await s.from('registrations').update(updates).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Errore' }, { status: 500 })
  }
}
