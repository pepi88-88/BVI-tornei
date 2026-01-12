'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import BracketCanvas, { type Bracket as BracketType, type WinnerMap } from '../../../../../components/BracketCanvas'

/* ============== Helpers comuni ============== */

const nextPow2 = (n: number) => { let p = 1; while (p < n) p <<= 1; return p }

function normalizeBracket(b: any): BracketType {
  const n = Math.max(2, Number(b?.nTeams) || 8)
  const typeRaw = String(b?.type || 'SE').toUpperCase() as BracketType['type']
  const r1 = Array.from({ length: nextPow2(n) / 2 }, (_, i) => ({
    A: b?.r1?.[i]?.A ?? '-',
    B: b?.r1?.[i]?.B ?? '-',
  }))
  const slots = Array.from({ length: nextPow2(n) }, (_, i) => b?.slots?.[i] ?? '')
  return {
    id: String(b?.id || Math.random().toString(36).slice(2, 10)),
    title: String(b?.title || 'TABELLONE 1'),
    color: String(b?.color || '#22c55e'),
    type: typeRaw,
    nTeams: n,
    source: (b?.source as BracketType['source']) || 'gironi',
    fromTableId: b?.fromTableId || undefined,
    r1,
    slots,
  }
}

// nomi “brevi”: cognomi A / B
function lastSurnames(label: string) {
  const ln = (s: string) => s.trim().replace(/\s+[A-Z]\.?$/u, '').split(/\s+/)[0] || ''
  const parts = String(label).replace(/—/g,'/').split('/').map(p=>p.trim()).filter(Boolean)
  return parts.length>=2 ? `${ln(parts[0])} / ${ln(parts[1])}` : ln(String(label))
}

/* ===== stato pubblico gironi (esteso) ===== */
type PublicPersist = {
  assign?: Record<string, string>   // "A-1" -> "ridXYZ"
  labels?: Record<string, string>   // "ridXYZ" -> "Mario / Luca"
  meta?:   Record<string, { capacity: number; format?: 'pool'|'ita' }>
  scores?: Record<string, { a: string; b: string }[]>
  times?:  Record<string, string[]>
}

/** risolutore token → nome: A1/B2, “1A”, “A 1”, “3”, Vincente/Perdente … */
function makeSlotResolver(
  tourId?: string,
  tId?: string,
  externalResolver?: (token: string) => string | undefined,
  publicGroups?: PublicPersist | null,
) {
  const gmStore = (() => {
    try { return tId ? JSON.parse(localStorage.getItem(`gm:${tId}`) || 'null') : null }
    catch { return null }
  })();

  const basic = (raw: string): string => {
    const token = String(raw || '').trim();
    if (!token || token === '-' || token === '—') return '—';
    if (token.toUpperCase() === 'BYE') return 'BYE';

    // normalizza: supporta A1 / A 1 / 1A / 1 A
    const s = token.toUpperCase().replace(/\s+/g, '');
    const mAB = s.match(/^([A-Z])(\d{1,2})$/) || s.match(/^(\d{1,2})([A-Z])$/);

    // === A1/B2/1A ===
    if (mAB && tourId && tId) {
      const isLetterFirst = /^[A-Z]/.test(mAB[1]);
      const L = isLetterFirst ? mAB[1] : mAB[2];
      const pos = Number(isLetterFirst ? mAB[2] : mAB[1]);

      // 1) Classifica live dai punteggi pubblici (PRIORITÀ)
      const byRank = nameFromGroupRankPublic(L, pos, publicGroups);
      if (byRank) return lastSurnames(byRank);

      // 2) classifica salvata (admin) in LS
      try {
        const raw = localStorage.getItem(`groups_rank:${tourId}:${tId}`) || localStorage.getItem(`gironi_rank_${tourId}_${tId}`);
        if (raw) {
          const rankByGroup: Record<string, string[]> = JSON.parse(raw);
          const name = rankByGroup[L]?.[pos - 1];
          if (name) return lastSurnames(name);
        }
      } catch {}

      // 3) fallback: mapping slot pubblico (assign/labels)
      try {
        const rid = publicGroups?.assign?.[`${L}-${pos}`];
        const lab = rid ? publicGroups?.labels?.[rid] : undefined;
        if (lab) return lastSurnames(lab);
      } catch {}

      // 4) ultimo fallback: gm:<tId> dal client
      try {
        const rid = gmStore?.assign?.[`${L}-${pos}`];
        const lab = rid ? gmStore?.labels?.[rid] : undefined;
        if (lab) return lastSurnames(lab);
      } catch {}

      return token;
    }

    // === “3” → Avulsa ===
    if (/^\d+$/.test(token) && tourId && tId) {
      // 1) PRIMA: avulsa LIVE dai dati pubblici
      const live = buildAvulsaPublic(publicGroups);
      const idx = Math.max(1, Number(token)) - 1;
      if (Array.isArray(live) && live[idx]) {
        return live[idx]; // già in forma "cognomi brevi"
      }

      // 2) FALLBACK: LocalStorage
      try {
        const raw =
          localStorage.getItem(`classifica_avulsa:${tourId}:${tId}`) ||
          localStorage.getItem(`avulsa:${tourId}:${tId}`) ||
          localStorage.getItem(`avulsa:${tId}`);
       if (raw) {
    const arr: string[] = JSON.parse(raw);
    const nm = arr[idx];
    // 🔴 guard aggiunto
    if (nm && !/^slot\s*\d+$/i.test(nm)) return lastSurnames(nm);
  }
} catch {}
      return token;
    }

    // default: nessuna regola speciale
    return token;
  }; // <-- CHIUDE basic ✅

  // wrapper: prima Vincente/Perdente (external), poi normalizza
  return (token: string): string => {
    const ext = externalResolver?.(token);
    if (ext) return basic(ext);
    return basic(token);
  };
} // <-- CHIUDE makeSlotResolver ✅

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


function rrPairs(n: number) {
  const t = Array.from({length:n}, (_,i)=>i+1)
  if (t.length < 2) return [] as Array<[number,number]>
  if (t.length % 2 === 1) t.push(0)
  const rounds = t.length-1, half = t.length/2, out: Array<[number,number]> = []
  for (let r=0; r<rounds; r++){
    for (let i=0; i<half; i++){
      const a=t[i], b=t[t.length-1-i]
      if (a!==0 && b!==0) out.push([a,b])
    }
    const f=t[0], rest=t.slice(1); rest.unshift(rest.pop()!); t.splice(0,t.length,f,...rest)
  }
  return out
}

function labelBySlotPublic(L: string, slot: number, pub?: PublicPersist | null) {
  const rid = pub?.assign?.[`${L}-${slot}`]
  const raw = rid ? pub?.labels?.[rid] : undefined
  return raw ? lastSurnames(raw) : `Slot ${slot}`
}

type TeamStatPub = { slot:number; label:string; W:number; PF:number; PS:number; QP:number; finish?:number }

function computeGroupRankingPublic(L: string, pub?: PublicPersist | null): TeamStatPub[] {
  if (!pub) return []
  const cap = Number(pub?.meta?.[L]?.capacity ?? 0)
  const fmt = (pub?.meta?.[L]?.format ?? 'pool').toLowerCase() as 'pool'|'ita'
  if (cap < 2) return []

  const sc = pub?.scores?.[L] ?? []
  const init: Record<number, TeamStatPub> = {}
  for (let s=1; s<=cap; s++) init[s] = { slot:s, label:labelBySlotPublic(L,s,pub), W:0, PF:0, PS:0, QP:0 }

  // calendario base
  const rows = (fmt==='pool' && cap===4)
    ? [
        { a:1, b:4 }, { a:2, b:3 }, // semifinali
        { a:undefined as any, b:undefined as any }, // finale 1-2 (placeholder)
        { a:undefined as any, b:undefined as any }, // finale 3-4 (placeholder)
      ]
    : rrPairs(cap).map(([a,b]) => ({ a, b }))

  // applica semifinali
  const apply = (A?:number, B?:number, i?:number) => {
    if (!A || !B) return
    const a = Number(sc[i!]?.a), b = Number(sc[i!]?.b)
    if (!Number.isFinite(a) || !Number.isFinite(b)) return
    init[A].PF += a; init[A].PS += b
    init[B].PF += b; init[B].PS += a
    if (a>b) init[A].W += 1; else if (b>a) init[B].W += 1
  }

  if (fmt === 'pool' && cap === 4) {
    // 1) Semifinali
    apply(1, 4, 0) // S1 vs S4
    apply(2, 3, 1) // S2 vs S3

    const s0a = Number(sc[0]?.a), s0b = Number(sc[0]?.b)
    const s1a = Number(sc[1]?.a), s1b = Number(sc[1]?.b)

    const w1 = (s0a > s0b) ? 1 : 4
    const w2 = (s1a > s1b) ? 2 : 3
    const l1 = (w1 === 1) ? 4 : 1
    const l2 = (w2 === 2) ? 3 : 2

    // 2) Finali: contano sia per PF/PS/W che per la posizione finale
    // finale 1°-2°
    if (Number.isFinite(Number(sc[2]?.a)) && Number.isFinite(Number(sc[2]?.b))) {
      apply(w1, w2, 2) // aggiunge PF/PS/W anche da questa partita
      const a = Number(sc[2].a), b = Number(sc[2].b)
      init[w1].finish = a > b ? 1 : 2
      init[w2].finish = a > b ? 2 : 1
    }

    // finale 3°-4°
    if (Number.isFinite(Number(sc[3]?.a)) && Number.isFinite(Number(sc[3]?.b))) {
      apply(l1, l2, 3) // idem per la finale 3/4 posto
      const a = Number(sc[3].a), b = Number(sc[3].b)
      init[l1].finish = a > b ? 3 : 4
      init[l2].finish = a > b ? 4 : 3
    }
  } else {
    // round robin classico (già ok)
    rows.forEach((r, i) => apply(r.a, r.b, i))
  }


  const arr = Object.values(init)
  arr.forEach(s => { s.QP = s.PF / Math.max(1, s.PS) })
  arr.sort((A,B) => {
    const fA = A.finish ?? 999, fB = B.finish ?? 999
    if (fA !== fB) return fA - fB
    return (B.W - A.W) || (B.QP - A.QP) || (B.PF - A.PF) || A.label.localeCompare(B.label)
  })
  return arr
}

function nameFromGroupRankPublic(letter: string, pos: number, pub?: PublicPersist | null): string | undefined {
  const L = String(letter || '').toUpperCase()
  if (!/^[A-Z]$/.test(L) || !Number.isFinite(pos) || pos < 1) return
  const stats = computeGroupRankingPublic(L, pub)
  const row = stats[pos - 1]
  return row?.label ? lastSurnames(row.label) : undefined
}
// Crea la avulsa "live" dai dati pubblici
// ❗️SOSTITUISCI interamente la funzione esistente
function buildAvulsaPublic(pub?: PublicPersist | null): string[] {
  if (!pub?.meta) return []

  const letters = Object.keys(pub.meta).sort()
  type Row = { letter: string; pos: number; label: string; W: number; PF: number; PS: number; QP: number }
  const rows: Row[] = []

  for (const L of letters) {
    const stats = computeGroupRankingPublic(L, pub)
    stats.forEach((s, i) =>
      rows.push({
        letter: L,
        pos: i + 1,
        label: s.label,
        W: s.W,
        PF: s.PF,
        PS: s.PS,
        QP: s.QP,
      })
    )
  }

  // stesso ordinamento dell’admin
 rows.sort((a, b) =>
    (a.pos - b.pos) ||
    (b.W - a.W) ||
    (b.QP - a.QP) ||
    a.letter.localeCompare(b.letter) ||   // <— 4° criterio: lettera, non PF
    a.label.localeCompare(b.label)        // (facoltativo ma utile per stabilità)
  )

  // 🔴 filtro: niente placeholder "Slot n" o etichette vuote
  const rowsClean = rows.filter(r => r.label && !/^slot\s*\d+$/i.test(r.label))

  // ritorna già in formato “cognomi brevi”
  return rowsClean.map(r => lastSurnames(r.label))
}


/* ============== External “Vincente/Perdente …” ============== */
function makeExternalResolver(
  brackets: Array<{ id: string; title: string; r1?: { A: string; B: string }[] }>,
  winnersById: Record<string, Record<string, 'A' | 'B' | undefined>>
) {
  const byTitle = new Map(brackets.map(b => [b.title.toUpperCase(), b]))
  return (token: string): string | undefined => {
    if (!token) return undefined
    const t = token.trim()

    // es. "Vincente Tabellone 1 R2" | "Perdente Main Draw R3" ecc.
    const m = t.match(/^(Perdente|Loser|Vincente|Winner)\s+(.+?)\s+([A-Za-z])(\d+)$/i)
    if (!m) return undefined

    const kind = m[1].toLowerCase()
    const titleU = m[2].toUpperCase()
    let letter = m[3].toUpperCase()
    const num = Number(m[4])

    const br = byTitle.get(titleU)
    if (!br || !Number.isFinite(num) || num < 1) return undefined
    if (letter === 'M') letter = 'R'   // compat vecchia “M” per “R”
    if (letter !== 'R') return undefined

    const pair = br.r1?.[num - 1]
    if (!pair) return undefined

    const side = (winnersById[br.id] || {})[`R${num}`] // 'A' | 'B'
    if (!side) return undefined

    if (kind === 'vincente' || kind === 'winner') return side === 'A' ? pair.A : pair.B
    if (kind === 'perdente' || kind === 'loser') {
      const loserSide = side === 'A' ? 'B' : 'A'
      return loserSide === 'A' ? pair.A : pair.B
    }
    return undefined
  }
}

/* ============== ITA viewer (read-only) ============== */

function buildRR_Ita(n: number): Array<[number, number]> {
  const t: number[] = Array.from({ length: Math.max(2, n) }, (_, i) => i + 1)
  if (t.length % 2 === 1) t.push(0)
  const rounds = t.length - 1
  const half = t.length / 2
  const out: Array<[number, number]> = []
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < half; i++) {
      const a = t[i], b = t[t.length - 1 - i]
      if (a !== 0 && b !== 0) out.push([a, b])
    }
    const fixed = t[0]
    const rest = t.slice(1)
    rest.unshift(rest.pop()!)
    t.splice(0, t.length, fixed, ...rest)
  }
  return out
}

type ItaScore = { a?: number; b?: number }

function ItaViewer({
  bracket, tourId, tId, resolve, serverScores,
}: {
  bracket: BracketType
  tourId: string
  tId: string
  resolve: (token: string) => string
  serverScores?: ItaScore[]
}) {
  const n = Math.max(2, Number(bracket.nTeams) || 0)

  const teams = useMemo(() => {
    const seeded = seedFromBracket(bracket, resolve)
    const arr = seeded.slice(0, n)
    while (arr.length < n) arr.push('—')
    return arr
  }, [bracket, resolve, n])

  const pairs = useMemo(() => buildRR_Ita(n), [n])
  const scores: ItaScore[] = Array.isArray(serverScores) ? serverScores : []

  const standings = useMemo(() => {
    const S = teams.map((name, idx) => ({ idx: idx + 1, name, W: 0, PF: 0, PS: 0, QP: 0 }))
    pairs.forEach(([aIdx1, bIdx1], i) => {
      const s = scores[i] || {}
      const a = Number(s.a), b = Number(s.b)
      if (!Number.isFinite(a) || !Number.isFinite(b)) return
      const ai = aIdx1 - 1, bi = bIdx1 - 1
      S[ai].PF += a; S[ai].PS += b
      S[bi].PF += b; S[bi].PS += a
      if (a > b) S[ai].W += 1
      else if (b > a) S[bi].W += 1
    })
    S.forEach(r => (r.QP = r.PF / Math.max(1, r.PS)))
    S.sort((A,B)=> B.W-A.W || B.QP-A.QP || B.PF-A.PF || A.name.localeCompare(B.name))
    return S
  }, [teams, pairs, scores])

  return (
    <div className="card p-0 overflow-hidden mb-4">
      <div className="h-9 px-3 flex items-center justify-between text-white" style={{ background: bracket.color }}>
        <div className="text-sm font-semibold">Girone all’italiana — {bracket.title}</div>
      </div>

      <div className="p-3 grid gap-4 md:grid-cols-2">
        {/* calendario & punteggi (read-only) */}
        <div>
          <div className="text-sm font-semibold mb-2">Calendario & punteggi</div>
          <div className="space-y-2">
            {pairs.map(([a1,b1], i) => {
              const aName = teams[a1-1] || `S${a1}`
              const bName = teams[b1-1] || `S${b1}`
              const s = scores[i] || {}
              return (
                <div key={`m-${i}`} className="grid items-center gap-2"
                     style={{ gridTemplateColumns: 'minmax(0,1fr) 52px 16px 52px minmax(0,1fr)' }}>
                  <div className="truncate pr-1 text-right" title={aName}>{aName}</div>
                  <div className="input input-sm text-center select-none">{s.a ?? ''}</div>
                  <div className="text-center opacity-60">–</div>
                  <div className="input input-sm text-center select-none">{s.b ?? ''}</div>
                  <div className="truncate pl-1 text-left" title={bName}>{bName}</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* classifica */}
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
                {standings.map((r,i)=>(
                  <tr key={`st-${r.idx}-${i}`} className="border-t border-neutral-800">
                    <td className="py-1">{i+1}</td>
                    <td className="truncate">{r.name}</td>
                    <td className="text-right">{r.W}</td>
                    <td className="text-right">{r.PF}</td>
                    <td className="text-right">{r.PS}</td>
                    <td className="text-right">{(r.QP||0).toFixed(3).replace(/\.?0+$/,'')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  )
}

/* ============== Pagina atleta: Tabellone finale (read-only) ============== */

export default function AthleteTabellonePage() {
  const params = useParams() as { tour?: string }
  const tourId = params?.tour || ''
  const q = useSearchParams()

  // 🛡️ SSR-safe: niente localStorage nel render
  const [tId, setTId] = useState<string>('')
  const [tname, setTname] = useState<string>('Tabellone finale')

  useEffect(() => {
    const qTid = q.get('tid')
    const qName = q.get('tname')

    if (qTid) {
      setTId(qTid)
      if (typeof window !== 'undefined') localStorage.setItem('selectedTournamentId', qTid)
    } else if (typeof window !== 'undefined') {
      setTId(localStorage.getItem('selectedTournamentId') || '')
    }

    if (qName) {
      const decoded = decodeURIComponent(qName)
      setTname(decoded)
      if (typeof window !== 'undefined' && (qTid || tId)) {
        localStorage.setItem(`tournamentTitle:${qTid || tId}`, decoded)
      }
    } else if (typeof window !== 'undefined') {
      const fromLS = localStorage.getItem(`tournamentTitle:${qTid || tId}`)
      if (fromLS) setTname(fromLS)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  // blocco visibilità: mostra il tabellone solo quando i gironi sono confermati
  const [groupsConfirmed, setGroupsConfirmed] = useState<boolean>(false)
  const [isPublic, setIsPublic] = useState<boolean>(false)
  const [publicGroups, setPublicGroups] = useState<PublicPersist | null>(null)

  const [brackets, setBrackets] = useState<BracketType[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [winnersById, setWinnersById] = useState<Record<string, WinnerMap>>({})
  const [itaScoresById, setItaScoresById] = useState<Record<string, ItaScore[]>>({})

  useEffect(() => {
    let cancelled = false
    if (!tId) { setGroupsConfirmed(false); return }
    ;(async () => {
      try {
        const r = await fetch(`/api/groups/state?tournament_id=${encodeURIComponent(tId)}`, {
          headers: { 'x-role': 'admin' }, cache: 'no-store'
        })
        const js = await r.json()
        if (cancelled) return
        const st = js?.state || {}
        setGroupsConfirmed(!!st.groupsConfirmed)
      } catch {
        if (!cancelled) setGroupsConfirmed(false)
      }
    })()
    return () => { cancelled = true }
  }, [tId])

  useEffect(() => {
    let cancelled = false
    if (!tId) { setBrackets([]); setActiveId(null); setWinnersById({}); setItaScoresById({}); setIsPublic(false); return }

    ;(async () => {
      try {
        const r = await fetch(`/api/brackets/state?tournament_id=${encodeURIComponent(tId)}`, {
          headers: { 'x-role': 'admin' },
          cache: 'no-store',
        })
        const js = await r.json()
        const raw = js?.state

        const items   = Array.isArray(raw) ? raw : (raw?.items || [])
        const winners = Array.isArray(raw) ? {}   : (raw?.winnersById   || {})
        const ita     = Array.isArray(raw) ? {}   : (raw?.itaScoresById || {})

        const normalized = items.map(normalizeBracket)

        if (cancelled) return
        setBrackets(normalized)
        setActiveId(normalized[0]?.id ?? null)
        setWinnersById(winners)
        setItaScoresById(ita)
        setIsPublic(Boolean(js?.is_public))
      } catch {
        if (cancelled) return
        setBrackets([]); setActiveId(null); setWinnersById({}); setItaScoresById({}); setIsPublic(false)
      }
    })()

    return () => { cancelled = true }
  }, [tId])

  // carica stato pubblico per risoluzione A1/B2/… senza dipendere dal solo localStorage
  useEffect(() => {
    let cancelled = false
    if (!tId) { setPublicGroups(null); return }
    ;(async () => {
      try {
        const r = await fetch(`/api/groups/public/state?tournament_id=${encodeURIComponent(tId)}`, { cache: 'no-store' })
        const js = await r.json()
        if (!cancelled) setPublicGroups(js?.state ?? null)
      } catch {
        if (!cancelled) setPublicGroups(null)
      }
    })()
    return () => { cancelled = true }
  }, [tId])

  // resolver per Vincente/Perdente e nomi
  const external = useMemo(() => makeExternalResolver(brackets, winnersById), [brackets, winnersById])
  const resolve  = useMemo(() => makeSlotResolver(tourId, tId, external, publicGroups), [tourId, tId, external, publicGroups])

  const active = useMemo(
    () => brackets.find((b) => b.id === activeId) || null,
    [activeId, brackets]
  )

  // bracket con nomi già risolti (A1/B2/… + Vincente/Perdente …)
  const resolvedActive = useMemo(() => {
    if (!active) return null
    return {
      ...active,
      r1: (active.r1 || []).map(m => ({
        A: resolve(m.A),
        B: resolve(m.B),
      })),
      slots: (active.slots || []).map(s => resolve(s)),
    }
  }, [active, resolve])

  return (
    <div className="min-h-screen px-4 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[1400px] py-6 space-y-6">
        {/* header */}
        <div className="flex items-center gap-2">
          <Link className="btn btn-ghost btn-sm" href="/atleta/tornei">← Tornei attivi</Link>
          <Link className="btn btn-ghost btn-sm" href="/atleta/classifica">Classifica generale</Link>
          <div className="mx-auto text-2xl md:text-3xl font-semibold text-center">{tname || 'Tabellone finale'}</div>
        </div>

        {!tId ? (
          <div className="card p-6 text-sm text-neutral-400">
            Seleziona una tappa dalla pagina <Link className="link" href="/atleta/tornei">Tornei attivi</Link>.
          </div>
        ) : !groupsConfirmed && !isPublic ? (
          <div className="card p-6 text-sm text-neutral-400">
            Il tabellone non è ancora visibile. Sarà mostrato quando gli organizzatori confermano i risultati dei gironi o lo rendono pubblico.
          </div>
        ) : !brackets.length ? (
          <div className="card p-6 text-sm text-neutral-400">Nessun tabellone disponibile per questa tappa.</div>
        ) : (
          <div className="card p-0 overflow-hidden">
            {/* tabs dei tabelloni */}
            <div className="p-3 flex flex-wrap gap-2 border-b border-neutral-800">
              {brackets.map((b, i) => (
                <button
                  key={b.id}
                  className={`btn ${b.id === activeId ? '' : 'opacity-80'}`}
                  onClick={() => setActiveId(b.id)}
                  title={b.title}
                  style={b.id === activeId ? { outline: `2px solid ${b.color}`, outlineOffset: 2 } : {}}
                >
                  {b.title}
                  <span className="ml-2 text-[10px] opacity-60">L{i + 1}</span>
                  {i === 0 && <span className="ml-1">👑</span>}
                </button>
              ))}
            </div>

            {/* contenuto */}
            <div className="p-4">
              {resolvedActive && (
                String(resolvedActive.type).toUpperCase() === 'ITA' ? (
                  <ItaViewer
                    bracket={resolvedActive}
                    tourId={tourId}
                    tId={tId}
                    resolve={resolve}
                    serverScores={itaScoresById[resolvedActive.id]}
                  />
                ) : (
                  <BracketCanvas
                    bracket={resolvedActive}
                    interactive={false}
                    confirmOnPick={false}
                    winners={winnersById[resolvedActive.id] || {}}
                    onWinnersChange={() => {}}
                    tourId={tourId}
                    tId={tId}
                    externalResolver={external}
                  />
                )
              )}
            </div>
          </div>
        )}
    {/* CLASSIFICA AVULSA (visibile per test) */}
{false && publicGroups && (
  <div className="card p-4 mt-6">
    <div className="text-lg font-semibold mb-3">Classifica avulsa (TEST VISIBILE)</div>

    {(() => {
     const lettersAv = Object.keys(publicGroups?.meta ?? {}).sort()
      type RowAv = { letter: string; pos: number; label: string; W: number; PF: number; PS: number; QP: number }
      const rowsAv: RowAv[] = []

      for (const L of lettersAv) {
        const stats = computeGroupRankingPublic(L, publicGroups)
        stats.forEach((s, i) =>
          rowsAv.push({
            letter: L,
            pos: i + 1,
            label: s.label,
            W: s.W,
            PF: s.PF,
            PS: s.PS,
            QP: s.QP,
          })
        )
      }

      // stesso ordinamento dell’admin
     rowsAv.sort((a, b) =>
  (a.pos - b.pos) ||
  (b.W - a.W) ||
  (b.QP - a.QP) ||
  a.letter.localeCompare(b.letter) ||   // <— 4° criterio: lettera
  a.label.localeCompare(b.label)
)

      // 🔴 FIX: elimina i placeholder "Slot n" dalla vista pubblica
      const rowsClean = rowsAv.filter(r => r.label && !/^slot\s*\d+$/i.test(r.label))

      return (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase opacity-70 border-b border-neutral-800">
              <tr>
                <th className="py-1 text-left w-12">#</th>
                <th className="text-left">Squadra</th>
                <th className="text-right">W</th>
                <th className="text-right">PF</th>
                <th className="text-right">PS</th>
                <th className="text-right">QP</th>
              </tr>
            </thead>
            <tbody>
              {rowsClean.map((r, i) => (
                <tr key={`av-${i}`} className="border-t border-neutral-800">
                  <td className="py-1">{i + 1}</td>
                  <td className="truncate">{r.label}</td>
                  <td className="text-right">{r.W}</td>
                  <td className="text-right">{r.PF}</td>
                  <td className="text-right">{r.PS}</td>
                  <td className="text-right">{r.QP.toFixed(3).replace(/\.?0+$/, '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    })()}
  </div>
)}


      </div>
    </div>
  )
}

