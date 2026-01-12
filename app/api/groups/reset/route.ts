import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { db } from '@/lib/db'

export async function POST(req: Request) {
  if (!requireAdmin(req as any)) return new NextResponse('Unauthorized', { status: 401 })
  const { tournament_id: tId } = await req.json().catch(() => ({}))
  if (!tId) return new NextResponse('Missing tournament_id', { status: 400 })

  await db.query(
    `delete from public.tournament_group_assignments
     where group_id in (select id from public.tournament_groups where tournament_id = $1)`,
    [tId]
  )
  await db.query(
    `delete from public.tournament_groups where tournament_id = $1`,
    [tId]
  )
  return NextResponse.json({ ok: true })
}
