import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { db } from '@/lib/db'   // espone .query e .tx

type IncomingGroup = {
  name: string
  order_index?: number
  format?: 'pool' | 'ita'
  capacity?: number | null
  items?: Array<{ registration_id: string; slot_index: number }>
}

export async function POST(req: Request) {
  if (!requireAdmin(req as any)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const { tournament_id: tId, groups } = await req.json().catch(() => ({} as {
    tournament_id?: string
    groups?: IncomingGroup[]
  }))

  if (!tId || !Array.isArray(groups)) {
    return new NextResponse('Bad request', { status: 400 })
  }

  try {
    await db.tx(async (client) => {
      // 1) pulizia vecchi gironi/assegnazioni
      await client.query(
        `delete from public.tournament_group_assignments
         where group_id in (
           select id from public.tournament_groups where tournament_id = $1
         )`,
        [tId]
      )
      await client.query(
        `delete from public.tournament_groups where tournament_id = $1`,
        [tId]
      )

      // 2) inserimento nuovi gironi + assegnazioni
      for (const g of groups) {
        const fmt = g.format === 'ita' ? 'ita' : 'pool'
        const cap = (g.capacity ?? null) as number | null
        const ord = Number.isFinite(g.order_index as number) ? Number(g.order_index) : null

        const { rows: [row] } = await client.query(
          `insert into public.tournament_groups
             (tournament_id, name, order_index, format, capacity)
           values ($1,$2,$3,$4,$5)
           returning id`,
          [tId, g.name, ord, fmt, cap]
        )

        const gid = row.id as string

        if (Array.isArray(g.items) && g.items.length > 0) {
          const vals: any[] = []
          const chunks: string[] = []
          let i = 1
          for (const it of g.items) {
            chunks.push(`($${i++}, $${i++}, $${i++})`)
            vals.push(gid, it.registration_id, it.slot_index)
          }
          await client.query(
            `insert into public.tournament_group_assignments
               (group_id, registration_id, slot_index)
             values ${chunks.join(',')}`,
            vals
          )
        }
      }
    })

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('groups/save error:', err)
    return NextResponse.json({ error: err?.message ?? 'db error' }, { status: 500 })
  }
}
