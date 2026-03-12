'use client'

import { useEffect, useMemo, useState } from 'react'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'
import useSWR from 'swr'

const fetcher = (u: string) => fetch(u).then(r => r.json()).catch(() => null)

type Tour = { id: string; name: string }
type Tournament = { id: string; name: string; date?: string }
type RegRow = { id: string; label: string; label_short?: string }

const LETTERS = 'ABCDEFGHIJKLMNOP'.split('') // fino a 16 gironi

// PALETTE UNIFICATA (A→P) — usata anche in /admin/stampa
const GROUP_COLORS: Record<string, string> = {
  A:'#2563EB', B:'#EF4444', C:'#F59E0B', D:'#8B5CF6',
  E:'#10B981', F:'#FB923C', G:'#06B6D4', H:'#8B5CF6',
  I:'#22C55E', J:'#F97316', K:'#0EA5E9', L:'#EAB308',
  M:'#84CC16', N:'#F43F5E', O:'#14B8A6', P:'#64748B',
}
const colorFor = (L: string) => GROUP_COLORS[L] ?? '#334155'

// “Rossi Luca — Bianchi Marco” -> “Rossi L / Bianchi M” | CDC/IN CERCA
const compact = (s: string) => {
  const parts = s.split('—').map(p => p.trim())

  const left = parts[0] ?? ''
  const right = parts[1] ?? ''

  // CDC / IN CERCA
  const up = right.toUpperCase()
  if (up.includes('CDC')) return `${left} / CDC`
  if (up.includes('CERCA')) return `${left} / IN CERCA`

  // Se è squadra (ha spazi multipli → tipo "I Bimbi di Robi")
  // Mostra nome squadra completo + solo cognome capitano
  const firstWordRight = right.split(/\s+/)[0] ?? ''

  return firstWordRight
    ? `${left} / ${firstWordRight}`
    : left
}


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
const pool4 = () => ({
  r1: [[1, 4], [2, 3]] as Array<[number, number]>,
  r2: ['Vincente G1 vs Vincente G2', 'Perdente G1 vs Perdente G2']
})

type Meta = { capacity: number; format: 'pool' | 'ita'; bestOf?: 1 | 3 }
type PersistServer = {
  groupsCount: number;
  meta: Record<string, { capacity: number; format: 'pool'|'ita'; bestOf?: 1 | 3 }>;
  assign: Record<string, string>;
  times: Record<string, string[]>;
  gField: Record<string, string>;
  scores: Record<string, { a: string; b: string }[]>;
  isPublic: boolean;
  labels: Record<string, string>;
}


// util
const chunk = <T,>(arr: T[], size: number) => { const o: T[][] = []; for (let i = 0; i < arr.length; i += size) o.push(arr.slice(i, i + size)); return o }

export default function GironiPage() {
  // ---- Tour / Tappe
  const { data: toursRes } = useSWR('/api/tours', fetcher)
  const tours: Tour[] = toursRes?.items ?? []
  const [tourId, setTourId] = useState('')
  const { data: tappeRes } = useSWR(tourId ? `/api/tournaments?tour_id=${tourId}` : '/api/tournaments', fetcher)
  const tappe: Tournament[] = tappeRes?.items ?? []
  const [tId, setTId] = useState('')
  useEffect(() => { if (!tourId && tours.length) setTourId(tours[0].id) }, [tours, tourId])
 // max squadre della tappa selezionata (normalizzato a numero >= 0)
const maxTeamsRaw = (tappeRes?.items ?? []).find((t: any) => t.id === tId)?.max_teams
const maxTeams = Number.isFinite(+maxTeamsRaw) ? Math.max(0, +maxTeamsRaw) : 0

// --- Tappe visibili: esclude quelle chiuse + ordina per data desc (se presente)
const parseDate = (s?: string) => (s ? new Date(s).getTime() : 0)
const tappeVisibili = useMemo(() => {
  const arr = (tappeRes?.items ?? []) as any[]
  return arr.filter(t => t?.status !== 'closed')
            .sort((a, b) => parseDate(b?.date) - parseDate(a?.date))
}, [tappeRes])

// Se non c'è tId, seleziona la prima tappa VISIBILE
useEffect(() => {
  if (!tId && tappeVisibili.length) setTId(tappeVisibili[0].id)
}, [tappeVisibili, tId])

// Se la tappa selezionata diventa non visibile (chiusa), resetta
useEffect(() => {
  if (!tId) return
  const ok = tappeVisibili.some(t => t.id === tId)
  if (!ok) setTId('')
}, [tId, tappeVisibili])

  // ---- Iscritti
  const { data: regsRes } = useSWR(
  tId ? `/api/registrations/by-tournament?tournament_id=${tId}` : null,
  fetcher
)

// NB: l'API ritorna gli iscritti nell'ordine "ufficiale"
// Se maxTeams > 0, prendi solo i primi maxTeams (esclude "in attesa")
const regAll: RegRow[] = ((regsRes?.items ?? []) as any[])
  .filter((_, idx) => (maxTeams > 0 ? idx < maxTeams : true))
  .map(x => ({
    id: x.id,
    label: (x.label_short ?? x.label ?? '').trim(),
  }))

  const regMap = useMemo(() => Object.fromEntries(regAll.map(r => [r.id, r.label])), [regAll])

  // lista a destra con DnD (solo visual)
  const [order, setOrder] = useState<string[]>([])
  useEffect(() => { if (regAll.length) setOrder(regAll.map(r => r.id)) }, [regAll.length])
  const ordered = order.map(id => regAll.find(r => r.id === id)).filter(Boolean) as RegRow[]
  const onDragEnd = (r: DropResult) => { if (!r.destination) return; const a = [...order]; const [m] = a.splice(r.source.index, 1); a.splice(r.destination.index, 0, m!); setOrder(a) }

  // ---- Stato gironi
  const [groupsCount, setGroupsCount] = useState(4)
  const letters = useMemo(() => LETTERS.slice(0, Math.max(1, groupsCount)), [groupsCount])
  const [meta, setMeta] = useState<Record<string, Meta>>({})
  const [assign, setAssign] = useState<Record<string, string>>({})
  const [times, setTimes] = useState<Record<string, string[]>>({})

  // CAMPO per girone
  const [gField, setGField] = useState<Record<string, string>>({})

  // Punteggi per partita
  type Score = { a: string; b: string }
  const [scores, setScores] = useState<Record<string, Score[]>>({})
// Visibilità (salvata su Supabase)
const [isPublic, setIsPublic] = useState(false)

   // ---- Stato gironi su Supabase (rimpiazza il vecchio localStorage)


const [ready, setReady] = useState(false)

// LOAD da Supabase quando cambia tId
useEffect(() => {
  (async () => {
    // 1) subito svuoto lo stato locale per evitare che il vecchio “appaia” nella nuova tappa
    setReady(false)
    setGroupsCount(4)
    setMeta({})
    setAssign({})
    setTimes({})
    setGField({})
    setScores({})
    setIsPublic(false)

    if (!tId) return

    try {
      const res = await fetch(`/api/groups/state?tournament_id=${tId}`, {
        headers: { 'x-role': 'admin' }, // API protetta
        cache: 'no-store',
      })
      const js = await res.json()
      const st: Partial<PersistServer> = js?.state || {}

      if (st.groupsCount != null) setGroupsCount(st.groupsCount)
      else setGroupsCount(4)

      setMeta(st.meta ?? {})
      setAssign(st.assign ?? {})
      setTimes(st.times ?? {})
      setGField(st.gField ?? {})
      setScores(st.scores ?? {})
      setIsPublic(typeof st.isPublic === 'boolean' ? st.isPublic : false)

      // NB: le labels le rigeneriamo da regMap (vedi patch 2)
      setReady(true)
    } catch {
      // stato “vuoto” se non presente
      setGroupsCount(4)
      setMeta({})
      setAssign({})
      setTimes({})
      setGField({})
      setScores({})
      setIsPublic(false)
      setReady(true)
    }
  })()
}, [tId])
function isEmptyStateForSave(st: {
  groupsCount: number;
  meta: Record<string, any>;
  assign: Record<string, any>;
}) {
  if (!st) return true
  if (!st.groupsCount || st.groupsCount < 1) return true
  if (!st.meta || Object.keys(st.meta).length === 0) return true
  // (opzionale) almeno un capacity > 0
  const someCap = Object.values(st.meta).some((m:any) => Number(m?.capacity) > 0)
  if (!someCap) return true
  return false
}

// SAVE auto (debounce) verso Supabase
useEffect(() => {
  if (!ready || !tId) return

  const payload: PersistServer = {
    groupsCount,
    meta,
    assign,
    times,
    gField,
    scores,
    isPublic,
    labels: regMap,
  }

  // 🛡️ blocca salvataggi vuoti/prematuri
  if (isEmptyStateForSave({ groupsCount, meta, assign })) return

  const id = setTimeout(async () => {
    try {
      await fetch('/api/groups/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-role': 'admin' },
        body: JSON.stringify({ tournament_id: tId, state: payload }),
      })
    } catch {}
  }, 300)

  return () => clearTimeout(id)
}, [ready, tId, groupsCount, meta, assign, times, gField, scores, isPublic, regMap])

  // util
  const regToLetter = useMemo(() => { const m: Record<string, string> = {}; for (const [k, v] of Object.entries(assign)) { if (!v) continue; const L = k.split('-')[0]; m[v] = L } return m }, [assign])
  const isUsedElsewhere = (rid: string, selfKey: string) => { for (const [k, v] of Object.entries(assign)) if (k !== selfKey && v === rid) return true; return false }

  function labelBySlot(L: string, slot: number) { const rid = assign[`${L}-${slot}`]; return rid ? (regMap[rid] ?? `Slot ${slot}`) : `Slot ${slot}` }

 function scheduleRows(L: string) {
  const m = meta[L] ?? { capacity: 0, format: 'pool', bestOf: 1 as 1|3 }
  const cap = m.capacity ?? 0
  if (cap < 2) return [] as { t1: string; t2: string; scoreIdx: number; matchIdx: number; setNo: 1|2|3; sep?: boolean }[]

  const bestOf = (m.bestOf ?? 1) as 1 | 3

  // base matches (1 riga per match)
  const base =
    (m.format === 'pool' && cap === 4)
      ? (() => {
          const p = pool4()
          return [
            { t1: labelBySlot(L, p.r1[0][0]), t2: labelBySlot(L, p.r1[0][1]) },
            { t1: labelBySlot(L, p.r1[1][0]), t2: labelBySlot(L, p.r1[1][1]) },
            { t1: 'Vincente G1', t2: 'Vincente G2' },
            { t1: 'Perdente G1', t2: 'Perdente G2' },
          ]
        })()
      : rr(Math.min(cap, 6)).map(([a, b]) => ({ t1: labelBySlot(L, a), t2: labelBySlot(L, b) }))

  // explode: 1->1 riga, 3->3 righe per match (con separatore sopra al match)
  const out: { t1: string; t2: string; scoreIdx: number; matchIdx: number; setNo: 1|2|3; sep?: boolean }[] = []
  base.forEach((match, matchIdx) => {
    for (let s = 0; s < bestOf; s++) {
      out.push({
  ...match,
  scoreIdx: matchIdx * bestOf + s,
  matchIdx,
  setNo: (s + 1) as 1 | 2 | 3,
  sep: bestOf === 3 && s === 0 && matchIdx > 0,
})
    }
  })
  return out
}

function computeGroupRankingCorrect(L: string) {
  const rows = scheduleRows(L)
  const bestOf = (meta[L]?.bestOf ?? 1) as 1 | 3

  const isRealTeam = (name: string) => {
    const s = String(name || '').trim().toLowerCase()
    if (!s) return false
    if (s.startsWith('vincente')) return false
    if (s.startsWith('perdente')) return false
    return true
  }

  type TeamStat = {
    team: string
    matchWon: number
    matchLost: number
    setWon: number
    setLost: number
    pointsWon: number
    pointsLost: number
  }

  const ensure = (map: Record<string, TeamStat>, team: string) => {
    if (!map[team]) {
      map[team] = {
        team,
        matchWon: 0,
        matchLost: 0,
        setWon: 0,
        setLost: 0,
        pointsWon: 0,
        pointsLost: 0,
      }
    }
  }

  const ratio = (a: number, b: number) => {
    if (b <= 0) return a > 0 ? 999999 : 0
    return a / b
  }

  // 1) raggruppo righe per matchIdx
  const matchMap: Record<number, typeof rows> = {}
  for (const r of rows) {
    if (!matchMap[r.matchIdx]) matchMap[r.matchIdx] = []
    matchMap[r.matchIdx].push(r)
  }

  type MatchResult = {
    A: string
    B: string
    Aw: number
    Bw: number
    Aset: number
    Bset: number
    Ap: number
    Bp: number
    played: boolean
  }

  const matches: MatchResult[] = []

  Object.values(matchMap).forEach((sets) => {
    const A = sets[0]?.t1 ?? ''
    const B = sets[0]?.t2 ?? ''
    if (!isRealTeam(A) || !isRealTeam(B)) return

    let Aset = 0
    let Bset = 0
    let Ap = 0
    let Bp = 0
    let anySetPlayed = false

    for (const s of sets) {
      const aRaw = scores[L]?.[s.scoreIdx]?.a
      const bRaw = scores[L]?.[s.scoreIdx]?.b
      const a = Number(aRaw)
      const b = Number(bRaw)

      if (!Number.isFinite(a) || !Number.isFinite(b)) continue
      if (a === 0 && b === 0) continue

      anySetPlayed = true
      Ap += a
      Bp += b

      if (a > b) Aset++
      else if (b > a) Bset++
    }

    if (!anySetPlayed) return

    let Aw = 0
    let Bw = 0

    if (bestOf === 1) {
      if (Ap > Bp) Aw = 1
      else if (Bp > Ap) Bw = 1
    } else {
      if (Aset > Bset) Aw = 1
      else if (Bset > Aset) Bw = 1
    }

    matches.push({ A, B, Aw, Bw, Aset, Bset, Ap, Bp, played: true })
  })

  // 2) stats globali
  const global: Record<string, TeamStat> = {}

  for (const m of matches) {
    ensure(global, m.A)
    ensure(global, m.B)

    global[m.A].pointsWon += m.Ap
    global[m.A].pointsLost += m.Bp
    global[m.B].pointsWon += m.Bp
    global[m.B].pointsLost += m.Ap

    global[m.A].setWon += m.Aset
    global[m.A].setLost += m.Bset
    global[m.B].setWon += m.Bset
    global[m.B].setLost += m.Aset

    if (m.Aw === 1) {
      global[m.A].matchWon += 1
      global[m.B].matchLost += 1
    } else if (m.Bw === 1) {
      global[m.B].matchWon += 1
      global[m.A].matchLost += 1
    }
  }

  const teamsAll = Object.values(global)
  if (!teamsAll.length) return []

  // 3) mini-classifica per scontro diretto
  const miniTable = (teamNames: string[]) => {
    const setTeams = new Set(teamNames)
    const mini: Record<string, TeamStat> = {}
    for (const t of teamNames) ensure(mini, t)

    for (const m of matches) {
      if (!setTeams.has(m.A) || !setTeams.has(m.B)) continue

      mini[m.A].pointsWon += m.Ap
      mini[m.A].pointsLost += m.Bp
      mini[m.B].pointsWon += m.Bp
      mini[m.B].pointsLost += m.Ap

      mini[m.A].setWon += m.Aset
      mini[m.A].setLost += m.Bset
      mini[m.B].setWon += m.Bset
      mini[m.B].setLost += m.Aset

      if (m.Aw === 1) {
        mini[m.A].matchWon += 1
        mini[m.B].matchLost += 1
      } else if (m.Bw === 1) {
        mini[m.B].matchWon += 1
        mini[m.A].matchLost += 1
      }
    }

    return Object.values(mini)
  }

  // 4) raggruppo per vittorie e ordino con scontro diretto
  const groupsByWins: Record<number, TeamStat[]> = {}
  for (const t of teamsAll) {
    const w = t.matchWon
    if (!groupsByWins[w]) groupsByWins[w] = []
    groupsByWins[w].push(t)
  }

  const winsSorted = Object.keys(groupsByWins).map(Number).sort((a, b) => b - a)
  const finalList: TeamStat[] = []

  for (const w of winsSorted) {
    const group = groupsByWins[w]
    if (group.length === 1) {
      finalList.push(group[0])
      continue
    }

    const names = group.map(x => x.team)
    const mini = miniTable(names)
    const miniMap = Object.fromEntries(mini.map(x => [x.team, x]))

    group.sort((a, b) => {
      const ma = miniMap[a.team]
      const mb = miniMap[b.team]

      if (mb.matchWon !== ma.matchWon) return mb.matchWon - ma.matchWon

      const srA = ratio(ma.setWon, ma.setLost)
      const srB = ratio(mb.setWon, mb.setLost)
      if (srB !== srA) return srB - srA

      const prA = ratio(ma.pointsWon, ma.pointsLost)
      const prB = ratio(mb.pointsWon, mb.pointsLost)
      if (prB !== prA) return prB - prA

      const gsrA = ratio(a.setWon, a.setLost)
      const gsrB = ratio(b.setWon, b.setLost)
      if (gsrB !== gsrA) return gsrB - gsrA

      const gprA = ratio(a.pointsWon, a.pointsLost)
      const gprB = ratio(b.pointsWon, b.pointsLost)
      if (gprB !== gprA) return gprB - gprA

      return a.team.localeCompare(b.team)
    })

    finalList.push(...group)
  }

  return finalList
} 

function normalizeTime(raw: string) {
  let v = String(raw || '').trim()
  // accetta "9", "9:3", "0930", "09:30" ecc.
  const m = v.match(/^(\d{1,2})(?::?(\d{0,2}))?$/)
  if (!m) return ''
  let h = Math.min(23, Number(m[1]))
  let mm = m[2] == null ? 0 : Number(m[2].padEnd(2, '0'))
  mm = Math.min(59, mm)
  const HH = String(h).padStart(2, '0')
  const MM = String(mm).padStart(2, '0')
  return `${HH}:${MM}`
}

function commitTimeUncontrolled(
  L: string,
  idx: number,
  input: HTMLInputElement,
  setTime: (L: string, idx: number, val: string) => void
) {
  const v = normalizeTime(input.value)
  if (v) setTime(L, idx, v)
  input.value = v // riscrivo il formato normalizzato nel campo
}

  // setter helper
  function setTime(L: string, idx: number, val: string) {
    const arr = [...(times[L] ?? [])]; arr[idx] = val
    setTimes(t => ({ ...t, [L]: arr }))
  }
  function setScore(L: string, idx: number, side: 'a' | 'b', val: string) {
    const arr = [...(scores[L] ?? [])]
    const row = arr[idx] ?? { a: '', b: '' }
    row[side] = val
    arr[idx] = row
    setScores(s => ({ ...s, [L]: arr }))
  }

  // ---- UI: cards gironi
  function GroupCard({ L }: { L: string }) {
    const color = colorFor(L)
     const m = meta[L] ?? { capacity: 0, format: 'pool', bestOf: 1 }
    const cap = m.capacity ?? 0
    return (
      <div className="card p-0 overflow-hidden" key={L}>
        {/* Header girone (testo bianco) */}
        <div className="px-3 py-2" style={{ background: color }}>
          <div className="flex items-center gap-2 text-white">
            <div className="text-base font-extrabold tracking-wide mr-2">GIRONE {L}</div>
            <input
              className="input w-16 text-center bg-white/90 text-black"
              type="number" min={0}
              value={m.capacity}
              onChange={e => {
                const v = Math.max(0, Number(e.target.value || 0))
                setMeta(mm => ({ ...mm, [L]: { ...(mm[L] ?? { capacity: 0, format: 'pool' }), capacity: v } }))
              }}
              title="Numero squadre"
            />
            <select
              className="input w-24 bg-white/90 text-black"
              value={m.format}
              onChange={e => setMeta(mm => ({ ...mm, [L]: { ...(mm[L] ?? { capacity: 0, format: 'pool' }), format: e.target.value as any } }))}
              title="Formato"
            >
              <option value="ita">ITA</option>
              <option value="pool">Pool</option>
            </select>
            <select
  className="input w-20 bg-white/90 text-black"
  value={String(m.bestOf ?? 1)}
  onChange={e =>
    setMeta(mm => ({
      ...mm,
      [L]: {
        ...(mm[L] ?? { capacity: 0, format: 'pool', bestOf: 1 }),
        bestOf: (Number(e.target.value) === 3 ? 3 : 1) as 1 | 3,
      },
    }))
  }
  title="Numero set"
>
  <option value="1">1 set</option>
  <option value="3">3 set</option>
</select>
            <div className="ml-auto text-xs opacity-80 text-white/90">#</div>
          </div>
        </div>

        {/* Slot squadra */}
        <div className="p-3 space-y-2">
          {Array.from({ length: cap }, (_, i) => i + 1).map(slot => {
            const key = `${L}-${slot}`, sel = assign[key] ?? ''
            return (
              <div key={key} className="flex items-center gap-2">
                <div className="w-5 text-xs text-neutral-500">{slot}.</div>
                <select className="input w-full text-white placeholder-neutral-400" value={sel}
                  onChange={e => setAssign(a => ({ ...a, [key]: e.target.value }))}>
                  <option value="">—</option>
                  {ordered.map(r => {
                    const used = sel !== r.id && isUsedElsewhere(r.id, key)
                    return (
                      <option key={r.id} value={r.id} disabled={used}
                        style={used ? { color: '#9ca3af' } : undefined}>
                        {r.label}{used ? '  (x)' : ''}
                      </option>
                    )
                  })}
                </select>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

   // ---- UI: partite (due colonne)
  function SchedulesRow({ pair }: { pair: string[] }) {
    return (
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(2,minmax(0,1fr))' }}>
        {pair.map(L => {
          const color = colorFor(L)
          const rows = scheduleRows(L)

          return (
            <div key={`${tId}-sch-${L}`} className="card p-0 overflow-hidden">
              {/* Barra colore full + CAMPO */}
              <div className="h-9 px-3 flex items-center justify-between text-white" style={{ background: color }}>
                <div className="text-sm font-semibold">
                  Partite {L} — {(meta[L]?.format ?? 'pool').toString().toUpperCase()}
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs tracking-wide uppercase text-white/90">Campo</span>
                  <input
                    type="text"
                    className="input h-7 w-24 bg-white/90 text-black"
                    placeholder="es. 3"
                    value={gField[L] ?? ''}
                    onChange={(e) => setGField(prev => ({ ...prev, [L]: e.target.value }))}
                    title="Campo predefinito del girone"
                  />
                </div>
              </div>

                         {/* Elenco partite */}
              <div className="p-3 space-y-0">
                {rows.length === 0 ? (
                  <div className="text-xs text-neutral-500">Imposta # squadre e formato.</div>
                ) : (
                  rows.map((r, idx) => {
                    const isFirstSet = r.setNo === 1
                    const isLastSetOfMatch = r.setNo === (meta[L]?.bestOf ?? 1)

                    return (
                      <div key={idx}>
                        {r.sep && <div className="h-px bg-neutral-800 my-3" />}

                        <div
                          className="grid items-center min-h-[38px]"
                          style={{
                            gridTemplateColumns: '86px minmax(0,1fr) 44px 16px 44px minmax(0,1fr)',
                            columnGap: '.35rem',
                          }}
                        >
                          {/* Ora */}
                          {isFirstSet ? (
                            <input
                              type="text"
                              inputMode="numeric"
                              placeholder="hh:mm"
                              className="input h-8 pl-1 pr-0 text-sm text-white tabular-nums w-[82px]"
                              defaultValue={(times[L] ?? [])[r.matchIdx] ?? ''}
                              onBlur={(e) => commitTimeUncontrolled(L, r.matchIdx, e.currentTarget, setTime)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  ;(e.currentTarget as HTMLInputElement).blur()
                                }
                              }}
                              title="Ora"
                            />
                          ) : (
                            <div className="w-[82px] h-8" />
                          )}

                          {/* Team / Set */}
                          <div className="min-w-0 truncate text-sm text-right pr-0.5">
                            {isFirstSet ? r.t1 : (
                              <span className="text-neutral-400 font-medium">SET {r.setNo}</span>
                            )}
                          </div>

                          {/* Score A */}
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="\d*"
                            maxLength={2}
                            defaultValue={scores[L]?.[r.scoreIdx]?.a ?? ''}
                            onBlur={(e) => {
                              const v = e.currentTarget.value.replace(/\D/g, '').slice(0, 2)
                              setScore(L, r.scoreIdx, 'a', v)
                              e.currentTarget.value = v
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                ;(e.currentTarget as HTMLInputElement).blur()
                              }
                            }}
                            className="input h-8 w-12 px-1 text-sm text-center tabular-nums"
                            title="Punteggio squadra 1"
                          />

                          {/* VS */}
                          <div className="w-6 text-center text-[13px] text-neutral-400">
                            {isFirstSet ? 'vs' : ''}
                          </div>

                          {/* Score B */}
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="\d*"
                            maxLength={2}
                            defaultValue={scores[L]?.[r.scoreIdx]?.b ?? ''}
                            onBlur={(e) => {
                              const v = e.currentTarget.value.replace(/\D/g, '').slice(0, 2)
                              setScore(L, r.scoreIdx, 'b', v)
                              e.currentTarget.value = v
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                ;(e.currentTarget as HTMLInputElement).blur()
                              }
                            }}
                            className="input h-8 w-12 px-1 text-sm text-center tabular-nums"
                            title="Punteggio squadra 2"
                          />

                          {/* Team B */}
                          <div className="min-w-0 truncate text-sm pl-1">
                            {isFirstSet ? r.t2 : ''}
                          </div>
                        </div>

                        {!isLastSetOfMatch && <div className="h-1" />}
                      </div>
                    )
                  })
                )}
              </div>
              {/* Classifica */}
{(() => {
  const ranking = computeGroupRankingCorrect(L)
  if (!ranking.length) return null
  return (
    <div className="px-3 pb-3">
      <div className="mt-2 border-t border-neutral-800 pt-2">
        <div className="text-xs text-neutral-400 mb-1">Classifica {L}</div>
        <div className="space-y-1 text-sm">
          {ranking.map((r, i) => (
            <div key={r.team} className="flex justify-between gap-2">
              <div className="min-w-0 truncate">{i + 1}. {r.team}</div>
              <div className="text-neutral-400 tabular-nums shrink-0">{r.matchWon}W</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
})()}
            </div>
          )
        })}
      </div>
    )
  }
  return (
    <div className="p-6">
      <div className="card p-3 grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
        {/* colonna sinistra */}
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <div className="text-xs text-neutral-400 mb-1">Tour</div>
              <select className="input w-full" value={tourId} onChange={e => { setTourId(e.target.value); setTId('') }}>
                {tours.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <div className="text-xs text-neutral-400 mb-1">Tappa</div>
             <select className="input w-full" value={tId} onChange={e => setTId(e.target.value)}>
  {tappeVisibili.map((t:any) => (
    <option key={t.id} value={t.id}>
      {t.name}{t.date ? ` — ${new Date(t.date).toLocaleDateString()}` : ''}
    </option>
  ))}
</select>

            </div>
            <div>
              <div className="text-xs text-neutral-400 mb-1"># Gironi</div>
              <input className="input w-24" type="number" min={1} value={groupsCount}
                onChange={e => setGroupsCount(Math.max(1, Number(e.target.value || 1)))} />
            </div>
          <div className="flex items-end gap-2">
  <button
    className="btn"
    onClick={() => {
      if (!tId) return alert('Seleziona la tappa')
      if (!confirm('Resetta i gironi di questa tappa (server)?')) return
      setGroupsCount(4)
      setMeta({})
      setAssign({})
      setTimes({})
      setGField({})
      setScores({})
      setIsPublic(false)
      // il salvataggio parte in automatico (effect 3.b)
    }}
  >
    Reset
  </button>

  <button
    className="btn btn-ghost"
    onClick={()=>alert('Il salvataggio è automatico su server.')}
    title="Salvataggio automatico attivo"
  >
    Salva
  </button>

  <button
    className={isPublic ? 'btn btn-success' : 'btn btn-ghost'}
    onClick={() => setIsPublic(v => !v)} // basta aggiornare lo stato; l’auto-save ci pensa
  >
    {isPublic ? 'Visibile agli atleti' : 'Non visibile'}
  </button>
</div>

          </div>

         {/* griglia gironi (responsive, niente chunk) */}
<div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
 {letters.map(L => <GroupCard key={`${tId}-${L}`} L={L} />)}
</div>

          

          {/* griglia partite: A|B poi C|D ... */}
          <div className="space-y-4">
            {chunk(letters, 2).map((pair, i) => <SchedulesRow key={`s2-${i}`} pair={pair} />)}
          </div>
        </div>

        {/* colonna destra: giocatori */}
        <div className="lg:sticky lg:top-4 lg:h-[calc(100vh-3rem)]">
          <div className="card p-3 h-full overflow-auto">
            <div className="font-semibold mb-2 text-lg">Giocatori</div>
            <DragDropContext onDragEnd={onDragEnd}>
              <Droppable droppableId="pool">
                {p => (
                  <div ref={p.innerRef} {...p.droppableProps} className="space-y-1">
                    {ordered.map((r, i) => {
                      const L = regToLetter[r.id]; const color = L ? colorFor(L) : 'transparent'
                      return (
                        <Draggable key={r.id} draggableId={r.id} index={i}>
                          {prov => (
                            <div
                              ref={prov.innerRef}
                              {...prov.draggableProps}
                              {...prov.dragHandleProps}
                              className="rounded px-2 py-1 text-sm flex items-center gap-2 border border-neutral-800"
                              style={{ ...prov.draggableProps.style, borderLeft: `6px solid ${color}` }}
                            >
                              <div className="w-6 text-neutral-500">{(i + 1).toString().padStart(2, '0')}</div>
                              <div className="truncate">{r.label}</div>
                            </div>
                          )}
                        </Draggable>
                      )
                    })}
                    {p.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          </div>
        </div>
      </div>
    </div>
  )
}
