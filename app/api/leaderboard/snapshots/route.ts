// app/api/leaderboard/snapshots/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function supaAdmin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}
function supaAnon(req: Request) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { 'X-Client-Info': 'leaderboard' } }
  })
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const tour = (searchParams.get('tour') || '').trim()
  const gender = (searchParams.get('gender') || '').toUpperCase()
  if (!tour || !['M','F'].includes(gender)) return NextResponse.json({ data: null }, { status: 400 })

  const supa = supaAnon(req)
  const { data, error } = await supa
    .from('leaderboard_snapshots')
    .select('data')
    .eq('tour', tour)
    .eq('gender', gender)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: data?.data ?? null }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PUT(req: Request) {
  const body = await req.json().catch(()=>null)
  const tour = String(body?.tour || '').trim()
  const gender = String(body?.gender || '').toUpperCase()
  const data = body?.data
  if (!tour || !['M','F'].includes(gender) || !data) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 })
  }

  // opzionale: verifica ruolo dal header 'x-role'
  // const role = req.headers.get('x-role') || ''
  // if (!['admin','coach'].includes(role)) return NextResponse.json({ error:'forbidden' }, { status: 403 })

  const supa = supaAnon(req)
  const { error } = await supa
    .from('leaderboard_snapshots')
    .upsert({ tour, gender, data, updated_at: new Date().toISOString() }, { onConflict: 'tour,gender' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url)
  const tour = (searchParams.get('tour') || '').trim()
  const gender = (searchParams.get('gender') || '').toUpperCase()
  const key = req.headers.get('x-super-key') || ''
  if (!tour || !['M','F'].includes(gender)) return NextResponse.json({ error: 'bad params' }, { status: 400 })
  if (key !== process.env.ADMIN_SUPER_KEY) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  // DELETE con service role (bypassa RLS)
  const supa = supaAdmin()
  const { error } = await supa
    .from('leaderboard_snapshots')
    .delete()
    .eq('tour', tour)
    .eq('gender', gender)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
