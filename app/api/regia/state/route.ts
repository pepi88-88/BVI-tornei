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
  source: 'gironi' | 'avulsa' | 'eliminati' | 'gironi+eliminati'
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
    if (B.QS !== A.QS) return B.QS - A.QS
    if (B.QP !== A.QP) return B.QP - A.QP
    if (B.PF !== A.PF) return B.PF - A.PF
    return A.slot - B.slot
  })

  return arr
}

function buildGroupsRank(gs: GroupState) {
  const letters = LETTERS.slice(0, Math.max(1, gs?.groupsCount ?? 0))
  const byGroup: Record<string, string[]> = {}
  const avulsa: string[] = []

  for (const L of letters) {
    const stats = computeStatsForGroup(gs, L)
    byGroup[L] = stats.map((r: any) => lastSurnames(r.label))
    stats.forEach((r: any, idx: number) => {
      avulsa.push(JSON.stringify({
        letter: L,
        pos: idx + 1,
        label: lastSurnames(r.label),
        W: r.W,
        PF: r.PF,
        PS: r.PS,
        QP: r.QP,
      }))
    })
  }

  const avRows = avulsa.map((s) => JSON.parse(s))
  avRows.sort((a, b) => (a.pos - b.pos) || (b.W - a.W) || (b.QP - a.QP) || a.letter.localeCompare(b.letter))

  return {
    byGroup,
    avulsa: avRows.map((r) => r.label as string),
  }
}

function makeBracketResolver(
  gs: GroupState,
  brackets: Bracket[],
  winnersById: Record<string, WinnerMap>,
) {
  const { byGroup, avulsa } = buildGroupsRank(gs)
  const byTitle = new Map(brackets.map((b) => [b.title.toUpperCase(), b]))

  const baseResolve = (token: string): string => {
    if (!token) return '—'
    if (token === '-' || token === '—') return '—'
    if (token.toUpperCase() === 'BYE') return 'BYE'

    let m = token.match(/^([A-Z])(\d{1,2})$/)
    if (m) {
      const letter = m[1].toUpperCase()
      const pos = Math.max(1, Number(m[2])) - 1
      const name = byGroup[letter]?.[pos]
      return name || token
    }

    m = token.match(/^(\d{1,2})([A-Z])$/)
    if (m) {
      const letter = m[2].toUpperCase()
      const pos = Math.max(1, Number(m[1])) - 1
      const name = byGroup[letter]?.[pos]
      return name || token
    }

    if (/^\d+$/.test(token)) {
      const idx = Math.max(1, Number(token)) - 1
      return avulsa[idx] || token
    }

    return token
  }

  const externalResolve = (token: string): string | undefined => {
    const m = String(token).trim().match(/^(Perdente|Loser|Vincente|Winner)\s+(.+?)\s+([A-Za-z])?(\d+)$/i)
    if (!m) return undefined

    const kind = m[1].toLowerCase()
    const titleU = m[2].toUpperCase()
    const num = Number(m[4])

    const br = byTitle.get(titleU)
    if (!br || !Number.isFinite(num) || num < 1) return undefined

    const pair = br.r1?.[num - 1]
    if (!pair) return undefined

    const side = (winnersById[br.id] || {})[`R${num}`]
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
  gs: GroupState,
  winnersById: Record<string, WinnerMap>,
  regiaItems: Record<string, RegiaItemState>
): RegiaRow[] {
  const resolve = makeBracketResolver(gs, [bracket], winnersById)
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
        A: wA ? labelsByCode[prevA][wA] : `Winner ${prevA} — ${bracket.title}`,
        B: wB ? labelsByCode[prevB][wB] : `Winner ${prevB} — ${bracket.title}`,
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
        scheduledTime: '',
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
      const loserA = winA ? labelsByCode[semiA][winA === 'A' ? 'B' : 'A'] : `Loser ${semiA} — ${bracket.title}`
      const loserB = winB ? labelsByCode[semiB][winB === 'A' ? 'B' : 'A'] : `Loser ${semiB} — ${bracket.title}`
      const key = `bracket:${bracket.id}:THIRD`
      const reg = regiaItems[key] || { court: null, sequence: null, status: 'waiting' as RegiaStatus }

      rows.push({
        key,
        sourceType: 'bracket',
        tournament_id: '',
        phase: `3° / 4° ${bracket.title}`,
        teamA: loserA,
        teamB: loserB,
        scheduledTime: '',
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
  gs: GroupState,
  winnersById: Record<string, WinnerMap>,
  regiaItems: Record<string, RegiaItemState>
): RegiaRow[] {
  const resolve = makeBracketResolver(gs, [bracket], winnersById)
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
      case 'Z1': return { a: winnerOf('R1') || `Winner R1 — ${bracket.title}`, b: winnerOf('R2') || `Winner R2 — ${bracket.title}` }
      case 'Z2': return { a: winnerOf('R3') || `Winner R3 — ${bracket.title}`, b: winnerOf('R4') || `Winner R4 — ${bracket.title}` }
      case 'X1': return { a: loserOf('R1') || `Loser R1 — ${bracket.title}`, b: loserOf('R2') || `Loser R2 — ${bracket.title}` }
      case 'X2': return { a: loserOf('R3') || `Loser R3 — ${bracket.title}`, b: loserOf('R4') || `Loser R4 — ${bracket.title}` }
      case 'W1': return { a: loserOf('Z1') || `Loser Z1 — ${bracket.title}`, b: winnerOf('X1') || `Winner X1 — ${bracket.title}` }
      case 'W2': return { a: loserOf('Z2') || `Loser Z2 — ${bracket.title}`, b: winnerOf('X2') || `Winner X2 — ${bracket.title}` }
      case 'CO1': return { a: winnerOf('Z1') || `Winner Z1 — ${bracket.title}`, b: winnerOf('W2') || `Winner W2 — ${bracket.title}` }
      case 'CO2': return { a: winnerOf('Z2') || `Winner Z2 — ${bracket.title}`, b: winnerOf('W1') || `Winner W1 — ${bracket.title}` }
      case 'F': return { a: winnerOf('CO1') || `Winner CO1 — ${bracket.title}`, b: winnerOf('CO2') || `Winner CO2 — ${bracket.title}` }
      case 'THIRD': return { a: loserOf('CO1') || `Loser CO1 — ${bracket.title}`, b: loserOf('CO2') || `Loser CO2 — ${bracket.title}` }
      default: return { a: '—', b: '—' }
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
    { code: 'X1', phase: `Losers ${bracket.title}` },
    { code: 'X2', phase: `Losers ${bracket.title}` },
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
      teamA: labels.a,
      teamB: labels.b,
      scheduledTime: '',
      court: reg.court ?? null,
      sequence: reg.sequence ?? null,
      status: reg.status ?? 'waiting',
    }
  })
}

function sortRows(rows: RegiaRow[]) {
  return [...rows].sort((a, b) => {
    const ac = a.court == null ? 999 : a.court
    const bc = b.court == null ? 999 : b.court
    if (ac !== bc) return ac - bc

    const as = a.status === 'paused' ? 0 : (a.sequence == null ? 999 : a.sequence)
    const bs = b.status === 'paused' ? 0 : (b.sequence == null ? 999 : b.sequence)
    if (as !== bs) return as - bs

    if (a.phase !== b.phase) return a.phase.localeCompare(b.phase)
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

function buildAllRows(tournament_id: string, groupState: GroupState, bracketState: BracketState): RegiaRow[] {
  const rows: RegiaRow[] = []
  const groupRegia = groupState?.regia?.items || {}
  const bracketRegia = bracketState?.regia?.items || {}
  const letters = LETTERS.slice(0, Math.max(1, groupState?.groupsCount ?? 0))

  for (const L of letters) {
    const matchRows = scheduleRowsForGroup(groupState, L).filter((r) => r.setNo === 1)
    matchRows.forEach((r) => {
      const key = `girone:${L}:${r.matchIdx}`
      const reg = groupRegia[key] || { court: null, sequence: null, status: 'waiting' as RegiaStatus }
      rows.push({
        key,
        sourceType: 'girone',
        tournament_id,
        phase: `Girone ${L}`,
        teamA: lastSurnames(r.labelA),
        teamB: lastSurnames(r.labelB),
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
    if (b.type === 'SE') list = buildSERows(b, groupState, winnersById, bracketRegia)
    else if (b.type === 'DE') list = buildDERows(b, groupState, winnersById, bracketRegia)
    else list = []

    list.forEach((r) => {
      r.tournament_id = tournament_id
      rows.push(r)
    })
  })

  return sortRows(rows)
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
    const allRows = []

for (const tournament_id of tournament_ids) {
  const { groupState, bracketState } = await loadStates(s, tournament_id)
  const rows = buildAllRows(tournament_id, groupState, bracketState)
  allRows.push(...rows)
}

return NextResponse.json({
  ok: true,
  rows: allRows,
})
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Errore GET regia' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  if (!requireAdmin(req)) return new NextResponse('Unauthorized', { status: 401 })

  try {
    const body = (await req.json().catch(() => null)) as
      | {
          tournament_id?: string
          action?: 'save_assignment' | 'set_live' | 'stop_live' | 'close_match'
          key?: string
          court?: number | null
          sequence?: number | null
        }
      | null

    const tournament_id = String(body?.tournament_id || '').trim()
    const action = body?.action
    const key = String(body?.key || '').trim()

    if (!tournament_id || !action || !key) {
      return NextResponse.json({ error: 'Missing params' }, { status: 400 })
    }

    const s = supabaseAdmin()
    const { groupState, bracketState, gData, bData } = await loadStates(s, tournament_id)
    const rows = buildAllRows(tournament_id, groupState, bracketState)
    const target = readRegiaState(rows, key)

    if (!target) {
      return NextResponse.json({ error: 'Partita non trovata' }, { status: 404 })
    }

    if (action === 'save_assignment') {
      if (target.status === 'live') {
        return NextResponse.json({ error: 'Una partita LIVE non può essere spostata' }, { status: 400 })
      }

      const nextCourt = body?.court == null ? null : Number(body.court)
      const nextSequence = body?.sequence == null ? null : Number(body.sequence)

      if (nextCourt == null) {
        target.court = null
        target.sequence = null
        target.status = 'waiting'
      } else {
        target.court = nextCourt
        target.sequence = nextSequence || 1
        if (target.status === 'waiting' || target.status === 'paused') target.status = 'queued'

        const sameCourt = rows
          .filter((r) => r.key !== target.key && r.court === nextCourt && (r.status === 'queued' || r.status === 'live'))
          .sort((a, b) => {
            if (a.status === 'live' && b.status !== 'live') return -1
            if (b.status === 'live' && a.status !== 'live') return 1
            return (a.sequence ?? 999) - (b.sequence ?? 999)
          })

        const liveExists = sameCourt.some((r) => r.status === 'live')
        if (liveExists && target.sequence === 1) {
          return NextResponse.json({ error: 'Non puoi inserire una partita prima della LIVE del campo' }, { status: 400 })
        }
      }

      const affectedCourts = Array.from(new Set(rows.map((r) => r.court).filter((x): x is number => x != null)))
      affectedCourts.forEach((court) => resequenceCourt(rows, court))
    }

    if (action === 'set_live') {
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
      if (target.status !== 'live') {
        return NextResponse.json({ error: 'La partita non è LIVE' }, { status: 400 })
      }
      const court = target.court
      target.status = 'paused'
      target.sequence = 0

      if (court != null) resequenceCourt(rows, court)
    }

    if (action === 'close_match') {
      const court = target.court
      target.status = 'done'
      if (court != null) resequenceCourt(rows, court)
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
