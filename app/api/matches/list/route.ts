import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseServer'
import { requireAdmin } from '@/lib/auth'

export async function GET(req: NextRequest){
  if(!requireAdmin(req)) return new NextResponse('Unauthorized',{status:401})
  const supa = supabaseAdmin()
  const sp = new URL(req.url).searchParams
  const t = sp.get('tournament_id')!, round = sp.get('round') || 'group'
  const { data: ms, error } = await supa
    .from('matches')
    .select('id, team1_registration_id, team2_registration_id, round, stage, status')
    .eq('tournament_id', t).eq('round', round).order('created_at')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const items:any[] = []
  for (const m of ms || []) {
    const { data:r1 } = await supa.from('registrations').select('team_id').eq('id', m.team1_registration_id).single()
    const { data:r2 } = await supa.from('registrations').select('team_id').eq('id', m.team2_registration_id).single()
    const { data:t1 } = await supa.from('teams').select('player_a,player_b').eq('id', r1?.team_id).single()
    const { data:t2 } = await supa.from('teams').select('player_a,player_b').eq('id', r2?.team_id).single()
    const { data:a1 } = await supa.from('players').select('first_name,last_name').eq('id', t1?.player_a).single()
    const { data:b1 } = await supa.from('players').select('first_name,last_name').eq('id', t1?.player_b).single()
    const { data:a2 } = await supa.from('players').select('first_name,last_name').eq('id', t2?.player_a).single()
    const { data:b2 } = await supa.from('players').select('first_name,last_name').eq('id', t2?.player_b).single()

    const l = `${a1?.last_name ?? ''} ${a1?.first_name ?? ''}/${b1?.last_name ?? ''} ${b1?.first_name ?? ''} vs ` +
              `${a2?.last_name ?? ''} ${a2?.first_name ?? ''}/${b2?.last_name ?? ''} ${b2?.first_name ?? ''}`
    items.push({ id:m.id, label:l, stage:m.stage, status:m.status })
  }
  return NextResponse.json({ items })
}
