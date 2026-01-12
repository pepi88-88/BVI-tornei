// app/atleta/tornei/[tour]/page.tsx
'use client'

import * as React from 'react'
import Link from 'next/link'

type Tournament = {
  id: string
  name: string
  title?: string
  event_date?: string | null
  archived?: boolean | null
  max_teams?: number | null
  /** opzionale: alcune API possono restituirlo */
  multiplier?: number | null
}

export default function AthleteTourHome({ params }: { params: { tour: string } }) {
  const tourName = decodeURIComponent(params.tour)

  const [tourId, setTourId] = React.useState<string | null>(null)
  const [items, setItems] = React.useState<Tournament[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    const tid = localStorage.getItem('selectedTourId')
    setTourId(tid)
    if (!tid) { setItems([]); setLoading(false); return }

    setLoading(true)
    fetch(`/api/tournaments/by-tour?tour_id=${tid}`)
      .then(r => r.json())
      .then(js => {
        const arr = Array.isArray(js?.items) ? js.items as Tournament[] : []
        setItems(arr)
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [tourName])

  // cache alcuni campi delle tappe (titolo & max iscritti)
  React.useEffect(() => {
    items.forEach(t => {
      if (t?.name || t?.title) {
        localStorage.setItem(`tournamentTitle:${t.id}`, (t.name || t.title || ''))
      }
      if (t?.max_teams != null) {
        localStorage.setItem(`tournamentMaxTeams:${t.id}`, String(t.max_teams))
      }
    })
  }, [items])

  const tourSeg = tourId ?? tourName // fallback se tourId non disponibile

  return (
    <div className="space-y-4">
      {/* Titolo grande, centrato */}
      <div className="text-center">
        <div className="text-2xl md:text-3xl font-bold">{tourName}</div>
        {!tourId && (
          <div className="mt-1 text-xs text-red-400">
            Nessun tour selezionato (manca <code>selectedTourId</code>).
            Vai su <span className="underline">/admin/tour</span> e seleziona un tour.
          </div>
        )}
      </div>

      <div className="card p-4">
        {loading ? (
          <div className="text-sm text-neutral-500">Caricamento…</div>
        ) : items.length === 0 ? (
          <div className="text-sm text-neutral-500">Nessuna tappa disponibile.</div>
        ) : (
          <ul className="space-y-2">
            {items.map(t => (
              <li
  key={t.id}
  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 border-b border-neutral-800 py-2"
>
  <div className="min-w-0">
    <div className="font-medium break-words whitespace-normal sm:truncate sm:whitespace-nowrap">
      {t.title || t.name}
    </div>
    <div className="text-xs text-neutral-500">
      × {Number(t.multiplier ?? 1).toFixed(2)} • {t.event_date ?? 'gg/mm'} • tot: {t.max_teams ?? '—'}
    </div>
  </div>

  <div className="flex flex-wrap gap-2 sm:shrink-0">
                  {/* Passo tid e tname: la pagina Iscritti/Gironi li usa */}
                  <Link
                    className="btn btn-ghost btn-sm w-full sm:w-auto"
                    href={`/atleta/tornei/${encodeURIComponent(tourSeg)}/iscritti?tid=${t.id}&tname=${encodeURIComponent(t.name)}`}
                  >
                    Iscritti
                  </Link>

                  <Link
                    className="btn btn-ghost btn-sm w-full sm:w-auto"
                    href={`/atleta/tornei/${encodeURIComponent(tourSeg)}/gironi?tid=${t.id}&tname=${encodeURIComponent(t.name)}`}
                  >
                    Gironi
                  </Link>

                  <Link
                    className="btn btn-ghost btn-sm w-full sm:w-auto"
                    href={`/atleta/tornei/${encodeURIComponent(tourSeg)}/risultati?tid=${t.id}&tname=${encodeURIComponent(t.name)}`}
                  >
                    Risultati
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
