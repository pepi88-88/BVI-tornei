'use client'

import * as React from 'react'
import { useSearchParams } from 'next/navigation'

/* === palette / util === */
const LETTERS = 'ABCDEFGHIJKLMNOP'.split('')
const COLORS: Record<string, string> = {
  A:'#2563EB', B:'#EF4444', C:'#F59E0B', D:'#8B5CF6',
  E:'#10B981', F:'#FB923C', G:'#06B6D4', H:'#8B5CF6',
  I:'#22C55E', J:'#F97316', K:'#0EA5E9', L:'#EAB308',
  M:'#84CC16', N:'#F43F5E', O:'#14B8A6', P:'#64748B',
}
const colorFor = (L: string) => COLORS[L] ?? '#334155'

/* === tipi === */
type Meta = { capacity: number; format: 'pool' | 'ita'; bestOf?: 1 | 3 }
type Score  = { a?: string|number; b?: string|number }
type Persist = {
  groupsCount: number
  meta:   Record<string, Meta>
  assign: Record<string, string>
  times:  Record<string, string[]>
  gField: Record<string, string>
  scores: Record<string, Score[]>
  labels: Record<string, string>
}
type PublicState = { is_public: boolean; state?: Persist | null }
type ScheduleRow = {
  key: string
  t1: string
  t2: string
  setNo: 1 | 2 | 3
  matchIdx: number
  scoreIdx: number
}

/* === round-robin helpers === */
function rr(n: number){
  const t = Array.from({length:n},(_,i)=>i+1)
  if (t.length < 2) return [] as Array<[number,number]>
  if (t.length % 2 === 1) t.push(0)
  const rounds = t.length-1, half=t.length/2, out:Array<[number,number]>= []
  for(let r=0;r<rounds;r++){
    for(let i=0;i<half;i++){ const a=t[i], b=t[t.length-1-i]; if(a&&b) out.push([a,b]) }
    const f=t[0], rest=t.slice(1); rest.unshift(rest.pop()!); t.splice(0,t.length,f,...rest)
  }
  return out
}

function labelBySlot(data: Persist, L:string, slot:number){
  const rid = data?.assign?.[`${L}-${slot}`]
  return rid ? (data?.labels?.[rid] ?? `Slot ${slot}`) : `Slot ${slot}`
}
function bestOfOf(data: Persist, L: string): 1 | 3 {
  return Number(data?.meta?.[L]?.bestOf) === 3 ? 3 : 1
}

function setsToWin(bestOf: 1 | 3) {
  return bestOf === 3 ? 2 : 1
}

function matchWinnerFromScoresPublic(L: string, matchIdx: number, data: Persist): { winner?: 'A' | 'B' } {
  const bestOf = bestOfOf(data, L)
  const need = setsToWin(bestOf)
  const sc = data?.scores?.[L] ?? []

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
function scheduleRows(L: string, data: Persist): ScheduleRow[] {
  const m = data?.meta?.[L] ?? { capacity: 0, format: 'pool' as const }
  const cap = m.capacity ?? 0
  const bestOf = bestOfOf(data, L)

  if (cap < 2) return []

  const explodeMatch = (
    base: { key: string; t1: string; t2: string },
    matchIdx: number
  ): ScheduleRow[] => {
    return Array.from({ length: bestOf }, (_, si) => ({
  ...base,
  key: `${base.key}-S${si + 1}`,
  setNo: (si + 1) as 1 | 2 | 3,
  matchIdx,
  scoreIdx: matchIdx * bestOf + si,
}))
  }

  // Pool 4 con semifinali/finali
  if (m.format === 'pool' && cap === 4) {
    const p = { r1: [[1, 4], [2, 3]] as Array<[number, number]> }

    const m0 = {
      key: 'G1',
      t1: labelBySlot(data, L, p.r1[0][0]),
      t2: labelBySlot(data, L, p.r1[0][1]),
    }
    const m1 = {
      key: 'G2',
      t1: labelBySlot(data, L, p.r1[1][0]),
      t2: labelBySlot(data, L, p.r1[1][1]),
    }

    const w0 = matchWinnerFromScoresPublic(L, 0, data).winner
    const w1 = matchWinnerFromScoresPublic(L, 1, data).winner

    const wSlot0 = w0 ? (w0 === 'A' ? p.r1[0][0] : p.r1[0][1]) : undefined
    const lSlot0 = w0 ? (w0 === 'A' ? p.r1[0][1] : p.r1[0][0]) : undefined
    const wSlot1 = w1 ? (w1 === 'A' ? p.r1[1][0] : p.r1[1][1]) : undefined
    const lSlot1 = w1 ? (w1 === 'A' ? p.r1[1][1] : p.r1[1][0]) : undefined

    const m2 = {
      key: 'F12',
      t1: wSlot0 ? labelBySlot(data, L, wSlot0) : 'Vincente G1',
      t2: wSlot1 ? labelBySlot(data, L, wSlot1) : 'Vincente G2',
    }
    const m3 = {
      key: 'F34',
      t1: lSlot0 ? labelBySlot(data, L, lSlot0) : 'Perdente G1',
      t2: lSlot1 ? labelBySlot(data, L, lSlot1) : 'Perdente G2',
    }

    return [
      ...explodeMatch(m0, 0),
      ...explodeMatch(m1, 1),
      ...explodeMatch(m2, 2),
      ...explodeMatch(m3, 3),
    ]
  }

  // RR normale
  const base = rr(Math.min(cap, 6)).map(([a, b], i) => ({
    key: `R${i + 1}`,
    t1: labelBySlot(data, L, a),
    t2: labelBySlot(data, L, b),
  }))

  const out: ScheduleRow[] = []
  base.forEach((m, matchIdx) => out.push(...explodeMatch(m, matchIdx)))
  return out
}

// --- Pool4: mapping G1/G2 ---
function poolPairFor(gameIndex: number): [number, number] {
  // G1 = (1,4), G2 = (2,3)
  return gameIndex === 0 ? [1, 4] : [2, 3]
}

// --- Risolve "Vincente/Perdente G1/G2" SOLO se i punteggi sono presenti e diversi ---
function resolvePoolToken(L: string, token: string, data: Persist): string {
  const m = token.match(/^(Vincente|Perdente)\s+G([12])$/i)
  if (!m) return token

  const outcome = m[1].toLowerCase() as 'vincente' | 'perdente'
  const gIdx = Number(m[2]) - 1
  const [slotA, slotB] = poolPairFor(gIdx)
  const nameA = labelBySlot(data, L, slotA)
  const nameB = labelBySlot(data, L, slotB)

  const w = matchWinnerFromScoresPublic(L, gIdx, data).winner
  if (!w) return token

  if (outcome === 'vincente') return w === 'A' ? nameA : nameB
  return w === 'A' ? nameB : nameA
}
// --- Wrapper da usare in render ---
function displayTeamLabel(L: string, raw: string, data: Persist): string {
  return /^(Vincente|Perdente)\s+G[12]$/i.test(raw)
    ? resolvePoolToken(L, raw, data)
    : raw
}

/* === PAGE === */
export default function AthleteGironiPage(){
  const params = useSearchParams()
  const tId   = params.get('tid') || (typeof window!=='undefined' ? localStorage.getItem('selectedTournamentId') : '') || ''

  // Titolo (cosmetico, da query/localStorage)
  const [title, setTitle] = React.useState<string>('')
  React.useEffect(() => {
    if (!tId) { setTitle(''); return }
    const tn = params.get('tname')
    if (tn) { setTitle(decodeURIComponent(tn)); return }
    const fromTourPage = (typeof window!=='undefined') ? localStorage.getItem(`tournamentTitle:${tId}`) : ''
    setTitle(fromTourPage || '')
  }, [tId, params])

  // Stato pubblico dal SERVER
  const [pub, setPub] = React.useState<PublicState>({ is_public:false, state:null })
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string>('')

  React.useEffect(()=> {
    let alive = true
    if (!tId) { setPub({is_public:false, state:null}); return }
    setLoading(true); setError('')
    fetch(`/api/groups/public/state?tournament_id=${encodeURIComponent(tId)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then((js:PublicState) => { if (alive) setPub({ is_public: !!js?.is_public, state: js?.state ?? null }) })
      .catch(()=> { if (alive) setError('Errore caricamento dati') })
      .finally(()=> { if (alive) setLoading(false) })
    return ()=> { alive=false }
  }, [tId])

  if (!tId) return <div className="p-6 max-w-[1400px] mx-auto">Tappa non valida.</div>

  const data = pub.state || null
  const letters = React.useMemo(
    ()=> LETTERS.slice(0, Math.max(1, data?.groupsCount || 0)),
    [data?.groupsCount]
  )

  // refs per scrollIntoView dei pannelli (MOBILE)
  const panelRefs = React.useRef<Record<string, HTMLElement | null>>({})
  const [currentIdx, setCurrentIdx] = React.useState(0)
  const scrollTo = (idx: number) => {
    const L = letters[idx]
    if (!L) return
    panelRefs.current[L]?.scrollIntoView({ behavior: 'smooth', inline: 'center' })
  }
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const w = el.clientWidth
    const i = Math.round(el.scrollLeft / w)
    if (i !== currentIdx) setCurrentIdx(Math.max(0, Math.min(i, letters.length - 1)))
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="text-2xl md:text-3xl font-semibold text-center mb-3">{title || 'Gironi'}</div>

      {loading ? (
        <div className="card p-4 text-sm text-neutral-400">Carico…</div>
      ) : error ? (
        <div className="card p-4 text-sm text-red-400">{error}</div>
      ) : !pub.is_public ? (
        <div className="card p-4 text-sm">I gironi non sono ancora visibili. Verranno mostrati quando gli organizzatori li renderanno pubblici.</div>
      ) : !data ? (
        <div className="card p-4 text-sm text-neutral-400">Nessun dato disponibile.</div>
      ) : (
        <>
          {/* ===== MOBILE: carosello swipe (uno per volta) ===== */}
          <div className="md:hidden">
            {/* DOTS / quick nav */}
            <div className="flex justify-center gap-2 mb-3">
              {letters.map((L, i) => (
                <button
                  key={L}
                  onClick={() => scrollTo(i)}
                  className={[
                    'h-2.5 w-2.5 rounded-full transition-opacity',
                    i === currentIdx ? 'bg-white opacity-100' : 'bg-neutral-500 opacity-50',
                  ].join(' ')}
                  aria-label={`Vai a girone ${L}`}
                />
              ))}
            </div>

            {/* CAROUSEL */}
            <div
              className="snap-x snap-mandatory overflow-x-auto -mx-4 px-4"
              onScroll={onScroll}
            >
              <div className="flex gap-4">
                {letters.map((L) => {
                  const m = data.meta?.[L] ?? { capacity: 0, format: 'pool' as const }
                  const cap = m.capacity ?? 0
                  const rows = scheduleRows(L, data)

                  return (
                    <section
                      key={L}
                      ref={(el) => { panelRefs.current[L] = el }}
                      className="snap-center shrink-0 w-full"
                    >
                      {/* GIRONE */}
                      <div className="card p-0 overflow-hidden text-[14px] mb-3">
                        <div className="px-3 py-2 text-white" style={{ background: colorFor(L) }}>
                          <div className="flex items-center gap-3">
                            <div className="font-extrabold tracking-wide">GIRONE {L}</div>
                            <div className="text-xs opacity-90"># {cap}</div>
                            <div className="text-xs opacity-90 uppercase">{m.format}</div>
                          </div>
                        </div>
                        <div className="p-3 space-y-2">
                          {cap < 1 ? (
                            <div className="text-xs text-neutral-500">Nessuna squadra.</div>
                          ) : Array.from({ length: cap }, (_, k) => k + 1).map(slot => (
                            <div key={`${L}-${slot}`} className="flex items-center gap-2">
                              <div className="w-5 text-xs text-neutral-500">{slot}.</div>
                              <div className="input w-full h-9 px-2 bg-neutral-900/60">
                                {labelBySlot(data, L, slot)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* PARTITE */}
                      <div className="card p-0 overflow-hidden text-[14px]">
                        <div className="h-9 px-3 flex items-center justify-between text-white" style={{ background: colorFor(L) }}>
                          <div className="text-sm font-semibold">Partite {L}</div>
                          <div className="text-xs opacity-90">Campo {data.gField?.[L] ?? '—'}</div>
                        </div>

                        <div className="p-3">
                          {/* scroll orizzontale se stringe */}
                          <div className="overflow-x-auto -mx-3">
                            <div className="inline-block min-w-[640px] w-full">
                              <div className="space-y-2">
                                {rows.length === 0 ? (
  <div className="text-xs text-neutral-500">Nessuna partita.</div>
) : rows.map((r, idx) => {
  const showHeader = r.setNo === 1
  const prev = idx > 0 ? rows[idx - 1] : null
  const newMatch = !prev || prev.matchIdx !== r.matchIdx

  return (
    <div
      key={r.key}
      className={[
        'grid items-center whitespace-nowrap',
        newMatch ? 'border-t border-neutral-800 pt-2 mt-2 first:border-t-0 first:pt-0 first:mt-0' : ''
      ].join(' ')}
      style={{
        gridTemplateColumns:
          '70px minmax(170px,1fr) 44px 18px 44px minmax(170px,1fr)',
        columnGap: '.45rem',
      }}
    >
      <div className={showHeader ? 'input h-8 pl-1 pr-0 text-sm tabular-nums' : 'h-8'}>
  {showHeader ? ((data.times?.[L]?.[r.matchIdx] ?? '') || '—') : ''}
</div>

     <div className="min-w-0 truncate text-sm text-right">
  {showHeader ? displayTeamLabel(L, r.t1, data) : `SET ${r.setNo}`}
</div>

      <div className="input h-8 w-12 px-1 text-sm text-center tabular-nums">
        {data.scores?.[L]?.[r.scoreIdx]?.a ?? ''}
      </div>

      <div className="w-5 text-center text-[12px] text-neutral-400">
        {showHeader ? 'vs' : ''}
      </div>

      <div className="input h-8 w-12 px-1 text-sm text-center tabular-nums">
        {data.scores?.[L]?.[r.scoreIdx]?.b ?? ''}
      </div>

      <div className="min-w-0 truncate text-sm pl-1">
        {showHeader ? displayTeamLabel(L, r.t2, data) : ''}
      </div>
    </div>
  )
})}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </section>
                  )
                })}
              </div>
            </div>
          </div>

      {/* ===== DESKTOP: prima tutti i GIRONI, poi sotto tutte le PARTITE ===== */}
<div className="hidden md:block">
  {/* --- ROW 1: GIRONI (4 per riga) --- */}
  <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-4">
    {letters.map((L) => {
      const m = data.meta?.[L] ?? { capacity: 0, format: 'pool' as const }
      const cap = m.capacity ?? 0
      return (
        <div key={`g-${L}`} className="card p-0 overflow-hidden">
          <div className="px-3 py-2 text-white" style={{ background: colorFor(L) }}>
            <div className="flex items-center gap-3">
              <div className="font-extrabold tracking-wide">GIRONE {L}</div>
              <div className="text-xs opacity-90"># {cap}</div>
              <div className="text-xs opacity-90 uppercase">{m.format}</div>
            </div>
          </div>
          <div className="p-3 space-y-2">
            {cap < 1 ? (
              <div className="text-xs text-neutral-500">Nessuna squadra.</div>
            ) : Array.from({ length: cap }, (_, k) => k + 1).map(slot => (
              <div key={`${L}-${slot}`} className="flex items-center gap-2">
                <div className="w-5 text-xs text-neutral-500">{slot}.</div>
                <div className="input w-full bg-neutral-900/60">
                  {labelBySlot(data, L, slot)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )
    })}
  </div>

  {/* --- ROW 2: PARTITE (ogni card occupa 2 colonne → 2 per riga) --- */}
  <div className="mt-4 grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-4">
    {letters.map((L) => {
      const m = data.meta?.[L] ?? { capacity: 0, format: 'pool' as const }
      const rows = scheduleRows(L, data)
      return (
        <div key={`p-${L}`} className="col-span-1 xl:col-span-2 2xl:col-span-2">
          <div className="card p-0 overflow-hidden">
            <div className="h-9 px-3 flex items-center justify-between text-white" style={{ background: colorFor(L) }}>
              <div className="text-sm font-semibold">Partite {L}</div>
              <div className="text-xs opacity-90">Campo {data.gField?.[L] ?? '—'}</div>
            </div>
            <div className="p-3 space-y-2">
             {rows.length === 0 ? (
  <div className="text-xs text-neutral-500">Nessuna partita.</div>
) : rows.map((r, idx) => {
  const showHeader = r.setNo === 1
  const prev = idx > 0 ? rows[idx - 1] : null
  const newMatch = !prev || prev.matchIdx !== r.matchIdx

  return (
    <div
      key={r.key}
      className={[
        'grid items-center',
        newMatch ? 'border-t border-neutral-800 pt-2 mt-2 first:border-t-0 first:pt-0 first:mt-0' : ''
      ].join(' ')}
      style={{
        gridTemplateColumns: '72px minmax(0,1fr) 44px 16px 44px minmax(0,1fr)',
        columnGap: '.35rem',
      }}
    >
    <div className={showHeader ? 'input h-8 pl-1 pr-0 text-sm tabular-nums' : 'h-8'}>
  {showHeader ? ((data.times?.[L]?.[r.matchIdx] ?? '') || '—') : ''}
</div>

    <div className="min-w-0 truncate whitespace-nowrap text-sm text-right">
  {showHeader ? displayTeamLabel(L, r.t1, data) : `SET ${r.setNo}`}
</div>

      <div className="input h-8 w-12 px-1 text-sm text-center tabular-nums">
        {data.scores?.[L]?.[r.scoreIdx]?.a ?? ''}
      </div>

      <div className="w-6 text-center text-[13px] text-neutral-400">
        {showHeader ? 'vs' : ''}
      </div>

      <div className="input h-8 w-12 px-1 text-sm text-center tabular-nums">
        {data.scores?.[L]?.[r.scoreIdx]?.b ?? ''}
      </div>

      <div className="min-w-0 truncate whitespace-nowrap text-sm pl-1">
        {showHeader ? displayTeamLabel(L, r.t2, data) : ''}
      </div>
    </div>
  )
})}
            </div>
          </div>
        </div>
      )
    })}
  </div>
</div>


        </>
      )}
    </div>
  )
}
