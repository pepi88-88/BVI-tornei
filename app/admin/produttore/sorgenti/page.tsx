'use client'

/**
 * app/admin/produttore/sorgenti/page.tsx
 * ------------------------------------------------------------------
 * Sorgenti “centrale tecnica” (sola lettura + autosnapshot)
 *  - Gironi: meta (lettere+size) da /admin/gironi (varie chiavi note)
 *  - Avulsa: classifica da /admin/risultati (varie chiavi note) o fallback iscritti
 *  - Nuovo: Gironi con cognomi + Classifiche per girone leggendo gm:${tappa}
 *  - Snapshot automatico in localStorage: sources:${tour}:${tappa}
 * ------------------------------------------------------------------
 */

import { useEffect, useMemo, useRef, useState } from 'react'

/* ==============================
   SEZIONE 1 — util & formati
   ============================== */

type GroupMeta = { key: string; size: number }
type Sources = { gironi: string[]; avulsa: string[]; createdAt: string }

// struttura gm salvata da /admin/gironi (e letta anche da /admin/risultati)
type GmStore = {
  groupsCount: number
  meta: Record<string, { capacity: number; format?: "pool" | "ita" }>
  assign: Record<string, any>
  labels: Record<string, any>
}
type Score = { a: string; b: string }            // punteggi salvati in gm:${tId}:scores

const keySources = (tour: string, tappa: string) => `sources:${tour}:${tappa}`

/** Chiavi possibili dove la pagina /admin/gironi potrebbe aver salvato la meta */
const GROUP_KEYS = [
  (tour: string, tappa: string) => `groups:${tour}:${tappa}`,
  (tour: string, tappa: string) => `gironi:${tour}:${tappa}`,
  (tour: string, tappa: string) => `gironi_meta:${tour}:${tappa}`,
  (_tour: string, tappa: string) => `meta_gironi_${tappa}`,
  (tour: string, tappa: string) => `gironi_meta_${tour}_${tappa}`,
]

/** Chiavi plausibili per una classifica Avulsa salvata dalla pagina risultati */
const AVULSA_KEYS = [
  (tour: string, tappa: string) => `avulsa:${tour}:${tappa}`,
  (tour: string, tappa: string) => `classifica_avulsa:${tour}:${tappa}`,
  (_tour: string, tappa: string) => `avulsa:${tappa}`,
]

function saveSources(tour: string, tappa: string, s: Sources) {
  try { localStorage.setItem(keySources(tour, tappa), JSON.stringify(s)) } catch {}
}
function loadSources(tour: string, tappa: string): Sources | null {
  try {
    const raw = localStorage.getItem(keySources(tour, tappa))
    return raw ? JSON.parse(raw) as Sources : null
  } catch { return null }
}
/** compatta etichetta iscrizione in "CognomeA / CognomeB" */
function compactLabel(label: string) {
  // riuso la tua pairFromLabelString
  return pairFromLabelString(label)
}

/** costruisce labels id->nome dagli iscritti della tappa */
async function labelsFromRegistrations(tappaId: string): Promise<Record<string, string>> {
  try {
    const r = await fetch(`/api/registrations/by-tournament?tournament_id=${tappaId}`)
    const j = await r.json()
    const items = Array.isArray(j?.items) ? j.items : []
    const out: Record<string, string> = {}
    for (const x of items) {
      const id = String(x.id || '').trim()
      const lab = compactLabel(String(x.label || ''))
      if (id && lab) out[id] = lab
    }
    return out
  } catch { return {} }
}

/** normalizza assign/labels; se mancano labels per qualche id, prova a ricostruirli dagli iscritti */
async function normalizeGm(gm: GmStore, tappaId: string): Promise<GmStore> {
  const assign: Record<string, string> = {}
  for (const [k, v] of Object.entries(gm.assign || {})) {
    if (!k) continue
    assign[String(k).trim()] = String(v ?? '').trim()
  }

  // normalizza chiavi labels a stringhe trim
  const labels: Record<string, string> = {}
  for (const [k, v] of Object.entries(gm.labels || {})) {
    const key = String(k).trim()
    const val = compactLabel(String(v || ''))
    if (key && val) labels[key] = val
  }

  // completa eventuali buchi con gli iscritti
  const needIds = new Set<string>()
  for (const rid of Object.values(assign)) if (rid && !labels[rid]) needIds.add(rid)
  if (needIds.size) {
    const fromRegs = await labelsFromRegistrations(tappaId)
    for (const id of needIds) if (fromRegs[id]) labels[id] = fromRegs[id]
  }

  return { ...gm, assign, labels }
}

/* ==============================
   SEZIONE 2 — loader locali/API
   ============================== */

/** Meta gironi (solo lettere+size) letta da localStorage (prova più chiavi/forme) */
function loadGroupsLS(tour: string, tappa: string): GroupMeta[] {
  for (const k of GROUP_KEYS) {
    try {
      const raw = localStorage.getItem(k(tour, tappa))
      if (!raw) continue
      const j = JSON.parse(raw)

      // array di record { key, size|teams }
      if (Array.isArray(j) && j.length && j[0]?.key && (j[0]?.size ?? j[0]?.teams)) {
        return j.map((r: any) => ({
          key: String(r.key).toUpperCase(),
          size: Number(r.size ?? r.teams) || 0,
        })) as GroupMeta[]
      }

      // mappa lettera->numero  { A:3, B:4, ... } oppure { A:[..], B:[..] }
      if (j && typeof j === 'object' && !Array.isArray(j)) {
        const entries = Object.entries(j)

        // caso numeri
        const numeric = entries.filter(([, v]) => typeof v === 'number')
        if (numeric.length) {
          return numeric.map(([key, size]) => ({
            key: String(key).toUpperCase(),
            size: Number(size) || 0,
          })).filter(g => g.size > 0)
        }

        // caso array (assegnazioni salvate)  { A:[..], B:[..] }
        const arrays = entries.filter(([, v]) => Array.isArray(v))
        if (arrays.length) {
          return arrays.map(([key, list]) => ({
            key: String(key).toUpperCase(),
            size: Array.isArray(list) ? list.length : 0,
          })).filter(g => g.size > 0)
        }
      }
    } catch {}
  }
  return []
}
/** Loader consolidato: legge dallo stesso endpoint usato da /admin/gironi */
async function loadFromSupabase(tappaId: string): Promise<{
  meta: Record<string, { capacity: number, format?: 'pool'|'ita' }>,
  assign: Record<string, string>,
  labels: Record<string, string>,
  groupsCount?: number,
}> {
  if (!tappaId) return { meta:{}, assign:{}, labels:{} }
  try {
    const r = await fetch(`/api/groups/state?tournament_id=${encodeURIComponent(tappaId)}`, {
      headers: { 'x-role': 'admin' },
      cache: 'no-store',
    })
    if (!r.ok) return { meta:{}, assign:{}, labels:{} }
    const j = await r.json()
    const st = j?.state || j || {}
    return {
      meta:   st?.meta   || {},
      assign: st?.assign || {},
      labels: st?.labels || {},
      groupsCount: st?.groupsCount,
    }
  } catch {
    return { meta:{}, assign:{}, labels:{} }
  }
}



/** Classifica Avulsa letta da localStorage (varie chiavi) */
function loadAvulsaLS(tour: string, tappa: string): string[] {
  for (const k of AVULSA_KEYS) {
    try {
      const raw = localStorage.getItem(k(tour, tappa))
      if (!raw) continue
      const j = JSON.parse(raw)
      if (Array.isArray(j) && j.every(x => typeof x === 'string')) {
        const cleaned = j.map(s => s.trim()).filter(Boolean)
        return Array.from(new Set(cleaned))
      }
    } catch {}
  }
  return []
}

/** Iscritti tappa (fallback per Avulsa) */
async function fetchRegistrations(tId: string) {
  if (!tId) return []
  try {
    const r = await fetch(`/api/registrations/by-tournament?tournament_id=${tId}`)
    const j = await r.json()
    return Array.isArray(j?.items) ? j.items : []
  } catch { return [] }
}

/** “CognomeA / CognomeB” da stringhe eterogenee */
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

/** “CognomeA / CognomeB” da un item registrations (label o oggetti) — usata solo per fallback Avulsa */
function labelSurnamesFromRegistration(reg: any): string {
  const LN = ['cognome','surname','last_name','lastName','family_name']
  const FN = ['nome','first_name','name','firstName','given_name']
  const lastFromString = (s: any) => pairFromLabelString(String(s ?? ''))
  const lastFromObj = (p: any): string => {
    if (!p) return ''
    if (typeof p === 'string') return lastFromString(p)
    for (const k of LN) if (p[k]) return String(p[k])
    for (const k of [...FN, 'full_name', 'display_name']) if (p[k]) return lastFromString(p[k])
    return ''
  }
  const a =
    lastFromObj(reg.player_a) || lastFromObj(reg.playerA) ||
    lastFromObj(reg.a)        || lastFromObj(reg.pa)      ||
    lastFromString(reg?.label?.split('—')[0]?.split('/')?.[0])
  const b =
    lastFromObj(reg.player_b) || lastFromObj(reg.playerB) ||
    lastFromObj(reg.b)        || lastFromObj(reg.pb)      ||
    lastFromString(reg?.label?.split('—')[1]?.split('/')?.[0])
  return [a,b].filter(Boolean).join(' / ')
}

/* ---- Loader gm store / scores (da /admin/gironi & /admin/risultati) -------- */
function loadGmStore(tappaId: string): GmStore | null {
  try {
    const raw = localStorage.getItem(`gm:${tappaId}`)
    return raw ? JSON.parse(raw) as GmStore : null
  } catch { return null }
}
function loadScores(tappaId: string): Record<string, Score[]> {
  try {
    const raw = localStorage.getItem(`gm:${tappaId}:scores`)
    const js = raw ? JSON.parse(raw) : {}
    return js && typeof js === 'object' ? js : {}
  } catch { return {} }
}
function metaFromGm(gm: GmStore | null): GroupMeta[] {
  if (!gm || !gm.meta) return []
  return Object.entries(gm.meta)
    .map(([key, v]) => ({ key: String(key).toUpperCase(), size: Number(v?.capacity ?? 0) || 0 }))
    .filter(g => g.size > 0)
    .sort((a, b) => a.key.localeCompare(b.key))
}

function metaFromAssign(gm: GmStore | null): GroupMeta[] {
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


/* ==============================
   SEZIONE 3 — fetch Tour/Tappe
   ============================== */

async function fetchTours() {
  try {
    const r = await fetch('/api/tours')
    const j = await r.json()
    return Array.isArray(j?.items) ? j.items : []
  } catch { return [] }
}

/**
 * Prova più endpoint/parametri per ottenere le tappe del tour.
 * Ritorna sempre { items, error, tried } così possiamo mostrare diagnostica.
 */
async function fetchTappe(tourId: string): Promise<{ items: any[]; error: string | null; tried: string[] }> {
  if (!tourId) return { items: [], error: null, tried: [] }

  // Provo più varianti di endpoint/parametri e con header ruolo admin
  const urls = [
    `/api/tournaments/by-tour?tour_id=${encodeURIComponent(tourId)}`,
    `/api/tournaments?tour_id=${encodeURIComponent(tourId)}`,
    `/api/tournaments/by-tour?tourId=${encodeURIComponent(tourId)}`,
    // fallback “grezzo”: prendo tutte le tappe e filtro lato client
    `/api/tournaments`
  ]

  const tried: string[] = []
  let lastErr: string | null = null
  let collectedAll: any[] | null = null

  for (const u of urls) {
    tried.push(u)
    try {
      const r = await fetch(u, { headers: { 'x-role': 'admin' }, cache: 'no-store' })
      if (!r.ok) { lastErr = `${r.status} ${r.statusText} @ ${u}`; continue }
      const j = await r.json()

      // normalizzo i risultati
      const arr = Array.isArray(j) ? j
        : Array.isArray(j?.items) ? j.items
        : Array.isArray(j?.data) ? j.data
        : []

      // se ho chiamato l’ultimo endpoint “grezzo”, salvo l’intera lista per un filtraggio client
      if (u === '/api/tournaments') {
        collectedAll = arr
        break
      }

      if (arr.length) {
        return { items: arr, error: null, tried }
      }
    } catch (e: any) {
      lastErr = `${String(e)} @ ${u}`
      continue
    }
  }

  // Fallback: ho preso tutte le tappe, filtro lato client se hanno un campo tour_id/tourId
  if (Array.isArray(collectedAll) && collectedAll.length) {
    const items = collectedAll.filter((x: any) => {
      const tid = x?.tour_id ?? x?.tourId
      return !tid || String(tid) === String(tourId) // se manca tour_id le mostro comunque
    })
    return { items, error: null, tried }
  }

  return { items: [], error: lastErr ?? 'no data', tried }
}

/* ==============================
   SEZIONE 4 — Pagina
   ============================== */

export default function SorgentiProduttore() {
  const [tours, setTours] = useState<any[]>([])
  const [tappe, setTappe] = useState<any[]>([])
  const [tourId, setTourId] = useState<string>('')
  const [tappaId, setTappaId] = useState<string>('')

  const [groups, setGroups] = useState<GroupMeta[] | null>(null)
  const [avulsa, setAvulsa]   = useState<string[] | null>(null)
  const [snapTs, setSnapTs]   = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
const gironiRef = useRef<HTMLDivElement | null>(null)

  // errori/diagnostica tappe
  const [tappeErr, setTappeErr] = useState<string | null>(null)
  const [tappeTried, setTappeTried] = useState<string[]>([])

  // reload manuale + diagnostica
  const [reloadKey, setReloadKey] = useState(0)
  const [showDiag, setShowDiag] = useState(false)

  // gm store (per nuove tabelle)
  const [gm, setGm] = useState<GmStore | null>(null)
  const [scores, setScores] = useState<Record<string, Score[]>>({})

  // carica tours
  useEffect(() => {
    let alive = true
    ;(async () => {
      const ts = await fetchTours()
      if (!alive) return
      setTours(ts)
      if (!tourId && ts[0]?.id) setTourId(ts[0].id)
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
// carica tappe al cambio tour (filtra chiuse)  ✅ FIX
useEffect(() => {
  let alive = true
  ;(async () => {
    if (!tourId) { setTappe([]); setTappaId(''); return }
    const { items, error, tried } = await fetchTappe(tourId)
    if (!alive) return
    const vis = (items || []).filter((x: any) => String(x?.status || '').toLowerCase() !== 'closed')
    setTappe(vis)
    setTappeErr(error)
    setTappeTried(tried)
    // se non ho una tappa selezionata, prendo la prima disponibile
    if (!tappaId && vis[0]?.id) setTappaId(vis[0].id)
  })()
  return () => { alive = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [tourId])


 // carica tappe al cambio tour (filtra chiuse)
useEffect(() => {
  let alive = true
  ;(async () => {
    if (!tourId || !tappaId) return
    setLoading(true)

    // A) carico subito gm e scores (così posso derivare la meta se mancano le vecchie chiavi)
 const gmFromSb = await loadFromSupabase(tappaId)
let gmStore: GmStore = {
  groupsCount: gmFromSb.groupsCount ?? Object.keys(gmFromSb.meta || {}).length,
  meta: gmFromSb.meta || {},
  assign: gmFromSb.assign || {},
  labels: gmFromSb.labels || {},
}
gmStore = await normalizeGm(gmStore, tappaId)

const scr = loadScores(tappaId)
if (alive) { setGm(gmStore); setScores(scr) }


    // B) snapshot esistente (solo per mostrare timestamp)
    const snap = loadSources(tourId, tappaId)
    if (snap && alive) {
      setSnapTs(snap.createdAt)
    }

   // C) GIRONI — prova chiavi legacy; poi gm.meta; poi deriva da gm.assign
const legacyMeta = loadGroupsLS(tourId, tappaId)
let groupsMeta = legacyMeta.length ? legacyMeta : metaFromGm(gmStore)
if (!groupsMeta.length) groupsMeta = metaFromAssign(gmStore)
if (alive) setGroups(groupsMeta.length ? groupsMeta : [])
// D) AVULSA — preferisco NOMI. 1) provo LS; 2) se vuoto, uso labels di gm; 3) ultimo fallback: iscritti
let avNames: string[] = loadAvulsaLS(tourId, tappaId)

// Se vuoto, prova dai labels (ordine alfabetico per coerenza)
if (!avNames.length && gmStore?.labels && Object.keys(gmStore.labels).length) {
  avNames = Object.values(gmStore.labels).map(pairFromLabelString).filter(Boolean).sort((a,b)=>a.localeCompare(b))
}

// Se ancora vuoto, fallback iscritti
if (!avNames.length) {
  const regs = await fetchRegistrations(tappaId)
  avNames = Array.isArray(regs) ? regs.map(labelSurnamesFromRegistration).filter(Boolean) : []
}

// Mostra NOMI in UI
if (alive) setAvulsa(avNames)

    // E) salva lo snapshot SOLO se ho qualcosa (gironi o avulsa)
   if (alive) {
  const createdAt = new Date().toISOString()
  saveSources(tourId, tappaId, {
    gironi: expandGironi(groupsMeta),
    avulsa: avulsa ?? [], // ✅ garantisce string[]
    createdAt
  })
  setSnapTs(createdAt)
}


    if (alive) setLoading(false)
  })()
  return () => { alive = false }
}, [tourId, tappaId, reloadKey])


  // espande meta gironi in lista posizioni esistenti (A1..An, B1..Bn, …)
  const gironiPositions = useMemo(() => expandGironi(groups ?? []), [groups])

  // lettere effettive da mostrare nelle nuove tabelle (priorità meta gm)
const letters = useMemo(() => {
  const set = new Set<string>()

  // 1) da meta: prendi solo L con capacity > 0
  if (gm?.meta) {
    for (const [k, v] of Object.entries(gm.meta)) {
      if (Number(v?.capacity) > 0) set.add(k.toUpperCase())
    }
  }

  // 2) da assign: se c'è almeno uno slot assegnato in L
  if (gm?.assign) {
    for (const key of Object.keys(gm.assign)) {
      const m = key.match(/^([A-Za-z]+)-\d+$/)
      if (m) set.add(m[1].toUpperCase())
    }
  }

  // 3) fallback legacy (LS)
  if (groups?.length) {
    for (const g of groups) if ((g?.size ?? 0) > 0) set.add(String(g.key).toUpperCase())
  }

  const all = Array.from(set).sort()

  // 4) limita al groupsCount DEFINITO in creazione gironi (se presente)
  const n = Number(gm?.groupsCount || 0)
  if (n > 0 && all.length > n) return all.slice(0, n)

  return all
}, [gm, groups])



  // size di un girone (preferisco gm.meta.capacity, altrimenti meta LS)
 const sizeOf = (L: string) => {
  const s = gm?.meta?.[L]?.capacity
  if (typeof s === 'number' && s > 0) return s

  if (gm?.assign) {
    let max = 0
    for (const k of Object.keys(gm.assign)) {
      const m = k.match(/^([A-Za-z]+)-(\d+)$/)
      if (m && m[1].toUpperCase() === L.toUpperCase()) {
        const slot = Number(m[2] || 0)
        if (slot > max) max = slot
      }
    }
    if (max > 0) return max
  }

  const rec = (groups ?? []).find(g => g.key.toUpperCase() === L.toUpperCase())
  return rec?.size ?? 0
}


// conteggio gironi e mappa L -> size
const groupsMap = useMemo(() => {
  const out: Record<string, number> = {}
  for (const L of letters) out[L] = sizeOf(L)
  return out
}, [letters, gm, groups])

const groupsCount = useMemo(() => Object.keys(groupsMap).length, [groupsMap])

  // label coppia da assegnazioni gm
function labelBySlot(L: string, slot: number): string {
  const rid = gm?.assign?.[`${L}-${slot}`]
  if (!rid) return ''
  const key = String(rid).trim()
  const raw = gm?.labels?.[key]
  if (raw) return pairFromLabelString(String(raw))
  // fallback: match chiave equivalente
  if (gm?.labels) {
    for (const [k, v] of Object.entries(gm.labels)) {
      if (String(k).trim() === key) return pairFromLabelString(String(v))
    }
  }
  return ''
}


  /* -------------------- helpers per classifiche per girone -------------------- */
  // round-robin fino a 6 team
  function rr(n: number) {
    const t = Array.from({ length: n }, (_, i) => i + 1)
    if (t.length < 2) return [] as Array<[number, number]>
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
  const poolPairs = { semi1: [1,4] as [number,number], semi2: [2,3] as [number,number] }

  function scheduleRows(L:string) {
    const cap = sizeOf(L)
    const fmt = (gm?.meta?.[L]?.format ?? 'pool') as 'pool'|'ita'
    if (cap < 2) return [] as Array<{ a?:number; b?:number }>
    if (fmt === 'pool' && cap === 4) {
      return [
        { a: poolPairs.semi1[0], b: poolPairs.semi1[1] },
        { a: poolPairs.semi2[0], b: poolPairs.semi2[1] },
        { a: undefined, b: undefined }, // F12 (derivata)
        { a: undefined, b: undefined }, // F34 (derivata)
      ]
    }
    return rr(Math.min(cap,6)).map(([a,b]) => ({ a, b }))
  }

  type TeamStat = { slot:number; label:string; W:number; PF:number; PS:number; QP:number; finish?: number }
  function computeStatsFor(L:string): TeamStat[] {
    const cap = sizeOf(L)
    const fmt = (gm?.meta?.[L]?.format ?? 'pool') as 'pool'|'ita'
    if (!cap) return []
    const init: Record<number, TeamStat> = {}
   for (let s=1; s<=cap; s++) init[s] = { slot:s, label: labelBySlot(L,s) || `Slot ${s}`, W:0, PF:0, PS:0, QP:0 }


    const rows = scheduleRows(L)
    const sc = scores[L] ?? []
  const apply = (slotA: number | undefined, slotB: number | undefined, idx: number) => {
  if (slotA == null || slotB == null) return
  const a = Number(sc[idx]?.a), b = Number(sc[idx]?.b)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return
      init[slotA].PF += a; init[slotA].PS += b
      init[slotB].PF += b; init[slotB].PS += a
      if (a > b) init[slotA].W += 1; else if (b > a) init[slotB].W += 1
    }
    rows.forEach((r, idx) => apply(r.a, r.b, idx))
    for (const s of Object.values(init)) s.QP = s.PF / Math.max(1, s.PS)

    if (fmt === 'pool' && cap === 4) {
      const s1 = poolPairs.semi1, s2 = poolPairs.semi2
      const w1 = (sc[0]?.a && sc[0]?.b) ? (Number(sc[0].a) > Number(sc[0].b) ? s1[0] : s1[1]) : undefined
      const w2 = (sc[1]?.a && sc[1]?.b) ? (Number(sc[1].a) > Number(sc[1].b) ? s2[0] : s2[1]) : undefined
      const l1 = w1 ? (w1 === s1[0] ? s1[1] : s1[0]) : undefined
      const l2 = w2 ? (w2 === s2[0] ? s2[1] : s2[0]) : undefined

      if (w1 && w2 && sc[2]?.a && sc[2]?.b) {
        const a = Number(sc[2].a), b = Number(sc[2].b)
        init[w1].finish = a > b ? 1 : 2
        init[w2].finish = a > b ? 2 : 1
      }
      if (l1 && l2 && sc[3]?.a && sc[3]?.b) {
        const a = Number(sc[3].a), b = Number(sc[3].b)
        init[l1].finish = a > b ? 3 : 4
        init[l2].finish = a > b ? 4 : 3
      }

      const arr = Object.values(init)
      arr.sort((x,y) => {
        const fx = x.finish ?? 999, fy = y.finish ?? 999
        if (fx !== fy) return fx - fy
        if (y.W !== x.W) return y.W - x.W
        if (y.QP !== x.QP) return y.QP - x.QP
        if (y.PF !== x.PF) return y.PF - x.PF
        return x.label.localeCompare(y.label)
      })
      return arr
    }

    const arr = Object.values(init)
    arr.sort((a,b) => {
      if (b.W !== a.W) return b.W - a.W
      if (b.QP !== a.QP) return b.QP - a.QP
      if (b.PF !== a.PF) return b.PF - a.PF
      return a.label.localeCompare(b.label)
    })
    return arr
  }

  return (
    <div className="p-4 space-y-4">
      {/* Barra di selezione tour/tappa */}
      <div className="card p-3 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <div className="text-xs text-neutral-400 mb-1">Tour</div>
          <select className="input w-full" value={tourId} onChange={e=>{ setTourId(e.target.value); setTappaId('') }}>
            {tours.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <div className="text-xs text-neutral-400 mb-1">Tappa</div>
          <select
            className="input w-full"
            value={tappaId}
            onChange={e => setTappaId(e.target.value)}
            disabled={!tours.length}
          >
            {tappe.length === 0 && <option value="">— nessuna tappa disponibile —</option>}
            {tappe.map(t => (
              <option key={t.id} value={t.id}>
                {t.name}{t.date ? ` — ${new Date(t.date).toLocaleDateString()}` : ''}
              </option>
            ))}
          </select>

          {tappeErr && (
            <div className="mt-1 text-xs text-amber-400">
              Non riesco a caricare le tappe: <code>{tappeErr}</code>
              {tappeTried.length > 0 && (
                <div className="mt-1 opacity-80">URL provati:
                  <ul className="list-disc list-inside">
                    {tappeTried.map(u => <li key={u}><code>{u}</code></li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* pulsanti Rileggi + Diagnostica + stato */}
        <div className="flex items-end justify-end gap-2 text-sm">
  
  <button
    className="px-3 py-1 rounded-md border border-neutral-700 hover:bg-neutral-800/40"
    onClick={() => setReloadKey(k => k + 1)}
    title="Forza una nuova lettura delle sorgenti"
  >
    Rileggi adesso
  </button>

  <button
    className="px-3 py-1 rounded-md border border-neutral-700 hover:bg-neutral-800/40"
    onClick={() => setShowDiag(v => !v)}
    title="Mostra diagnostica localStorage"
  >
    {showDiag ? 'Nascondi diagnostica' : 'Diagnostica'}
  </button>

  <span className="px-2 py-1 rounded-md border border-neutral-700 text-neutral-300">
    {loading
      ? 'Lettura sorgenti…'
      : snapTs
        ? `Lette • ${niceTs(snapTs)}`
        : 'Sorgenti in attesa'}
  </span>
</div>

      </div>
{/* Riepilogo gironi/size */}
<div className="card p-3">
  <div className="text-lg font-semibold mb-2">Riepilogo Gironi (questa tappa)</div>
  {!tappaId
    ? <div className="text-sm text-neutral-400">Seleziona una tappa.</div>
    : (groupsCount === 0
        ? <div className="text-sm text-amber-400">Nessun girone trovato per questa tappa.</div>
        : (
          <div className="text-sm">
            <div className="mb-2">Totale gironi: <b>{groupsCount}</b></div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(groupsMap).sort(([a],[b]) => a.localeCompare(b)).map(([L, n]) => (
                <span key={L} className="px-2 py-1 rounded-lg border border-neutral-700">
                  <b>{L}</b>: {n} squadre
                </span>
              ))}
            </div>
          </div>
        )
      )
  }
</div>

      {/* GIRONI (solo posizioni) */}
<div className="card p-3">
  <div className="text-lg font-semibold mb-2">Gironi (da /admin/gironi)</div>

  {!tappaId
    ? <div className="text-sm text-neutral-400">Seleziona una tappa.</div>
    : (letters.length === 0
        ? <div className="text-sm text-amber-400">Nessun girone valido trovato per questa tappa.</div>
        : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {letters.map(L => {
              const n = sizeOf(L)
              if (!n) return null
              return (
                <div key={L} className="border border-neutral-700 rounded-xl p-2">
                  <div className="text-sm font-semibold mb-1">Girone {L} — {n} squadre</div>
                  <ul className="text-sm space-y-1">
                    {Array.from({ length: n }, (_, i) => i + 1).map(slot => (
                      <li key={`${L}${slot}`} className="border-b border-dashed border-neutral-700 pb-1">
                        {L}{slot}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        )
      )
  }
</div>


      {/* 🔵 NUOVO — Gironi (con cognomi) */}
      <div ref={gironiRef} id="gironi-dettaglio" className="card p-3">
        <div className="text-lg font-semibold mb-2">Gironi (con cognomi)</div>
        {!tappaId
          ? <div className="text-sm text-neutral-400">Seleziona una tappa.</div>
          : !gm
            ? <div className="text-sm text-neutral-400">Nessuna assegnazione trovata. Apri <code>/admin/gironi</code> e salva i gironi.</div>
            : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {letters.map(L => (
                  <div key={`teams-${L}`} className="border border-neutral-700 rounded-xl p-2">
                    <div className="text-sm font-semibold mb-1">Girone {L} — {sizeOf(L)} squadre</div>
                    <ul className="text-sm space-y-1">
                      {Array.from({ length: sizeOf(L) }, (_,i) => i+1).map(slot => {
                        const label = labelBySlot(L, slot)
                        return (
                        <li key={`${L}${slot}`} className="border-b border-dashed border-neutral-700 pb-1">
  <span className="inline-block w-8 text-neutral-400">{L}{slot}</span>
  <span className="inline-block">{labelBySlot(L, slot) || '—'}</span>
</li>

                        )
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )
        }
      </div>

      {/* AVULSA */}
      <div className="card p-3">
        <div className="text-lg font-semibold mb-2">Classifica Avulsa (da Risultati)</div>
        {!avulsa
          ? <div className="text-sm text-neutral-400">In attesa…</div>
          : (avulsa.length === 0
              ? <div className="text-sm text-amber-400">
                  Nessuna classifica avulsa trovata. Apri la pagina <code>/admin/risultati</code> e compila i risultati; altrimenti verrà usato un fallback dagli iscritti.
                </div>
              : (
                <ol className="text-sm space-y-1 list-decimal list-inside">
                  {avulsa.map((name, i) => (
                    <li key={`${i}-${name}`} className="border-b border-dashed border-neutral-700 pb-1">
                      {name}
                    </li>
                  ))}
                </ol>
              )
            )
        }
      </div>

      {/* 🟣 NUOVO — Classifica per gironi (da risultati salvati) */}
      <div className="card p-3">
        <div className="text-lg font-semibold mb-2">Classifiche per Girone (da Risultati)</div>
        {!tappaId
          ? <div className="text-sm text-neutral-400">Seleziona una tappa.</div>
          : !gm
            ? <div className="text-sm text-neutral-400">Nessun dato partite. Compila/salva in <code>/admin/risultati</code>.</div>
            : (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                {letters.map(L => {
                  const stats = computeStatsFor(L)
                  return (
                    <div key={`cls-${L}`} className="border border-neutral-700 rounded-xl p-2 overflow-hidden">
                      <div className="text-sm font-semibold mb-1">Classifica {L}</div>
                      {stats.length === 0 ? (
                        <div className="text-xs text-neutral-500">Nessun risultato salvato.</div>
                      ) : (
                        <table className="w-full text-sm">
                          <thead className="text-xs text-neutral-400">
                            <tr>
                              <th className="text-left">Team</th>
                              <th className="text-right">W</th>
                              <th className="text-right">PF</th>
                              <th className="text-right">PS</th>
                              <th className="text-right">QP</th>
                            </tr>
                          </thead>
                          <tbody>
                            {stats.map((s, idx) => (
                              <tr key={`${L}-${idx}`} className="border-t border-neutral-800">
                                <td className="py-1 pr-2 truncate">{s.label}</td>
                                <td className="text-right">{s.W}</td>
                                <td className="text-right">{s.PF}</td>
                                <td className="text-right">{s.PS}</td>
                                <td className="text-right">{(s.QP || 0).toFixed(3)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )
                })}
              </div>
            )
        }
      </div>

      {/* Pannello diagnostica */}
      {showDiag && tourId && tappaId && (
        <div className="card p-3">
          <div className="text-lg font-semibold mb-2">Diagnostica localStorage</div>
          <div className="text-xs text-neutral-400 mb-2">
            Tour: <code>{tourId}</code> — Tappa: <code>{tappaId}</code>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="border border-neutral-700 rounded-xl p-2">
              <div className="text-sm font-semibold mb-1">Chiavi GIRONI provate</div>
              <ul className="text-xs space-y-1">
                {GROUP_KEYS.map(fn => {
                  const k = fn(tourId, tappaId)
                  let ok = false
                  try { ok = !!localStorage.getItem(k) } catch {}
                  return (
                    <li key={k} className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-neutral-600'}`} />
                      <code className="break-all">{k}</code>
                    </li>
                  )
                })}
              </ul>
            </div>
            <div className="border border-neutral-700 rounded-xl p-2">
              <div className="text-sm font-semibold mb-1">Chiavi AVULSA provate</div>
              <ul className="text-xs space-y-1">
                {AVULSA_KEYS.map(fn => {
                  const k = fn(tourId, tappaId)
                  let ok = false
                  try { ok = !!localStorage.getItem(k) } catch {}
                  return (
                    <li key={k} className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-neutral-600'}`} />
                      <code className="break-all">{k}</code>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
          <div className="mt-3 text-xs">
            Snapshot usato da <code>/admin/crea-tabellone</code>:
            <pre className="mt-1 p-2 bg-neutral-900 rounded-md overflow-x-auto">
{(() => {
  try {
    const raw = localStorage.getItem(keySources(tourId, tappaId)) || '{}'
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch { return '{}' }
})()}
            </pre>
          </div>
        </div>
      )}

      {/* Nota finale */}
      <div className="text-xs text-neutral-500">
        Nota: questa pagina è in sola lettura. Le sorgenti vengono <b>lette in automatico</b> e salvate come snapshot per la tappa
        (<code>sources:&#123;tour,tappa&#125;</code>). La pagina <code>/admin/crea-tabellone</code> userà questo snapshot per popolare i menu “Provenienza”.
      </div>
    </div>
  )
}

/* ==============================
   SEZIONE 5 — helpers
   ============================== */

function expandGironi(meta: GroupMeta[] | null): string[] {
  if (!meta || !meta.length) return []
  const out: string[] = []
  const ord = [...meta].sort((a, b) => String(a.key).localeCompare(String(b.key)))
  for (const g of ord) {
    const L = String(g.key).toUpperCase()
    const n = Number(g.size) || 0
    for (let p = 1; p <= n; p++) out.push(`${L}${p}`)
  }
  return out
}

function niceTs(ts: string) {
  try {
    const d = new Date(ts)
    return d.toLocaleString()
  } catch { return ts }
}
