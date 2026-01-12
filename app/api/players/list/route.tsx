import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabaseServer'

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return new NextResponse('Unauthorized', { status: 401 })
  const s = supabaseAdmin()

  const sp = new URL(req.url).searchParams
  const q = (sp.get('q') || '').trim()
  const gender = (sp.get('gender') || 'all').toUpperCase()
  const limit = Math.min(Number(sp.get('limit') || 200), 500)
  const page = Math.max(Number(sp.get('page') || 1), 1)
  const from = (page - 1) * limit
  const to = from + limit - 1

  let query = s.from('players')
    .select('id, first_name, last_name, gender, is_placeholder', { count: 'exact' })
    .eq('is_placeholder', false)
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true })

  if (gender === 'M' || gender === 'F') query = query.eq('gender', gender)
  if (q) query = query.or(`last_name.ilike.%${q}%,first_name.ilike.%${q}%`)

  const { data, error, count } = await query.range(from, to)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [], total: count ?? 0, page, limit })
}
