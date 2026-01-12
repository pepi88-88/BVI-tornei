'use client'

import React, { useEffect, useMemo, useState } from 'react'

/* chiave stabile anche se manca/cambia l'ID del tabellone */
const slugify = (s: string) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

/* ---- Tipi ridotti: bastano questi per l’editor ITA ---- */
type Bracket = {
  id: string
  title: string
  color: string
  type: 'ITA' | 'SE' | 'DE'
  nTeams: number
  slots: string[] // "Perdente ORO M1", "A1", "3", "BYE", ...
}

type WinnersMap = Record<string, 'A' | 'B'>

type Props = {
  bracket: Bracket
  tourId?: string
  tId?: string
  resolver?: (token: string) => string | undefined  // risoluzione esterna (Perdente/Vincente <Tab> Mx)
  winners?: WinnersMap                               // precaricamento
  onWinnersChange?: (map: WinnersMap) => void        // callback al parent
}

/* =================== util comuni (come in gironi) =================== */
function bothSurnames(label: string) {
  const ln = (s: string) => {
    const cleaned = s.trim().replace(/\s+[A-Z]\.?$/u, '')
    return (cleaned.split(/\s+/)[0] ?? '').trim()
  }
  const parts = String(label).replace(/—/g,'/').split('/').map(p=>p.trim()).filter(Boolean)
  if (parts.length >= 2) return `${ln(parts[0])} / ${ln(parts[1])}`
  return ln(String(label))
}

/* round-robin fino a 6 */
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

/* ---------- risoluzione token slot ---------- */
function makeSlotResolver(
  tourId?: string,
  tId?: string,
  externalResolver?: (token: string) => string | undefined
) {
  const basic = (token: string): string => {
    if (!token) return '—'
    if (token === '-' || token === '—') return '—'
    if (token === 'BYE') return 'BYE'

    // Gironi assegnati: A1, B2, ...
    const m = token.match(/^([A-Z])(\d{1,2})$/)
    if (m && tId) {
      try {
        const js = JSON.parse(localStorage.getItem(`gm:${tId}`) || 'null')
        const rid = js?.assign?.[`${m[1]}-${Number(m[2])}`]
        const lbl = rid && js?.labels?.[rid]
        if (lbl) return bothSurnames(lbl)
      } catch {}
      return token
    }

    // Avulsa: "3", "7", ...
    if (/^\d+$/.test(token) && tourId && tId) {
      try {
        const raw =
          localStorage.getItem(`classifica_avulsa:${tourId}:${tId}`) ||
          localStorage.getItem(`avulsa:${tourId}:${tId}`)
        const arr: string[] = raw ? JSON.parse(raw) : []
        const i = Number(token) - 1
        if (arr[i]) return bothSurnames(arr[i])
      } catch {}
      return token
    }

    return token
  }

  // wrapper per “Perdente/Vincente <tab> Mx”
  return (token: string): string => {
    if (/^(Perdente|Loser|Vincente|Winner)\s+/i.test(token)) {
      const v = externalResolver?.(token) // può restituire "C3", "A1", "7"…
      return v ? basic(v) : token         // se non c’è il vincitore: resta “Perdente …”
    }
    return basic(token)
  }
}

/* =================== COMPONENTE =================== */
export default function ItaEditor({ bracket, tourId, tId, resolver, winners, onWinnersChange }: Props) {
  // 🔑 chiave stabile (usa id se c'è, altrimenti slug del titolo es. "bronze")
  const stableKey = useMemo(
    () => bracket?.id || `slug:${slugify(bracket?.title || 'tabellone')}`,
    [bracket?.id, bracket?.title]
  )

  const [times, setTimes] = useState<string[]>([])
  const [scores, setScores] = useState<Array<{ a: string; b: string }>>([])

  // carica/salva LS (times/scores/standings dell’ITA) — usando stableKey
  useEffect(() => {
    try {
      const k = `ita:${tourId}:${tId}:${stableKey}`
      setTimes(JSON.parse(localStorage.getItem(`${k}:times`) || '[]'))
      setScores(JSON.parse(localStorage.getItem(`${k}:scores`) || '[]'))
    } catch { setTimes([]); setScores([]) }
  }, [tourId, tId, stableKey])

  useEffect(() => {
    const k = `ita:${tourId}:${tId}:${stableKey}`
    try { localStorage.setItem(`${k}:times`, JSON.stringify(times)) } catch {}
  }, [times, tourId, tId, stableKey])

  useEffect(() => {
    const k = `ita:${tourId}:${tId}:${stableKey}`
    try { localStorage.setItem(`${k}:scores`, JSON.stringify(scores)) } catch {}
  }, [scores, tourId, tId, stableKey])

  // risolvi i nomi slot
  const resolve = useMemo(() => makeSlotResolver(tourId, tId, resolver), [tourId, tId, resolver])
  const teams = useMemo(() => (bracket.slots || []).map(tok => resolve(tok) || tok), [bracket.slots, resolve])

  const n = Math.min(Math.max(bracket.nTeams || teams.length, 2), 6)
  const matches = useMemo(() => rr(n), [n])

  // helper set
  const setTime = (i: number, v: string) => setTimes(arr => { const out=[...arr]; out[i]=v; return out })
  const setScore = (i: number, side: 'a'|'b', v: string) =>
    setScores(arr => { const out=[...arr]; const row = out[i] ?? {a:'', b:''}; row[side] = v.replace(/\D/g,'').slice(0,2); out[i] = row; return out })

  /* winners map (R1,R2,...) -> parent */
  function computeWinners(): WinnersMap {
    const map: WinnersMap = {}
    matches.forEach(([_a, _b], i) => {
      const a = Number(scores[i]?.a), b = Number(scores[i]?.b)
      if (Number.isFinite(a) && Number.isFinite(b) && a !== b) {
        map[`R${i + 1}`] = a > b ? 'A' : 'B'
      }
    })
    return map
  }

  useEffect(() => {
    if (!onWinnersChange) return
    const next = computeWinners()
    const now = winners || {}
    const same =
      Object.keys(next).length === Object.keys(now).length &&
      Object.keys(next).every(k => now[k] === next[k])
    if (!same) onWinnersChange(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scores, matches])

  // classifica visuale
  type Row = { idx:number; label:string; W:number; PF:number; PS:number; QP:number }
  const standings: Row[] = useMemo(() => {
    const base: Row[] = Array.from({ length: n }, (_, i) => ({ idx:i+1, label: teams[i] || `S${i+1}`, W:0, PF:0, PS:0, QP:0 }))
    const apply = (slotA:number, slotB:number, i:number) => {
      const a = Number(scores[i]?.a), b = Number(scores[i]?.b)
      if (!Number.isFinite(a) || !Number.isFinite(b)) return
      base[slotA-1].PF += a; base[slotA-1].PS += b
      base[slotB-1].PF += b; base[slotB-1].PS += a
      if (a > b) base[slotA-1].W += 1; else if (b > a) base[slotB-1].W += 1
    }
    matches.forEach(([a,b], i) => apply(a,b,i))
    base.forEach(r => r.QP = r.PF / Math.max(1, r.PS))
    base.sort((x,y) => (y.W-x.W) || (y.QP-x.QP) || (y.PF-x.PF) || x.label.localeCompare(y.label))
    return base
  }, [n, teams, matches, scores])

  useEffect(() => {
    try {
      localStorage.setItem(
        `ita:${tourId}:${tId}:${stableKey}:standings`,
        JSON.stringify(standings.map(s => s.label))
      )
    } catch {}
  }, [standings, tourId, tId, stableKey])

  return (
    <div className="relative">
      {/* titolo */}
      <div className="mt-1 mb-4 flex justify-center">
        <div
          className="relative flex items-center justify-center text-center px-8 py-3 rounded-xl font-extrabold uppercase tracking-wide text-2xl md:text-3xl"
          style={{ background: bracket.color, color:'#000', minWidth: 380 }}
        >
          <span className="pointer-events-none">{bracket.title}</span>
        </div>
      </div>

      {/* calendario + punteggi */}
      <div className="card p-0 overflow-hidden">
        <div className="h-9 px-3 flex items-center justify-between text-white" style={{ background: bracket.color }}>
          <div className="text-sm font-semibold">Calendario (round-robin)</div>
        </div>
        <div className="p-3 space-y-2">
          {matches.map(([a,b], i) => (
            <div
              key={`m-${i}`}
              className="grid items-center"
              style={{ gridTemplateColumns: '72px minmax(0,1fr) 44px 16px 44px minmax(0,1fr)', columnGap: '.35rem' }}
            >
              {/* ora */}
              <input
                type="time"
                className="input h-8 pl-1 pr-0 text-sm text-white tabular-nums shrink-0 w-[78px]"
                value={times[i] ?? ''}
                onChange={e => setTime(i, e.target.value)}
                title="Ora"
              />
              {/* squadra A */}
              <div className="min-w-0 truncate whitespace-nowrap text-sm text-right pr-0.5">{teams[a-1] || `S${a}`}</div>
              {/* punteggio A */}
              <input
                type="text" inputMode="numeric" pattern="\d*" maxLength={2}
                value={scores[i]?.a ?? ''}
                onChange={e => setScore(i, 'a', e.target.value)}
                className="input h-8 w-12 px-1 text-sm text-center tabular-nums shrink-0"
                title="Punteggio squadra 1"
              />
              {/* vs */}
              <div className="shrink-0 w-6 -mx-0.5 text-center text-[13px] text-neutral-400">vs</div>
              {/* punteggio B */}
              <input
                type="text" inputMode="numeric" pattern="\d*" maxLength={2}
                value={scores[i]?.b ?? ''}
                onChange={e => setScore(i, 'b', e.target.value)}
                className="input h-8 w-12 px-1 text-sm text-center tabular-nums shrink-0"
                title="Punteggio squadra 2"
              />
              {/* squadra B */}
              <div className="min-w-0 truncate whitespace-nowrap text-sm pl-1">{teams[b-1] || `S${b}`}</div>
            </div>
          ))}
        </div>
      </div>

      {/* classifica */}
      <div className="card p-3 mt-4">
        <div className="text-lg font-semibold mb-2">Classifica</div>
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
            {standings.map((r, i) => (
              <tr key={i} className="border-t border-neutral-800">
                <td className="py-1 pr-2 truncate">{r.label}</td>
                <td className="text-right">{r.W}</td>
                <td className="text-right">{r.PF}</td>
                <td className="text-right">{r.PS}</td>
                <td className="text-right">{(r.QP || 0).toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 text-[11px] text-neutral-500">W=Vittorie · PF=Punti Fatti · PS=Punti Subiti · QP=PF/PS</div>
      </div>
    </div>
  )
}
