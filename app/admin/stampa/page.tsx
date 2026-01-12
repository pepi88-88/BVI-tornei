'use client'

import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'

/* ==================== fetch helper ==================== */
const fetcher = (u: string) => fetch(u).then(r => r.json())

/* ==================== tipi ==================== */
type Tour = { id: string; name: string }
type Tournament = { id: string; name: string; date?: string; status?: string }

type Meta = { capacity: number; format: 'pool'|'ita' }
type Persist = {
  groupsCount: number
  meta:   Record<string, Meta>
  assign: Record<string, string>
  times?:  Record<string, string[]>
  labels?: Record<string, string>
}

/* ==================== costanti / util ==================== */
const LETTERS = 'ABCDEFGHIJKLMNOP'.split('')

// palette come /admin/gironi
const GROUP_COLORS: Record<string, string> = {
  A:'#2563EB', B:'#059669', C:'#F59E0B', D:'#8B5CF6',
  E:'#EF4444', F:'#06B6D4', G:'#22C55E', H:'#EAB308',
  I:'#F97316', J:'#A855F7', K:'#10B981', L:'#DC2626',
  M:'#0EA5E9', N:'#84CC16', O:'#FB7185', P:'#14B8A6',
}
const colorFor = (L: string) => GROUP_COLORS[L] ?? '#334155'

function rr(n: number) {
  const t = Array.from({ length: n }, (_, i) => i + 1)
  if (t.length < 2) return [] as Array<[number, number]>
  if (t.length % 2 === 1) t.push(0)
  const rounds = t.length - 1
  const half = t.length / 2
  const out: Array<[number, number]> = []
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < half; i++) {
      const a = t[i], b = t[t.length - 1 - i]
      if (a !== 0 && b !== 0) out.push([a, b])
    }
    const fixed = t[0], rest = t.slice(1)
    rest.unshift(rest.pop()!); t.splice(0, t.length, fixed, ...rest)
  }
  return out
}
const pool4 = () => ({
  r1: [[1,4],[2,3]] as Array<[number,number]>,
  r2: ['Vincente G1 vs Vincente G2','Perdente G1 vs Perdente G2']
})
const chunk = <T,>(arr:T[], size:number) => { const o:T[][]=[]; for(let i=0;i<arr.length;i+=size)o.push(arr.slice(i,i+size)); return o }
const parseDate = (s?: string|null) => (s ? new Date(s).getTime() : 0)

/* =========================================================
   Pagina STAMPA
   ========================================================= */
export default function StampaPage() {
  /* ---------- TOUR ---------- */
  const { data: toursRes } = useSWR('/api/tours', fetcher)
  const tours: Tour[] = toursRes?.items ?? []
  const [tourId, setTourId] = useState<string>('')

  // inizializzazione tourId: 1) localStorage, 2) primo tour disponibile
  useEffect(() => {
    if (tourId) return
    const saved = localStorage.getItem('print:tour') || ''
    if (saved && tours.some(t => t.id === saved)) {
      setTourId(saved)
    } else if (tours.length) {
      setTourId(tours[0].id)
      localStorage.setItem('print:tour', tours[0].id)
    }
  }, [tours, tourId])

  /* ---------- TAPPE per tour ---------- */
  const { data: tappeRes } = useSWR(
    tourId ? `/api/tournaments?tour_id=${tourId}` : null,
    fetcher
  )
  const tappeAll: Tournament[] = tappeRes?.items ?? []

  // solo tappe visibili (non “closed”) + ordinate per data decrescente
  const tappeVisibili = useMemo(() => {
    return (tappeAll || [])
      .filter(t => (t?.status || '').toLowerCase() !== 'closed')
      .sort((a,b) => parseDate(b?.date) - parseDate(a?.date))
  }, [tappeAll])

  const [tId, setTId] = useState<string>('')

  // inizializzazione tId: 1) LS se ancora valida, 2) prima visibile
  useEffect(() => {
    if (!tourId) { setTId(''); return }
    const saved = localStorage.getItem('print:tournament') || ''
    if (saved && tappeVisibili.some(t => t.id === saved)) {
      setTId(saved)
    } else if (tappeVisibili.length) {
      setTId(tappeVisibili[0].id)
      localStorage.setItem('print:tournament', tappeVisibili[0].id)
    } else {
      setTId('')
      if (saved) localStorage.removeItem('print:tournament')
    }
  }, [tourId, tappeVisibili])

// ---------- Carica dati gironi: LS -> admin API -> public API ----------
const [store, setStore] = useState<Persist | null>(null)
const [times, setTimes] = useState<Record<string,string[]>>({})
const [dataSource, setDataSource] = useState<'local'|'admin-api'|'public-api'|'none'>('none')
const [isPublicFlag, setIsPublicFlag] = useState<boolean>(false)

useEffect(() => {
  if (!tId) {
    setStore(null); setTimes({}); setDataSource('none'); setIsPublicFlag(false)
    return
  }

  // 1) localStorage
  const raw = localStorage.getItem(`gm:${tId}`)
  if (raw) {
    try {
      const js: Persist = JSON.parse(raw)
      setStore(js)
      setTimes(js?.times ?? {})
      setDataSource('local')
      // local non ci dice se è pubblico o no
      setIsPublicFlag(false)
      return
    } catch {
      // continua ai fallback
    }
  }

  let cancelled = false
  ;(async () => {
    // 2) admin API (vede anche non pubblici)
    try {
      const r = await fetch(`/api/groups/state?tournament_id=${encodeURIComponent(tId)}`, {
        headers: { 'x-role': 'admin' },
        cache: 'no-store',
      })
      const js = await r.json()
      if (cancelled) return
      const st: Persist | null = js?.state ?? null
      if (st) {
        setStore(st)
        setTimes(st?.times ?? {})
        setDataSource('admin-api')
        setIsPublicFlag(!!js?.is_public)
        return
      }
    } catch {}

    // 3) public API
    try {
      const r = await fetch(`/api/groups/public/state?tournament_id=${encodeURIComponent(tId)}`, {
        cache: 'no-store',
      })
      const js = await r.json()
      if (cancelled) return
      const st: Persist | null = js?.state ?? null
      if (st) {
        setStore(st)
        setTimes(st?.times ?? {})
        setDataSource('public-api')
        setIsPublicFlag(!!js?.is_public)
        return
      }
    } catch {}

    // niente trovato
    if (!cancelled) {
      setStore(null); setTimes({}); setDataSource('none'); setIsPublicFlag(false)
    }
  })()

  return () => { cancelled = true }
}, [tId])


  /* ---------- helper rendering ---------- */
  const letters = useMemo(() => {
    if (!store?.groupsCount) return []
    return LETTERS.slice(0, Math.max(1, store.groupsCount))
  }, [store?.groupsCount])

  const regLabels = store?.labels ?? {}
  const labelBySlot = (L:string, slot:number) => {
    const rid = store?.assign?.[`${L}-${slot}`] ?? ''
    return rid ? (regLabels[rid] ?? `Slot ${slot}`) : `Slot ${slot}`
  }

  function scheduleRows(L:string){
    const m = store?.meta?.[L] ?? { capacity:0, format: 'pool' as const }
    const cap = m.capacity ?? 0
    if (cap < 2) return [] as { t1:string; t2:string }[]
    if (m.format === 'pool' && cap === 4) {
      const p = pool4()
      return [
        { t1: labelBySlot(L, p.r1[0][0]), t2: labelBySlot(L, p.r1[0][1]) },
        { t1: labelBySlot(L, p.r1[1][0]), t2: labelBySlot(L, p.r1[1][1]) },
        { t1: 'Vincente G1', t2: 'Vincente G2' },
        { t1: 'Perdente G1', t2: 'Perdente G2' },
      ]
    }
    return rr(Math.min(cap,6)).map(([a,b]) => ({ t1: labelBySlot(L,a), t2: labelBySlot(L,b) }))
  }

  /* ---------- UI stato ---------- */
  const [tab, setTab] = useState<'gironi'|'iscritti'>('gironi')

  /* ---------- RENDER ---------- */
  return (
    <div className="p-6 space-y-4 print-area">
      {/* Barra filtri */}
      <div className="print:hidden card p-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {/* TOUR */}
          <div>
            <div className="text-xs text-neutral-400 mb-1">Tour</div>
            <select
              className="input w-full"
              value={tourId}
              onChange={e => {
                const v = e.target.value
                setTourId(v)
                localStorage.setItem('print:tour', v)
                setTId('') // reset tappa alla scelta tour
              }}
            >
              {tours.length === 0 && <option value="">—</option>}
              {tours.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* TAPPA (solo visibili) */}
          <div>
            <div className="text-xs text-neutral-400 mb-1">Tappa</div>
            <select
              className="input w-full"
              value={tId}
              disabled={!tappeVisibili.length}
              onChange={e => {
                const v = e.target.value
                setTId(v)
                if (v) localStorage.setItem('print:tournament', v)
              }}
            >
              {!tappeVisibili.length && <option value="">Nessuna tappa disponibile</option>}
              {tappeVisibili.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.date ? ` — ${new Date(t.date).toLocaleDateString()}` : ''}
                </option>
              ))}
            </select>
          </div>
{/* DEBUG SOURCE (solo schermo) */}
<div className="print:hidden text-xs text-neutral-400">
  Fonte dati gironi: <b>
    {dataSource === 'local' ? 'localStorage'
     : dataSource === 'admin-api' ? 'API admin'
     : dataSource === 'public-api' ? 'API pubblica'
     : '—'}
  </b>
  {dataSource !== 'none' && (
    <> • pubblico: <b>{isPublicFlag ? 'sì' : 'no'}</b></>
  )}
</div>

          {/* TAB */}
          <div className="flex items-end gap-2">
            <button
              className={`btn ${tab==='gironi' ? 'ring-2 ring-blue-500' : ''}`}
              onClick={()=>setTab('gironi')}
            >
              Gironi
            </button>
            <button
              className={`btn ${tab==='iscritti' ? 'ring-2 ring-blue-500' : ''}`}
              onClick={()=>setTab('iscritti')}
            >
              Iscritti
            </button>
          </div>

          {/* STAMPA */}
          <div className="flex items-end justify-end gap-2">
            <div className="text-sm text-neutral-400">
              {tId ? 'Pronto per la stampa' : (tappeVisibili.length ? 'Seleziona Tour e Tappa' : 'Nessuna tappa disponibile (tutte chiuse)')}
            </div>
            <button className="btn" onClick={()=>window.print()} disabled={!tId} title="Stampa (Ctrl+P)">
              🖨️ Stampa
            </button>
          </div>
        </div>
      </div>

      {/* ---------- TAB: GIRONI ---------- */}
      {tab === 'gironi' && (
        !tId ? (
          <div className="card p-6 text-sm text-neutral-400">
            {tappeVisibili.length > 0
              ? <>Seleziona <b>Tour</b> e <b>Tappa</b>.</>
              : <>Nessuna tappa disponibile (tutte chiuse).</>
            }
          </div>
        ) : !store ? (
          <div className="card p-6 text-sm text-neutral-400">
            Nessun dato salvato per questa tappa. Vai in <b>/admin/gironi</b>, premi <b>Salva</b>, poi torna qui.
          </div>
        ) : (
          <div className="space-y-12">
            {chunk(letters, 8).map((block, bi) => {
              const rowsOf4 = chunk(block, 4)
              return (
                <div key={`pg-${bi}`} className="print-page space-y-10">
                  {/* Gironi: 4 per riga */}
                  <div className="space-y-6">
                    {rowsOf4.map((rowLetters, ri) => (
                      <div key={`row-g-${bi}-${ri}`} className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        {rowLetters.map(L => (
                          <div key={`g-${L}`} className="card p-0 overflow-hidden">
                            <div className="card-hd px-3 py-2 font-semibold text-white" style={{ background: colorFor(L) }}>
                              GIRONE {L}
                            </div>
                            <div className="card-bd p-3">
                              <ol className="space-y-2">
                                {Array.from({ length: (store.meta?.[L]?.capacity ?? 0) }).map((_,i)=>(
                                  <li key={i} className="flex items-center gap-2">
                                    <span className="text-xs w-4 text-neutral-500">{String(i+1).padStart(2,'0')}</span>
                                    <span className="flex-1 border-b border-dashed border-neutral-600 leading-6">
                                      {labelBySlot(L, i+1)}
                                    </span>
                                  </li>
                                ))}
                              </ol>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>

                  {/* Partite: 2 per riga */}
                  <div className="space-y-6">
                    {rowsOf4.map((rowLetters, ri) => {
                      const pairs = chunk(rowLetters, 2)
                      return (
                        <div key={`row-m-${bi}-${ri}`} className="space-y-6">
                          {pairs.map((pair, pi) => (
                            <div key={`pair-${pi}`} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              {pair.map(L => {
                                const rows = scheduleRows(L)
                                return (
                                  <div key={`m-${L}`} className="card p-0 overflow-hidden">
                                    <div className="card-hd px-3 py-2 font-semibold text-white" style={{ background: colorFor(L) }}>
                                      Partite {L}
                                    </div>
                                    <div className="card-bd p-3 space-y-2">
                                      {rows.length ? rows.map((r,idx)=>(
                                        <div key={idx} className="grid items-center"
                                             style={{ gridTemplateColumns: '48px 1fr 28px 16px 28px 1fr' }}>
                                          <div className="text-[12px] text-neutral-600">{(times?.[L]?.[idx] ?? '')}</div>
                                          <div className="min-w-0 truncate whitespace-nowrap text-sm text-right pr-1">{r.t1}</div>
                                          <div className="h-6 leading-6 border border-neutral-600 rounded" />
                                          <div className="text-center text-neutral-500 text-[12px]">vs</div>
                                          <div className="h-6 leading-6 border border-neutral-600 rounded" />
                                          <div className="min-w-0 truncate whitespace-nowrap text-sm pl-1">{r.t2}</div>
                                        </div>
                                      )) : <div className="text-xs text-neutral-500">—</div>}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          ))}
                        </div>
                      )
                    })}
                  </div>

                  {bi < Math.ceil(letters.length/8)-1 && <div className="print-break" />}
                </div>
              )
            })}
          </div>
        )
      )}

      {/* ---------- TAB: ISCRITTI ---------- */}
      {tab==='iscritti' && (!tId ? (
        <div className="card p-6 text-sm text-neutral-400">Seleziona <b>Tour</b> e <b>Tappa</b>.</div>
      ) : <Iscritti tId={tId} />)}

      {/* CSS stampa */}
      <style jsx global>{`
        @media print {
          :root { color-scheme: light; }
          body { background:#fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          body * { visibility: hidden; }
          .print-area, .print-area * { visibility: visible; }
          .print-area { position: absolute; inset: 0; padding: 8px; }
          .card{ background:#fff !important; color:#000 !important; border:1px solid #000 !important; box-shadow:none !important; border-radius:10px; }
          .text-neutral-500,.text-neutral-600{ color:#000 !important; }
          .border-neutral-600,.border-neutral-700{ border-color:#000 !important; }
          .space-y-6 > :where(*+*){ margin-top:10px !important; }
          .space-y-10 > :where(*+*){ margin-top:14px !important; }
          .space-y-12 > :where(*+*){ margin-top:16px !important; }
          .print-break{ break-after: page; }
        }
      `}</style>
    </div>
  )
}

/* =========================================================
   Sottocomponente: ISCRITTI (solo cognomi dal label)
   ========================================================= */
function Iscritti({ tId }: { tId: string }) {
  const { data } = useSWR(
    tId ? `/api/registrations/by-tournament?tournament_id=${tId}` : null,
    (u) => fetch(u).then(r => r.json()),
    { revalidateOnFocus: false }
  )
  const regs = data?.items ?? []

  const surnameFromSide = (s: string) => {
    const cleaned = s.trim().replace(/\s+[A-Z]\.?$/u, '')
    return (cleaned.split(/\s+/)[0] ?? '')
  }
  const labelToSurnames = (label: string) => {
    const [a = '', b = ''] = String(label).replace(/—/g, '/').split('/').map(v => v.trim())
    const la = surnameFromSide(a)
    const lb = surnameFromSide(b)
    return [la, lb].filter(Boolean).join(' / ')
  }

  return (
    <div className="card p-4">
      <div className="text-lg font-semibold mb-3">Iscritti</div>
      <ul className="space-y-2">
        {regs.length === 0 ? (
          <li className="text-sm text-neutral-500">Nessun iscritto.</li>
        ) : regs.map((row: any, i: number) => (
          <li key={row.id ?? i} className="flex items-center gap-2">
            <span className="text-xs w-6 text-neutral-500">{String(i + 1).padStart(2, '0')}</span>
            <span className="mr-3">{labelToSurnames(row?.label ?? '')}</span>
            <span className="flex-1 border-b border-dashed border-neutral-600 leading-6"></span>
          </li>
        ))}
      </ul>
    </div>
  )
}
