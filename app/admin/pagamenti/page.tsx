'use client'
import useSWR from 'swr'
import { useEffect, useMemo, useState } from 'react'

const fetcher = (u: string) => fetch(u).then(r => r.json())

export default function PagamentiPage() {
  // TOUR
  const { data: tours } = useSWR('/api/tours', fetcher)
  const [tourId, setTourId] = useState('')
  useEffect(() => {
    const s = localStorage.getItem('selectedTourId')
    if (s) setTourId(s)
  }, [])
  function onPickTour(id: string) {
    setTourId(id)
    localStorage.setItem('selectedTourId', id)
    setTId('')
  }

  // TAPPA (raw)
  const { data: taps } = useSWR(
    tourId ? `/api/tournaments?tour_id=${tourId}` : null,
    fetcher
  )
  const [tId, setTId] = useState('')
  useEffect(() => {
    const s = localStorage.getItem('selectedTournamentId')
    if (s) setTId(s)
  }, [])

  // ---- TAPPE VISIBILI: esclude CHIUSE + ordina per data desc
  const parseDate = (s?: string | null) => (s ? new Date(s).getTime() : 0)
  const tappeVisibili = useMemo(() => {
    const arr = (taps?.items ?? []) as any[]
    return arr
      .filter(tp => tp?.status !== 'closed')
      .sort((a, b) => parseDate(b?.event_date) - parseDate(a?.event_date))
  }, [taps])

  // se non c'è tId, seleziona la prima visibile
  useEffect(() => {
    if (!tId && tappeVisibili.length) {
      setTId(tappeVisibili[0].id)
    }
  }, [tappeVisibili, tId])

  // se la tappa salvata è chiusa/non più visibile → reset
  useEffect(() => {
    if (!tId) return
    const stillVisible = tappeVisibili.some(t => t.id === tId)
    if (!stillVisible) {
      setTId('')
      const saved = localStorage.getItem('selectedTournamentId')
      if (saved === tId) localStorage.removeItem('selectedTournamentId')
    }
  }, [tId, tappeVisibili])

  function onPickTappa(id: string) {
    setTId(id)
    localStorage.setItem('selectedTournamentId', id)
  }

  // LISTA pagamenti
  const { data, mutate } = useSWR(
    tId ? `/api/registrations/for-payments?tournament_id=${tId}` : null,
    fetcher
  )
  const items = data?.items ?? []

  // --- SOLO PAGAMENTI: escludi la waiting list
  const maxTeamsRaw = tId
    ? tappeVisibili.find((t: any) => t.id === tId)?.max_teams
    : undefined
  const maxTeams = Number.isFinite(+maxTeamsRaw) ? Math.max(0, +maxTeamsRaw) : 0

  // mostra in Pagamenti solo i primi "maxTeams" (se > 0). Se maxTeams non impostato → mostra tutto
  const payableItems =
    maxTeams > 0 ? items.slice(0, Math.min(maxTeams, items.length)) : items

  // 🔍 RICERCA TESTUALE
  const [search, setSearch] = useState('')

  // TOT GENERALI (NON filtrati dalla ricerca)
  const stats = useMemo(() => {
    let a = 0, b = 0, c = 0, d = 0, full = 0

for (const r of payableItems) {
  if (r.paid_a) a++
  if (r.paid_b) b++
  if (r.paid_c) c++
  if (r.paid_d) d++

  const isTeam = !!r.team_name && Number(r.team_format) >= 3
  const is4 = Number(r.team_format) === 4

  const fullyPaid = isTeam
    ? (r.paid_a && r.paid_b && r.paid_c && (is4 ? r.paid_d : true))
    : (r.paid_a && r.paid_b)

  if (fullyPaid) full++
}

return { a, b, c, d, full, teams: payableItems.length }

  }, [payableItems])

  // 📌 LISTA VISIBILE: applica ricerca + manda in fondo le squadre COMPLETAMENTE pagate
  const visibleItems = useMemo(() => {
    // 1) filtro per ricerca
    const q = search.trim().toLowerCase()
    let filtered = payableItems
    if (q) {
      filtered = payableItems.filter((r: any) => {
       const a = String(r.a || '').toLowerCase()
const b = String(r.b || '').toLowerCase()
const c = String(r.c || '').toLowerCase()
const d = String(r.d || '').toLowerCase()
const tn = String(r.team_name || '').toLowerCase()
return a.includes(q) || b.includes(q) || c.includes(q) || d.includes(q) || tn.includes(q)

      })
    }

    // 2) metti in fondo quelle completamente pagate (paid_a && paid_b)
    const notFull: any[] = []
    const full: any[] = []
    for (const r of filtered) {
     const isTeam = !!r.team_name && Number(r.team_format) >= 3
const is4 = Number(r.team_format) === 4
const fullyPaid = isTeam
  ? (r.paid_a && r.paid_b && r.paid_c && (is4 ? r.paid_d : true))
  : (r.paid_a && r.paid_b)

if (fullyPaid) full.push(r)
else notFull.push(r)

    }
    return [...notFull, ...full]
  }, [payableItems, search])

  async function togglePaid(id: string, side: 'A' | 'B' | 'C' | 'D', value: boolean) {
    // trova la riga per messaggio più chiaro
    const reg = items.find((r: any) => r.id === id)

    // se stiamo TOGLIENDO una spunta → chiedi conferma
    if (!value) {
     const name = reg
  ? (reg.team_name ? `${reg.team_name} — ${reg.a} / ${reg.b} / ${reg.c || ''} / ${reg.d || ''}` : `${reg.a} — ${reg.b}`)
  : ''
const label =
  side === 'A' ? 'Pagato A'
  : side === 'B' ? 'Pagato B'
  : side === 'C' ? 'Pagato C'
  : 'Pagato D'

      const msg = name
        ? `Vuoi davvero togliere la spunta "${label}" per ${name}?`
        : `Vuoi davvero togliere la spunta "${label}"?`

      const ok = confirm(msg)
      if (!ok) {
        // ripristina lo stato locale (nel dubbio, ricarichiamo i dati correnti)
        mutate(data, false)
        return
      }
    }

    const body: any = { id }
if (side === 'A') body.paid_a = value
else if (side === 'B') body.paid_b = value
else if (side === 'C') body.paid_c = value
else body.paid_d = value


    // ottimistico
    const prev = data
    mutate(
      {
        items: items.map((r: any) =>
          r.id === id
            ? {
                ...r,
                paid_a: side === 'A' ? value : r.paid_a,
paid_b: side === 'B' ? value : r.paid_b,
paid_c: side === 'C' ? value : r.paid_c,
paid_d: side === 'D' ? value : r.paid_d,

              }
            : r
        ),
      },
      false
    )

    const res = await fetch('/api/registrations/pay', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      mutate(prev, false)
      const js = await res.json().catch(() => ({}))
      alert(js?.error || 'Errore aggiornamento pagamento')
    } else {
      mutate()
    }
  }


  return (
    <div className="space-y-6 p-6">
      {/* intestazione: stessi selettori di Iscrizioni */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-neutral-400">Tour</span>
          <select
            className="input"
            value={tourId}
            onChange={e => onPickTour(e.target.value)}
          >
            {tours?.items?.map((tr: any) => (
              <option key={tr.id} value={tr.id}>
                {tr.name}
                {tr.season_start && tr.season_end
                  ? ` (${tr.season_start}/${tr.season_end})`
                  : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-sm text-neutral-400">Tappa</span>
          <select
            className="input"
            value={tId}
            onChange={e => onPickTappa(e.target.value)}
          >
            {tappeVisibili.map((t: any) => (
              <option key={t.id} value={t.id}>
                {t.event_date ? `${t.event_date} — ` : ''}
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <div className="ml-auto text-sm text-neutral-400">
         Squadre: {stats.teams} · Pagate A: {stats.a} · Pagate B: {stats.b} · Pagate C: {stats.c} · Pagate D: {stats.d} · Squadre pagate: {stats.full}

        </div>
      </div>

      {/* elenco pagamenti */}
      <div className="card p-4 space-y-3">
        {/* 🔍 barra di ricerca (solo se c'è tappa selezionata) */}
        {tId && payableItems.length > 0 && (
          <div className="mb-2">
            <input
              className="input w-full max-w-sm"
              placeholder="Cerca per nome o squadra…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        )}

        {!tId ? (
          <div className="text-neutral-400">Seleziona una tappa visibile.</div>
        ) : payableItems.length === 0 ? (
          items.length > 0 ? (
            <div className="text-neutral-400">
              Solo lista d’attesa per questa tappa. Nessuno da pagare.
            </div>
          ) : (
            <div className="text-neutral-400">
              Nessuna iscrizione per questa tappa.
            </div>
          )
        ) : visibleItems.length === 0 ? (
          <div className="text-neutral-400">
            Nessun risultato per la ricerca corrente.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
  {visibleItems.map((r: any, i: number) => {
    const isTeam = !!r.team_name && Number(r.team_format) >= 3
    const is4 = Number(r.team_format) === 4

    const fullyPaid = isTeam
      ? (r.paid_a && r.paid_b && r.paid_c && (is4 ? r.paid_d : true))
      : (r.paid_a && r.paid_b)

   return (
  <div
    key={r.id}
    className={[
      'py-2 px-3 rounded-lg border border-neutral-800',
      'grid gap-x-2 gap-y-2',
      'grid-cols-[72px_1fr_72px]',  // sx / centro / dx
      fullyPaid ? 'opacity-70' : '',
    ].join(' ')}
  >
    {/* TEAM NAME (span 3) */}
    {isTeam && (
      <div className="col-span-3 text-center font-semibold text-blue-400 leading-tight">
        {r.team_name}
      </div>
    )}

    {/* ROW 1: A / (A-B names) / B */}
    <label className="flex items-center gap-2 text-xs sm:text-sm justify-start">
      <input
        type="checkbox"
        checked={!!r.paid_a}
        onChange={e => togglePaid(r.id, 'A', e.target.checked)}
      />
      <span>A</span>
    </label>

    <div className="text-center text-sm text-white leading-tight">
      {r.a} — {r.b}
    </div>

    <label className="flex items-center gap-2 text-xs sm:text-sm justify-end">
      <span>B</span>
      <input
        type="checkbox"
        checked={!!r.paid_b}
        onChange={e => togglePaid(r.id, 'B', e.target.checked)}
      />
    </label>

    {/* ROW 2: C / (C-D names) / D */}
    {isTeam ? (
      <>
        <label className="flex items-center gap-2 text-xs sm:text-sm justify-start">
          <input
            type="checkbox"
            checked={!!r.paid_c}
            onChange={e => togglePaid(r.id, 'C', e.target.checked)}
          />
          <span>C</span>
        </label>

        <div className="text-center text-sm text-white/90 leading-tight">
          {r.c || '—'}
          {is4 ? ` — ${r.d || '—'}` : ''}
        </div>

        {is4 ? (
          <label className="flex items-center gap-2 text-xs sm:text-sm justify-end">
            <span>D</span>
            <input
              type="checkbox"
              checked={!!r.paid_d}
              onChange={e => togglePaid(r.id, 'D', e.target.checked)}
            />
          </label>
        ) : (
          <div /> // placeholder per 3x3
        )}
      </>
    ) : (
      // 2x2: seconda riga vuota
      <>
        <div />
        <div />
        <div />
      </>
    )}
  </div>
)


  })}
</div>

        )}
      </div>
    </div>
  )
}
