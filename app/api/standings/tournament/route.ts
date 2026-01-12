import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabaseServer'

export async function GET(req: NextRequest){
  if(!requireAdmin(req)) return new NextResponse('Unauthorized',{status:401})
  const supa = supabaseAdmin()
  const sp = new URL(req.url).searchParams; const t = sp.get('tournament_id')!

  const { data: regs } = await supa.from('registrations').select('id, team_id').eq('tournament_id', t)
  const wins: Record<string, number> = {}
  for(const r of regs ?? []) wins[r.id]=0

  const { data: ms } = await supa.from('matches').select('winner_registration_id, round, status').eq('tournament_id', t).eq('status','finished')
  for(const m of ms ?? []) if(m.winner_registration_id) wins[m.winner_registration_id]=(wins[m.winner_registration_id]||0)+1

  // label
  const items:any[]=[]
  for(const r of regs ?? []){
    const { data: team } = await supa.from('teams').select('player_a,player_b').eq('id', r.team_id).single()
    const { data: a } = await supa.from('players').select('first_name,last_name').eq('id', team?.player_a).single()
    const { data: b } = await supa.from('players').select('first_name,last_name').eq('id', team?.player_b).single()
    const label = `${a?.last_name ?? ''} ${a?.first_name ?? ''} — ${b?.last_name ?? ''} ${b?.first_name ?? ''}`
    items.push({ id:r.id, label, wins:wins[r.id]||0 })
  }

  items.sort((x,y)=>y.wins - x.wins)
  return NextResponse.json({ items })
}
