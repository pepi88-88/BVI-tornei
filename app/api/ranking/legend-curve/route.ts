import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// (opzionali ma utili nei deploy su Vercel/Edge)
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Tipi lato API
type Bucket = 'S' | 'M' | 'L' | 'XL'
type ScoreCfg = { base: number; minLast: number; curvePercent: number }
type ScoreCfgWire = { base: number; min_last: number; curve_percent: number }

// Helpers di mapping
const fromRow = (r: any): ScoreCfg => ({
  base: Number(r.base ?? 100),
  minLast: Number(r.min_last ?? 10),
  curvePercent: Number(r.curve_percent ?? 100),
})
const toRow = (bucket: Bucket, v: ScoreCfg): ScoreCfgWire & { bucket: Bucket } => ({
  bucket,
  base: Number(v.base ?? 100),
  min_last: Number(v.minLast ?? 10),
  curve_percent: Number(v.curvePercent ?? 100),
})

// ========== GET /api/ranking/legend-curve ==========
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('rank_legend_curve')
      .select('bucket, base, min_last, curve_percent')

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    const map = new Map<string, ScoreCfg>()
    ;(data || []).forEach((r: any) => map.set(String(r.bucket).toUpperCase(), fromRow(r)))

    const settings = {
      S: map.get('S') || { base: 100, minLast: 10, curvePercent: 100 },
      M: map.get('M') || { base: 100, minLast: 10, curvePercent: 100 },
      L: map.get('L') || { base: 100, minLast: 10, curvePercent: 100 },
      XL: map.get('XL') || { base: 100, minLast: 10, curvePercent: 100 },
    }

    return NextResponse.json({ ok: true, settings })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'GET failed' }, { status: 500 })
  }
}

// ========== PUT /api/ranking/legend-curve ==========
export async function PUT(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const settings = body?.settings as { S: ScoreCfg; M: ScoreCfg; L: ScoreCfg; XL: ScoreCfg } | null

    if (!settings) {
      return NextResponse.json({ ok: false, error: 'settings missing' }, { status: 400 })
    }

    // Upsert delle 4 righe S/M/L/XL
    const rows = (['S','M','L','XL'] as Bucket[]).map(b => toRow(b, (settings as any)[b]))

    const { error: upErr } = await supabaseAdmin
      .from('rank_legend_curve')
      .upsert(rows, { onConflict: 'bucket' })

    if (upErr) {
      return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'PUT failed' }, { status: 500 })
  }
}
