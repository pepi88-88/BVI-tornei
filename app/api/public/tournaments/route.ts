// app/api/public/tournaments/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const s = getSupabaseAdmin()
    const sp = new URL(req.url).searchParams
    const tourId = sp.get('tour_id') || sp.get('tour') || '' // compat

    let q = s
      .from('tournaments')
      .select('id, name, title, event_date, status, max_teams')
      .order('event_date', { ascending: false })

    if (tourId) {
      q = q.eq('tour_id', tourId)
    }

    // se hai un flag per la pubblicazione (es. is_public), puoi filtrare qui:
    // q = q.eq('is_public', true)

    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const items = (data || []).map(t => ({
      id: String(t.id),
      name: t.name ?? t.title ?? '',
      title: t.title ?? t.name ?? '',
      event_date: t.event_date ?? null,
      status: t.status ?? null,
      max_teams: t.max_teams ?? null,
    }))

    return NextResponse.json({ items })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  }
}
