import { NextResponse } from 'next/server'
import db from '@/lib/db'   // <-- default import

export async function GET() {
  try {
    const { rows } = await db.query('select 1 as ok')
    return NextResponse.json({ ok: true, rows })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
