import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseServer'
import { requireAdmin } from '@/lib/auth'

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) return new NextResponse('Unauthorized', { status: 401 })
  const s = supabaseAdmin()
  const b = await req.json().catch(()=>({}))
  const pairs = Math.max(1, Number(b.pairs ?? 16))
  const today = new Date()
  const tappaDate = new Date(today.getTime() + 7*24*60*60*1000) // fra 7 giorni
  const event_date = tappaDate.toISOString().slice(0,10)

  // 1) crea Tour
  const { data: tour, error: eTour } = await s.from('tours').insert({
    name: 'Tour Demo',
    season_start: 2025,
    season_end: 2026,
    is_active: true
  }).select('id').single()
  if (eTour) return NextResponse.json({ error: eTour.message }, { status: 500 })

  // 2) crea Tappa
  const { data: tappa, error: eTap } = await s.from('tournaments').insert({
    name: 'Tappa Demo 1',
    event_date,
    tour_id: tour.id,
    multiplier: 1,
    max_teams: pairs
  }).select('id').single()
  if (eTap) return NextResponse.json({ error: eTap.message }, { status: 500 })

  // 3) crea 2*pairs giocatori
  const players:any[] = []
  for (let i=1;i<=pairs*2;i++){
    players.push({
      first_name: `Player${i}`,
      last_name: `Demo${i}`,
      gender: 'M',            // per l’esempio li teniamo tutti M
      is_placeholder: false
    })
  }
  const { data: createdPlayers, error: ePl } = await s.from('players').insert(players).select('id').returns<any[]>()
  if (ePl) return NextResponse.json({ error: ePl.message }, { status: 500 })

  // 4) crea teams (1-2, 3-4, ..., 31-32)
  const teams:any[] = []
  for (let p=0; p<pairs; p++){
    const aId = createdPlayers[2*p]?.id
    const bId = createdPlayers[2*p+1]?.id
    teams.push({ player_a: aId, player_b: bId })
  }
  const { data: createdTeams, error: eTm } = await s.from('teams').insert(teams).select('id').returns<any[]>()
  if (eTm) return NextResponse.json({ error: eTm.message }, { status: 500 })

  // 5) crea registrations in ordine
  const regs:any[] = []
  for (let i=0;i<createdTeams.length;i++){
    regs.push({
      tournament_id: tappa.id,
      team_id: createdTeams[i].id,
      order_index: i+1,
      partner_status: 'none',
      paid_a: false, paid_b: false
    })
  }
  const { error: eReg } = await s.from('registrations').insert(regs)
  if (eReg) return NextResponse.json({ error: eReg.message }, { status: 500 })

  return NextResponse.json({ ok:true, tour_id: tour.id, tournament_id: tappa.id })
}
