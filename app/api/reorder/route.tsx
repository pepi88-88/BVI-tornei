import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabaseServer'

export async function PATCH(req: NextRequest) {
  if (!requireAdmin(req)) return new NextResponse('Unauthorized', { status: 401 })
  const supa = supabaseAdmin()
  const { tournament_id, orderedRegistrationIds }:{ tournament_id:string, orderedRegistrationIds:string[] } = await req.json()
  for (let i=0;i<orderedRegistrationIds.length;i++) {
    const id = orderedRegistrationIds[i]
    await supa.from('registrations').update({ order_index: i+1 }).eq('id', id).eq('tournament_id', tournament_id)
  }
  return NextResponse.json({ ok: true })
}