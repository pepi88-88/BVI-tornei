import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabaseServer'

function alphaName(i: number) {
  const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  return `Girone ${L[i] ?? String(i + 1)}`
}

export async function POST(req: Request) {
  if (!requireAdmin(req as any)) return new NextResponse('Unauthorized', { status: 401 })

  const { tournament_id: tId, groups_count = 4, sizes = [], reset = false } =
    (await req.json().catch(() => ({}))) as {
      tournament_id?: string
      groups_count?: number
      sizes?: number[]
      reset?: boolean
    }

  if (!tId) return new NextResponse('Missing tournament_id', { status: 400 })

  const s = supabaseAdmin()

  // Reset opzionale
  if (reset) {
    const { data: gIds } = await s.from('tournament_groups').select('id').eq('tournament_id', tId)
    const ids = (gIds ?? []).map(x => x.id)
    if (ids.length) await s.from('tournament_group_assignments').delete().in('group_id', ids)
    await s.from('matches').delete().eq('tournament_id', tId)
    await s.from('tournament_groups').delete().eq('tournament_id', tId)
  }

  // Reg iscritti (in ordine d’iscrizione)
  const { data: regs, error: regsErr } = await s
    .from('registrations')
    .select('id')
    .eq('tournament_id', tId)
    .order('order_index')
  if (regsErr) return NextResponse.json({ error: regsErr.message }, { status: 500 })
  const total = regs?.length ?? 0
  if (!total) return NextResponse.json({ error: 'Nessuna iscrizione trovata.' }, { status: 400 })

  // Capienze gruppi
  let cap: number[] = []
  if (Array.isArray(sizes) && sizes.length) {
    cap = sizes.map(n => Number(n) || 0)
  } else {
    const base = Math.floor(total / groups_count)
    const rest = total % groups_count
    cap = Array.from({ length: groups_count }, (_, i) => base + (i < rest ? 1 : 0))
  }

  // Crea gruppi
  for (let i = 0; i < cap.length; i++) {
    await s.from('tournament_groups').insert({ tournament_id: tId, name: alphaName(i), order_index: i + 1 })
  }
  const { data: groups, error: gErr } = await s
    .from('tournament_groups')
    .select('id, order_index')
    .eq('tournament_id', tId)
    .order('order_index')
  if (gErr) return NextResponse.json({ error: gErr.message }, { status: 500 })

  // Distribuzione round-robin rispettando capienze
  const counters = cap.slice()
  const slots = groups.map(() => 0)
  let gi = 0
  for (const r of regs!) {
    // trova un gruppo disponibile
    let tries = 0
    while (counters[gi] <= 0 && tries < groups.length) {
      gi = (gi + 1) % groups.length
      tries++
    }
    if (counters[gi] <= 0) break

    const g = groups[gi]
    slots[gi] += 1
    counters[gi] -= 1
    await s.from('tournament_group_assignments').insert({
      group_id: g.id,
      registration_id: r.id,
      slot_index: slots[gi],
    })

    gi = (gi + 1) % groups.length
  }

  return NextResponse.json({ ok: true })
}
