// app/api/leaderboard/settings/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supaAnon = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const tour = (searchParams.get('tour') || '').trim()
  const gender = (searchParams.get('gender') || '').toUpperCase()
  if (!tour || !['M','F'].includes(gender)) return NextResponse.json({ settings: null }, { status: 400 })

  const supa = supaAnon()
  const { data, error } = await supa
    .from('leaderboard_settings')
    .select('settings')
    .eq('tour', tour)
    .eq('gender', gender)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: data?.settings ?? null }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PUT(req: Request) {
  const body = await req.json().catch(()=>null)
  const tour = String(body?.tour || '').trim()
  const gender = String(body?.gender || '').toUpperCase()
  const settings = body?.settings
  if (!tour || !['M','F'].includes(gender) || !settings) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 })
  }

  // opzionale ruolo
  // const role = req.headers.get('x-role') || ''
  // if (!['admin','coach'].includes(role)) return NextResponse.json({ error:'forbidden' }, { status: 403 })

  const supa = supaAnon()
  const { error } = await supa
    .from('leaderboard_settings')
    .upsert({ tour, gender, settings, updated_at: new Date().toISOString() }, { onConflict: 'tour,gender' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
