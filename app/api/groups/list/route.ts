import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { db } from '@/lib/db'

export async function POST(req: Request) {
  if (!requireAdmin(req as any)) return new NextResponse('Unauthorized', { status: 401 })
  const body = await req.json().catch(() => ({}))
  const tId = body?.tournament_id as string | undefined
  if (!tId) return new NextResponse('Missing tournament_id', { status: 400 })

  // Gruppi + assegnazioni
  const { rows: ga } = await db.query(
    `select g.id as group_id, g.name, g.order_index, g.format, g.capacity,
            a.registration_id, a.slot_index
       from public.tournament_groups g
  left join public.tournament_group_assignments a on a.group_id = g.id
      where g.tournament_id = $1
      order by g.order_index, a.slot_index`,
    [tId]
  )

  // Etichette compatte per le iscrizioni
  const { rows: labs } = await db.query(
    `select r.id as reg_id, r.partner_status,
            pa.first_name as a_first, pa.last_name as a_last,
            pb.first_name as b_first, pb.last_name as b_last
       from public.registrations r
       join public.teams t  on t.id = r.team_id
       join public.players pa on pa.id = t.player_a
  left join public.players pb on pb.id = t.player_b
      where r.tournament_id = $1`,
    [tId]
  )

  const labelMap: Record<string, string> = {}
  const initial = (s?: string) => (s?.[0]?.toUpperCase() ?? '')
  for (const x of labs) {
    const a = `${x.a_last ?? ''} ${initial(x.a_first)}`.trim()
    let b = ''
    if (x.partner_status === 'looking') b = 'IN CERCA'
    else if (x.partner_status === 'cdc') b = 'CDC'
    else b = `${x.b_last ?? ''} ${initial(x.b_first)}`.trim()
    labelMap[x.reg_id] = b ? `${a} / ${b}` : a
  }

  // Aggrega
  const by: Record<string, any> = {}
  for (const r of ga) {
    if (!by[r.group_id]) {
      by[r.group_id] = {
        id: r.group_id,
        name: r.name,
        order_index: r.order_index,
        format: r.format ?? 'pool',
        capacity: r.capacity ?? 0,
        items: [] as { registration_id: string; slot_index: number; label: string }[],
      }
    }
    if (r.registration_id) {
      by[r.group_id].items.push({
        registration_id: r.registration_id,
        slot_index: r.slot_index ?? 0,
        label: labelMap[r.registration_id] || '—',
      })
    }
  }

  return NextResponse.json({ items: Object.values(by).sort((a:any,b:any)=>a.order_index-b.order_index) })
}
