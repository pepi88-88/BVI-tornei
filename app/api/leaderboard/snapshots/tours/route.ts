import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

// obbliga runtime dinamico (evita prerender degli endpoint)
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const sb = getSupabaseAdmin()
    const { data, error } = await sb
      .from('leaderboard_snapshots')
      .select('tour')
      .order('tour', { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    const tours = Array.from(new Set((data ?? []).map(r => r.tour).filter(Boolean)))
    return NextResponse.json({ tours })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  }
}
