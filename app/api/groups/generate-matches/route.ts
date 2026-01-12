import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'

export async function POST(req: Request) {
  if (!requireAdmin(req as any)) return new NextResponse('Unauthorized', { status: 401 })
  const { tournament_id: tId } = await req.json().catch(() => ({}))
  if (!tId) return new NextResponse('Missing tournament_id', { status: 400 })

  // TODO: generazione reale delle partite; per ora ritorniamo ok per non bloccare il flusso
  return NextResponse.json({ ok: true })
}
