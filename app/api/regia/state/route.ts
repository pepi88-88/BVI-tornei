import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseServer'
import { requireAdmin } from '@/lib/auth'

type GroupMeta = {
  capacity: number
  format?: 'pool' | 'ita'
  bestOf?: 1 | 3
}

type GroupState = {
  groupsCount?: number
  meta?: Record<string, GroupMeta>
  assign?: Record<string, string>
  labels?: Record<string, string>
  times?: Record<string, string[]>
  scores?: Record<string, { a: string; b: string }[]>
  groupsConfirmed?: boolean
  regia?: {
    items?: Record<string, RegiaItemState>
  }
  isPublic?: boolean
}

type Bracket = {
  id: string
  title: string
  color: string
  type: 'SE' | 'DE' | 'ITA'
  nTeams: number
  source: 'gironi' | 'avulsa' | 'eliminati' | 'gironi+eliminati' | 'avulsa+eliminati'
  fromTableId?: string
  r1: { A: string; B: string }[]
  slots: string[]
}

type WinnerMap = Record<string, 'A' | 'B' | undefined>

type BracketState = {
  items?: Bracket[]
  winnersById?: Record<string, WinnerMap>
  itaScoresById?: Record<string, any[]>
  regia?: {
    items?: Record<string, RegiaItemState>
  }
}

type RegiaStatus = 'waiting' | 'queued' | 'live' | 'paused' | 'done'

type RegiaItemState = {
  court: number | null
  sequence: number | null
  status: RegiaStatus
  scheduledTimeManual?: string
}

type RegiaRow = {
  key: string
  sourceType: 'girone' | 'bracket'
  tournament_id: string
  phase: string
  teamA: string
  teamB: string
  scheduledTime: string
  court: number | null
  sequence: number | null
  status: RegiaStatus
}

type ScheduleRow = {
  key: string
  a?: number
  b?: number
  labelA: string
  labelB: string
  setNo: number
  matchIdx: number
  scoreIdx: number
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
function getGroupLetters(gs: GroupState) {
  const set = new Set<string>()

  for (const [k, v] of Object.entries(gs?.meta || {})) {
    if (Number(v?.capacity ?? 0) > 0) set.add(String(k).toUpperCase())
  }

  for (const key of Object.keys(gs?.assign || {})) {
    const m = key.match(/^([A-Za-z]+)-\d+$/)
    if (m) set.add(m[1].toUpperCase())
  }

  const arr = Array.from(set).sort()

  if (arr.length) return arr

  return LETTERS.slice(0, Math.max(1, gs?.groupsCount ?? 0))
}
function nextPow2(n: number) {
  let p = 1
  while (p < n) p <<= 1
  return p
}

function normalizeBracket(b: any): Bracket {
  const n = Math.max(2, Number(b?.nTeams) || 8)
  const r1 = Array.from({ length: nextPow2(n) / 2 }, (_, i) => ({
    A: b?.r1?.[i]?.A ?? '-',
    B: b?.r1?.[i]?.B ?? '-',
  }))
  const slots = Array.from({ length: nextPow2(n) }, (_, i) => b?.slots?.[i] ?? '')
  return {
    id: String(b?.id || Math.random().toString(36).slice(2, 10)),
    title: String(b?.title || 'TABELLONE'),
    color: String(b?.color || '#22c55e'),
    type: (b?.type as Bracket['type']) || 'SE',
    nTeams: n,
    source: (b?.source as Bracket['source']) || 'gironi',
    fromTableId: b?.fromTableId || undefined,
    r1,
    slots,
  }
}

function shortSurname(full: string) {
  const s = String(full || '').trim().replace(/\s+[A-Z]\.?$/u, '')
  const parts = s.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''

  const PARTICLES = new Set([
    'DE', 'DEL', 'DEI', 'DEGLI', 'DELLA', 'DELL', 'DELL’', "DELL'",
    'DELLE', 'DELLO', 'DI', 'D’', "D'", 'DA', 'DAL', 'DALLA', 'DALL’', "DALL'",
    'LA', 'LE', 'LO', 'VAN', 'VON', 'VANDER', 'DER',
  ])

  let start = parts.length - 1
  while (start - 1 >= 0) {
    const prev = parts[start - 1].toUpperCase()
    if (PARTICLES.has(prev)) start -= 1
    else break
  }

  return parts.slice(start).join(' ')
}

function lastSurnames(label: string) {
  const s = String(label || '').trim()
  if (!s) return ''
  if (!s.includes('—') && !s.includes('/')) return s
  const parts = s.replace(/—/g, '/').split('/').map((p) => p.trim()).filter(Boolean)
  if (parts.length >= 2) return `${shortSurname(parts[0])} / ${shortSurname(parts[1])}`
  return shortSurname(s)
}

function rrPairs(n: number) {
  const t = Array.from({ length: n }, (_, i) => i + 1)
  if (t.length < 2) return [] as Array<[number, number]>
  if (t.length % 2 === 1) t.push(0)
  const rounds = t.length - 1
  const half = t.length / 2
  const out: Array<[number, number]> = []

  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < half; i++) {
      const a = t[i]
      const b = t[t.length - 1 - i]
      if (a !== 0 && b !== 0) out.push([a, b])
    }
    const fixed = t[0]
    const rest = t.slice(1)
    rest.unshift(rest.pop()!)
    t.splice(0, t.length, fixed, ...rest)
  }
  return out
}

const poolPairs = {
  semi1: [1, 4] as [number, number],
  semi2: [2, 3] as [number, number],
}

function capOf(gs: GroupState, L: string) {
  return Number(gs?.meta?.[L]?.capacity ?? 0)
}

function fmtOf(gs: GroupState, L: string) {
  return (gs?.meta?.[L]?.format ?? 'pool').toLowerCase()
}

function bestOfOf(gs: GroupState, L: string): 1 | 3 {
  return Number(gs?.meta?.[L]?.bestOf ?? 1) === 3 ? 3 : 1
}

function labelBySlot(gs: GroupState, L: string, slot: number) {
  const rid = gs?.assign?.[`${L}-${slot}`] ?? ''
  const raw = rid ? gs?.labels?.[rid] ?? '' : ''
  if (raw) return raw
  if (rid) return rid
  return `Slot ${slot}`
}

function scheduleRowsForGroup(gs: GroupState, L: string): ScheduleRow[] {
  const cap = capOf(gs, L)
  const fmt = fmtOf(gs, L)
  const bestOf = bestOfOf(gs, L)

  if (cap < 2) return []

  const explodeMatch = (
    base: { key: string; a?: number; b?: number; labelA: string; labelB: string },
    matchIdx: number
  ): ScheduleRow[] => {
    return Array.from({ length: bestOf }, (_, si) => ({
      ...base,
      key: `${base.key}-S${si + 1}`,
      setNo: si + 1,
      matchIdx,
      scoreIdx: matchIdx * bestOf + si,
    }))
  }

  if (fmt === 'pool' && cap === 4) {
    const s1 = poolPairs.semi1
    const s2 = poolPairs.semi2

    const m0 = {
      key: 'S1',
      a: s1[0],
      b: s1[1],
      labelA: labelBySlot(gs, L, s1[0]),
      labelB: labelBySlot(gs, L, s1[1]),
    }
    const m1 = {
      key: 'S2',
      a: s2[0],
      b: s2[1],
      labelA: labelBySlot(gs, L, s2[0]),
      labelB: labelBySlot(gs, L, s2[1]),
    }
    const m2 = {
      key: 'F12',
      labelA: 'Vincente G1',
      labelB: 'Vincente G2',
    }
    const m3 = {
      key: 'F34',
      labelA: 'Perdente G1',
      labelB: 'Perdente G2',
    }

    return [
      ...explodeMatch(m0, 0),
      ...explodeMatch(m1, 1),
      ...explodeMatch(m2 as any, 2),
      ...explodeMatch(m3 as any, 3),
    ]
  }

  const baseMatches = rrPairs(cap).map(([a, b], i) => ({
    key: `R${i + 1}`,
    a,
    b,
    labelA: labelBySlot(gs, L, a),
    labelB: labelBySlot(gs, L, b),
  }))

  const out: ScheduleRow[] = []
  baseMatches.forEach((m, matchIdx) => out.push(...explodeMatch(m, matchIdx)))
  return out
}

function matchWinnerFromScores(gs: GroupState, L: string, matchIdx: number): { winner?: 'A' | 'B' } {
  const bestOf = bestOfOf(gs, L)
  const need = bestOf === 3 ? 2 : 1
  const sc = gs?.scores?.[L] ?? []
  let wa = 0
  let wb = 0

  for (let s = 0; s < bestOf; s++) {
    const row = sc[matchIdx * bestOf + s]
    const a = Number(row?.a)
    const b = Number(row?.b)
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue
    if (a === b) continue
    if (a > b) wa++
    else wb++
  }

  if (wa >= need) return { winner: 'A' }
  if (wb >= need) return { winner: 'B' }
  return {}
}

function matchPointsSum(gs: GroupState, L: string, matchIdx: number) {
  const bestOf = bestOfOf(gs, L)
  const sc = gs?.scores?.[L] ?? []
  let aPF = 0
  let aPS = 0
  let bPF = 0
  let bPS = 0

  for (let s = 0; s < bestOf; s++) {
    const row = sc[matchIdx * bestOf + s]
    const a = Number(row?.a)
    const b = Number(row?.b)
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue
    aPF += a
    aPS += b
    bPF += b
    bPS += a
  }

  return { aPF, aPS, bPF, bPS }
}

function computeStatsForGroup(gs: GroupState, L: string) {
  const cap = capOf(gs, L)
  const fmt = (gs?.meta?.[L]?.format ?? 'pool').toLowerCase() as 'pool' | 'ita'
  const init: Record<number, any> = {}

  for (let s = 1; s <= cap; s++) {
    init[s] = {
      slot: s,
      label: labelBySlot(gs, L, s),
      W: 0,
      PF: 0,
      PS: 0,
      QP: 0,
      SW: 0,
      SL: 0,
      QS: 0,
      finish: undefined as number | undefined,
    }
  }

  const rows = scheduleRowsForGroup(gs, L)

  const apply = (slotA?: number, slotB?: number, matchIdx?: number) => {
    if (!slotA || !slotB) return
    const mi = matchIdx ?? 0

    const pts = matchPointsSum(gs, L, mi)
    init[slotA].PF += pts.aPF
    init[slotA].PS += pts.aPS
    init[slotB].PF += pts.bPF
    init[slotB].PS += pts.bPS

    const bestOf = bestOfOf(gs, L)
    const sc = gs?.scores?.[L] ?? []

    for (let s = 0; s < bestOf; s++) {
      const row = sc[mi * bestOf + s]
      const a = Number(row?.a)
      const b = Number(row?.b)
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue
      if (a === b) continue

      if (a > b) {
        init[slotA].SW += 1
        init[slotB].SL += 1
      } else {
        init[slotB].SW += 1
        init[slotA].SL += 1
      }
    }

    const win = matchWinnerFromScores(gs, L, mi).winner
    if (win === 'A') init[slotA].W += 1
    else if (win === 'B') init[slotB].W += 1
  }

  rows.forEach((r) => {
    if (r?.setNo !== 1) return
    apply(r.a, r.b, r.matchIdx)
  })

  for (const s of Object.values<any>(init)) {
    s.QP = s.PF / Math.max(1, s.PS)
    s.QS = s.SW / Math.max(1, s.SL)
  }

  const headToHeadWinner = (slotX: number, slotY: number): number | undefined => {
    const rr = scheduleRowsForGroup(gs, L)
    for (const r of rr) {
      if (r.setNo !== 1) continue
      const a = r.a
      const b = r.b
      if (!a || !b) continue

      const ok = (a === slotX && b === slotY) || (a === slotY && b === slotX)
      if (!ok) continue

      const w = matchWinnerFromScores(gs, L, r.matchIdx).winner
      if (!w) return undefined
      return w === 'A' ? a : b
    }
    return undefined
  }

  const miniStatsAmong = (slots: number[]) => {
    const setSlots = new Set(slots)
    const tmp: Record<number, { W: number; SW: number; SL: number; PF: number; PS: number; QS: number; QP: number }> = {}

    for (const s of slots) {
      tmp[s] = { W: 0, SW: 0, SL: 0, PF: 0, PS: 0, QS: 0, QP: 0 }
    }

    const rr = scheduleRowsForGroup(gs, L)
    const bestOf = bestOfOf(gs, L)
    const sc = gs?.scores?.[L] ?? []

    for (const r of rr) {
      if (r.setNo !== 1) continue
      const a = r.a
      const b = r.b
      if (!a || !b) continue
      if (!setSlots.has(a) || !setSlots.has(b)) continue

      for (let si = 0; si < bestOf; si++) {
        const row = sc[r.matchIdx * bestOf + si]
        const va = Number(row?.a)
        const vb = Number(row?.b)
        if (!Number.isFinite(va) || !Number.isFinite(vb)) continue

        tmp[a].PF += va
        tmp[a].PS += vb
        tmp[b].PF += vb
        tmp[b].PS += va

        if (va === vb) continue
        if (va > vb) {
          tmp[a].SW += 1
          tmp[b].SL += 1
        } else {
          tmp[b].SW += 1
          tmp[a].SL += 1
        }
      }

      const w = matchWinnerFromScores(gs, L, r.matchIdx).winner
      if (w === 'A') tmp[a].W += 1
      else if (w === 'B') tmp[b].W += 1
    }

    for (const s of slots) {
      tmp[s].QS = tmp[s].SW / Math.max(1, tmp[s].SL)
      tmp[s].QP = tmp[s].PF / Math.max(1, tmp[s].PS)
    }

    return tmp
  }

  if (fmt === 'pool' && cap === 4) {
    const s1 = poolPairs.semi1
    const s2 = poolPairs.semi2

    const w1 = matchWinnerFromScores(gs, L, 0).winner
    const w2 = matchWinnerFromScores(gs, L, 1).winner

    const wSlot1 = w1 ? (w1 === 'A' ? s1[0] : s1[1]) : undefined
    const lSlot1 = w1 ? (w1 === 'A' ? s1[1] : s1[0]) : undefined
    const wSlot2 = w2 ? (w2 === 'A' ? s2[0] : s2[1]) : undefined
    const lSlot2 = w2 ? (w2 === 'A' ? s2[1] : s2[0]) : undefined

    const wf = matchWinnerFromScores(gs, L, 2).winner
    if (wSlot1 && wSlot2 && wf) {
      const first = wf === 'A' ? wSlot1 : wSlot2
      const second = wf === 'A' ? wSlot2 : wSlot1
      init[first].finish = 1
      init[second].finish = 2
    }

    const wl = matchWinnerFromScores(gs, L, 3).winner
    if (lSlot1 && lSlot2 && wl) {
      const third = wl === 'A' ? lSlot1 : lSlot2
      const fourth = wl === 'A' ? lSlot2 : lSlot1
      init[third].finish = 3
      init[fourth].finish = 4
    }

    const arr = Object.values<any>(init)
    arr.sort((x, y) => {
      const fx = x.finish ?? 999
      const fy = y.finish ?? 999
      if (fx !== fy) return fx - fy
      if (y.W !== x.W) return y.W - x.W
      if (y.QP !== x.QP) return y.QP - x.QP
      if (y.PF !== x.PF) return y.PF - x.PF
      return x.slot - y.slot
    })
    return arr
  }

  const arr = Object.values<any>(init)
  arr.sort((A, B) => {
    if (B.W !== A.W) return B.W - A.W

    const tiedSlots = Object.values<any>(init)
      .filter((x) => x.W === A.W)
      .map((x) => x.slot)

    if (tiedSlots.length === 2) {
      const w = headToHeadWinner(A.slot, B.slot)
      if (w === A.slot) return -1
      if (w === B.slot) return 1
    } else if (tiedSlots.length >= 3) {
      const ms = miniStatsAmong(tiedSlots)
      const a = ms[A.slot]
      const b = ms[B.slot]
      if (a && b) {
        if (b.W !== a.W) return b.W - a.W
        if (b.QS !== a.QS) return b.QS - a.QS
        if (b.QP !== a.QP) return b.QP - a.QP
        if (b.PF !== a.PF) return b.PF - a.PF
      }
    }

    if (B.QS !== A.QS) return B.QS - A.QS
    if (B.QP !== A.QP) return B.QP - A.QP
    if (B.PF !== A.PF) return B.PF - A.PF
    return A.slot - B.slot
  })

  return arr
}
function isGroupResolved(gs: GroupState, L: string) {
  const rows = scheduleRowsForGroup(gs, L).filter((r) => r.setNo === 1)
  if (!rows.length) return false

  return rows.every((r) => {
    const winner = matchWinnerFromScores(gs, L, r.matchIdx).winner
    return !!winner
  })
}
function buildGroupsRank(gs: GroupState) {
  const letters = getGroupLetters(gs)
  const byGroup: Record<string, string[]> = {}
  const avulsaRows: Array<{
    letter: string
    pos: number
    label: string
    W: number
    PF: number
    PS: number
    QP: number
  }> = []

  for (const L of letters) {
    if (!isGroupResolved(gs, L)) {
      byGroup[L] = []
      continue
    }

    const stats = computeStatsForGroup(gs, L)
    byGroup[L] = stats.map((r: any) => lastSurnames(r.label))

    stats.forEach((r: any, idx: number) => {
      avulsaRows.push({
        letter: L,
        pos: idx + 1,
        label: lastSurnames(r.label),
        W: r.W,
        PF: r.PF,
        PS: r.PS,
        QP: r.QP,
      })
    })
  }

  avulsaRows.sort((a, b) =>
    (a.pos - b.pos) ||
    (b.W - a.W) ||
    (b.QP - a.QP) ||
    a.letter.localeCompare(b.letter)
  )

  return {
    byGroup,
    avulsa: avulsaRows.map((r) => r.label),
  }
}
function normalizeRefText(s: string) {
  return String(s || '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
}
function makeBracketResolver(
  gs: GroupState,
  brackets: Bracket[],
  winnersById: Record<string, WinnerMap>,
) {
  const { byGroup, avulsa } = buildGroupsRank(gs)
 const byTitle = new Map(brackets.map((b) => [normalizeRefText(b.title), b]))

  const baseResolve = (token: string): string => {
    const raw = String(token || '').trim()
    if (!raw) return '—'
    
    if (raw === '-' || raw === '—') return '—'
    if (raw.toUpperCase() === 'BYE') return 'BYE'

  let m = raw.match(/^([A-Z])(\d{1,2})$/)
if (m) {
  const letter = m[1].toUpperCase()
  const pos = Math.max(1, Number(m[2])) - 1
  const name = byGroup[letter]?.[pos]
  return name || ''
}

m = raw.match(/^(\d{1,2})([A-Z])$/)
if (m) {
  const letter = m[2].toUpperCase()
  const pos = Math.max(1, Number(m[1])) - 1
  const name = byGroup[letter]?.[pos]
  return name || ''
}

if (/^\d+$/.test(raw)) {
  const idx = Math.max(1, Number(raw)) - 1
  return avulsa[idx] || ''
}
    return raw
  }

  const externalResolve = (token: string): string | undefined => {
    const raw = String(token || '').trim()
    if (!raw) return undefined

   const m = raw.match(/^(Perdente|Loser|Vincente|Winner)\s+(.+?)\s+([A-Za-z]+|M)?\s*(\d+)$/i)
    if (!m) return undefined

    const kind = m[1].toLowerCase()
   const titleU = normalizeRefText(m[2])
    let prefix = String(m[3] || 'R').toUpperCase()
if (prefix === 'M') prefix = 'R'
    const num = Number(m[4])

    const br = byTitle.get(titleU)
    if (!br || !Number.isFinite(num) || num < 1) return undefined

    const winners = winnersById[br.id] || {}
    const code = `${prefix}${num}`

    const labelsForCode = (code: string): { A: string; B: string } | null => {
      if (/^R\d+$/i.test(code)) {
        const idx = Number(code.slice(1)) - 1
        const pair = br.r1?.[idx]
        if (!pair) return null
        return {
          A: baseResolve(String(pair.A || '').trim()),
          B: baseResolve(String(pair.B || '').trim()),
        }
      }

      if (/^Z\d+$/i.test(code)) {
        const idx = Number(code.slice(1)) - 1
        const left = `R${idx * 2 + 1}`
        const right = `R${idx * 2 + 2}`
        return {
  A: winnerOfCode(left) || '',
  B: winnerOfCode(right) || '',
}
      }

    if (/^Y\d+$/i.test(code)) {
  const idx = Number(code.slice(1))
  const z = `Z${idx}`
  return {
    A: winnerOfCode(z) || '',
    B: '',
  }
}

        if (/^X\d+$/i.test(code)) {
        const idx = Number(code.slice(1))

        if (idx === 1) {
         return {
  A: loserOfCode('R1') || '',
  B: loserOfCode('R2') || '',
}
        }

       if (idx === 2) {
  return {
    A: loserOfCode('R3') || '',
    B: loserOfCode('R4') || '',
  }
}

if (idx === 3) {
  return {
    A: winnerOfCode('X1') || '',
    B: '',
  }
}

if (idx === 4) {
  return {
    A: winnerOfCode('X2') || '',
    B: '',
  }
}

        return null
      }

      if (/^Q\d+$/i.test(code)) {
        const idx = Number(code.slice(1))

      if (idx === 1) {
  return {
    A: loserOfCode('Z1') || '',
    B: '',
  }
}

if (idx === 2) {
  return {
    A: loserOfCode('Z2') || '',
    B: '',
  }
}

        return null
      }

      if (/^W\d+$/i.test(code)) {
        const idx = Number(code.slice(1))

     if (idx === 1) {
  return {
    A: winnerOfCode('Q1') || '',
    B: winnerOfCode('X3') || '',
  }
}

if (idx === 2) {
  return {
    A: winnerOfCode('Q2') || '',
    B: winnerOfCode('X4') || '',
  }
}
        return null
      }

      if (/^CO\d+$/i.test(code)) {
        const idx = Number(code.slice(2))

      if (idx === 1) {
  return {
    A: winnerOfCode('Y1') || '',
    B: winnerOfCode('W2') || '',
  }
}

if (idx === 2) {
  return {
    A: winnerOfCode('Y2') || '',
    B: winnerOfCode('W1') || '',
  }
}
        return null
      }
     if (code === 'F') {
  return {
    A: winnerOfCode('CO1') || '',
    B: winnerOfCode('CO2') || '',
  }
}

if (code === 'THIRD') {
  return {
    A: loserOfCode('CO1') || '',
    B: loserOfCode('CO2') || '',
  }
}
      return null
    }

    const winnerOfCode = (code: string): string => {
      const labels = labelsForCode(code)
      if (!labels) return ''
      const side = winners[code]
      if (side === 'A') return labels.A
      if (side === 'B') return labels.B
      return ''
    }

    const loserOfCode = (code: string): string => {
      const labels = labelsForCode(code)
      if (!labels) return ''
      const side = winners[code]
      if (side === 'A') return labels.B
      if (side === 'B') return labels.A
      return ''
    }

    if (kind === 'vincente' || kind === 'winner') {
      return winnerOfCode(code) || undefined
    }

    if (kind === 'perdente' || kind === 'loser') {
      return loserOfCode(code) || undefined
    }

    return undefined
  }

  return (token: string): string => {
    const ext = externalResolve(token)
    if (ext) return baseResolve(ext)
    return baseResolve(token)
  }
}

function phaseLabelSE(round: number, totalRounds: number, idx: number, title: string) {
  if (totalRounds === 1) return `Finale ${title}`
  if (round === totalRounds) return `Finale ${title}`
  if (round === totalRounds - 1) return `Semifinale ${title}`
  if (round === totalRounds - 2) return `Quarto ${title}`
  return `Turno ${round} ${title}`
}

function buildSERows(
  bracket: Bracket,
  allBrackets: Bracket[],
  gs: GroupState,
  winnersById: Record<string, WinnerMap>,
  regiaItems: Record<string, RegiaItemState>
): RegiaRow[] {
  const resolve = makeBracketResolver(gs, allBrackets, winnersById)
  const pow = nextPow2(Math.max(2, Number(bracket.nTeams) || 2))
  const rounds = Math.log2(pow)
  const rows: RegiaRow[] = []
  const winners = winnersById[bracket.id] || {}

  const labelsByCode: Record<string, { A: string; B: string }> = {}

  const r1Matches = pow / 2
  for (let i = 0; i < r1Matches; i++) {
    const code = `R${i + 1}`
    const pair = bracket.r1?.[i] ?? { A: '-', B: '-' }
    labelsByCode[code] = {
      A: resolve(String(pair.A || '').trim()),
      B: resolve(String(pair.B || '').trim()),
    }
  }

  let prevCodes = Array.from({ length: r1Matches }, (_, i) => `R${i + 1}`)
  const roundLetters = ['Z', 'Y', 'X', 'W']

  for (let round = 2; round <= rounds; round++) {
    const matchCount = prevCodes.length / 2
    const letter = roundLetters[round - 2] || `T${round}`
    const nextCodes: string[] = []

    for (let i = 0; i < matchCount; i++) {
      const code = `${letter}${i + 1}`
      nextCodes.push(code)
      const prevA = prevCodes[2 * i]
      const prevB = prevCodes[2 * i + 1]
      const wA = winners[prevA]
      const wB = winners[prevB]

      labelsByCode[code] = {
  A: wA ? labelsByCode[prevA][wA] : '',
  B: wB ? labelsByCode[prevB][wB] : '',
}
    }

    prevCodes = nextCodes
  }

  const phaseCodesByRound: string[][] = []
  phaseCodesByRound.push(Array.from({ length: r1Matches }, (_, i) => `R${i + 1}`))

  let prev = phaseCodesByRound[0]
  for (let round = 2; round <= rounds; round++) {
    const count = prev.length / 2
    const letter = roundLetters[round - 2] || `T${round}`
    const codes = Array.from({ length: count }, (_, i) => `${letter}${i + 1}`)
    phaseCodesByRound.push(codes)
    prev = codes
  }

  phaseCodesByRound.forEach((codes, roundIdx) => {
    const round = roundIdx + 1
    codes.forEach((code, idx) => {
      const key = `bracket:${bracket.id}:${code}`
      const reg = regiaItems[key] || { court: null, sequence: null, status: 'waiting' as RegiaStatus }
      rows.push({
        key,
        sourceType: 'bracket',
        tournament_id: '',
        phase: phaseLabelSE(round, rounds, idx, bracket.title),
        teamA: labelsByCode[code]?.A || '—',
        teamB: labelsByCode[code]?.B || '—',
        scheduledTime: reg.scheduledTimeManual || '',
        court: reg.court ?? null,
        sequence: reg.sequence ?? null,
        status: reg.status ?? 'waiting',
      })
    })
  })

  if (rounds >= 2) {
    const semis = phaseCodesByRound[phaseCodesByRound.length - 2] || []
    if (semis.length >= 2) {
      const semiA = semis[0]
      const semiB = semis[1]
      const winA = winners[semiA]
      const winB = winners[semiB]
      const loserA = winA ? labelsByCode[semiA][winA === 'A' ? 'B' : 'A'] : ''
const loserB = winB ? labelsByCode[semiB][winB === 'A' ? 'B' : 'A'] : ''
      const key = `bracket:${bracket.id}:THIRD`
      const reg = regiaItems[key] || { court: null, sequence: null, status: 'waiting' as RegiaStatus }

      rows.push({
        key,
        sourceType: 'bracket',
        tournament_id: '',
        phase: `3° / 4° ${bracket.title}`,
        teamA: loserA || '—',
teamB: loserB || '—',
        scheduledTime: reg.scheduledTimeManual || '',
        court: reg.court ?? null,
        sequence: reg.sequence ?? null,
        status: reg.status ?? 'waiting',
      })
    }
  }

  return rows
}

function buildDERows(
  bracket: Bracket,
  allBrackets: Bracket[],
  gs: GroupState,
  winnersById: Record<string, WinnerMap>,
  regiaItems: Record<string, RegiaItemState>
): RegiaRow[] {
  const resolve = makeBracketResolver(gs, allBrackets, winnersById)
  const W = winnersById[bracket.id] || {}

  const rLabel = (i: 0 | 1 | 2 | 3) => {
    const m = bracket.r1?.[i] ?? { A: '-', B: '-' }
    return { a: resolve(m.A), b: resolve(m.B) }
  }

  const labelsFor = (code: string): { a: string; b: string } => {
 switch (code) {
  case 'R1': return rLabel(0)
  case 'R2': return rLabel(1)
  case 'R3': return rLabel(2)
  case 'R4': return rLabel(3)

  case 'Z1':
  return {
    a: winnerOf('R1') || '',
    b: winnerOf('R2') || '',
  }

  case 'Z2':
  return {
    a: winnerOf('R3') || '',
    b: winnerOf('R4') || '',
  }

 case 'Y1':
  return {
    a: winnerOf('Z1') || '',
    b: '',
  }

case 'Y2':
  return {
    a: winnerOf('Z2') || '',
    b: '',
  }

case 'X1':
  return {
    a: loserOf('R1') || '',
    b: loserOf('R2') || '',
  }

case 'X2':
  return {
    a: loserOf('R3') || '',
    b: loserOf('R4') || '',
  }

case 'X3':
  return {
    a: winnerOf('X1') || '',
    b: '',
  }

case 'X4':
  return {
    a: winnerOf('X2') || '',
    b: '',
  }

case 'Q1':
  return {
    a: loserOf('Z1') || '',
    b: '',
  }

case 'Q2':
  return {
    a: loserOf('Z2') || '',
    b: '',
  }

case 'W1':
  return {
    a: winnerOf('Q1') || '',
    b: winnerOf('X3') || '',
  }

case 'W2':
  return {
    a: winnerOf('Q2') || '',
    b: winnerOf('X4') || '',
  }

case 'CO1':
  return {
    a: winnerOf('Y1') || '',
    b: winnerOf('W2') || '',
  }

case 'CO2':
  return {
    a: winnerOf('Y2') || '',
    b: winnerOf('W1') || '',
  }

case 'F':
  return {
    a: winnerOf('CO1') || '',
    b: winnerOf('CO2') || '',
  }

case 'THIRD':
  return {
    a: loserOf('CO1') || '',
    b: loserOf('CO2') || '',
  }

  default:
    return { a: '—', b: '—' }
}
  }

  function winnerOf(code: string): string {
    const w = W[code]
    const { a, b } = labelsFor(code)
    if (w === 'A') return a
    if (w === 'B') return b
    return ''
  }

  function loserOf(code: string): string {
    const w = W[code]
    const { a, b } = labelsFor(code)
    if (w === 'A') return b
    if (w === 'B') return a
    return ''
  }

 const defs = [
  { code: 'R1', phase: `Round 1 ${bracket.title}` },
  { code: 'R2', phase: `Round 1 ${bracket.title}` },
  { code: 'R3', phase: `Round 1 ${bracket.title}` },
  { code: 'R4', phase: `Round 1 ${bracket.title}` },

  { code: 'Z1', phase: `Upper ${bracket.title}` },
  { code: 'Z2', phase: `Upper ${bracket.title}` },

  { code: 'Y1', phase: `Upper ${bracket.title}` },
  { code: 'Y2', phase: `Upper ${bracket.title}` },

  { code: 'X1', phase: `Losers ${bracket.title}` },
  { code: 'X2', phase: `Losers ${bracket.title}` },
  { code: 'X3', phase: `Losers ${bracket.title}` },
  { code: 'X4', phase: `Losers ${bracket.title}` },

  { code: 'Q1', phase: `Losers ${bracket.title}` },
  { code: 'Q2', phase: `Losers ${bracket.title}` },

  { code: 'W1', phase: `Losers ${bracket.title}` },
  { code: 'W2', phase: `Losers ${bracket.title}` },

  { code: 'CO1', phase: `Semifinale ${bracket.title}` },
  { code: 'CO2', phase: `Semifinale ${bracket.title}` },

  { code: 'F', phase: `Finale ${bracket.title}` },
  { code: 'THIRD', phase: `3° / 4° ${bracket.title}` },
]

  return defs.map((d) => {
    const key = `bracket:${bracket.id}:${d.code}`
    const reg = regiaItems[key] || { court: null, sequence: null, status: 'waiting' as RegiaStatus }
    const labels = labelsFor(d.code)

    return {
      key,
      sourceType: 'bracket' as const,
      tournament_id: '',
      phase: d.phase,
     teamA: labels.a || '—',
teamB: labels.b || '—',
      scheduledTime: reg.scheduledTimeManual || '',
      court: reg.court ?? null,
      sequence: reg.sequence ?? null,
      status: reg.status ?? 'waiting',
    }
  })
}

function sortRows(rows: RegiaRow[]) {
  return [...rows].sort((a, b) => {
    // PRIORITÀ STATUS
    const order = { live: 0, queued: 1, paused: 2, waiting: 3, done: 4 }
    const sa = order[a.status] ?? 99
    const sb = order[b.status] ?? 99
    if (sa !== sb) return sa - sb

    // poi campo
    const ac = a.court == null ? 999 : a.court
    const bc = b.court == null ? 999 : b.court
    if (ac !== bc) return ac - bc

    // poi sequenza
    const as = a.sequence == null ? 999 : a.sequence
    const bs = b.sequence == null ? 999 : b.sequence
    if (as !== bs) return as - bs

    return a.key.localeCompare(b.key)
  })
}

function resequenceCourt(rows: RegiaRow[], court: number) {
  const active = rows
    .filter((r) => r.court === court && (r.status === 'queued' || r.status === 'live'))
    .sort((a, b) => {
      if (a.status === 'live' && b.status !== 'live') return -1
      if (b.status === 'live' && a.status !== 'live') return 1
      return (a.sequence ?? 999) - (b.sequence ?? 999)
    })

  active.forEach((r, idx) => {
    r.sequence = idx + 1
  })
}

function readRegiaState(rows: RegiaRow[], key: string) {
  const row = rows.find((r) => r.key === key)
  return row || null
}

function applyRowsBackToStates(rows: RegiaRow[], groupState: GroupState, bracketState: BracketState) {
  const gMap: Record<string, RegiaItemState> = {}
  const bMap: Record<string, RegiaItemState> = {}

  rows.forEach((r) => {
    const payload: RegiaItemState = {
  court: r.court ?? null,
  sequence: r.sequence ?? null,
  status: r.status,
  scheduledTimeManual: r.sourceType === 'bracket' ? (r.scheduledTime || '') : undefined,
}
    if (r.sourceType === 'girone') gMap[r.key] = payload
    else bMap[r.key] = payload
  })

  groupState.regia = { items: gMap }
  bracketState.regia = { items: bMap }
}

async function loadStates(s: ReturnType<typeof supabaseAdmin>, tournament_id: string) {
  const [{ data: gData, error: gError }, { data: bData, error: bError }] = await Promise.all([
    s.from('group_states').select('state, is_public').eq('tournament_id', tournament_id).maybeSingle(),
    s.from('bracket_states').select('state, is_public').eq('tournament_id', tournament_id).maybeSingle(),
  ])

  if (gError) throw new Error(gError.message)
  if (bError) throw new Error(bError.message)

  const groupState = (gData?.state || {}) as GroupState
  const rawBracketState = bData?.state || {}
  const bracketState: BracketState = Array.isArray(rawBracketState)
    ? { items: rawBracketState.map(normalizeBracket), winnersById: {}, itaScoresById: {}, regia: { items: {} } }
    : {
        items: Array.isArray(rawBracketState?.items) ? rawBracketState.items.map(normalizeBracket) : [],
        winnersById: rawBracketState?.winnersById || {},
        itaScoresById: rawBracketState?.itaScoresById || {},
        regia: rawBracketState?.regia || { items: {} },
      }

  return { groupState, bracketState, gData, bData }
}
function resolvePoolLabel(
  gs: GroupState,
  L: string,
  label: string
): string {
  const raw = String(label || '').trim()
  if (!raw) return '—'

  const isPool4 = fmtOf(gs, L) === 'pool' && capOf(gs, L) === 4
  if (!isPool4) return lastSurnames(raw)

  const w1 = matchWinnerFromScores(gs, L, 0).winner
  const w2 = matchWinnerFromScores(gs, L, 1).winner

  const s1 = poolPairs.semi1
  const s2 = poolPairs.semi2

  const winnerG1 = w1 ? (w1 === 'A' ? labelBySlot(gs, L, s1[0]) : labelBySlot(gs, L, s1[1])) : ''
  const loserG1  = w1 ? (w1 === 'A' ? labelBySlot(gs, L, s1[1]) : labelBySlot(gs, L, s1[0])) : ''

  const winnerG2 = w2 ? (w2 === 'A' ? labelBySlot(gs, L, s2[0]) : labelBySlot(gs, L, s2[1])) : ''
  const loserG2  = w2 ? (w2 === 'A' ? labelBySlot(gs, L, s2[1]) : labelBySlot(gs, L, s2[0])) : ''

  if (/^Vincente G1$/i.test(raw)) return winnerG1 ? lastSurnames(winnerG1) : 'Vincente G1'
  if (/^Vincente G2$/i.test(raw)) return winnerG2 ? lastSurnames(winnerG2) : 'Vincente G2'
  if (/^Perdente G1$/i.test(raw)) return loserG1 ? lastSurnames(loserG1) : 'Perdente G1'
  if (/^Perdente G2$/i.test(raw)) return loserG2 ? lastSurnames(loserG2) : 'Perdente G2'

  return lastSurnames(raw)
}

function resolveGroupRowTeams(gs: GroupState, L: string, r: ScheduleRow) {
  return {
    teamA: resolvePoolLabel(gs, L, r.labelA),
    teamB: resolvePoolLabel(gs, L, r.labelB),
  }
}
function buildAllRows(tournament_id: string, groupState: GroupState, bracketState: BracketState): RegiaRow[] {
  const rows: RegiaRow[] = []
  const groupRegia = groupState?.regia?.items || {}
  const bracketRegia = bracketState?.regia?.items || {}
  const letters = getGroupLetters(groupState)

  for (const L of letters) {
    const matchRows = scheduleRowsForGroup(groupState, L).filter((r) => r.setNo === 1)
    matchRows.forEach((r) => {
      const key = `girone:${L}:${r.matchIdx}`
      const reg = groupRegia[key] || { court: null, sequence: null, status: 'waiting' as RegiaStatus }
      const resolved = resolveGroupRowTeams(groupState, L, r)

rows.push({
  key,
  sourceType: 'girone',
  tournament_id,
  phase: `Girone ${L}`,
  teamA: resolved.teamA,
  teamB: resolved.teamB,
  scheduledTime: groupState?.times?.[L]?.[r.matchIdx] || '',
  court: reg.court ?? null,
  sequence: reg.sequence ?? null,
  status: reg.status ?? 'waiting',
})
    })
  }

  const brackets = bracketState?.items || []
  const winnersById = bracketState?.winnersById || {}

  brackets.forEach((b) => {
    let list: RegiaRow[] = []
    if (b.type === 'SE') list = buildSERows(b, brackets, groupState, winnersById, bracketRegia)
    else if (b.type === 'DE') list = buildDERows(b, brackets, groupState, winnersById, bracketRegia)
    else list = []

    list.forEach((r) => {
      r.tournament_id = tournament_id
      rows.push(r)
    })
  })
  return rows
}

async function persistStates(
  s: ReturnType<typeof supabaseAdmin>,
  tournament_id: string,
  groupState: GroupState,
  bracketState: BracketState,
  gData: any,
  bData: any,
) {
  const gPayload = {
    tournament_id,
    state: groupState,
    is_public: Boolean(groupState?.isPublic ?? gData?.is_public ?? false),
    updated_at: new Date().toISOString(),
  }

  const bPayload = {
    tournament_id,
    state: {
      items: bracketState.items || [],
      winnersById: bracketState.winnersById || {},
      itaScoresById: bracketState.itaScoresById || {},
      regia: bracketState.regia || { items: {} },
    },
    is_public: Boolean(bData?.is_public ?? false),
    updated_at: new Date().toISOString(),
  }

  const [{ error: gErr }, { error: bErr }] = await Promise.all([
    s.from('group_states').upsert(gPayload, { onConflict: 'tournament_id' }),
    s.from('bracket_states').upsert(bPayload, { onConflict: 'tournament_id' }),
  ])

  if (gErr) throw new Error(gErr.message)
  if (bErr) throw new Error(bErr.message)
}

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return new NextResponse('Unauthorized', { status: 401 })

  try {
    const sp = new URL(req.url).searchParams
    const tournament_ids = sp.getAll('tournament_id').map((x) => String(x || '').trim()).filter(Boolean)

    if (!tournament_ids.length) {
      return NextResponse.json({ error: 'Missing tournament_id' }, { status: 400 })
    }

    const s = supabaseAdmin()
    const allRows: RegiaRow[] = []

    for (const tournament_id of tournament_ids) {
      const { groupState, bracketState } = await loadStates(s, tournament_id)
      const rows = buildAllRows(tournament_id, groupState, bracketState)
      allRows.push(...rows)
    }

    return NextResponse.json({
      ok: true,
      rows: sortRows(allRows),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Errore GET regia' }, { status: 500 })
  }
}
function applyAssignmentToRow(
  target: RegiaRow,
  patch: {
    court?: number | null
    sequence?: number | null
    scheduledTime?: string
  }
) {
  if (target.status === 'live') {
    throw new Error('Una partita LIVE non può essere spostata')
  }

  const nextCourt = patch.court == null ? null : Number(patch.court)
  const nextSequence = patch.sequence == null ? null : Number(patch.sequence)
  const nextScheduledTime = String(patch.scheduledTime || '').trim()

  target.scheduledTime = nextScheduledTime

  if (nextCourt == null) {
    target.court = null
    target.sequence = null
    target.status = 'waiting'
  } else {
    target.court = nextCourt
    target.sequence = nextSequence
    if (target.status === 'waiting' || target.status === 'paused') {
      target.status = 'queued'
    }
  }
}

export async function PUT(req: NextRequest) {
  if (!requireAdmin(req)) return new NextResponse('Unauthorized', { status: 401 })

  try {
  const body = (await req.json().catch(() => null)) as
  | {
      tournament_id?: string
      action?:
        | 'save_assignment'
        | 'save_assignment_batch'
        | 'set_live'
        | 'stop_live'
        | 'close_match'
        | 'reopen_match'
        | 'reset_tournament_regia'
      key?: string
      court?: number | null
      sequence?: number | null
      scheduledTime?: string
      changes?: Array<{
        key: string
        court?: number | null
        sequence?: number | null
        scheduledTime?: string
      }>
    }
  | null
   const tournament_id = String(body?.tournament_id || '').trim()
const action = body?.action
const key = String(body?.key || '').trim()

if (!tournament_id || !action) {
  return NextResponse.json({ error: 'Missing params' }, { status: 400 })
}

if (
  action !== 'reset_tournament_regia' &&
  action !== 'save_assignment_batch' &&
  !key
) {
  return NextResponse.json({ error: 'Missing key' }, { status: 400 })
}

   const s = supabaseAdmin()
const { groupState, bracketState, gData, bData } = await loadStates(s, tournament_id)
const rows = buildAllRows(tournament_id, groupState, bracketState)

const target =
  action === 'reset_tournament_regia' || action === 'save_assignment_batch'
    ? null
    : readRegiaState(rows, key)

if (
  action !== 'reset_tournament_regia' &&
  action !== 'save_assignment_batch' &&
  !target
) {
  return NextResponse.json({ error: 'Partita non trovata' }, { status: 404 })
}

if (action === 'save_assignment') {
  if (!target) {
    return NextResponse.json({ error: 'Partita non trovata' }, { status: 404 })
  }

  try {
    applyAssignmentToRow(target, {
      court: body?.court,
      sequence: body?.sequence,
      scheduledTime: body?.scheduledTime,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Errore assegnazione' }, { status: 400 })
  }
}
    if (action === 'save_assignment_batch') {
  const changes = Array.isArray(body?.changes) ? body!.changes : []

  if (!changes.length) {
    return NextResponse.json({ error: 'Nessuna modifica da salvare' }, { status: 400 })
  }

  const seen = new Set<string>()

  for (const change of changes) {
    const changeKey = String(change?.key || '').trim()
    if (!changeKey) {
      return NextResponse.json({ error: 'Una modifica non ha key valida' }, { status: 400 })
    }
    if (seen.has(changeKey)) continue
    seen.add(changeKey)

    const row = readRegiaState(rows, changeKey)
    if (!row) {
      return NextResponse.json({ error: `Partita non trovata: ${changeKey}` }, { status: 404 })
    }

    try {
      applyAssignmentToRow(row, {
        court: change?.court,
        sequence: change?.sequence,
        scheduledTime: change?.scheduledTime,
      })
    } catch (err: any) {
      return NextResponse.json(
        { error: `${changeKey}: ${err?.message || 'Errore assegnazione'}` },
        { status: 400 }
      )
    }
  }
}

 
if (action === 'set_live') {
  if (!target) {
    return NextResponse.json({ error: 'Partita non trovata' }, { status: 404 })
  }

  if (target.court == null) {
    return NextResponse.json({ error: 'Assegna prima un campo' }, { status: 400 })
  }

  const otherLive = rows.find(
    (r) => r.key !== target.key && r.court === target.court && r.status === 'live'
  )
  if (otherLive) {
    return NextResponse.json({ error: `Sul Campo ${target.court} c'è già una partita LIVE` }, { status: 400 })
  }

  target.status = 'live'
  target.sequence = 1

  rows
    .filter((r) => r.key !== target.key && r.court === target.court && (r.status === 'queued' || r.status === 'live'))
    .sort((a, b) => (a.sequence ?? 999) - (b.sequence ?? 999))
    .forEach((r, idx) => {
      r.sequence = idx + 2
      if (r.status === 'live') r.status = 'queued'
    })

  resequenceCourt(rows, target.court)
}

if (action === 'stop_live') {
  if (!target) {
    return NextResponse.json({ error: 'Partita non trovata' }, { status: 404 })
  }

  if (target.status !== 'live') {
    return NextResponse.json({ error: 'La partita non è LIVE' }, { status: 400 })
  }

  target.status = 'paused'
  target.sequence = 0
}

if (action === 'close_match') {
  if (!target) {
    return NextResponse.json({ error: 'Partita non trovata' }, { status: 404 })
  }

  target.status = 'done'
}

if (action === 'reopen_match') {
  if (!target) {
    return NextResponse.json({ error: 'Partita non trovata' }, { status: 404 })
  }

  if (target.status !== 'done') {
    return NextResponse.json({ error: 'La partita non è chiusa' }, { status: 400 })
  }

  target.status = target.court != null ? 'queued' : 'waiting'

  if (target.court == null) {
    target.sequence = null
  }
}

if (action === 'reset_tournament_regia') {
  rows.forEach((r) => {
    r.court = null
    r.sequence = null
    r.status = 'waiting'
  })
}
    applyRowsBackToStates(rows, groupState, bracketState)
    await persistStates(s, tournament_id, groupState, bracketState, gData, bData)

    return NextResponse.json({
      ok: true,
      rows: sortRows(rows),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Errore PUT regia' }, { status: 500 })
  }
}
