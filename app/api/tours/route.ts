// app/api/tours/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseServer'

function requireAdmin(req: NextRequest) {
  const role = (req.headers.get('x-role') || '').toLowerCase()
  return role === 'admin' || role === 'coach'
}

// GET: lista
export async function GET(req: NextRequest) {
  try {
    const s = supabaseAdmin()
    const { data, error } = await s
      .from('tours')
      .select('id, name, season_start, season_end, is_active, created_at')
      .order('created_at', { ascending: false })
    if (error) throw error
    return NextResponse.json({ items: data ?? [] })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'GET failed' }, { status: 500 })
  }
}

// POST: crea tour
export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) return new NextResponse('Unauthorized', { status: 401 })
  try {
    const b = await req.json()
    const name = (b?.name || '').trim()
    const season_start = b?.season_start ?? null
    const season_end   = b?.season_end ?? null
    if (!name) return NextResponse.json({ error: 'name mancante' }, { status: 400 })

    const s = supabaseAdmin()
    const { data, error } = await s
      .from('tours')
      .insert({ name, season_start, season_end, is_active: true })
      .select('id, name, season_start, season_end, is_active, created_at')
      .single()
    if (error) throw error
    return NextResponse.json({ item: data })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'POST failed' }, { status: 500 })
  }
}

// PATCH: aggiorna campi (es. season_start / season_end)
export async function PATCH(req: NextRequest) {
  if (!requireAdmin(req)) return new NextResponse('Unauthorized', { status: 401 })
  try {
    const b = await req.json()
    const id = b?.id as string
    if (!id) return NextResponse.json({ error: 'id mancante' }, { status: 400 })

    const updates: any = {}
    ;['name','season_start','season_end','is_active'].forEach(k=>{
      if (b[k] !== undefined) updates[k] = b[k]
    })

    const s = supabaseAdmin()
    const { data, error } = await s
      .from('tours')
      .update(updates)
      .eq('id', id)
      .select('id, name, season_start, season_end, is_active, created_at')
      .single()
    if (error) throw error
    return NextResponse.json({ item: data })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'PATCH failed' }, { status: 500 })
  }
}

// DELETE: con chiave di sicurezza
export async function DELETE(req: NextRequest) {
  const key = req.headers.get('x-admin-delete-key') || req.headers.get('X-Admin-Delete-Key')
  if (key !== process.env.ADMIN_DELETE_KEY) return new NextResponse('Forbidden', { status: 403 })

  try {
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id mancante' }, { status: 400 })
    const s = supabaseAdmin()
    const { error } = await s.from('tours').delete().eq('id', id)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'DELETE failed' }, { status: 500 })
  }
}
