import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabaseServer'

export async function PATCH(req: NextRequest){
  if(!requireAdmin(req)) return new NextResponse('Unauthorized',{status:401})
  const { match_id } = await req.json()
  const supa = supabaseAdmin()
  await supa.from('matches').update({ status:'playing', start_time: new Date().toISOString() }).eq('id', match_id)
  return NextResponse.json({ ok:true })
}
