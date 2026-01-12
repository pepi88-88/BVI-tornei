'use client'

import * as React from 'react'
import Link from 'next/link'

type Tour = { id: string; name: string; season_start?: string|null; season_end?: string|null }
type Tournament = { id: string; name: string; title?: string; event_date?: string|null; archived?: boolean|null; max_teams?: number|null }


const fetcher = (url: string) => fetch(url, { cache: 'no-store' }).then(r => {
  if (!r.ok) throw new Error(`Fetch failed: ${url}`)
  return r.json()
})

export default function AthleteTappePage(){
  const [tours, setTours] = React.useState<Tour[]>([])
  const [tourId, setTourId] = React.useState<string>('')

  // carico i tour e imposto il selezionato come in Iscrizioni
  React.useEffect(()=>{
    (async ()=>{
      try {
        const data = await fetcher('/api/tours') as { items: Tour[] }
        const items = data?.items ?? []
        setTours(items)
        const saved = localStorage.getItem('selectedTourId')
        const fallback = items[0]?.id ?? ''
        const next = (saved && items.some(t => t.id === saved)) ? saved : fallback
        setTourId(next)
        if (next) localStorage.setItem('selectedTourId', next)
      } catch (e) {
        console.error(e)
        setTours([])
        setTourId('')
      }
    })()
  },[])

  // carico le tappe del tour
  const [tappe, setTappe] = React.useState<Tournament[]>([])
  const [loading, setLoading] = React.useState(false)
  React.useEffect(()=>{
    (async ()=>{
      if (!tourId) { setTappe([]); return }
      setLoading(true)
      try {
        // ⚠️ stesso endpoint della tua pagina Iscrizioni
       const data = await fetcher(`/api/tournaments?tour_id=${tourId}`) as { items: Tournament[] }
const all = data?.items ?? []

// 🔒 mostra SOLO le tappe non chiuse (e non archiviate, se vuoi)
const visible = all
  .filter(tp => (tp as any).status !== 'closed')        // ← nasconde le CHIUSE
  .filter(tp => !tp.archived)                            // ← opzionale: nasconde anche ARCHIVIATE

// (opz.) ordina per data decrescente
visible.sort((a, b) => (b.event_date ? +new Date(b.event_date) : 0) - (a.event_date ? +new Date(a.event_date) : 0))

setTappe(visible)


      } catch (e) {
        console.error(e)
        setTappe([])
      } finally { setLoading(false) }
    })()
  },[tourId])

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Tappe attive</h1>

      {/* selezione tour (stesso comportamento di Iscrizioni) */}
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-neutral-400">Tour</span>
          <select
            className="input"
            value={tourId}
            onChange={(e)=>{ setTourId(e.target.value); localStorage.setItem('selectedTourId', e.target.value) }}
          >
            {tours.map(tr => (
              <option key={tr.id} value={tr.id}>
                {tr.name}{tr.season_start && tr.season_end ? ` (${tr.season_start}/${tr.season_end})` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* elenco tappe del tour selezionato (solo lettura) */}
      <div className="card p-4">
        {!tourId ? (
          <div className="text-sm text-neutral-500">Seleziona un tour.</div>
        ) : loading ? (
          <div className="text-sm text-neutral-500">Caricamento…</div>
        ) : tappe.length === 0 ? (
          <div className="text-sm text-neutral-500">Nessuna tappa disponibile per questo tour.</div>
        ) : (
          <ul className="space-y-2">
            {tappe.map(t => (
             <li
  key={t.id}
  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 border-b border-neutral-800 py-2"
>
  <div className="min-w-0">
    {/* niente truncate su mobile; da sm in su torna truncate */}
    <div className="font-medium break-words whitespace-normal sm:truncate sm:whitespace-nowrap">
      {t.name}
    </div>
    <div className="text-xs text-neutral-500">{t.event_date ? t.event_date : 'data da definire'}</div>
  </div>

  {/* su mobile i bottoni vanno a capo e occupano tutta la riga; da sm in su tornano inline */}
  <div className="flex flex-wrap gap-2 sm:shrink-0">

                  {/* passiamo tid = tournament_id alle pagine atleta */}

 <Link  className="btn btn-ghost btn-sm w-full sm:w-auto" href={`/atleta/tornei/${encodeURIComponent(tourId)}/iscritti?tid=${t.id}&tname=${encodeURIComponent(t.name)}`}>
  Iscritti
</Link>

<Link  className="btn btn-ghost btn-sm w-full sm:w-auto" href={`/atleta/tornei/${encodeURIComponent(tourId)}/gironi?tid=${t.id}&tname=${encodeURIComponent(t.name)}`}>
  Gironi
</Link>

<Link className="btn btn-ghost btn-sm w-full sm:w-auto" href={`/atleta/tornei/${tourId}/tabellone?tid=${t.id}&tname=${encodeURIComponent(t.name)}`}>
  Tabellone finale
</Link>

                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
