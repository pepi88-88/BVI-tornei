import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabaseServer'

export async function POST(req: NextRequest){
  if(!requireAdmin(req)) return new NextResponse('Unauthorized',{status:401})
  const supa = supabaseAdmin()
  const { tournament_id, size = 4 } = await req.json()

  // pulizia vecchie finali
  await supa.from('matches').delete().eq('tournament_id', tournament_id).eq('round','knockout')

  // prendo i primi "size" dalla lista (ordine iscrizioni = ranking provvisorio)
  const { data: regs } = await supa.from('registrations').select('id').eq('tournament_id', tournament_id).order('order_index').limit(size)
  if(!regs || regs.length<2) return NextResponse.json({ ok:false, error:'Not enough teams' }, { status:400 })

  const pairs:any[]=[]
  for(let i=0;i<Math.floor(regs.length/2);i++){
    pairs.push([regs[i].id, regs[regs.length-1-i].id])
  }

  // Crea quarti/semifinali/finale in base a size
  const stage = (s:number)=> s===8?'QF': s===4?'SF':'F'
  for(const [a,b] of pairs){
    await supa.from('matches').insert({ tournament_id, round:'knockout', stage: stage(size), team1_registration_id:a, team2_registration_id:b })
  }
  return NextResponse.json({ ok:true })
}
