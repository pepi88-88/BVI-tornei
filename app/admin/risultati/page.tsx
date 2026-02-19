'use client'

import React, { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import BracketCanvas, {
  type WinnerMap,
  type Bracket as BracketType,
} from '../../../components/BracketCanvas'
import {
  colorForLetter as colorFor,
  GROUP_LETTERS as LETTERS_STR,
} from '@/lib/groupColors'

// ------------------------------------------------------------
// Round robin helper (per gironi + eventuale tab ITA)
// ------------------------------------------------------------
type ItaRowScore = { a: string; b: string }

function rrPairs(n: number) {
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
type Meta = { capacity: number; format: 'pool' | 'ita' }

function normalizeMeta(
  meta: Record<string, { capacity: number; format?: 'pool' | 'ita' }> | undefined
): Record<string, Meta> {
  const out: Record<string, Meta> = {}
  for (const [k, v] of Object.entries(meta || {})) {
    out[k] = {
      capacity: Number(v?.capacity ?? 0),
      // default sicuro: se manca o è invalido, usa 'pool'
      format: v?.format === 'ita' ? 'ita' : 'pool',
    }
  }
  return out
}
// ------------------------------------------------------------
// Helper nomi brevi (cognomi) + risolutore token→nome
// ------------------------------------------------------------
function shortSurname(full: string) {
  // es.: "DELLA COSTANZA M." -> ["DELLA","COSTANZA"]
  const s = String(full || '').trim().replace(/\s+[A-Z]\.?$/u, '')
  const parts = s.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''

  // particelle in MAIUSCOLO per confronto; l’output mantiene il casing originale
  const PARTICLES = new Set([
    'DE','DEL','DEI','DEGLI','DEGLI','DELLA','DELL','DELL’','DELL\'','DELLA','DELLE','DELLO',
    'DI','D’','D\'','DA','DAL','DALLA','DALL\'','DALL’',
    'LA','LE','LO',
    'VAN','VON','VANDER','DER',
  ])

  // prendi almeno l’ultima parola; poi risali all’indietro finché trovi particelle
  let start = parts.length - 1
  while (start - 1 >= 0) {
    const prevRaw = parts[start - 1]
    const prevU = prevRaw.toUpperCase()
    if (PARTICLES.has(prevU)) {
      start -= 1
    } else {
      break
    }
  }

  // ricompone dal primo elemento “di cognome” fino alla fine
  return parts.slice(start).join(' ')
}


function lastSurnames(label: string) {
  const s = String(label || '').trim()
  if (!s) return ''

  // ✅ Se NON c'è separatore (2x2 usa "/" o "—"), allora è un nome squadra → non toccare
  if (!s.includes('—') && !s.includes('/')) return s

  // altrimenti applica la logica cognomi
  const parts = s.replace(/—/g, '/').split('/').map(p => p.trim()).filter(Boolean)
  if (parts.length >= 2) return `${shortSurname(parts[0])} / ${shortSurname(parts[1])}`
  return shortSurname(s)
}



function makeSlotResolver(
  tourId?: string,
  tId?: string,
  externalResolver?: (token: string) => string | undefined
) {
  const basic = (token: string): string => {
    if (!token) return '—'
    if (token === '-' || token === '—') return '—'
    if (token.toUpperCase() === 'BYE') return 'BYE'

    // A1, B2 ... -> nomi dalla classifica gironi salvata
    const mAB = token.match(/^([A-Z])(\d{1,2})$/)
    if (mAB && tourId && tId) {
      try {
        const raw = localStorage.getItem(`groups_rank:${tourId}:${tId}`)
        const rankByGroup: Record<string,string[]> = raw ? JSON.parse(raw) : {}
        const L = mAB[1].toUpperCase()
        const pos = Math.max(1, Number(mAB[2])) - 1
        const name = rankByGroup[L]?.[pos]
        if (name) return lastSurnames(name)
      } catch {}
      return token
    }

    // “3” (classifica avulsa)
    if (/^\d+$/.test(token) && tourId && tId) {
      try {
        const raw =
          localStorage.getItem(`classifica_avulsa:${tourId}:${tId}`) ||
          localStorage.getItem(`avulsa:${tourId}:${tId}`)
        const arr: string[] = raw ? JSON.parse(raw) : []
        const idx = Math.max(1, Number(token)) - 1
        const name = arr[idx]
        if (name) return lastSurnames(name)
      } catch {}
      return token
    }

    return token
  }


  // wrapper: prima chiedi all’external (Perdente/Vincente …), poi normalizza
 return (token: string): string => {
    const ext = externalResolver?.(token)
    if (ext) return basic(ext)
    return basic(token)
  }
}

// piccoli alias utile quando non serve l’external
const resolveSlotBasic = (token: string, tourId?: string, tId?: string) =>
  makeSlotResolver(tourId, tId, undefined)(String(token || '').trim())
/** Carica stato gironi "live" da Supabase (stesso endpoint di /admin/gironi) */
async function loadGroupsStateFromSupabase(tId: string): Promise<{
  groupsCount: number
  meta: Record<string, { capacity: number; format?: 'pool' | 'ita' }>
  assign: Record<string, string>
  labels: Record<string, string>
  times: Record<string, string[]>
  scores: Record<string, { a: string; b: string }[]>
  groupsConfirmed: boolean
}> {
  if (!tId) {
    return {
      groupsCount: 0,
      meta: {},
      assign: {},
      labels: {},
      times: {},
      scores: {},
      groupsConfirmed: false,
    }
  }
  try {
    const r = await fetch(
      `/api/groups/state?tournament_id=${encodeURIComponent(tId)}`,
      { headers: { 'x-role': 'admin' }, cache: 'no-store' }
    )
    const j = await r.json()
    const st = (j?.state || j || {}) as any
    return {
      groupsCount:
        Number(st?.groupsCount || Object.keys(st?.meta || {}).length || 0),
      meta: st?.meta || {},
      assign: st?.assign || {},
      labels: st?.labels || {},
      times: st?.times || {},
      scores: st?.scores || {},
      groupsConfirmed: !!st?.groupsConfirmed,
    }
  } catch {
    return {
      groupsCount: 0,
      meta: {},
      assign: {},
      labels: {},
      times: {},
      scores: {},
      groupsConfirmed: false,
    }
  }
}


// ------------------------------------------------------------
// Tabellina ITA “neutra” (se mai ti serve)
// ------------------------------------------------------------
function ItaRRTable({
  bracket,
  tourId,
  tId,
}: {
  bracket: { id: string; title: string; color: string; nTeams: number; slots: string[] }
  tourId: string
  tId: string
}) {
  const keyBase = `ita:${tourId}:${tId}:${bracket.id}`
  const [times, setTimes] = useState<string[]>([])
  const [scores, setScores] = useState<ItaRowScore[]>([])

  useEffect(() => {
    try { setTimes(JSON.parse(localStorage.getItem(`${keyBase}:times`) || '[]')) } catch { setTimes([]) }
    try { setScores(JSON.parse(localStorage.getItem(`${keyBase}:scores`) || '[]')) } catch { setScores([]) }
  }, [keyBase])

  useEffect(() => { try { localStorage.setItem(`${keyBase}:times`, JSON.stringify(times)) } catch {} }, [keyBase, times])
  useEffect(() => { try { localStorage.setItem(`${keyBase}:scores`, JSON.stringify(scores)) } catch {} }, [keyBase, scores])

  const labels = useMemo(
    () => (bracket.slots || []).slice(0, bracket.nTeams).map(s => resolveSlotBasic(s, tourId, tId)),
    [bracket.slots, bracket.nTeams, tourId, tId]
  )
  const matches = useMemo(() => rrPairs(bracket.nTeams), [bracket.nTeams])

  const setTime = (i: number, v: string) => setTimes(prev => { const a=[...prev]; a[i]=v; return a })
  const setScore = (i: number, side: 'a'|'b', raw: string) => {
    const a = [...scores]; const row = a[i] ?? { a:'', b:'' }
    row[side] = raw.replace(/\D/g,'').slice(0,2); a[i] = row; setScores(a)
  }

  return (
    <div className="card p-0 overflow-hidden">
      <div className="h-9 px-3 flex items-center justify-between text-white" style={{ background: bracket.color }}>
        <div className="text-sm font-semibold">Girone all’italiana — {bracket.title}</div>
      </div>
      <div className="p-3 space-y-2">
        {matches.map(([a,b], idx) => (
          <div key={idx} className="grid items-center"
               style={{ gridTemplateColumns: '96px minmax(0,1fr) 44px 16px 44px minmax(0,1fr)', columnGap: '.35rem' }}>
            <input type="time" className="input h-8 pl-1 pr-0 text-sm text-white w-[78px]"
                   value={times[idx] ?? ''} onChange={e => setTime(idx, e.target.value)}/>
            <div className="min-w-0 truncate text-sm text-right pr-0.5">{labels[a-1] || `S${a}`}</div>
            <input className="input h-8 w-12 px-1 text-sm text-center" maxLength={2}
                   defaultValue={scores[idx]?.a ?? ''} onBlur={e => setScore(idx,'a',e.currentTarget.value)}/>
            <div className="w-6 text-center text-[13px] text-neutral-400">vs</div>
            <input className="input h-8 w-12 px-1 text-sm text-center" maxLength={2}
                   defaultValue={scores[idx]?.b ?? ''} onBlur={e => setScore(idx,'b',e.currentTarget.value)}/>
            <div className="min-w-0 truncate text-sm pl-1">{labels[b-1] || `S${b}`}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
/** Round-robin per ITA: restituisce la lista di match come coppie [a,b] (1-based). */
/** Round-robin per ITA (gestisce anche n dispari con BYE=0) */
function buildRR_Ita(n: number): Array<[number, number]> {
  const t: number[] = Array.from({ length: Math.max(2, n) }, (_, i) => i + 1)
  if (t.length % 2 === 1) t.push(0) // aggiungi BYE
  const rounds = t.length - 1
  const half = t.length / 2
  const out: Array<[number, number]> = []

  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < half; i++) {
      const a = t[i], b = t[t.length - 1 - i]
      if (a !== 0 && b !== 0) out.push([a, b]) // ignora BYE
    }
    const fixed = t[0]
    const rest = t.slice(1)
    rest.unshift(rest.pop()!)
    t.splice(0, t.length, fixed, ...rest)
  }
  return out
}


type ItaScore = { a?: number; b?: number }

function ItaEditor({
  bracket,
  tourId,
  tId,
  resolve,
  serverScores,
  onServerScoresChange,
}: {
  bracket: BracketType
  tourId?: string
  tId?: string
  resolve: (token: string) => string
  serverScores?: ItaScore[]                      // <- NEW: punteggi dal server
  onServerScoresChange?: (rows: ItaScore[]) => void // <- NEW: callback per salvare su server
}) {

  const n = Math.max(2, Number(bracket.nTeams) || 0)
  const keyScores = `ita:${tourId || '_'}:${tId || '_'}:${bracket.id}:scores`

  /** nomi squadra (risolti) */
  const teams = useMemo(() => {
    const seeded = seedFromBracket(bracket, resolve)
    const arr = seeded.slice(0, n)
    while (arr.length < n) arr.push('—')
    return arr
  }, [bracket, resolve, n])

  /** calendario lineare (lista match) */
  const pairs = useMemo(() => buildRR_Ita(n), [n])

 /** punteggi persistenti per match (preferisci server, fallback LS) */
const [scores, setScores] = useState<ItaScore[]>(() => {
  if (serverScores && Array.isArray(serverScores)) return serverScores
  try {
    const raw = localStorage.getItem(keyScores)
    const arr: ItaScore[] = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
})

// se cambiano i dati server, riallinea
useEffect(() => {
  if (serverScores && Array.isArray(serverScores)) {
    setScores(serverScores)
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [serverScores])


  // allinea lunghezza punteggi al numero di partite
  useEffect(() => {
    if (scores.length !== pairs.length) {
      setScores((prev) => {
        const out = prev.slice()
        out.length = pairs.length
        return out
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairs.length])

  // persistenza: preferisci server (callback), fallback LS
useEffect(() => {
  if (onServerScoresChange) {
    onServerScoresChange(scores)
  } else {
    try { localStorage.setItem(keyScores, JSON.stringify(scores)) } catch {}
  }
}, [scores, keyScores, onServerScoresChange])

  /** classifica automatica */
  const standings = useMemo(() => {
    const S = teams.map((name, idx) => ({
      idx: idx + 1,
      name,
      W: 0,
      PF: 0,
      PS: 0,
      QP: 0,
    }))
    pairs.forEach(([aIdx1, bIdx1], i) => {
      const s = scores[i] || {}
      const a = Number(s.a)
      const b = Number(s.b)
      if (!Number.isFinite(a) || !Number.isFinite(b)) return
      const ai = aIdx1 - 1
      const bi = bIdx1 - 1
      S[ai].PF += a
      S[ai].PS += b
      S[bi].PF += b
      S[bi].PS += a
      if (a > b) S[ai].W += 1
      else if (b > a) S[bi].W += 1
    })
    S.forEach((r) => (r.QP = r.PF / Math.max(1, r.PS)))
    S.sort(
      (A, B) =>
        B.W - A.W || B.QP - A.QP || B.PF - A.PF || A.name.localeCompare(B.name)
    )
    return S
  }, [teams, pairs, scores])

  /** UI */
  const onScore = (i: number, side: 'a' | 'b', val: string) => {
    const num =
      val === '' ? undefined : Math.max(0, Math.min(999, Number(val) || 0))
    setScores((prev) => {
      const out = prev.slice()
      out[i] = { ...(out[i] || {}), [side]: num }
      return out
    })
  }

 return (
  <div className="card p-0 overflow-hidden mb-4 relative z-0">

      {/* header */}
      <div
        className="h-9 px-3 flex items-center justify-between text-white"
        style={{ background: bracket.color }}
      >
        <div className="text-sm font-semibold">
          Cronologia (girone all’italiana) — {bracket.title}
        </div>
      </div>

      <div className="p-3 grid gap-4 md:grid-cols-2">
        {/* Calendario */}
        <div>
          <div className="text-sm font-semibold mb-2">Calendario & punteggi</div>
          <div className="space-y-2">
            {pairs.map(([a1, b1], i) => {
              const aName = teams[a1 - 1] || `S${a1}`
              const bName = teams[b1 - 1] || `S${b1}`
              const s = scores[i] || {}
              return (
                <div
                  key={`m-${i}`}
                  className="grid items-center gap-2"
                  style={{
                    gridTemplateColumns: 'minmax(0,1fr) 52px 16px 52px minmax(0,1fr)',
                  }}
                >
                  <div className="truncate pr-1" title={aName}>
                    {aName}
                  </div>
                  <input
                    className="input input-sm text-right"
                    value={s.a ?? ''}
                    onChange={(e) => onScore(i, 'a', e.target.value)}
                    inputMode="numeric"
                  />
                  <div className="text-center opacity-60">–</div>
                  <input
                    className="input input-sm"
                    value={s.b ?? ''}
                    onChange={(e) => onScore(i, 'b', e.target.value)}
                    inputMode="numeric"
                  />
                  <div className="truncate pl-1 text-right" title={bName}>
                    {bName}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Classifica auto */}
        <div>
          <div className="text-sm font-semibold mb-2">Classifica (auto)</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase opacity-70">
                <tr>
                  <th className="text-left py-1">#</th>
                  <th className="text-left">Squadra</th>
                  <th className="text-right">W</th>
                  <th className="text-right">PF</th>
                  <th className="text-right">PS</th>
                  <th className="text-right">QP</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((r, i) => (
                  <tr key={`st-${r.idx}-${i}`} className="border-t border-neutral-800">
                    <td className="py-1">{i + 1}</td>
                    <td className="truncate">{r.name}</td>
                    <td className="text-right">{r.W}</td>
                    <td className="text-right">{r.PF}</td>
                    <td className="text-right">{r.PS}</td>
                    <td className="text-right">
                      {(r.QP || 0).toFixed(3).replace(/\.?0+$/, '')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* pulsanti rapidi */}
          <div className="mt-3 flex gap-2">
            <button
              className="btn btn-sm"
              onClick={() => {
                if (confirm('Sicuro di svuotare tutti i punteggi?')) {
                  setScores(Array(pairs.length).fill({}))
                }
              }}
            >
              Svuota punteggi
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}


// ------------------------------------------------------------
// Helpers comuni (gironi, caricamenti, ecc.)
// ------------------------------------------------------------
const LETTERS = LETTERS_STR.split('')
const fetcher = (u: string) => fetch(u).then(r => r.json()).catch(() => null)

type Tour = { id: string; name: string }
type Tournament = { id: string; name: string; date?: string }
type Persist = {
  groupsCount: number
  meta: Record<string, Meta>
  assign: Record<string, string>
  times?: Record<string, string[]>
  labels?: Record<string, string>
}
type Score = { a: string; b: string }

const chunk = <T,>(arr: T[], size: number) => {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
function bothSurnames(label: string) {
  return lastSurnames(label)
}

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

// ---- risolvi nome da token del bracket (es. “1A”, o etichetta già nome)
function seedFromBracket(b: BracketType, resolveToken: (t: string) => string): string[] {
  const set = new Set<string>()
  for (const s of b.slots || []) {
    const name = resolveToken(String(s || '').trim())
    if (name && name !== '-' && name !== '—') set.add(name)
  }
  for (const m of b.r1 || []) {
    for (const side of ['A','B'] as const) {
      const name = resolveToken(String((m as any)[side] || '').trim())
      if (name && name !== '-' && name !== '—') set.add(name)
    }
  }
  return Array.from(set)
}

// ---- classifica manuale per tabellone (lista a sinistra + select 1..N)
function loadPlacements(tourId: string, tId: string, bId: string): string[] {
  try { return JSON.parse(localStorage.getItem(`placements:${tourId}:${tId}:${bId}`) || '[]') } catch { return [] }
}
function savePlacements(tourId: string, tId: string, bId: string, rows: string[]) {
  try { localStorage.setItem(`placements:${tourId}:${tId}:${bId}`, JSON.stringify(rows)) } catch {}
}

function PlacementsEditor({
  bracket,
  tourId,
  tId,
  resolver,   // externalResolver (perdente/vincente <tab>)
}: {
  bracket: BracketType
  tourId: string
  tId: string
  resolver: (token: string) => string | undefined
}) {
  const n = Math.max(2, Number(bracket.nTeams) || 2)

  // “risolutore completo” = gironi + avulsa + perdente/vincente
  const resolve = useMemo(
    () => makeSlotResolver(tourId, tId, resolver),
    [tourId, tId, resolver]
  )

  // classifica salvata per tabellone
  const [placements, setPlacements] = useState<string[]>(
    () => loadPlacements(tourId, tId, bracket.id) || Array(n).fill('')
  )

  // normalizza a n e salva
  useEffect(() => {
    setPlacements(prev => {
      if (prev.length === n) return prev
      const out = prev.slice(0, n)
      while (out.length < n) out.push('')
      savePlacements(tourId, tId, bracket.id, out)
      return out
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, tourId, tId, bracket.id])

  // salva ad ogni modifica
  useEffect(() => { savePlacements(tourId, tId, bracket.id, placements) },
    [placements, tourId, tId, bracket.id])

  // elenco squadre a sinistra (già NOMI)
  const teams = useMemo(() => {
    const seeded = seedFromBracket(bracket, resolve)
    const fromSaved = (placements || []).filter(Boolean)
      return Array.from(new Set([...seeded, ...fromSaved]))
  }, [bracket, resolve, placements])

  const posOf = (team: string) => {
    const i = placements.findIndex((t) => t === team)
    return i >= 0 ? i + 1 : 0
  }
  const setPos = (team: string, pos: number) => {
    const newIdx = pos - 1
    setPlacements(prev => {
      const next = [...prev]
      const oldIdx = next.findIndex(t => t === team)
      if (oldIdx !== -1) next[oldIdx] = ''
      if (newIdx >= 0 && newIdx < next.length && next[newIdx] && next[newIdx] !== team) {
        next[newIdx] = ''
      }
      if (newIdx >= 0 && newIdx < next.length) next[newIdx] = team
      savePlacements(tourId, tId, bracket.id, next)
      return next
    })
  }
  const clearAll = () => {
    const empty = Array(n).fill('') as string[]
    setPlacements(empty)
    savePlacements(tourId, tId, bracket.id, empty)
  }

  return (
    <div className="card p-0 overflow-hidden">
      <div className="h-9 px-3 flex items-center justify-between text-white" style={{ background: bracket.color }}>
        <div className="text-sm font-semibold">Classifica manuale — {bracket.title}</div>
        <div><button className="btn btn-sm" onClick={clearAll}>Svuota</button></div>
      </div>

      <div className="p-3 grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          {teams.length === 0 ? (
            <div className="text-xs text-neutral-500">Aggiungi le squadre nel tabellone.</div>
          ) : teams.map((name) => {
              const cur = posOf(name)
              return (
                <div key={name} className="grid items-center"
                     style={{ gridTemplateColumns: 'minmax(0,1fr) 120px', columnGap: '.5rem' }}>
                  <div className="truncate">{name}</div>
                  <select className="input h-8 w-[110px]" value={String(cur)}
                          onChange={(e) => setPos(name, Number(e.target.value))}>
                    <option value="0">—</option>
                    {Array.from({ length: n }, (_, i) => i + 1).map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              )
            })}
        </div>

        <div>
          <div className="text-sm font-semibold mb-2">Anteprima classifica</div>
          <div className="space-y-1">
            {Array.from({ length: n }, (_, i) => i + 1).map(p => (
              <div key={p} className="flex items-center gap-2">
                <div className="w-8 text-right text-neutral-400">{p}.</div>
                <div className="truncate">{placements[p - 1] || '—'}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-[11px] text-neutral-500">
            Salvataggio: <code>placements:{tourId}:{tId}:{bracket.id}</code>
          </div>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------
// Brackets: load/normalize + externalResolver (Perdente/Vincente)
// ------------------------------------------------------------
const nextPow2 = (n: number) => { let p=1; while (p < n) p <<= 1; return p }
function normalizeBracket(b: any): BracketType {
  const n = Math.max(2, Number(b?.nTeams) || 8)
  const r1 = Array.from({ length: nextPow2(n) / 2 }, (_, i) => ({
    A: b?.r1?.[i]?.A ?? '-',
    B: b?.r1?.[i]?.B ?? '-',
  }))
  const slots = Array.from({ length: nextPow2(n) }, (_, i) => b?.slots?.[i] ?? '')
  return {
    id: String(b?.id || Math.random().toString(36).slice(2, 10)),
    title: String(b?.title || 'TABELLONE 1'),
    color: String(b?.color || '#22c55e'),
    type: (b?.type as BracketType['type']) || 'SE',
    nTeams: n,
    source: (b?.source as BracketType['source']) || 'gironi',
    fromTableId: b?.fromTableId || undefined,
    r1,
    slots,
  }
}
const keyBr = (tour: string, tId: string) => `brackets:${tour}:${tId}`
function loadBrackets(tour: string, tId: string): BracketType[] {
  if (!tour || !tId) return []
  try {
    const raw = localStorage.getItem(keyBr(tour, tId))
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.map(normalizeBracket) : []
  } catch { return [] }
}

function makeExternalResolver(
  brackets: Array<{ id: string; title: string; r1?: { A: string; B: string }[] }>,
  winnersById: Record<string, Record<string, 'A' | 'B' | undefined>>,
  tourId?: string,
  tId?: string,
) {
  const byTitle = new Map(brackets.map(b => [b.title.toUpperCase(), b]))

  // normalizza lettera turno -> 'R'
  const normLetter = (L?: string) => {
    const u = String(L || '').toUpperCase()
    // accettiamo R, M (match), G (gara), S (semi/fase), F (finale) -> tutte come "R"
    return ['R','M','G','S','F'].includes(u) ? 'R' : ''
  }

  return (token: string): string | undefined => {
    if (!token) return undefined
    const t = token.trim()

    // supporta:
    //  - Perdente|Loser|Vincente|Winner <Titolo> <Lettera?> <Num>
    //    es: "Vincente Tabellone Oro G1", "Perdente Tabellone Argento 3"
    const m = t.match(/^(Perdente|Loser|Vincente|Winner)\s+(.+?)\s+([A-Za-z])?(\d+)$/i)
    if (!m) return undefined

    const kind = m[1].toLowerCase()                       // vincente/perdente
    const titleU = m[2].toUpperCase()                     // titolo tabellone
    const letterRaw = m[3] || ''                          // R / M / G / S / F / '' 
    const num = Number(m[4])                              // indice match

    const br = byTitle.get(titleU)
    if (!br || !Number.isFinite(num) || num < 1) return undefined

    // normalizza lettera -> 'R'; se non c'è lettera, trattiamo comunque come 'R'
    const L = normLetter(letterRaw)
    if (L !== 'R' && letterRaw) return undefined           // se lettera c'è ma non è tra quelle ammesse

    const pair = br.r1?.[num - 1]
    if (!pair) return undefined

    const side = (winnersById[br.id] || {})[`R${num}`]     // 'A' | 'B' | undefined
    if (!side) return undefined

    if (kind === 'vincente' || kind === 'winner') {
      return side === 'A' ? pair.A : pair.B
    }
    if (kind === 'perdente' || kind === 'loser') {
      const loserSide = side === 'A' ? 'B' : 'A'
      return loserSide === 'A' ? pair.A : pair.B
    }
    return undefined
  }
}
function MobileGroupsCarousel({
  letters,
  tId,
  scheduleRows,
  setTime,
  setScore,
  fmtOf,
  colorFor,
  times,
  scores,
}: {
  letters: string[]
  tId: string
  scheduleRows: (L: string) => { key: string; a?: number; b?: number; labelA: string; labelB: string }[]
  setTime: (L: string, idx: number, val: string) => void
  setScore: (L: string, idx: number, side: 'a' | 'b', val: string) => void
  fmtOf: (L: string) => string
  colorFor: (L: string) => string
  times: Record<string, string[]>
  scores: Record<string, { a: string; b: string }[]>
}) {
  // ogni slide = 1 girone, “ingrandito”
  return (
    <div
      className="relative overflow-x-auto snap-x snap-mandatory md:hidden no-scrollbar"
      style={{ WebkitOverflowScrolling: 'touch' }}
    >
      <div className="flex">
        {letters.map((L, idx) => {
          const color = colorFor(L)
          const rows = scheduleRows(L)
          return (
            <div
              key={`${tId}-slide-${L}-${idx}`}
              className="snap-start shrink-0 px-3"
              style={{ width: '200vw' }} // 👈 raddoppio dimensione “gruppo partite”
            >
              <div className="card p-0 overflow-hidden">
                <div className="h-10 px-3 flex items-center text-white" style={{ background: color }}>
                  <div className="text-[15px] font-semibold">Partite {L} — {fmtOf(L).toUpperCase()}</div>
                </div>

                <div className="p-3 space-y-3">
                  {rows.length === 0 ? (
                    <div className="text-sm text-neutral-500">Imposta i gironi in /admin/gironi.</div>
                  ) : (
                    rows.map((r, ridx) => (
                      <div
                        key={`${tId}-${L}-${r.key}`}
                        className="grid items-center rounded-xl border border-neutral-800 bg-neutral-900/60 p-3"
                        style={{
                          // colonne più larghe: input punteggi “tap friendly”
                          gridTemplateColumns: '110px minmax(0,1fr) 64px 18px 64px minmax(0,1fr)',
                          columnGap: '.5rem',
                        }}
                      >
                        <input
                          type="time"
                          className="input h-11 pl-2 pr-1 text-base text-white w-[110px] tabular-nums"
                          value={(times[L] ?? [])[ridx] ?? ''}
                          onChange={(e) => setTime(L, ridx, e.target.value)}
                        />

                        <div className="min-w-0 truncate text-[15px] text-right pr-1 font-medium">
                          {r.labelA}
                        </div>

                        <input
                          className="input h-11 w-16 px-2 text-base text-center"
                          inputMode="numeric"
                          value={scores[L]?.[ridx]?.a ?? ''}
                          onChange={(e) => {
                            const v = e.currentTarget.value.replace(/\D/g, '').slice(0, 2)
                            setScore(L, ridx, 'a', v)
                          }}
                        />

                        <div className="text-center text-[15px] opacity-60">–</div>

                        <input
                          className="input h-11 w-16 px-2 text-base text-center"
                          inputMode="numeric"
                          value={scores[L]?.[ridx]?.b ?? ''}
                          onChange={(e) => {
                            const v = e.currentTarget.value.replace(/\D/g, '').slice(0, 2)
                            setScore(L, ridx, 'b', v)
                          }}
                        />

                        <div className="min-w-0 truncate text-[15px] pl-1 font-medium">
                          {r.labelB}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* indicatori */}
              <div className="mt-3 mb-2 flex items-center justify-center gap-2">
                {letters.map((_, j) => (
                  <span key={`dot-${j}`} className={`h-1.5 w-6 rounded-full ${j === idx ? 'bg-white' : 'bg-neutral-700'}`} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ------------------------------------------------------------
// Pagina
// ------------------------------------------------------------
export default function RisultatiGironiPage() {
  // Filtri
  const { data: toursRes } = useSWR('/api/tours', fetcher)
  const tours: Tour[] = toursRes?.items ?? []
  const [tourId, setTourId] = useState('')
  const { data: tappeRes } = useSWR(tourId ? `/api/tournaments?tour_id=${tourId}` : '/api/tournaments', fetcher)
  const tappe: Tournament[] = tappeRes?.items ?? []
  const [tId, setTId] = useState('')
  const [view, setView] = useState<'gironi' | 'tabellone'>('gironi')
// Mostra solo le tappe non chiuse + ordina per data desc (se presente)
const parseDate = (s?: string) => (s ? new Date(s).getTime() : 0)
const tappeVisibili = useMemo(() => {
  const arr = (tappeRes?.items ?? []) as Tournament[]
  return arr.filter((t: any) => t?.status !== 'closed')
           .sort((a, b) => parseDate(b?.date) - parseDate(a?.date))
}, [tappeRes])
// Se non c'è tId, prova a selezionare la prima tappa VISIBILE
useEffect(() => {
  if (!tId && tappeVisibili.length) {
    setTId(tappeVisibili[0].id)
  }
}, [tappeVisibili, tId])

// Se la tappa selezionata diventa non visibile (chiusa), resetta
useEffect(() => {
  if (!tId) return
  const ok = tappeVisibili.some(t => t.id === tId)
  if (!ok) setTId('')
}, [tId, tappeVisibili])

  useEffect(() => { if (!tourId && tours.length) setTourId(tours[0].id) }, [tours, tourId])
  
  // Store gironi + conferma
  const [store, setStore] = useState<Persist | null>(null)
  const [times, setTimes] = useState<Record<string, string[]>>({})
  const [scores, setScores] = useState<Record<string, Score[]>>({})
  const [groupsConfirmed, setGroupsConfirmed] = useState(false)
// controllo caricamento per evitare cross-save fra tappe
const [isLoadingState, setIsLoadingState] = useState(false)
const [loadedFor, setLoadedFor] = useState<string>('') // tId per cui lo stato è “coerente”

 useEffect(() => {
  let cancelled = false

  // appena cambia tId, svuota lo stato locale per evitare che il vecchio finisca nel nuovo
  setIsLoadingState(true)
  setLoadedFor('')
  setTimes({})
  setScores({})

  if (!tId) {
    setStore(null)
    setGroupsConfirmed(false)
    setIsLoadingState(false)
    return
  }

  ;(async () => {
    const gm = await loadGroupsStateFromSupabase(tId)
    if (cancelled) return
    setStore({
  groupsCount: gm.groupsCount,
  meta: normalizeMeta(gm.meta),   // <-- qui la fix
  assign: gm.assign,
  labels: gm.labels,
  times: gm.times,
})
    setTimes(gm.times)
    setScores(gm.scores)
    setGroupsConfirmed(gm.groupsConfirmed)

    // stato coerente ora è riferito a QUESTO tId
    setLoadedFor(tId)
    setIsLoadingState(false)
  })()

  return () => {
    cancelled = true
  }
}, [tId])


 const confirmGroups = async () => {
  if (!tId || !tourId) return
  if (!window.confirm('Confermi i risultati dei gironi? Il tabellone sarà sbloccato per la compilazione.')) return
  try {
    // prendi lo stato attuale
    const res = await fetch(`/api/groups/state?tournament_id=${encodeURIComponent(tId)}`, {
      headers: { 'x-role': 'admin' }, cache: 'no-store'
    })
    const js = await res.json()
    const prev = (js?.state || {}) as any
    const next = { ...prev, groupsConfirmed: true }

    await fetch('/api/groups/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-role': 'admin' },
      body: JSON.stringify({ tournament_id: tId, state: next }),
    })
    setGroupsConfirmed(true)
  } catch {
    setGroupsConfirmed(true) // fallback UI
  }
}


  // Helpers Gironi
  const letters = useMemo(() => LETTERS.slice(0, Math.max(1, store?.groupsCount ?? 0)), [store?.groupsCount])
  const capOf = (L: string) => store?.meta?.[L]?.capacity ?? 0
  const fmtOf = (L: string) => (store?.meta?.[L]?.format ?? 'pool').toLowerCase()
 // 👇 SOSTITUISCI interamente questa funzione
const labelBySlot = (L: string, slot: number) => {
  const rid = store?.assign?.[`${L}-${slot}`] ?? ''
  const raw = rid ? store?.labels?.[rid] ?? '' : ''

  // 1) se il nome "crudo" esiste nei labels, uso quello
if (raw) return raw

  // 2) fallback robusto: risolvi A1/B2... in cognomi brevi tramite i resolver locali
  //    (usa i dati già in localStorage: groups_rank / classifica_avulsa)
  const token = `${L}${slot}` // es. "A1"
  const solved = resolveSlotBasic(token, tourId, tId) // già fa: gruppi_rank -> avulsa -> token
  if (solved && solved !== token && solved !== '—') return solved

  // 3) ultimo fallback visuale
  return `Slot ${slot}`
}


 function setTime(L: string, idx: number, val: string) {
  const arr = [...(times[L] ?? [])]
  arr[idx] = val
  setTimes((t) => ({ ...t, [L]: arr }))
  // niente localStorage: il persist lo fa l'auto-save verso Supabase
}

  function setScore(L: string, idx: number, side: 'a' | 'b', val: string) {
    const arr = [...(scores[L] ?? [])]; const row = arr[idx] ?? { a:'', b:'' }
    row[side] = val; arr[idx] = row; setScores(s => ({ ...s, [L]: arr }))
  }

  function scheduleRows(L: string) {
    const cap = capOf(L); const fmt = fmtOf(L)
    if (cap < 2) return [] as { key: string; a?: number; b?: number; labelA: string; labelB: string }[]
    if (fmt === 'pool' && cap === 4) {
      const s1 = poolPairs.semi1, s2 = poolPairs.semi2
      const rows: any[] = [
        { key:'S1', a:s1[0], b:s1[1], labelA:labelBySlot(L,s1[0]), labelB:labelBySlot(L,s1[1]) },
        { key:'S2', a:s2[0], b:s2[1], labelA:labelBySlot(L,s2[0]), labelB:labelBySlot(L,s2[1]) },
      ]
      const sc = scores[L] ?? []
      const w1 = sc[0]?.a && sc[0]?.b ? (Number(sc[0].a) > Number(sc[0].b) ? s1[0] : s1[1]) : undefined
      const l1 = w1 ? (w1 === s1[0] ? s1[1] : s1[0]) : undefined
      const w2 = sc[1]?.a && sc[1]?.b ? (Number(sc[1].a) > Number(sc[1].b) ? s2[0] : s2[1]) : undefined
      const l2 = w2 ? (w2 === s2[0] ? s2[1] : s2[0]) : undefined
      rows.push({ key:'F12', a:w1, b:w2, labelA: w1?labelBySlot(L,w1):'Vincente G1', labelB: w2?labelBySlot(L,w2):'Vincente G2' })
      rows.push({ key:'F34', a:l1, b:l2, labelA: l1?labelBySlot(L,l1):'Perdente G1', labelB: l2?labelBySlot(L,l2):'Perdente G2' })
      return rows
    }
    return rr(cap).map(([a,b], i) => ({ key:`R${i+1}`, a, b, labelA:labelBySlot(L,a), labelB:labelBySlot(L,b) }))
  }
// Salvataggio auto su Supabase di times + scores (stesso schema della pagina /admin/gironi)
useEffect(() => {
  // salva solo quando:
  // - c’è una tappa
  // - NON stiamo caricando
  // - i dati in memoria sono stati caricati proprio per questa tappa
  if (!tId || isLoadingState || loadedFor !== tId) return

  const curTId = tId
  const timer = setTimeout(async () => {
    try {
      const res = await fetch(
        `/api/groups/state?tournament_id=${encodeURIComponent(curTId)}`,
        { headers: { 'x-role': 'admin' }, cache: 'no-store' }
      )
      const js = await res.json()
      const prev = (js?.state || {}) as any

      const next = {
        groupsCount: prev?.groupsCount ?? store?.groupsCount ?? 0,
        meta: prev?.meta ?? store?.meta ?? {},
        assign: prev?.assign ?? store?.assign ?? {},
        labels: prev?.labels ?? store?.labels ?? {},
        gField: prev?.gField ?? {},
        times: { ...(prev?.times || {}), ...(times || {}) },
        scores: { ...(prev?.scores || {}), ...(scores || {}) },
        isPublic: typeof prev?.isPublic === 'boolean' ? prev.isPublic : false,
        groupsConfirmed: !!prev?.groupsConfirmed,
      }

      // se nel frattempo l’utente ha cambiato tappa, non salvare
      if (curTId !== tId) return

      await fetch('/api/groups/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-role': 'admin' },
        body: JSON.stringify({ tournament_id: curTId, state: next }),
      })
    } catch {}
  }, 300)

  return () => clearTimeout(timer)
}, [tId, times, scores, store, isLoadingState, loadedFor])



  // ---------- Classifica + avulsa: salvataggi ----------
  type TeamStat = { slot:number; label:string; W:number; PF:number; PS:number; QP:number; finish?:number }

 

  function computeStatsFor(L: string): TeamStat[] {
    const cap = capOf(L)
    const fmt = (store?.meta?.[L]?.format ?? 'pool').toLowerCase() as 'pool'|'ita'
    const init: Record<number, TeamStat> = {}
    for (let s = 1; s <= cap; s++) init[s] = { slot:s, label:labelBySlot(L,s), W:0, PF:0, PS:0, QP:0 }

    const rows = scheduleRows(L); const sc = scores[L] ?? []
    const apply = (slotA?:number, slotB?:number, idx?:number) => {
      if (!slotA || !slotB) return
      const a = Number(sc[idx!]?.a), b = Number(sc[idx!]?.b)
      if (!Number.isFinite(a) || !Number.isFinite(b)) return
      init[slotA].PF += a; init[slotA].PS += b
      init[slotB].PF += b; init[slotB].PS += a
      if (a>b) init[slotA].W += 1; else if (b>a) init[slotB].W += 1
    }
    rows.forEach((r,idx) => apply(r.a, r.b, idx))
    for (const s of Object.values(init)) s.QP = s.PF / Math.max(1, s.PS)

    if (fmt === 'pool' && cap === 4) {
      const s1:[number,number]=[1,4], s2:[number,number]=[2,3]
      const w1 = (sc[0]?.a && sc[0]?.b) ? (Number(sc[0].a) > Number(sc[0].b) ? s1[0] : s1[1]) : undefined
      const w2 = (sc[1]?.a && sc[1]?.b) ? (Number(sc[1].a) > Number(sc[1].b) ? s2[0] : s2[1]) : undefined
      const l1 = w1 ? (w1===s1[0]?s1[1]:s1[0]) : undefined
      const l2 = w2 ? (w2===s2[0]?s2[1]:s2[0]) : undefined
      if (w1 && w2 && sc[2]?.a && sc[2]?.b) {
        const a=Number(sc[2].a), b=Number(sc[2].b)
        init[w1].finish = a>b ? 1 : 2; init[w2].finish = a>b ? 2 : 1
      }
      if (l1 && l2 && sc[3]?.a && sc[3]?.b) {
        const a=Number(sc[3].a), b=Number(sc[3].b)
        init[l1].finish = a>b ? 3 : 4; init[l2].finish = a>b ? 4 : 3
      }
      const arr = Object.values(init)
      arr.sort((x,y) => {
        const fx=x.finish??999, fy=y.finish??999
        if (fx!==fy) return fx-fy
        if (y.W!==x.W) return y.W-x.W
        if (y.QP!==x.QP) return y.QP-x.QP
        if (y.PF!==x.PF) return y.PF-x.PF
        return x.label.localeCompare(y.label)
      })
      return arr
    }

    const arr = Object.values(init)
    arr.sort((a,b) => (b.W-a.W) || (b.QP-a.QP) || (b.PF-a.PF) || a.label.localeCompare(b.label))
    return arr
  }

  type AvulsaRow = { letter:string; pos:number; label:string; W:number; PF:number; PS:number; QP:number }
  const avulsa: AvulsaRow[] = useMemo(() => {
    if (!store) return []
    const out: AvulsaRow[] = []
    for (const L of letters) computeStatsFor(L).forEach((s,i) => out.push({ letter:L, pos:i+1, label:s.label, W:s.W, PF:s.PF, PS:s.PS, QP:s.QP }))
    out.sort((a,b) => (a.pos-b.pos) || (b.W-a.W) || (b.QP-a.QP) || a.letter.localeCompare(b.letter))
    return out
  }, [store, letters, scores])


  // -------- Tabelloni + winners ----------
  const [brackets, setBrackets] = useState<BracketType[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [winnersById, setWinnersById] = useState<Record<string, WinnerMap>>({})
const [itaScoresById, setItaScoresById] = useState<Record<string, ItaScore[]>>({})

      function nameFromGroupRank(letter: string, pos: number): string | undefined {
  const L = String(letter || '').toUpperCase()
  if (!/^[A-Z]$/.test(L) || !Number.isFinite(pos) || pos < 1) return
  // usa la classifica del girone calcolata in pagina (computeStatsFor)
  const row = computeStatsFor(L)[pos - 1]
  if (!row?.label) return
  // compat con il resto dell'UI: cognomi brevi
  return lastSurnames(row.label)
}

// Resolver completo: Winner/Loser -> A1/B2 (anche "1A", con spazi, minuscole) -> Avulsa(1..N) -> Fallback
const resolveToken = useMemo(() => {
  const winLose = makeExternalResolver(brackets, winnersById, tourId, tId)
  const slotBase = makeSlotResolver(tourId, tId, winLose)

  const avulsaNames: string[] = avulsa.map(r => r.label)

  const parseGroupToken = (raw: string): { letter: string; pos: number } | null => {
    const s = String(raw || '').trim().toUpperCase()
    let m = s.match(/^([A-Z])\s*(\d{1,2})$/) // A1 / A 1
    if (m) return { letter: m[1], pos: Number(m[2]) }
    m = s.match(/^(\d{1,2})\s*([A-Z])$/)     // 1A / 1 A
    if (m) return { letter: m[2], pos: Number(m[1]) }
    return null
  }

  const resolveGroupOrAvulsaNow = (maybe: string): string | undefined => {
    if (!maybe) return undefined
    // prova girone live
    const gp = parseGroupToken(maybe)
    if (gp) {
      const nm = nameFromGroupRank(gp.letter, gp.pos) // usa computeStatsFor live
      if (nm) return nm
    }
    // prova avulsa live
    if (/^\d+$/.test(maybe)) {
      const idx = Math.max(1, Number(maybe)) - 1
      const nm = avulsaNames[idx]
      if (nm) return lastSurnames(nm)
    }
    return undefined
  }

  return (raw: string): string => {
    const token = String(raw || '').trim()
    if (!token) return '—'

    // 1) numero avulsa diretto
    if (/^\d+$/.test(token)) {
      const nm = resolveGroupOrAvulsaNow(token)
      if (nm) return nm
    }

    // 2) A1/B2/1A ecc diretto
    const gp = parseGroupToken(token)
    if (gp) {
      const nm = nameFromGroupRank(gp.letter, gp.pos)
      if (nm) return nm
    }

    // 3) fallback standard (Winner/Loser -> A1) + post-risoluzione ULTERIORE
    const out = slotBase(token) // può restituire A1/B2 ecc (o già un nome)
    const nm = resolveGroupOrAvulsaNow(out)
    return nm ?? out
  }
}, [brackets, winnersById, tourId, tId, avulsa])

 useEffect(() => {
  if (!tourId || !tId) { setBrackets([]); setActiveId(null); setWinnersById({}); setItaScoresById({}); return }
  ;(async () => {
    try {
      const r = await fetch(`/api/brackets/state?tournament_id=${encodeURIComponent(tId)}`, {
        headers: { 'x-role': 'admin' },
        cache: 'no-store',
      })
      const js = await r.json()
      const raw = js?.state

      // Accetta sia il vecchio formato (array) che il nuovo (oggetto con items + winnersById + itaScoresById)
      const itemsRaw = Array.isArray(raw) ? raw : (raw?.items || [])
      const winnersRaw = Array.isArray(raw) ? {}   : (raw?.winnersById   || {})
      const itaRaw     = Array.isArray(raw) ? {}   : (raw?.itaScoresById || {})

      const normalized = itemsRaw.map(normalizeBracket)
      setBrackets(normalized)
      setActiveId(normalized[0]?.id ?? null)

      // winners / itaScores dal server
      setWinnersById(winnersRaw as Record<string, WinnerMap>)
      setItaScoresById(itaRaw as Record<string, ItaScore[]>)
    } catch {
      setBrackets([]); setActiveId(null); setWinnersById({}); setItaScoresById({})
    }
  })()
}, [tourId, tId])


// Salva winners + punteggi ITA del tabellone su Supabase (merge-safe)
useEffect(() => {
  if (!tId) return
  const curTId = tId
  const timer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/brackets/state?tournament_id=${encodeURIComponent(curTId)}`, {
        headers: { 'x-role': 'admin' },
        cache: 'no-store',
      })
      const js = await res.json()
      const prev = js?.state

      // tollerante al vecchio formato (array)
      const prevItems   = Array.isArray(prev) ? prev : (prev?.items || [])
      const prevWinners = Array.isArray(prev) ? {}   : (prev?.winnersById || {})
      const prevIta     = Array.isArray(prev) ? {}   : (prev?.itaScoresById || {})

      const next = {
        items: prevItems.length ? prevItems : brackets,     // fallback
        winnersById: { ...(prevWinners || {}), ...(winnersById || {}) },
        itaScoresById: { ...(prevIta || {}), ...(itaScoresById || {}) },
      }

      if (curTId !== tId) return

      await fetch('/api/brackets/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-role': 'admin' },
        body: JSON.stringify({ tournament_id: curTId, state: next }),
      })
    } catch {}
  }, 300)

  return () => clearTimeout(timer)
}, [tId, brackets, winnersById, itaScoresById])

  const active = useMemo(() => brackets.find(b => b.id === activeId) || null, [activeId, brackets])
// Bracket "per display": per SE/DE risolvo A1/B2/avulsa(1..N) -> cognomi
const activeForDisplay = useMemo(() => {
  if (!active) return null

  // solo SE/DE hanno il problema (ITA usa già ItaEditor con resolve)
  if (String(active.type).toUpperCase() === 'SE' || String(active.type).toUpperCase() === 'DE') {
    const mapSlot = (s: string) => resolveToken(String(s || '').trim())
    return {
      ...active,
      // r1: risolvo A e B
      r1: (active.r1 || []).map(m => ({ A: mapSlot(m.A), B: mapSlot(m.B) })),
      // slots lineari (per gli schemi che li mostrano)
      slots: (active.slots || []).map(mapSlot),
    } as BracketType
  }
  return active
}, [active, resolveToken])

  // ------------------------------------------------------------
// UI
// ------------------------------------------------------------
return (
  <div className="relative z-0 p-6 space-y-8 pointer-events-auto">
   
    {/* Header filtri */}
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col">
        <div className="text-xs text-neutral-400 mb-1">Tour</div>
        <select
          className="input w-56"
          value={tourId}
          onChange={(e) => {
            setTourId(e.target.value)
            setTId('')
          }}
        >
          {tours.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col">
        <div className="text-xs text-neutral-400 mb-1">Tappa</div>
        <select
  className="input w-64"
  value={tId}
  onChange={(e) => setTId(e.target.value)}
>
  {tappeVisibili.map((t) => (
    <option key={t.id} value={t.id}>
      {t.name}{t.date ? ` — ${new Date(t.date).toLocaleDateString()}` : ''}
    </option>
  ))}
</select>

      </div>

      <div className="flex items-end gap-2">
        <div className="inline-flex rounded-xl overflow-hidden border border-neutral-700">
          <button
            className={`px-3 py-2 text-sm ${
              view === 'gironi'
                ? 'bg-neutral-800 text-white'
                : 'bg-neutral-900 text-neutral-300'
            }`}
            onClick={() => setView('gironi')}
          >
            Gironi
          </button>
          <button
            className={`px-3 py-2 text-sm ${
              view === 'tabellone'
                ? 'bg-neutral-800 text-white'
                : 'bg-neutral-900 text-neutral-300'
            }`}
            onClick={() => setView('tabellone')}
          >
            Tabellone
          </button>
        </div>

        <button
          className="px-3 py-2 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-500 text-black"
          onClick={confirmGroups}
        >
          Risultati gironi CONFERMATI
        </button>
      </div>
    </div>

    {/* Contenuto */}
   {!tId ? (
  <div className="card p-6 text-sm text-neutral-400">
    {tappeVisibili.length > 0
      ? <>Seleziona <b>Tour</b> e <b>Tappa</b>.</>
      : <>Nessuna tappa disponibile (tutte chiuse).</>}
  </div>
) : view === 'tabellone' ? (

      <div className="card p-0 overflow-hidden">
        {!groupsConfirmed ? (
          <div className="p-6 text-sm text-neutral-400">
            Il tabellone è bloccato finché non confermi i risultati dei gironi.
            Premi <b>“Risultati gironi CONFERMATI”</b>.
          </div>
        ) : !brackets.length ? (
          <div className="p-6 text-sm text-neutral-400">
            Nessun tabellone trovato. Crea tabelloni in <b>/admin/creazione tabellone</b>.
          </div>
        ) : (
          <>
            {/* Tabs tabelloni */}
            <div className="p-3 flex flex-wrap gap-2 border-b border-neutral-800">
              {brackets.map((b, i) => (
                <button
                  key={b.id}
                  className={`btn ${b.id === activeId ? '' : 'opacity-80'}`}
                  onClick={() => setActiveId(b.id)}
                  title={b.title}
                  style={
                    b.id === activeId
                      ? { outline: `2px solid ${b.color}`, outlineOffset: 2 }
                      : {}
                  }
                >
                  {b.title}
                  <span className="ml-2 text-[10px] opacity-60">L{i + 1}</span>
                  {i === 0 && <span className="ml-1">👑</span>}
                </button>
              ))}
            </div>

            {/* Canvas / Editor */}
            {active ? (
  <div className="p-4">
    {active.type === 'ITA' ? (
      <ItaEditor
        bracket={active}
        tourId={tourId}
        tId={tId}
        resolve={resolveToken}
        serverScores={itaScoresById[active.id] || []}
        onServerScoresChange={(rows) =>
          setItaScoresById((prev) => ({ ...prev, [active.id]: rows }))
        }
      />
    ) : (
      <BracketCanvas
        bracket={activeForDisplay || active}  // 👈 usa la versione con nomi
        interactive
        confirmOnPick
        winners={winnersById[active.id] || {}}
        onWinnersChange={(w) =>
          setWinnersById((prev) => ({ ...prev, [active.id]: w }))
        }
        tourId={tourId}
        tId={tId}
        externalResolver={resolveToken}       // ok tenerlo per Winner/Loser
      />
    )}
  </div>
) : null}

          </>
        )}
      </div>
    ) : (
      <>
        {/* ——— GIRONI: partite + classifiche + avulsa ——— */}

     {/* Partite */}

<MobileGroupsCarousel
  letters={letters}
  tId={tId}
  scheduleRows={scheduleRows}
  setTime={setTime}
  setScore={setScore}
  fmtOf={fmtOf}
  colorFor={colorFor}
  times={times}
  scores={scores}
/>

{/* DESKTOP/TABLET: layout originale a griglia (immutato) */}
<div className="hidden md:block space-y-4">
  {chunk(letters, 2).map((pair, idx) => (
    <div
      key={idx}
      className="grid gap-4"
      style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}
    >
      {pair.map((L) => {
        const color = colorFor(L), rows = scheduleRows(L)
        return (
          <div key={`${tId}-${L}`} className="card p-0 overflow-hidden">
            <div className="h-9 px-3 flex items-center text-white" style={{ background: color }}>
              <div className="text-sm font-semibold">Partite {L} — {fmtOf(L).toUpperCase()}</div>
            </div>
            <div className="p-3 space-y-2">
              {rows.length === 0 ? (
                <div className="text-xs text-neutral-500">Imposta i gironi in /admin/gironi.</div>
              ) : (
                rows.map((r, ridx) => (
                  <div
                    key={`${tId}-${L}-${r.key}`}
                    className="grid items-center"
                    style={{
                      gridTemplateColumns: '96px minmax(0,1fr) 44px 16px 44px minmax(0,1fr)',
                      columnGap: '.35rem',
                    }}
                  >
                    <input
                      type="time"
                      className="input h-8 pl-1 pr-0 text-sm text-white w-[92px] tabular-nums"
                      value={(times[L] ?? [])[ridx] ?? ''}
                      onChange={(e) => setTime(L, ridx, e.target.value)}
                    />
                    <div className="min-w-0 truncate text-sm text-right pr-0.5">{r.labelA}</div>
                    <input
                      className="input h-8 w-12 px-1 text-sm text-center"
                      inputMode="numeric"
                      value={scores[L]?.[ridx]?.a ?? ''}
                      onChange={(e) => {
                        const v = e.currentTarget.value.replace(/\D/g, '').slice(0, 2)
                        setScore(L, ridx, 'a', v)
                      }}
                    />
                    <div className="w-6 text-center text-[13px] text-neutral-400">vs</div>
                    <input
                      className="input h-8 w-12 px-1 text-sm text-center"
                      inputMode="numeric"
                      value={scores[L]?.[ridx]?.b ?? ''}
                      onChange={(e) => {
                        const v = e.currentTarget.value.replace(/\D/g, '').slice(0, 2)
                        setScore(L, ridx, 'b', v)
                      }}
                    />
                    <div className="min-w-0 truncate text-sm pl-1">{r.labelB}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        )
      })}
    </div>
  ))}
</div>

        {/* Classifiche per girone */}
        <div className="space-y-6">
          {chunk(letters, 4).map((row, i) => (
            <div key={i} className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {row.map((L) => {
                const color = colorFor(L),
                  stats = computeStatsFor(L)
                return (
                  <div key={L} className="card p-0 overflow-hidden">
                    <div
                      className="px-3 py-2 font-semibold text-white"
                      style={{ background: color }}
                    >
                      Classifica {L}
                    </div>
                    <div className="p-3">
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
                          {stats.map((s, idx2) => (
                            <tr key={idx2} className="border-t border-neutral-800">
                              <td className="py-1 pr-2 truncate">{s.label}</td>
                              <td className="text-right">{s.W}</td>
                              <td className="text-right">{s.PF}</td>
                              <td className="text-right">{s.PS}</td>
                              <td className="text-right">{(s.QP || 0).toFixed(3)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="mt-2 text-[11px] text-neutral-500">
                        W=Vittorie · PF=Punti Fatti · PS=Punti Subiti · QP=PF/PS
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {/* Avulsa */}
        <div className="card p-3">
          <div className="text-lg font-semibold mb-3">Classifica Avulsa</div>
          <table className="w-full text-sm">
            <thead className="text-xs text-neutral-400">
              <tr>
                <th className="text-left">Pos</th>
                <th className="text-left">Gir</th>
                <th className="text-left">Team</th>
                <th className="text-right">W</th>
                <th className="text-right">PF</th>
                <th className="text-right">PS</th>
                <th className="text-right">QP</th>
              </tr>
            </thead>
            <tbody>
              {avulsa.map((r, i) => (
                <tr key={i} className="border-t border-neutral-800">
                  <td className="py-1">{r.pos}</td>
                  <td>{r.letter}</td>
                  <td className="truncate">{r.label}</td>
                  <td className="text-right">{r.W}</td>
                  <td className="text-right">{r.PF}</td>
                  <td className="text-right">{r.PS}</td>
                  <td className="text-right">{(r.QP || 0).toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    )}
  </div>
)
}
