import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseServer'

export async function POST(req: NextRequest) {
  const s = supabaseAdmin()
  const { key, wipe_players } = await req.json().catch(() => ({}))

  const SUPER = process.env.ADMIN_SUPER_KEY
  if (!SUPER) return NextResponse.json({ error: 'ADMIN_SUPER_KEY non configurata in .env.local' }, { status: 500 })
  if (key !== SUPER) return NextResponse.json({ error: 'Chiave errata' }, { status: 403 })

  // cancella "tutte le righe" della tabella; se la tabella non esiste, ignora
  async function safeDelAll(table: string) {
    const { error } = await s.from(table as any).delete().not('id', 'is', null)
    if (error) {
      const m = String(error.message || '')
      if (m.includes('schema cache') || m.includes('does not exist') || m.includes('relation') || m.includes('not exist')) return
      throw new Error(`${table}: ${m}`)
    }
  }

  try {
    // ordine giusto + supporto nuovi nomi dei gironi
    await safeDelAll('matches')
    await safeDelAll('tournament_group_assignments')
    await safeDelAll('tournament_groups')
    await safeDelAll('group_assignments') // legacy, nel dubbio
    await safeDelAll('groups')            // legacy, nel dubbio
    await safeDelAll('registrations')
    await safeDelAll('teams')
    await safeDelAll('tournaments')
    await safeDelAll('tours')
    if (wipe_players !== false) await safeDelAll('players')

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'wipe failed' }, { status: 500 })
  }
}
