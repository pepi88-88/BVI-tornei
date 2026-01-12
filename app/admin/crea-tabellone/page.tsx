'use client'

/* ============================================================================
   Creazione tabellone
   - SE classico (linee fino alle semifinali) + winner box
   - DE manuale (5–8 squadre): R1–R4 con select; tutti gli altri box/linee manuali
   - ITA round-robin
   - Box ~30% più stretti + scroll orizzontale
============================================================================ */

import React, { useEffect, useMemo, useRef, useState } from 'react'

/* =========================
   COSTANTI UI
========================= */
const BASE_CARD_W = 320
const CARD_W      = Math.round(BASE_CARD_W * 0.9) // ~ -30%
const CARD_H      = 148
const COL_GAP     = 120
const ROW_GAP     = 32
const BLOCK_GAP_V = 160 // Winners → Losers
const HSCROLL_PAD = -100 // extra larghezza per avere la scrollbar orizzontale

// fine-tuning linea/box del VINCITORE (SE/DE)
const SE_FINAL_TUNE = { lineDX: 16, lineDY: 18, lineLEN: 64, boxDX: -8, boxDY: 15 }
const DE_FINAL_TUNE = { lineDX: 16, lineDY: 18, lineLEN: 64, boxDX: -8, boxDY: 15 }

/* =========================
   UTILS
========================= */
type GroupMeta = { key: string; size: number }

const uid = () => Math.random().toString(36).slice(2, 10)
const nextPow2 = (n: number) => { let p = 1; while (p < n) p <<= 1; return p }
const clamp    = (n:number, lo:number, hi:number) => Math.max(lo, Math.min(hi, n))

function rr(n: number): Array<[number, number]> {
  const t = Array.from({ length: n }, (_, i) => i + 1)
  if (t.length < 2) return []
  if (t.length % 2 === 1) t.push(0)
  const rounds = t.length - 1, half = t.length / 2, out: Array<[number, number]> = []
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < half; i++) {
      const a = t[i], b = t[t.length - 1 - i]
      if (a !== 0 && b !== 0) out.push([a, b])
    }
    const fixed = t[0], rest = t.slice(1); rest.unshift(rest.pop()!); t.splice(0, t.length, fixed, ...rest)
  }
  return out
}

/* ---- storage tabelloni ---- */
type Bracket = {
  id: string
  title: string
  color: string
  type: 'SE' | 'DE' | 'ITA'
  nTeams: number
  source: 'gironi' | 'avulsa' | 'eliminati' | 'gironi+eliminati'| 'avulsa+eliminati'
  fromTableId?: string
  r1: { A: string; B: string }[]   // usato da SE e anche da DE (R1..R4)
  slots: string[]                   // usato da ITA
}
const keyLS = (tour: string, tappa: string) => `brackets:${tour}:${tappa}`
function normalizeBracket(b: any): Bracket {
  const nTeams = Math.max(2, Number(b?.nTeams) || 8)
  const needR1 = nextPow2(nTeams) / 2
  const r1 = Array.from({ length: needR1 }, (_, i) => ({
    A: b?.r1?.[i]?.A ?? '-',
    B: b?.r1?.[i]?.B ?? '-',
  }))
  const slots = Array.from({ length: nextPow2(nTeams) }, (_, i) => b?.slots?.[i] ?? '')
  return {
    id: String(b?.id || uid()),
    title: String(b?.title || 'TABELLONE 1'),
    color: String(b?.color || '#22c55e'),
    type: (b?.type as Bracket['type']) || 'SE',
    nTeams,
    source: (b?.source as Bracket['source']) || 'gironi',
    fromTableId: b?.fromTableId || undefined,
    r1,
    slots,
  }
}



/* ---- meta gironi (LS) ---- */

function loadGroupsLS(tour: string, tappa: string): GroupMeta[] {
  // 1) prova “gm:<tId>” (la pagina gironi salva qui)
  try {
    const raw = localStorage.getItem(`gm:${tappa}`)
    if (raw) {
      const js = JSON.parse(raw)
      const meta = js?.meta || {}
      const out: GroupMeta[] = []
      for (const [k, v] of Object.entries(meta)) {
        const key = String(k).toUpperCase()
        const size = Number((v as any)?.capacity ?? 0)
        if (size > 0) out.push({ key, size })
      }
      if (out.length) return out.sort((a, b) => a.key.localeCompare(b.key))
    }
  } catch {}

 // 1-bis) fallback: prendi i gruppi dallo snapshot “sources:*”
{
  const snapGroups = loadGroupsFromSnapshot(tour, tappa)
  if (snapGroups.length) return snapGroups
}

  // 2) fallback alle chiavi “storiche” (se per caso esistono)
  const GROUP_KEYS = [
    (tour: string, tappa: string) => `groups:${tour}:${tappa}`,
    (tour: string, tappa: string) => `gironi:${tour}:${tappa}`,
    (tour: string, tappa: string) => `gironi_meta:${tour}:${tappa}`,
    (_tour: string, tappa: string) => `meta_gironi_${tappa}`,
    (tour: string, tappa: string) => `gironi_meta_${tour}_${tappa}`,
  ]
  for (const k of GROUP_KEYS) {
    try {
      const raw = localStorage.getItem(k(tour, tappa))
      if (!raw) continue
      const val = JSON.parse(raw)
      if (Array.isArray(val) && val.length && val[0]?.key && (val[0]?.size ?? val[0]?.teams)) {
        return val.map((r:any)=>({ key:String(r.key).toUpperCase(), size:Number(r.size ?? r.teams)||0 }))
      }
    } catch {}
  }
  return []
}


/* ---- snapshot sorgenti (gironi/avulsa) ---- */
/** NOTA: GroupMeta è già usato in questo file: non ridefinirlo qui. */
type Sources = { gironi: GroupMeta[]; avulsa: string[]; createdAt: string }

const keySources = (tour: string, tappa: string) => `sources:${tour}:${tappa}`

function saveSources(tour: string, tappa: string, s: Sources) {
  try {
    localStorage.setItem(keySources(tour, tappa), JSON.stringify(s))
  } catch {}
}

/** Carica lo snapshot COMPLETO (gironi + avulsa) dal localStorage.
 *  Applica anche il filtro “no waiting / waitlist” su avulsa. */
function loadSourcesRaw(tour: string, tappa: string): Sources | null {
  try {
    const raw = localStorage.getItem(keySources(tour, tappa))
    if (!raw) return null
    const js = JSON.parse(raw) as Sources
    const av = Array.isArray(js.avulsa)
      ? js.avulsa.filter(s => {
          const v = String(s).toLowerCase()
          return !v.includes('waiting') && !v.includes('waitlist')
        })
      : []
    return { ...js, avulsa: av }
  } catch {
    return null
  }
}

/** Usa questa quando ti serve SOLO l'array dei gruppi (tipo: GroupMeta[]) */
function loadGroupsFromSnapshot(tour: string, tappa: string): GroupMeta[] {
  return loadSourcesRaw(tour, tappa)?.gironi ?? []
}

/** Usa questa quando ti serve l’array “avulsa” (già filtrato) */
function loadAvulsaFromSnapshot(tour: string, tappa: string): string[] {
  return loadSourcesRaw(tour, tappa)?.avulsa ?? []
}

// stati da ESCLUDERE (non attivi / non confermati)
const BAD = new Set([
  'waiting', 'waitlist', 'pending', 'on_hold',
  'canceled', 'cancelled', 'withdrawn', 'deleted',
  'rejected', 'refused', 'draft'
])

// Conta SOLO le iscrizioni valide (no waiting/waitlist/pending... e, se presente, payment ok)
async function fetchRegistrationsCount(tId: string): Promise<number> {
  if (!tId) return 0
  try {
    const r = await fetch(`/api/registrations/by-tournament?tournament_id=${tId}`, { cache: 'no-store' })
    const j = await r.json()
    const items = Array.isArray(j?.items) ? j.items : []

    const isEligible = (x: any) => {
      const status = String(x?.status ?? '').toLowerCase().trim()
      const waitingFlag = x?.waiting === true || x?.is_waiting === true || x?.on_waitlist === true
      const payment = String(x?.payment_status ?? '').toLowerCase().trim()
      const paymentOk = !payment || ['paid', 'confirmed', 'completed'].includes(payment)
      return !waitingFlag && !BAD.has(status) && paymentOk
    }

    return items.filter(isEligible).length
  } catch {
    return 0
  }
}

// Versione che restituisce l'array filtrato
async function fetchRegistrationsFiltered(tId: string) {
  if (!tId) return []
  try {
    const r = await fetch(`/api/registrations/by-tournament?tournament_id=${tId}`)
    const j = await r.json()
    const items = Array.isArray(j?.items) ? j.items : []

    const isEligible = (x: any) => {
      const status = String(x?.status ?? '').toLowerCase().trim()
      const waitingFlag = x?.waiting === true || x?.is_waiting === true || x?.on_waitlist === true
      const payment = String(x?.payment_status ?? '').toLowerCase().trim()
      const paymentOk = !payment || ['paid', 'confirmed', 'completed'].includes(payment)
      return !waitingFlag && !BAD.has(status) && paymentOk
    }

    return items.filter(isEligible)
  } catch {
    return []
  }
}

/* ---- Tours/Tappe ---- */
async function fetchTours() { try { const r = await fetch('/api/tours'); const j = await r.json(); return Array.isArray(j?.items) ? j.items : [] } catch { return [] } }
async function fetchTappe(tourId: string) {
  if (!tourId) return { items: [] as any[], tried: [] as string[], error: null as string|null }
  const urls = [

    `/api/tournaments?tour_id=${tourId}`,
   
  ]
  let lastErr: string | null = null
  for (const u of urls) {
    try {
      const r = await fetch(u)
      if (!r.ok) { lastErr = `${r.status} ${r.statusText} @ ${u}`; continue }
      const j = await r.json()
      const items = Array.isArray(j) ? j : Array.isArray(j?.items) ? j.items : Array.isArray(j?.data) ? j.data : []
      if (items.length) return { items, tried: urls, error: null }
    } catch (e:any) { lastErr = String(e) }
  }
  return { items: [], tried: urls, error: lastErr ?? 'no data' }
}

/* =========================
   LAYOUT SE (pixel) + codici
========================= */
type Node = { id:string; round:number; mIndex:number; left:number; top:number; fromA?:number; fromB?:number; code?:string }
const centerOf = (n: Node) => ({ cx: n.left + CARD_W/2, cy: n.top + CARD_H/2 })

const LETTER_BY_ROUND = ['R','Z','Y','X','W'] // R=prima fase, poi altre lettere
function codeFor(round:number, mIndex:number) {
  const L = LETTER_BY_ROUND[round-1] || 'R'
  return `${L}${mIndex+1}`
}

function buildSELayout(title: string, nTeams: number, leftOffset = 0, topOffset = 0) {
  const pow = nextPow2(nTeams)
  const rounds = Math.log2(pow)
  const r1Matches = pow / 2
  const nodes: Node[] = []
  const byRound: Node[][] = []

  const r1: Node[] = []
  for (let i=0;i<r1Matches;i++) {
    r1.push({ id:`${title.toUpperCase()}-M${i+1}`, round:1, mIndex:i, left:leftOffset, top:topOffset + i*(CARD_H+ROW_GAP), code: codeFor(1,i) })
  }
  byRound.push(r1); nodes.push(...r1)

  for (let r=2;r<=rounds;r++) {
    const prev = byRound[r-2]; const cur: Node[] = []
    for (let i=0;i<prev.length/2;i++) {
      const A = prev[2*i], B = prev[2*i+1]
      const centerY = (A.top + CARD_H/2 + B.top + CARD_H/2)/2
      const top = centerY - CARD_H/2
      const left = leftOffset + (r-1)*(CARD_W+COL_GAP)
      const node: Node = { id:`${title.toUpperCase()}-M${nodes.length+1}`, round:r, mIndex:i, left, top, fromA:nodes.indexOf(A), fromB:nodes.indexOf(B), code: codeFor(r,i) }
      cur.push(node); nodes.push(node)
    }
    byRound.push(cur)
  }
  const width = rounds*(CARD_W+COL_GAP)-COL_GAP+20
  const height = Math.max(...nodes.map(n=>n.top), 0) + CARD_H - topOffset
  return { nodes, rounds, width, height, byRound, topOffset, roundsCount: rounds }
}
// ======= FUNZIONI/TYPE prese da “Sorgenti” (ridotte al necessario) =======
type GmStore = {
  groupsCount: number
  meta: Record<string, { capacity: number; format?: 'pool'|'ita' }>
  assign: Record<string, string>                 // "A-1" -> registrationId
  labels?: Record<string, string>                // registrationId -> "Rossi Luca — Bianchi Marco"
}

// normalizza “CognomeA / CognomeB”
function pairFromLabelString(label: string): string {
  const lastFrom = (s: string) => {
    const cleaned = s.trim().replace(/\s+[A-Z]\.?$/u, '')
    const parts = cleaned.split(/\s+/)
    return (parts.pop() || '').trim()
  }
  const parts = String(label || '').replace(/—/g,'/').split('/').map(s=>s.trim()).filter(Boolean)
  if (parts.length >= 2) return `${lastFrom(parts[0])} / ${lastFrom(parts[1])}`
  return lastFrom(String(label || ''))
}

// carica stato “gironi” da Supabase (stesso endpoint della pagina /admin/gironi)
async function loadGroupsStateFromSupabase(tappaId: string): Promise<{
  meta: Record<string, { capacity: number, format?: 'pool'|'ita' }>,
  assign: Record<string, string>,
  labels: Record<string, string>,
  groupsCount: number,
}> {
  if (!tappaId) return { meta:{}, assign:{}, labels:{}, groupsCount: 0 }
  try {
    const r = await fetch(`/api/groups/state?tournament_id=${encodeURIComponent(tappaId)}`, {
      headers: { 'x-role': 'admin' },
      cache: 'no-store',
    })
    const j = await r.json()
    const st = (j?.state || j || {}) as any
    return {
      meta:   st?.meta   || {},
      assign: st?.assign || {},
      labels: st?.labels || {},
      groupsCount: Number(st?.groupsCount || 0),
    }
  } catch {
    return { meta:{}, assign:{}, labels:{}, groupsCount: 0 }
  }
}

// derive: meta → [{ key, size }]
function metaFromGm(gm: GmStore | null): Array<{ key: string; size: number }> {
  if (!gm || !gm.meta) return []
  return Object.entries(gm.meta)
    .map(([key, v]) => ({ key: String(key).toUpperCase(), size: Number(v?.capacity ?? 0) || 0 }))
    .filter(g => g.size > 0)
    .sort((a, b) => a.key.localeCompare(b.key))
}

// derive: assign → [{ key, sizeMax }] (se manca meta)
function metaFromAssign(gm: GmStore | null): Array<{ key: string; size: number }> {
  if (!gm || !gm.assign) return []
  const counts: Record<string, number> = {}
  for (const k of Object.keys(gm.assign)) {
    const m = k.match(/^([A-Za-z]+)-(\d+)$/)
    if (!m) continue
    const L = m[1].toUpperCase()
    const slot = Number(m[2] || 0)
    counts[L] = Math.max(counts[L] ?? 0, slot)
  }
  return Object.entries(counts)
    .map(([key, size]) => ({ key, size }))
    .filter(g => g.size > 0)
    .sort((a,b) => a.key.localeCompare(b.key))
}

// helper: genera codici A1..An, B1..Bn… dall’array {key,size}
function expandGironi(meta: Array<{ key: string; size: number }>): string[] {
  if (!meta?.length) return []
  const out: string[] = []
  const ord = [...meta].sort((a, b) => a.key.localeCompare(b.key))
  for (const g of ord) {
    const L = g.key.toUpperCase()
    const n = Number(g.size) || 0
    for (let p = 1; p <= n; p++) out.push(`${L}${p}`)
  }
  return out
}

/* ========= Nominativi per slot (per drawer) ========= */
type Persist = {
  groupsCount: number
  meta: Record<string, { capacity:number; format:'pool'|'ita' }>
  assign: Record<string, string>
  labels?: Record<string, string>
}
const lastSurnames = (label:string) => {
  const ln = (s: string) => {
    const cleaned = s.trim().replace(/\s+[A-Z]\.?$/u, '')
    const parts = cleaned.split(/\s+/)
    return (parts[0] ?? '').trim()
  }
  const parts = String(label).replace(/—/g,'/').split('/').map(p=>p.trim()).filter(Boolean)
  if (parts.length >= 2) return `${ln(parts[0])} / ${ln(parts[1])}`
  return ln(String(label))
}
async function fetchRegNames(tId:string): Promise<string[]> {
  try {
    const r = await fetch(`/api/registrations/by-tournament?tournament_id=${tId}`, { cache: 'no-store' })
    const j = await r.json()
    const items = Array.isArray(j?.items) ? j.items : []
    return items.map((x:any) => {
      const label = x?.label || ''
      const a = x?.player_a || x?.playerA || x?.a || x?.pa
      const b = x?.player_b || x?.playerB || x?.b || x?.pb
      if (label) return lastSurnames(label)
      const A = a ? lastSurnames(String(a?.full_name || a?.display_name || a?.surname || a?.last_name || a)) : ''
      const B = b ? lastSurnames(String(b?.full_name || b?.display_name || b?.surname || b?.last_name || b)) : ''
      return [A,B].filter(Boolean).join(' / ')
    })
  } catch { return [] }
}
async function loadNamesBySlot(tId:string, meta: GroupMeta[]): Promise<Record<string,string>> {
  try {
    const raw = localStorage.getItem(`gm:${tId}`)
    if (raw) {
      const js: Persist = JSON.parse(raw)
      const map: Record<string,string> = {}
      for (const [slotK, rid] of Object.entries(js.assign || {})) {
        const [L, pos] = slotK.split('-')
        const code = `${String(L).toUpperCase()}${Number(pos)||0}`
        const lab = js.labels?.[rid]
        if (lab) map[code] = lastSurnames(lab)
      }
      if (Object.keys(map).length) return map
    }
  } catch {}
  const regs = await fetchRegNames(tId)
  if (!regs.length || !meta.length) return {}
  const ord = [...meta].sort((a,b)=>a.key.localeCompare(b.key))
  const out: Record<string,string> = {}
  let idx = 0
  for (const g of ord) {
    for (let p=1; p<=g.size; p++) {
      const code = `${g.key}${p}`
      if (regs[idx]) out[code] = regs[idx]
      idx++
    }
  }
  return out
}
// "A1" -> "A1 — CognomeA / CognomeB" (se noto)
function prettySlotLabel(code: string, names: Record<string, string>) {
  if (!code || code === '-' || code === 'BYE') return code || '—'
  if (/^[A-Za-z]+\d+$/.test(code)) {
    const key = code.toUpperCase()
    const nm = names[key]
    return nm ? `${key} — ${nm}` : key
  }
  return code
}


/* =========================
   DE — MODALITÀ MANUALE (5–8)
========================= */
// Box “generico” manuale
type BoxDef = {
  code: string            // es. 'R1', 'R2', 'Z1', 'Y1', 'X1', 'Q1', 'W1', 'CO1', 'F', 'WIN', 'THIRD'
  title: string           // titolo mostrato in alto a destra
  left: number            // px da sinistra (sposta qui)
  top: number             // px dall’alto   (sposta qui)
  labelA?: string         // riga A (per box informativi/non-select)
  labelB?: string         // riga B (per box informativi/non-select)
  // NB: i box R1..R4 ignorano labelA/B perché usano i menu a tendina (A/B)
}

// Helpers linee semplici (da copiare/incollare)
function HLine({ x1, y, x2, width = 3, color = '#22c55e' }:{ x1:number; y:number; x2:number; width?:number; color?:string }) {
  return <path d={`M ${x1} ${y} H ${x2}`} stroke={color} strokeWidth={width} fill="none" />
}
function VLine({ x, y1, y2, width = 3, color = '#22c55e' }:{ x:number; y1:number; y2:number; width?:number; color?:string }) {
  return <path d={`M ${x} ${y1} V ${y2}`} stroke={color} strokeWidth={width} fill="none" />
}

// Componenti Box
function DESelectBox({
  code, title, left, top,
  pairIndex, valueA, valueB,
  onChangeA, onChangeB,
  slotOptions, disabledCheck,
  locked = false,
  labeler,
}:{
  code:string; title:string; left:number; top:number; pairIndex:number;
  valueA:string; valueB:string;
  onChangeA:(v:string)=>void; onChangeB:(v:string)=>void;
  slotOptions:string[]; disabledCheck:(op:string, ctx:{pair:number; side:0|1})=>boolean;
  locked?: boolean;
  labeler?:(op:string)=>string;
}) {

  return (
    <div className="absolute card p-3 shadow-lg" style={{ width: CARD_W, height: CARD_H, left, top }}>
      {/* intestazione: qui si vede R1/R2/R3/R4 */}
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] uppercase opacity-70">{code}</div>
        <div className="text-[10px] opacity-50">{title}</div>
      </div>

      {/* Riga A */}
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 text-xs opacity-70 hide-letter" aria-hidden>A</div>

        <select
          className="input flex-1 h-10"
          value={valueA}
          onChange={(e)=>onChangeA(e.target.value)}
          disabled={locked}
        >
         <option value="-">—</option>
<option value="BYE">BYE</option>
{slotOptions.map(op => {
  const dis = disabledCheck(op, { pair: pairIndex, side: 0 }) // o 1 per il secondo select
  return (
    <option key={`de-a${pairIndex}-${op}`} value={op} disabled={dis}>
      {(labeler ? labeler(op) : op)}{dis ? ' — X' : ''}
    </option>
  )
})}


        </select>
      </div>

      {/* Riga B */}
      <div className="flex items-center gap-2">
        <div className="w-8 text-xs opacity-70 hide-letter" aria-hidden>B</div>

        <select
          className="input flex-1 h-10"
          value={valueB}
          onChange={(e)=>onChangeB(e.target.value)}
          disabled={locked}
        >
          <option value="-">—</option>
          <option value="BYE">BYE</option>
        {slotOptions.map(op => {
  const dis = disabledCheck(op, {pair:pairIndex, side:1})
  return (
    <option key={`de-b${pairIndex}-${op}`} value={op} disabled={dis}>
      {(labeler ? labeler(op) : op)}{dis ? ' — X' : ''}
    </option>
  )
})}



        </select>
      </div>
    </div>
  )
}



function InfoBox({ b }:{ b:BoxDef }) {
  return (
    <div className="absolute card p-4 shadow-lg" style={{ width: CARD_W, height: CARD_H, left: b.left, top: b.top }} title={b.code}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] uppercase opacity-70">{b.code}</div>
        <div className="text-[10px] opacity-50">{b.title}</div>
      </div>
      {b.labelA && <div className="text-sm">{b.labelA}</div>}
      {b.labelB && (<><div className="text-[12px] text-neutral-400 my-1">vs</div><div className="text-sm">{b.labelB}</div></>)}
    </div>
  )
}
/**
 * SCENA DE MANUALE (5–8 squadre)
 * Sposta i box cambiando left/top qui sotto.
 * I testi dei box hanno commenti su cosa scrivere.
 */
function buildDEManual58(title:string) {
  // WINNERS — R1/R2/R3/R4 (SELECT) + Z1/Z2 (informativi) + Y1/Y2 (etichette)
  const WINNERS: BoxDef[] = [
    // R1 — Quarti (ALTA 1). ***SPOSTA left/top*** e scegli squadre via select (render sotto).
    { code:'R1', title:'R1 — Quarti (alta 1)', left: 40, top: 40 },

    // R2 — Quarti (ALTA 2)
    { code:'R2', title:'R2 — Quarti (alta 2)', left: 40, top: 40 + CARD_H + 28 },

    // R3 — Quarti (BASSA 1)
    { code:'R3', title:'R3 — Quarti (bassa 1)', left: 40, top: 40 + (CARD_H + 28)*2 },

    // R4 — Quarti (BASSA 2)
    { code:'R4', title:'R4 — Quarti (bassa 2)', left: 40, top: 40 + (CARD_H + 28)*3 },

    // Z1 — Semifinale (ALTA) — scrivi “Vincente R1 — {title}” e “Vincente R2 — {title}”
    { code:'Z1', title:'Z1 — Semifinale (alta)', left: 40 + CARD_W + 160, top: 40 + (CARD_H + 28)/2,
      labelA:`Vincente R1 — ${title}`, labelB:`Vincente R2 — ${title}` },

    // Z2 — Semifinale (BASSA)
    { code:'Z2', title:'Z2 — Semifinale (bassa)', left: 40 + CARD_W + 160, top: 40 + (CARD_H + 28)*2.5,
      labelA:`Vincente R3 — ${title}`, labelB:`Vincente R4 — ${title}` },
   

    // Y1 — Etichetta “Vincente Z1”
    { code:'Y1', title:'Y1 — Vincente Z1', left: 40 + (CARD_W + 160)*2, top: 40 + (CARD_H + 28)/2,
      labelA:`Vincente Z1 — ${title}` },

    
    // Y2 — Etichetta “Vincente Z2”
    { code:'Y2', title:'Y2 — Vincente Z2', left: 40 + (CARD_W + 160)*2, top: 40 + (CARD_H + 28)*2.5,
      labelA:`Vincente Z2 — ${title}` },
  ]

  // LOSERS — come richiesto: X1/X3 + Q1 → W1, X2/X4 + Q2 → W2
  const LOSERS: BoxDef[] = [
    // X1 — Perdente R1 vs Perdente R2
    { code:'X1', title:'X1 — Losers (alto)', left: 40, top: 400 + (CARD_H + 40)*3,
      labelA:`Perdente R1 — ${title}`, labelB:`Perdente R2 — ${title}` },

    // X2 — Perdente R3 vs Perdente R4
    { code:'X2', title:'X2 — Losers (basso)', left: 40, top: 400 + (CARD_H + 40)*5,
      labelA:`Perdente R3 — ${title}`, labelB:`Perdente R4 — ${title}` },
    
    // X3 — Vincente X1
    { code:'X3', title:'X3 — Losers (alto)', left: 40+ CARD_W + 160, top: 400 + (CARD_H + 40)*3 ,
      labelA:`Vincente X1 — ${title}` },

    // X4 — Vincente X2
    { code:'X4', title:'X4 — Losers (basso)', left: 40+ CARD_W + 160, top: 400 + (CARD_H + 40)*5,
      labelA:`Vincente X2 — ${title}` },

    // Q1 — Perdente Z1
    { code:'Q1', title:'Q1 — Losers (alto)', left: 40 + CARD_W + 160, top: 400 + (CARD_H + 40)*3 - CARD_H - 24,
      labelA:`Perdente Z1 — ${title}` },

    // Q2 — Perdente Z2
    { code:'Q2', title:'Q2 — Losers (basso)', left: 40 + CARD_W + 160, top: 400 + (CARD_H + 40)*5 - CARD_H - 24,
      labelA:`Perdente Z2 — ${title}` },

    // W1 — Vincente tra Q1 e X3
    { code:'W1', title:'W1 — Losers (alto)', left: 40 + (CARD_W + 160)*2, top: 400 + (CARD_H + 40)*3 - CARD_H/2,
      labelA:`Vincente Q1 — ${title}`, labelB:`Vincente X3 — ${title}` },
    
    // W2 — Vincente tra Q2 e X4
    { code:'W2', title:'W2 — Losers (basso)', left: 40 + (CARD_W + 160)*2, top: 400 + (CARD_H + 40)*5 - CARD_H/2,
      labelA:`Vincente Q2 — ${title}`, labelB:`Vincente X4 — ${title}` },
  ]

  // CROSS-OVER + FINALE
  const CO_FINAL: BoxDef[] = [
    // CO1 — Y1 vs W2
    { code:'CO1', title:'CO1 — Crossover', left: 40 + (CARD_W + 160)*3, top: 220,
      labelA:`CardBox Y1 — ${title}`, labelB:`Vincente W2 — ${title}` },

    // CO2 — Y2 vs W1
    { code:'CO2', title:'CO2 — Crossover', left: 40 + (CARD_W + 160)*3, top: 220 + (CARD_H + 28),
      labelA:`CardBox Y2 — ${title}`, labelB:`Vincente W2 — ${title}` },

    // F — Finale (Vincente CO1 vs Vincente CO2)
    { code:'F', title:'Finale', left: 40 + (CARD_W + 160)*4.0, top: 220 + (CARD_H + 14)/2,
      labelA:`Vincente CO1`, labelB:`Vincente CO2` },

    // WIN — Vincitore
    { code:'WIN', title:'VINCITORE TORNEO', left: 40 + (CARD_W + 150)*5, top: 220 + (CARD_H + 14)/2,
      labelA:`Vincente Finale` },

    // 3/4 — opzionale: attivato con il toggle nella UI
    { code:'THIRD', title:'3° / 4° posto', left: 40 + (CARD_W + 160)*4.0, top: 220 + (CARD_H + 14)/2 + CARD_H + 48,
      labelA:`Perdente CO1 vs Perdente CO2` },
  ]

  return { WINNERS, LOSERS, CO_FINAL }
}

// Helpers per dimensione canvas e per referenziare i bordi dei box
function sizeFromBoxes(all: BoxDef[]) {
  const w = Math.max(...all.map(b => b.left + CARD_W), 1200) + 160
  const h = Math.max(...all.map(b => b.top + CARD_H), 700) + 160
  return { w, h }
}
function toMap(arr: BoxDef[]) {
  const m = new Map<string, BoxDef>(); arr.forEach(b=>m.set(b.code,b)); return m
}
function LEFT(m:Map<string,BoxDef>, c:string){ return (m.get(c)?.left ?? 0) }
function RIGHT(m:Map<string,BoxDef>, c:string){ const b=m.get(c); return b? b.left + CARD_W : 0 }
function TOP(m:Map<string,BoxDef>, c:string){ return (m.get(c)?.top ?? 0) }
function BOTTOM(m:Map<string,BoxDef>, c:string){ const b=m.get(c); return b? b.top + CARD_H : 0 }
function CX(m:Map<string,BoxDef>, c:string){ const b=m.get(c); return b? b.left + CARD_W/2 : 0 }
function CY(m:Map<string,BoxDef>, c:string){ const b=m.get(c); return b? b.top + CARD_H/2 : 0 }

/* =========================
   PAGINA
========================= */
export default function CreaTabellonePage() {
  /* 1) Tour/Tappa reali */
  const [tours, setTours] = useState<any[]>([])
  const [tappe, setTappe] = useState<any[]>([])
  const [tourId, setTourId] = useState<string>('')
  const [tId, setTId]       = useState<string>('')
const [loadedRemote, setLoadedRemote] = useState(false)

  useEffect(() => { (async()=>{ const ts = await fetchTours(); setTours(ts); if (!tourId && ts[0]?.id) setTourId(ts[0].id) })() }, [])
  useEffect(() => {
  (async () => {
    if (!tourId) { setTappe([]); setTId(''); return }
    const { items } = await fetchTappe(tourId)
    const vis = (items || []).filter((x: any) => String(x?.status || '').toLowerCase() !== 'closed')
    setTappe(vis)
    if (!tId && vis[0]?.id) setTId(vis[0].id)
  })()
}, [tourId])

useEffect(() => {
  if (tId && !tappe.some(t => t.id === tId)) setTId('')
}, [tappe, tId])

  /* 2) Meta/iscritti + nominativi */
  const [groups, setGroups] = useState<GroupMeta[]>([])
  const [tappaSize, setTappaSize] = useState<number>(0)
  
// === Stato “gm” live come in Sorgenti ===
const [gmSE, setGmSE] = useState<GmStore | null>(null)
// Nomi "cognomeA / cognomeB" direttamente da gmSE (assign + labels)
const namesBySlot = useMemo(() => {
  const map: Record<string,string> = {}
  if (!gmSE) return map
  for (const [slotK, ridRaw] of Object.entries(gmSE.assign || {})) {
    const m = slotK.match(/^([A-Za-z]+)-(\d+)$/)
    if (!m) continue
    const code = `${m[1].toUpperCase()}${Number(m[2])}`
    const rid  = String(ridRaw || '').trim()
    const raw  = gmSE.labels?.[rid]
    if (raw) map[code] = pairFromLabelString(raw)
  }
  return map
}, [gmSE])
// carica lo stato gironi “reale” dalla tappa selezionata (GM live)
useEffect(() => {
  (async () => {
    if (!tId) { setGmSE(null); return }
    const st = await loadGroupsStateFromSupabase(tId)
    const gm: GmStore = {
      groupsCount: st.groupsCount || Object.keys(st.meta || {}).length,
      meta: st.meta || {},
      assign: st.assign || {},
      labels: st.labels || {},
    }
    setGmSE(gm)
  })()
}, [tId])
  useEffect(() => { if (tourId && tId) setGroups(loadGroupsLS(tourId, tId)) }, [tourId, tId])
  useEffect(() => { if (tId) fetchRegistrationsCount(tId).then(setTappaSize) }, [tId])
  
  /* 3) Brackets */
  const [brackets, setBrackets] = useState<Bracket[]>([])
const [activeId, setActiveId] = useState<string | null>(null)
type ItaScore = { a?: number; b?: number } // se non esiste già nel file

const [winnersById, setWinnersById] = useState<Record<string, Record<string, 'A' | 'B' | undefined>>>({})
const [itaScoresById, setItaScoresById] = useState<Record<string, ItaScore[]>>({})


// === LOCK: stato + persistenza ===
const [locked, setLocked] = useState<boolean>(() => {
  try { return localStorage.getItem(`bracketsLocked:${tourId}:${tId}`) === '1' } catch { return false }
})
useEffect(() => {
  try { localStorage.setItem(`bracketsLocked:${tourId}:${tId}`, locked ? '1' : '0') } catch {}
}, [locked, tourId, tId])


// attivo = quello con id === activeId; fallback al primo
const activeIndex = Math.max(0, brackets.findIndex(b => b.id === activeId))
const active = brackets[activeIndex] || brackets[0]
const [enableThirdPlace, setEnableThirdPlace] = useState(true)


  function newBracket(): Bracket {
    const n = 8
    return {
      id: uid(),
      title: 'TABELLONE 1',
      color: '#22c55e',
      type: 'SE',
      nTeams: n,
      source: 'gironi',
      r1: Array.from({ length: nextPow2(n)/2 }, () => ({ A: '-', B: '-' })),
      slots: Array.from({ length: nextPow2(n) }, () => ''),
    }
  }
function migrateParentsByTitle(brs: Bracket[]): Bracket[] {
  const byId    = new Map(brs.map(b => [b.id, b]));
  const byTitle = new Map(brs.map(b => [b.title, b.id]));
  return brs.map(b => {
    const p = b.fromTableId;
    if (!p) return b;
    // se p non è un id noto ma coincide con un titolo, sostituisco col vero id
    if (!byId.has(p) && byTitle.has(p)) return { ...b, fromTableId: byTitle.get(p)! };
    return b;
  });
}

 function handleTypeChange(newType: Bracket['type']) {
  if (!active || newType === active.type) {
    // niente da fare se non è un vero cambio
    patchActive({ type: newType })
    return
  }
  const nn    = clamp(active.nTeams, 2, 16)
  const needR1 = nextPow2(nn) / 2
  const clearedR1   = Array.from({ length: needR1 }, () => ({ A: '-', B: '-' }))
  const clearedSlot = Array.from({ length: nextPow2(nn) }, () => '')
  patchActive({ type: newType, r1: clearedR1, slots: clearedSlot })
}


//quimarco

// Variante A — se stai ancora usando `const active = brackets[bi]`
function patchActive(patch: Partial<Bracket>) {
  setBrackets(bs => bs.map(b => (active && b.id === active.id ? { ...b, ...patch } : b)));
}

/* // Variante B — se sei passato a activeId:
function patchActive(patch: Partial<Bracket>) {
  if (!activeId) return;
  setBrackets(bs => bs.map(b => (b.id === activeId ? { ...b, ...patch } : b)));
}
*/

function ensureR1For(n:number) {
  const nn   = clamp(n, 2, 16);
  const need = nextPow2(nn) / 2;
  const r1   = Array.from({ length: need }, (_, i) => ({
    A: active?.r1?.[i]?.A ?? '-',
    B: active?.r1?.[i]?.B ?? '-',
  }));
  const slots = Array.from({ length: nextPow2(nn) }, (_, i) => active?.slots?.[i] ?? '');
  patchActive({ nTeams: nn, r1, slots });
}

function setSlot(pair:number, side:0|1, value:string) {
  const r1 = active?.r1 ? [...active.r1] : [];
  const cur = r1[pair] ?? { A:'-', B:'-' };
  if (side===0) cur.A = value; else cur.B = value;
  r1[pair] = cur;
  patchActive({ r1 });
}

function setItaSlot(idx:number, value:string) {
  const slots = active?.slots ? [...active.slots] : [];
  slots[idx] = value;
  patchActive({ slots });
}

function addBracket() {
  const b = newBracket();
  setBrackets(bs => [...bs, b]);
  setActiveId(b.id); // attiva subito quello nuovo
}

function removeBracket() {
  setBrackets(bs => {
    if (bs.length <= 1) return bs;
    const curId = active?.id;
    const next = bs.filter(x => x.id !== curId);
    // attiva un tabellone valido (stesso indice se possibile)
    const idx = Math.max(0, Math.min(bs.findIndex(x => x.id === curId), next.length - 1));
    setActiveId(next[idx]?.id ?? null);
    return next;
  });
}
useEffect(() => {
  let cancelled = false
  setLoadedRemote(false)

  if (!tId) { 
    setBrackets([]); 
    setActiveId(null); 
    setLoadedRemote(true)
    return 
  }

  ;(async () => {
    try {
      const r = await fetch(`/api/brackets/state?tournament_id=${encodeURIComponent(tId)}`, {
        headers: { 'x-role': 'admin' }, cache: 'no-store'
      })
      const js = await r.json()
      const raw = js?.state

      const items = Array.isArray(raw) ? raw : (raw?.items || [])
      const normalized = items.map(normalizeBracket)

      if (cancelled) return

      if (normalized.length > 0) {
        setBrackets(normalized)
        setActiveId(normalized[0]?.id ?? null)
      } else {
        // 👉 inizializza SOLO se remoto vuoto
        const b = newBracket()
        setBrackets([b])
        setActiveId(b.id)
      }

      // carica winners/itaScores senza toccare items
      setWinnersById(Array.isArray(raw) ? {} : (raw?.winnersById || {}))
      setItaScoresById(Array.isArray(raw) ? {} : (raw?.itaScoresById || {}))
    } catch {
      if (!cancelled) {
        // fallback: crea locale 1 tab
        const b = newBracket()
        setBrackets([b])
        setActiveId(b.id)
        setWinnersById({})
        setItaScoresById({})
      }
    } finally {
      if (!cancelled) setLoadedRemote(true)
    }
  })()

  return () => { cancelled = true }
}, [tId])


// nella pagina risultati, autosave winners
useEffect(() => {
  if (!tId) return
  if (!loadedRemote) return             // aspetta il caricamento remoto
  if (brackets.length === 0) return     // mai salvare items: []

  const curTId = tId
  const timer = setTimeout(async () => {
    try {
      // leggi il precedente per non perdere winners/itaScores/is_public
      const res = await fetch(`/api/brackets/state?tournament_id=${encodeURIComponent(curTId)}`, {
        headers: { 'x-role': 'admin' }, cache: 'no-store'
      })
      const js = await res.json()
      const prev = (js?.state || {}) as any

      const next = {
        items: brackets,                                  // i tabelloni correnti
        winnersById: prev?.winnersById || {},             // preserva
        itaScoresById: prev?.itaScoresById || {},         // preserva
        isPublic: typeof prev?.isPublic === 'boolean' ? prev.isPublic : false,
      }


      // evita PUT inutili se nulla è cambiato
      const same =
        JSON.stringify(prev?.items || []) === JSON.stringify(next.items) &&
        JSON.stringify(prev?.winnersById || {}) === JSON.stringify(next.winnersById) &&
        JSON.stringify(prev?.itaScoresById || {}) === JSON.stringify(next.itaScoresById) &&
        Boolean(prev?.isPublic) === Boolean(next.isPublic)
      if (same) return

      if (curTId !== tId) return // tappa cambiata
      await fetch('/api/brackets/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-role': 'admin' },
        body: JSON.stringify({ tournament_id: curTId, state: next }),
      })
    } catch {}
  }, 300)

  return () => clearTimeout(timer)
}, [tId, loadedRemote, brackets]) // 👈 niente winnersById qui

// lettere da usare (come Sorgenti) + limitazione con groupsCount
const lettersReal = useMemo(() => {
  const set = new Set<string>()

  // 1) da meta (solo keys con capacity>0)
  if (gmSE?.meta) {
    for (const [k, v] of Object.entries(gmSE.meta)) {
      if (Number(v?.capacity) > 0) set.add(k.toUpperCase())
    }
  }

  // 2) da assign (se c’è almeno uno slot assegnato)
  if (gmSE?.assign) {
    for (const key of Object.keys(gmSE.assign)) {
      const m = key.match(/^([A-Za-z]+)-\d+$/)
      if (m) set.add(m[1].toUpperCase())
    }
  }

  // ordina
  const all = Array.from(set).sort()

  // 3) limitazione al groupsCount “ufficiale”
  const n = Number(gmSE?.groupsCount || 0)
  if (n > 0 && all.length > n) return all.slice(0, n)

  return all
}, [gmSE])

// size di un girone (preferisci meta.capacity; fallback assign)
const sizeOfReal = (L: string) => {
  const s = gmSE?.meta?.[L]?.capacity
  if (typeof s === 'number' && s > 0) return s
  if (gmSE?.assign) {
    let max = 0
    for (const k of Object.keys(gmSE.assign)) {
      const m = k.match(/^([A-Za-z]+)-(\d+)$/)
      if (m && m[1].toUpperCase() === L.toUpperCase()) {
        const slot = Number(m[2] || 0)
        if (slot > max) max = slot
      }
    }
    if (max > 0) return max
  }
  return 0
}

// codici reali (A1..An…) limitati al groupsCount
const realGironiCodes = useMemo(() => {
  const metaArr = lettersReal.map(L => ({ key: L, size: sizeOfReal(L) })).filter(g => g.size > 0)
  return expandGironi(metaArr)
}, [lettersReal, gmSE])

  /* 5) Opzioni slot + Anti-duplicati GLOBALI */
 const slotOptions = useMemo(() => {
  if (!tourId || !tId) return []

  // Gironi: SOLO codici reali (derivati dal gm live + groupsCount)
  const gironiOps = realGironiCodes

   // Avulsa: preferisci quanti sono realmente assegnati; poi snapshot; poi tappaSize
const gmAssignedCount = gmSE ? new Set(Object.values(gmSE.assign || {})).size : 0
const snapAvulsaCount = loadAvulsaFromSnapshot(tourId, tId).length
const avCount = gmAssignedCount || snapAvulsaCount || tappaSize
const avulsaOps = Array.from({ length: Math.max(0, avCount) }, (_, i) => String(i + 1))

  // Eliminati
  const loser = active?.fromTableId ? brackets.find(b => b.id === active.fromTableId) : null
  const mCount = loser ? nextPow2(loser.nTeams) / 2 : 0
  const elimOps = loser ? Array.from({ length: mCount }, (_, i) => `Perdente ${loser.title.toUpperCase()} M${i + 1}`) : []

  switch (active?.source) {
    case 'gironi':            return gironiOps
    case 'avulsa':            return avulsaOps
    case 'eliminati':         return elimOps
    case 'gironi+eliminati':  return [...gironiOps, ...elimOps]
case 'avulsa+eliminati':  return [...avulsaOps, ...elimOps]
    default:                  return []
  }
}, [tourId, tId, realGironiCodes, tappaSize, active?.source, active?.fromTableId, brackets, gmSE])



  const usedCodesGlobal = useMemo(()=>{
    const s = new Set<string>()
    const add = (code?:string) => { if (!code) return; if (code==='-'||code==='BYE') return; s.add(code) }
    for (const b of brackets) {
      for (const r of b.r1 ?? []) { add(r?.A); add(r?.B) }
      for (const c of b.slots ?? []) add(c)
    }
    return s
  }, [brackets])
  const isTakenElsewhere = (code:string, ctx: {pair?:number; side?:0|1; itaIndex?:number} = {}) => {
    if (!code || code==='-' || code==='BYE') return false
    if (ctx.pair!=null && ctx.side!=null) {
      const cur = (active?.r1?.[ctx.pair] ?? {A:'',B:''})[ctx.side===0?'A':'B']
      if (cur === code) return false
    }
    if (ctx.itaIndex!=null) {
      const cur = active?.slots?.[ctx.itaIndex]
      if (cur === code) return false
    }
    return usedCodesGlobal.has(code)
  }
// Calcolo livelli (profondità) rispetto al PRIMO tabellone dell’array
// Livelli in sequenza (sinistra→destra): L1, L2, L3...
const bracketLevels = useMemo(() => {
  const order: Record<string, number> = {};
  brackets.forEach((b, i) => { order[b.id] = i + 1 }); // L1 = primo, L2 = secondo, ...
  const topId = brackets[0]?.id || '';                 // primo = con la "corona"
  return { order, topId };
}, [brackets]);




  /* 6) Palette colori rapide */
  const COLOR_PRESETS: Array<{name:string; hex:string}> = [
    { name:'Bianco',   hex:'#ffffff' },
    { name:'Oro',      hex:'#FFD700' },
    { name:'Argento',  hex:'#C0C0C0' },
    { name:'Bronzo',   hex:'#CD7F32' },
    { name:'Legno',    hex:'#8E6E53' },
    { name:'Melma',    hex:'#14532d' },
    { name:'Galattico',hex:'#6D28D9' },
  ]

  /* 7) Layout SE */
  const svgRef = useRef<SVGSVGElement>(null)
  const seLayout = useMemo(() => {
    if (!active) return { nodes: [], rounds: 1, width: 0, height: 0, byRound: [] as Node[][], topOffset: 0, roundsCount: 1 }
    return buildSELayout(`${active.title}`, active.nTeams, 0, 0)
  }, [active?.title, active?.nTeams])

  /* Drawer “Vedi gironi” */
  const [showDrawer, setShowDrawer] = useState(false)
/* ============== RENDER ============== */
if (!loadedRemote) {
  // Evita il flash mentre carica da remoto
  return (
    <div className="p-4">
      <div className="card p-6 text-sm text-neutral-400">
        Caricamento tabelloni…
      </div>
    </div>
  )
}

if (!active) {
  return (
    <div className="p-4 space-y-3">
      <div className="card p-6 text-sm text-neutral-400">
        Nessun tabellone ancora presente per questa tappa.
        <div className="mt-3">
          <button className="btn" onClick={addBracket}>+ Aggiungi tabellone</button>
        </div>
      </div>
    </div>
  )
}

return (
  <div className="p-4 space-y-3">
    <style jsx global>{`
      .hide-letter { width:0!important; padding:0!important; margin:0!important; overflow:hidden!important; opacity:0!important; }
    `}</style>

    {/* Barra top (nuovo ordine + vicino a Tappa) */}
<div className="card p-3">
  <div className="flex flex-wrap items-end gap-2">
    {/* Tour */}
    <div>
      <div className="text-xs text-neutral-400 mb-1">Tour</div>
      <select
        className="input w-56 h-12 text-base"
        value={tourId}
        onChange={e=>{ setTourId(e.target.value); setTId('') }}
      >
        {tours.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    </div>

    {/* Tappa */}
    <div>
      <div className="text-xs text-neutral-400 mb-1">Tappa</div>
      <select
        className="input w-56 h-12 text-base"
        value={tId}
        onChange={e=>setTId(e.target.value)}
      >
        {tappe.map(t => (
          <option key={t.id} value={t.id}>
            {t.name}{t.date ? ` — ${new Date(t.date).toLocaleDateString()}` : ''}
          </option>
        ))}
      </select>
    </div>

    {/* Bottoni subito dopo Tappa, nell’ordine richiesto */}
    <button className="btn h-12" onClick={()=>setShowDrawer(true)}>Vedi gironi</button>
    <button className="btn h-12" onClick={removeBracket} disabled={locked}>Elimina tabellone</button>
    <button className="btn h-12" onClick={addBracket} disabled={locked}>+ Aggiungi tabellone</button>
<button
  className="btn h-12"
  onClick={() => {
    // prendi i meta reali dei gironi (key/size) se esistono
    const meta = loadGroupsLS(tourId, tId)

    // vogliamo salvare GroupMeta[] (non le posizioni A1/A2…)
    let groupsMeta: GroupMeta[] = []

    if (meta.length) {
      groupsMeta = [...meta].sort((a, b) => a.key.localeCompare(b.key))
    } else if (tappaSize > 0) {
      const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
      let remaining = tappaSize, li = 0
      while (remaining > 0) {
        const size = Math.min(4, remaining)
        const key = (letters[li] || `G${li + 1}`).toUpperCase()
        groupsMeta.push({ key, size })
        li++
        remaining -= size
      }
    }

    const av = Array.from({ length: Math.max(0, tappaSize) }, (_, i) => `${i + 1}`)

    saveSources(tourId, tId, {
      gironi: groupsMeta,
      avulsa: av,
      createdAt: new Date().toISOString(),
    })
  }}
>
  Rigenera sorgenti
</button>


    {/* Tab dei tabelloni (dopo i 3 bottoni) */}
    <div className="flex flex-wrap items-end gap-2">
      {brackets.map((b) => (
        <button
          key={b.id}
          className="btn"
          onClick={() => setActiveId(b.id)}
          style={b.id === activeId ? { outline: `2px solid ${b.color}`, outlineOffset: 2 } : {}}
          title={b.title}
        >
          {b.title}
         <span className="ml-2 text-[10px] opacity-60">
  L{bracketLevels.order[b.id] ?? 1}
</span>
{b.id === bracketLevels.topId && <span className="ml-1">👑</span>}

        </button>
      ))}
    </div>
  </div>
</div>


      {/* Header tabellone attivo */}
      <div className="card p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="text-xs text-neutral-400 mb-1">Titolo</div>
            <input className="input w-56 h-12 text-base" value={active.title} onChange={(e)=>patchActive({ title:e.target.value })} disabled={locked} />
          </div>
          <div>
            <div className="text-xs text-neutral-400 mb-1">Colore / preset</div>
            <div className="flex items-center gap-2">
              <input type="color" className="input w-28 h-12 p-1" value={active.color} onChange={(e)=>patchActive({ color:e.target.value })} disabled={locked} />
              <div className="flex flex-wrap gap-2">
                {COLOR_PRESETS.map(p => (
                  <button key={p.hex} className="h-9 px-2 rounded-md border border-neutral-700 text-[12px]" style={{ background:p.hex, color:'#000' }} onClick={()=>patchActive({ color:p.hex })} disabled={locked} title={p.name}>{p.name}</button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <div className="text-xs text-neutral-400 mb-1">Tipo</div>
           <select
  className="input w-56 h-12 text-base"
  value={active.type}
  onChange={(e)=>handleTypeChange(e.target.value as Bracket['type'])}
  disabled={locked}
>
  <option value="SE">Singola eliminazione</option>
  <option value="ITA">Girone all’italiana</option>
  <option value="DE">Doppia eliminazione (manuale)</option>
</select>

          </div>
          <div>
            <div className="text-xs text-neutral-400 mb-1"># Squadre</div>
            <input className="input w-28 h-12 text-base" type="number" min={2} max={16} step={1} value={active.nTeams} onChange={(e)=>ensureR1For(Math.max(2, Number(e.target.value)||2))} disabled={locked}/>
          </div>
          <div>
            <div className="text-xs text-neutral-400 mb-1">Provenienza</div>
            <select className="input w-56 h-12 text-base" value={active.source} onChange={(e)=>patchActive({ source: e.target.value as Bracket['source'] })}disabled={locked}>
              <option value="gironi">Gironi (A1, A2, …)</option>
              <option value="avulsa">Classifica avulsa (1, 2, …)</option>
              <option value="eliminati">Eliminati da tabellone</option>
              <option value="gironi+eliminati">Gironi + Eliminati</option>
<option value="avulsa+eliminati">Avulsa + Eliminati</option> 
            </select>
          </div>
          <div>
            <div className="text-xs text-neutral-400 mb-1">Da tabellone (per “Eliminati”)</div>
            <select className="input w-72 h-12 text-base" value={active.fromTableId || ''} onChange={(e)=>patchActive({ fromTableId: e.target.value || undefined })}disabled={locked}>
              <option value="">—</option>
              {brackets.filter((b)=>b.id!==active.id).map((b)=>(<option key={b.id} value={b.id}>{b.title}</option>))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2 ml-2 mt-3">
          <input id="thirdplace" type="checkbox" className="accent-white" checked={enableThirdPlace} onChange={(e)=>setEnableThirdPlace(e.target.checked)} disabled={locked} />
          <label htmlFor="thirdplace" className="text-sm">Match 3° / 4° posto</label>
        </div>
<div className="flex items-center gap-2 ml-2 mt-3">
  <input
    id="lock"
    type="checkbox"
    className="accent-white"
    checked={locked}
    onChange={e=>setLocked(e.target.checked)}
  />
  <label htmlFor="lock" className="text-sm">Blocca modifiche (solo lettura)</label>
</div>


        {/* Titolo grande colorato centrato */}
<div className="mt-4 flex justify-center">
  <div
    className="relative flex items-center justify-center text-center px-8 py-3 rounded-xl font-extrabold uppercase tracking-wide text-2xl md:text-3xl"
    style={{ background: active.color, color: '#000', minWidth: 380 }}
  >
    <span className="pointer-events-none">{active.title}</span>
    <span className="absolute -top-2 -right-2 text-[11px] px-2 py-[2px] rounded-md bg-neutral-900 border border-neutral-700">
      L{Math.max(0, brackets.findIndex(b => b.id === active.id)) + 1}
    </span>
  </div>
</div>



        <div className="mt-3 text-sm text-neutral-400">
          {groups.length
            ? <>Gironi caricati: {groups.map(g=>g.key).join(', ')} (N={groups.reduce((a,g)=>a+g.size,0)})</>
            : <>Nessun dato gironi trovato. Avulsa=N={tappaSize}</>
          }
        </div>
      </div>

      {/* === SE === */}
      {active.type === 'SE' && (
        <div className="relative card overflow-x-auto overflow-y-hidden" style={{ height: seLayout.height + 120 }}>
          <div className="relative" style={{ width: seLayout.width + HSCROLL_PAD, height: seLayout.height + 100 }}>
            {/* SVG connettori */}
            <svg ref={svgRef} width={seLayout.width} height={seLayout.height} className="absolute top-4 left-4" style={{ overflow: 'visible' }}>
              {seLayout.nodes.map((n, idx) => {
                if (n.round === 1) return null
                const A = seLayout.nodes[n.fromA!], B = seLayout.nodes[n.fromB!]
                const ca = centerOf(A), cb = centerOf(B), c = centerOf(n)
                const SHORT = Math.round(24 * (CARD_W / 224)) // 224 ≈ 320*0.7 di prima
const ENTER = Math.round(50 * (CARD_W / 224))
                const midAX = A.left + CARD_W + SHORT
                const midBX = B.left + CARD_W + SHORT
                const dstX  = n.left - ENTER
                return (
                  <g key={`ln-${idx}`} stroke={active.color} strokeWidth={3} fill="none">
                    <path d={`M ${A.left+CARD_W} ${ca.cy} H ${midAX} H ${dstX} V ${c.cy}`} />
                    <path d={`M ${B.left+CARD_W} ${cb.cy} H ${midBX} H ${dstX} V ${c.cy}`} />
                    <path d={`M ${dstX} ${c.cy} H ${n.left}`} />
                  </g>
                )
              })}
            </svg>

            {/* Cards */}
<div className="absolute top-4 left-4" style={{ width: seLayout.width, height: seLayout.height }}>
  {seLayout.nodes.map((n) => {
    if (n.round === 1) {
      const pair = n.mIndex
      const m = active.r1?.[pair] || { A: '-', B: '-' }
      return (
        <div key={n.id} className="absolute card p-3 shadow-lg" style={{ width: CARD_W, height: CARD_H, left: n.left, top: n.top }}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] uppercase opacity-70">{n.code} — {active.title}</div>
            <div className="text-[10px] opacity-50 font-mono">M{pair+1}</div>
          </div>

          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 text-xs opacity-70 hide-letter" aria-hidden>A</div>
            <select
              className="input flex-1 h-10"
              value={m.A}
              onChange={(e)=>setSlot(pair, 0, e.target.value)}
              disabled={locked}
            >
              <option value="-">—</option>
              <option value="BYE">BYE</option>
             {slotOptions.map(op => {
  const dis = isTakenElsewhere(op, {pair, side:0})
  return (
    <option key={`a-${pair}-${op}`} value={op} disabled={dis}>
     {op}{dis ? ' — X' : ''}
    </option>
  )
})}


            </select>
          </div>

          <div className="flex items-center gap-2">
            <div className="w-8 text-xs opacity-70 hide-letter" aria-hidden>B</div>

            <select
              className="input flex-1 h-10"
              value={m.B}
              onChange={(e)=>setSlot(pair, 1, e.target.value)}
              disabled={locked}
            >
              <option value="-">—</option>
              <option value="BYE">BYE</option>
             {slotOptions.map(op => {
  const dis = isTakenElsewhere(op, {pair, side:1})
  return (
    <option key={`b-${pair}-${op}`} value={op} disabled={dis}>
     {op}{dis ? ' — X' : ''}
    </option>
  )
})}


            </select>
          </div>
        </div>
      )
    }

    // round > 1
    const pA = seLayout.nodes[n.fromA!]
    const pB = seLayout.nodes[n.fromB!]
    return (
      <div key={n.id} className="absolute card p-4 shadow-lg flex flex-col justify-center" style={{ width: CARD_W, height: CARD_H, left: n.left, top: n.top }}>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] uppercase opacity-70">{n.code} — {active.title}</div>
          <div className="text-[10px] opacity-50 font-mono">M{n.mIndex+1}</div>
        </div>
        <div className="text-sm">Vincente {pA.code} — {active.title}</div>
        <div className="text-[13px] text-neutral-400 my-1">vs</div>
        <div className="text-sm">Vincente {pB.code} — {active.title}</div>
      </div>
    )
  })}
</div>



            {/* Finale → Vincitore + 3°/4° */}
            {seLayout.nodes.length > 0 && (() => {
              const final = seLayout.nodes[seLayout.nodes.length - 1]
              if (!final) return null
              const lineLeft  = final.left + CARD_W + SE_FINAL_TUNE.lineDX
              const lineTop   = final.top + SE_FINAL_TUNE.lineDY
              const lineWidth = SE_FINAL_TUNE.lineLEN
              const winnerLeft = lineLeft + lineWidth + 8 + SE_FINAL_TUNE.boxDX
              const winnerTop  = final.top + SE_FINAL_TUNE.boxDY

              const rounds = seLayout.byRound.length
              const semis  = seLayout.byRound[rounds - 2] || []
              const s1 = semis[0]?.code || 'SF1'
              const s2 = semis[1]?.code || 'SF2'

              return (
                <>
                  <svg width={lineWidth} height={CARD_H} className="absolute" style={{ left: lineLeft, top: lineTop }}>
                    <path d={`M 0 ${CARD_H/2} H ${lineWidth}`} stroke={active.color} strokeWidth={3} fill="none" />
                  </svg>
                  <div className="absolute card p-4 shadow-lg" style={{ width: CARD_W, height: CARD_H, left: winnerLeft, top: winnerTop }}>
                    <div className="text-[11px] uppercase opacity-70 mb-2">VINCITORE TORNEO</div>
                    <div className="text-sm text-neutral-300">Vincente {final.code} — {active.title}</div>
                  </div>
                  {enableThirdPlace && (
                    <div className="absolute card p-4 shadow-lg" style={{ width: CARD_W, height: CARD_H, left: final.left, top: final.top + CARD_H + 48 }}>
                      <div className="text-[11px] uppercase opacity-70 mb-2">3° / 4° posto — {active.title}</div>
                      <div className="text-sm text-neutral-300">Perdente {s1} — {active.title} vs Perdente {s2} — {active.title}</div>
                    </div>
                  )}
                </>
              )
            })()}
          </div>
        </div>
      )}

      {/* === ITA === */}
      {active.type === 'ITA' && (
        <div className="card p-3 space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="card p-3">
              <div className="font-semibold mb-2">Squadre</div>
              <div className="space-y-2">
                {Array.from({ length: active.nTeams }, (_, i) => i).map(i => (
                  <div key={`ita-s${i}`} className="flex items-center gap-2">
                    <div className="w-10 text-xs opacity-70">S{i+1}</div>
                    <select
  className="input flex-1 h-10"
  value={active.slots?.[i] ?? ''}
  onChange={(e)=>setItaSlot(i, e.target.value)}
  disabled={locked}
>
  <option value="">—</option>
  <option value="BYE">BYE</option>
  {slotOptions.map(op => (
    <option key={`ita-${i}-${op}`} value={op} disabled={isTakenElsewhere(op, { itaIndex:i })}>
      {op}{isTakenElsewhere(op, { itaIndex:i }) ? ' — X' : ''}
    </option>
  ))}
</select>

                  </div>
                ))}
              </div>
            </div>

            <div className="card p-3">
              <div className="font-semibold mb-2">Calendario (round-robin)</div>
              <div className="space-y-1 text-sm">
                {rr(active.nTeams).map(([a,b], idx) => (
                  <div key={`rr-${idx}`} className="border-b border-neutral-800 pb-1">
                    G{idx+1}: <span className="font-mono">{active.slots[a-1] || `S${a}`}</span> vs <span className="font-mono">{active.slots[b-1] || `S${b}`}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-[11px] text-neutral-500">NB: i risultati si gestiscono in <b>/admin/risultati</b>.</div>
            </div>
          </div>
        </div>
      )}

      {/* === DE — MANUALE (5–8 squadre) === */}
      {active.type === 'DE' && active.nTeams <= 8 && (() => {
        const SC = buildDEManual58(active.title)
        const ALL = [...SC.WINNERS, ...SC.LOSERS, ...SC.CO_FINAL]
        const MAP = toMap(ALL)
        const { w, h } = sizeFromBoxes(ALL)

        // Etichette dinamiche (sopra al primo box della sezione)
        const winnersTopLabel = Math.min(...SC.WINNERS.map(b=>b.top), 0) - 24
        const losersTopLabel  = Math.min(...SC.LOSERS.map(b=>b.top), 0) - 24

         return (
          <div className="relative card overflow-x-auto overflow-y-auto" style={{ height: h + 120 }}>
            <div className="relative" style={{ width: w + HSCROLL_PAD, height: h + 100 }}>
              {/* Etichette sezione */}
              <div className="absolute top-2 left-6 text-xs font-semibold text-neutral-400 tracking-widest">WINNERS</div>
              <div className="absolute text-xs font-semibold text-neutral-400 tracking-widest" style={{ top: 740, left: 24 }}>LOSERS</div>
              {/* BOX WINNERS: R1..R4 con select; Z1/Z2/Y1/Y2 informativi */}
              {SC.WINNERS.map(b => {
                if (b.code === 'R1' || b.code === 'R2' || b.code === 'R3' || b.code === 'R4') {
                  const pairIndex = ({R1:0,R2:1,R3:2,R4:3} as any)[b.code] ?? 0
                  const cur = active.r1?.[pairIndex] ?? {A:'-',B:'-'}
                  return (
                    <DESelectBox
                      key={b.code}
                      code={`${b.code} — ${active.title}`}
                      title={b.title}
                      left={b.left}
                      top={b.top}
                      pairIndex={pairIndex}
                      valueA={cur.A}
                      valueB={cur.B}
                      onChangeA={(v)=>setSlot(pairIndex, 0, v)}
                      onChangeB={(v)=>setSlot(pairIndex, 1, v)}
                      slotOptions={slotOptions}
                      disabledCheck={(op,ctx)=>isTakenElsewhere(op, ctx)}
locked={locked}
 labeler={(op) => op}
                    />
                  )
                }
                return <InfoBox key={b.code} b={{...b, title: `${b.title}`}} />
              })}

              {/* BOX LOSERS */}
              {SC.LOSERS.map(b => <InfoBox key={b.code} b={b} />)}

              {/* CO + FINALE + WIN + (3/4 opzionale) */}
              {SC.CO_FINAL.filter(b => b.code !== 'THIRD').map(b => <InfoBox key={b.code} b={b} />)}
              {enableThirdPlace && (() => {
                const t = SC.CO_FINAL.find(x=>x.code==='THIRD'); return t ? <InfoBox b={t} /> : null
              })()}

              {/* LINEE MANUALI — lascia vuoto e usa gli esempi qui sotto */}
              <svg width={w} height={h} className="absolute top-0 left-0 pointer-events-none" style={{ overflow:'visible' }}>
                {/* =========================================================
                   ESEMPI PRONTI (copiabili/incollabili).
                   Togli i commenti e adatta i codici/offset.
                   Usa RIGHT/LEFT/TOP/BOTTOM/CX/CY con MAP per ancorarti ai box.
                   ========================================================= */}

{/* R1 → Z1 */}
<HLine
  x1={RIGHT(MAP,'R1')}
  y={CY(MAP,'R1')}
  x2={(LEFT(MAP,'Z1') + RIGHT(MAP,'R1'))/2 - -18}
  color={active.color}
/>
<VLine
  x={(LEFT(MAP,'Z1') + RIGHT(MAP,'R1'))/2 - -18}
  y1={CY(MAP,'R1')}
  y2={CY(MAP,'Z1')}
  color={active.color}
/>
<HLine
  x1={(LEFT(MAP,'Z1') + RIGHT(MAP,'R1'))/2 - -18}
  y={CY(MAP,'Z1')}
  x2={LEFT(MAP,'Z1')}
  color={active.color}
/>

{/* R2 → Z1 */}
<HLine
  x1={RIGHT(MAP,'R2')}
  y={CY(MAP,'R2')}
  x2={(LEFT(MAP,'Z1') + RIGHT(MAP,'R2'))/2 +18}
  color={active.color}
/>
<VLine
  x={(LEFT(MAP,'Z1') + RIGHT(MAP,'R2'))/2 +18}
  y1={CY(MAP,'R2')}
  y2={CY(MAP,'Z1')}
  color={active.color}
/>
{/* R3 → Z2 */}
<HLine
  x1={RIGHT(MAP,'R3')}
  y={CY(MAP,'R3')}
  x2={(LEFT(MAP,'Z2') + RIGHT(MAP,'R3'))/2 +18}
  color={active.color}
/>
<VLine
  x={(LEFT(MAP,'Z2') + RIGHT(MAP,'R3'))/2 +18}
  y1={CY(MAP,'R3')}
  y2={CY(MAP,'Z2')}
  color={active.color}
/>
<HLine
  x1={(LEFT(MAP,'Z2') + RIGHT(MAP,'R3'))/2 +18}
  y={CY(MAP,'Z2')}
  x2={LEFT(MAP,'Z2')}
  color={active.color}
/>

{/* R4 → Z2 (uso un midX diverso per non sovrapporre le due verticali) */}
<HLine
  x1={RIGHT(MAP,'R4')}
  y={CY(MAP,'R4')}
  x2={(LEFT(MAP,'Z2') + RIGHT(MAP,'R4'))/2 +18}
  color={active.color}
/>
<VLine
  x={(LEFT(MAP,'Z2') + RIGHT(MAP,'R4'))/2 +18}
  y1={CY(MAP,'R4')}
  y2={CY(MAP,'Z2')}
  color={active.color}
/>

{/* X1 → X3 */}
{(() => {
  const mid = (RIGHT(MAP,'X1') + LEFT(MAP,'X3')) / 2 - 24;
  return (
    <>
      <HLine x1={RIGHT(MAP,'X1')} y={CY(MAP,'X1')} x2={mid} color={active.color} />
      <VLine x={mid} y1={CY(MAP,'X1')} y2={CY(MAP,'X3')} color={active.color} />
      <HLine x1={mid} y={CY(MAP,'X3')} x2={LEFT(MAP,'X3')} color={active.color} />
    </>
  )
})()}

{/* X2 → X4 */}
{(() => {
  const mid = (RIGHT(MAP,'X2') + LEFT(MAP,'X4')) / 2 + 24;
  return (
    <>
      <HLine x1={RIGHT(MAP,'X2')} y={CY(MAP,'X2')} x2={mid} color={active.color} />
      <VLine x={mid} y1={CY(MAP,'X2')} y2={CY(MAP,'X4')} color={active.color} />
      <HLine x1={mid} y={CY(MAP,'X4')} x2={LEFT(MAP,'X4')} color={active.color} />
    </>
  )
})()}

{/* Z1 → Y1 */}
{(() => {
  const mid = (RIGHT(MAP,'Z1') + LEFT(MAP,'Y1')) / 2; // sposta ± per regolare il gomito
  return (
    <>
      <HLine x1={RIGHT(MAP,'Z1')} y={CY(MAP,'Z1')} x2={mid} color={active.color} />
      <VLine x={mid} y1={CY(MAP,'Z1')} y2={CY(MAP,'Y1')} color={active.color} />
      <HLine x1={mid} y={CY(MAP,'Y1')} x2={LEFT(MAP,'Y1')} color={active.color} />
    </>
  )
})()}

{/* Z2 → Y2 */}
{(() => {
  const mid = (RIGHT(MAP,'Z2') + LEFT(MAP,'Y2')) / 2;
  return (
    <>
      <HLine x1={RIGHT(MAP,'Z2')} y={CY(MAP,'Z2')} x2={mid} color={active.color} />
      <VLine x={mid} y1={CY(MAP,'Z2')} y2={CY(MAP,'Y2')} color={active.color} />
      <HLine x1={mid} y={CY(MAP,'Y2')} x2={LEFT(MAP,'Y2')} color={active.color} />
    </>
  )
})()}

{/* Q1 → W1 (gomito leggermente a sinistra per non sovrapporre) */}
{(() => {
  const mid = (RIGHT(MAP,'Q1') + LEFT(MAP,'W1')) / 2 + 18;
  return (
    <>
      <HLine x1={RIGHT(MAP,'Q1')} y={CY(MAP,'Q1')} x2={mid} color={active.color} />
      <VLine x={mid} y1={CY(MAP,'Q1')} y2={CY(MAP,'W1')} color={active.color} />
      <HLine x1={mid} y={CY(MAP,'W1')} x2={LEFT(MAP,'W1')} color={active.color} />
    </>
  )
})()}

{/* X3 → W1 (può sovrapporsi; gomito spostato a destra) */}
{(() => {
  const mid = (RIGHT(MAP,'X3') + LEFT(MAP,'W1')) / 2 + 18;
  return (
    <>
      <HLine x1={RIGHT(MAP,'X3')} y={CY(MAP,'X3')} x2={mid} color={active.color} />
      <VLine x={mid} y1={CY(MAP,'X3')} y2={CY(MAP,'W1')} color={active.color} />
      <HLine x1={mid} y={CY(MAP,'W1')} x2={LEFT(MAP,'W1')} color={active.color} />
    </>
  )
})()}

{/* X4 → W2 */}
{(() => {
  const mid = (RIGHT(MAP,'X4') + LEFT(MAP,'W2')) / 2 + 18;
  return (
    <>
      <HLine x1={RIGHT(MAP,'X4')} y={CY(MAP,'X4')} x2={mid} color={active.color} />
      <VLine x={mid} y1={CY(MAP,'X4')} y2={CY(MAP,'W2')} color={active.color} />
      <HLine x1={mid} y={CY(MAP,'W2')} x2={LEFT(MAP,'W2')} color={active.color} />
    </>
  )
})()}

{/* Q2 → W2 */}
{(() => {
  const mid = (RIGHT(MAP,'Q2') + LEFT(MAP,'W2')) / 2 + 18;
  return (
    <>
      <HLine x1={RIGHT(MAP,'Q2')} y={CY(MAP,'Q2')} x2={mid} color={active.color} />
      <VLine x={mid} y1={CY(MAP,'Q2')} y2={CY(MAP,'W2')} color={active.color} />
      <HLine x1={mid} y={CY(MAP,'W2')} x2={LEFT(MAP,'W2')} color={active.color} />
    </>
  )
})()}

{/* CO1 → F */}
{(() => {
  const mid = (RIGHT(MAP,'CO1') + LEFT(MAP,'F')) / 2 + 18; // regola ± per spostare il gomito
  return (
    <>
      <HLine x1={RIGHT(MAP,'CO1')} y={CY(MAP,'CO1')} x2={mid} color={active.color} />
      <VLine x={mid} y1={CY(MAP,'CO1')} y2={CY(MAP,'F')} color={active.color} />
      <HLine x1={mid} y={CY(MAP,'F')} x2={LEFT(MAP,'F')} color={active.color} />
    </>
  )
})()}

{/* CO2 → F */}
{(() => {
  const mid = (RIGHT(MAP,'CO2') + LEFT(MAP,'F')) / 2 + 18; // regola ± per evitare sovrapposizioni
  return (
    <>
      <HLine x1={RIGHT(MAP,'CO2')} y={CY(MAP,'CO2')} x2={mid} color={active.color} />
      <VLine x={mid} y1={CY(MAP,'CO2')} y2={CY(MAP,'F')} color={active.color} />
      <HLine x1={mid} y={CY(MAP,'F')} x2={LEFT(MAP,'F')} color={active.color} />
    </>
  )
})()}


                {/* 9) F → WIN (attiva di default sotto) */}
                <HLine x1={RIGHT(MAP,'F')} y={CY(MAP,'F')} x2={LEFT(MAP,'WIN')} color={active.color} />
              </svg>
            </div>
          </div>
        )
      })()}

      {/* === DE 9–16 (placeholder minimo) === */}
      {active.type === 'DE' && active.nTeams > 8 && (
        <div className="card p-4">
          <div className="text-sm opacity-80">
            Layout manuale dettagliato per 9–16 non incluso in questa versione. Possiamo aggiungerlo come secondo schema manuale appena finiamo il 5–8. 🙂
          </div>
        </div>
      )}

      {/* Drawer “vedi gironi” */}
      {showDrawer && (
        <div className="fixed inset-0 z-50" onClick={()=>setShowDrawer(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="absolute right-0 top-0 h-full w-[380px] bg-neutral-900 border-l border-neutral-800 p-3 space-y-3" onClick={(e)=>e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="font-semibold">Gironi — nomi & posizioni</div>
              <button className="btn" onClick={()=>setShowDrawer(false)}>Chiudi</button>
            </div>
            <div className="text-xs space-y-3">
         {(() => {
  const gir = realGironiCodes
  if (!gir.length) {
    return <div>Nessun girone trovato. Apri <b>/admin/gironi</b> e salva la tappa.</div>
  }

  // raggruppo per lettera
  const byLetter = gir.reduce<Record<string,string[]>>((acc, code) => {
    const L = code.replace(/(\d+)$/, '')
    acc[L] = acc[L] || []
    acc[L].push(code)
    return acc
  }, {})

  const letters = Object.keys(byLetter).sort()

  return (
    <>
      <div className="text-xs font-semibold mb-1">Gironi (posizioni + nomi)</div>
      <div className="max-h-96 overflow-auto pr-1 space-y-3">
        {letters.map(L => (
          <div key={L}>
            {/* header girone più marcato */}
            <div className="sticky top-0 z-10 bg-neutral-900 py-1 border-y border-neutral-700 mb-1">
              <span className="text-xs font-bold">Girone {L}</span>
            </div>
            <ul className="text-xs space-y-1">
              {byLetter[L].map(code => (
                <li key={code} className="flex items-center gap-2 border-b border-neutral-800 pb-1">
                  <span className="font-mono w-10">{code}</span>
                  <span className="truncate">{namesBySlot[code] || '—'}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </>
  )
})()}

            </div>
          </div>
        </div>
      )}
    </div>
  )
}
