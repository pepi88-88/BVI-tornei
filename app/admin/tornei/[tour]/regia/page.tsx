'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'

type RegiaStatus = 'waiting' | 'queued' | 'live' | 'paused' | 'done'

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

type ViewMode = 'all' | 'live' | 'live_plus_2'
type TournamentOption = {
  id: string
  name: string
  date?: string
}
const COURTS = Array.from({ length: 10 }, (_, i) => i + 1)
const SEQ_OPTIONS = Array.from({ length: 20 }, (_, i) => i + 1)

export default function RegiaPage() {
  const params = useParams()
  const searchParams = useSearchParams()

 const routeTour = String(params?.tour ?? '')
const initialTournamentId = searchParams.get('tournament_id') || routeTour

  const [rows, setRows] = useState<RegiaRow[]>([])
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('all')
  const [drafts, setDrafts] = useState<Record<string, { court: string; sequence: string }>>({})
const [availableTournaments, setAvailableTournaments] = useState<TournamentOption[]>([])

const [draftTournamentA, setDraftTournamentA] = useState<string>('')
const [draftTournamentB, setDraftTournamentB] = useState<string>('')

const [activeTournamentA, setActiveTournamentA] = useState<string>('')
const [activeTournamentB, setActiveTournamentB] = useState<string>('')
  
const tournamentNameById = useMemo(() => {
  return Object.fromEntries(
    availableTournaments.map((t) => [t.id, t.name])
  ) as Record<string, string>
}, [availableTournaments])
  
const STORAGE_KEY = 'regia:selectedTournaments'
 async function loadData() {
  const ids = [activeTournamentA, activeTournamentB].filter(Boolean)
  if (!ids.length) return

  setLoading(true)
  try {
    const query = ids
      .map((id) => `tournament_id=${encodeURIComponent(id)}`)
      .join('&')

    const res = await fetch(`/api/regia/state?${query}`, {
      headers: { 'x-role': 'admin' },
      cache: 'no-store',
    })

    const json = await res.json()
    const items: RegiaRow[] = json?.rows || []
    setRows(items)

    const nextDrafts: Record<string, { court: string; sequence: string }> = {}
    items.forEach((r) => {
      nextDrafts[r.key] = {
        court: r.court == null ? '' : String(r.court),
        sequence:
          r.status === 'paused'
            ? '0'
            : r.sequence == null
            ? ''
            : String(r.sequence),
      }
    })
    setDrafts(nextDrafts)
  } finally {
    setLoading(false)
  }
}

  useEffect(() => {
  if (!activeTournamentA) return
  void loadData()
}, [activeTournamentA, activeTournamentB])

  function setDraft(key: string, patch: Partial<{ court: string; sequence: string }>) {
    setDrafts((prev) => ({
      ...prev,
      [key]: {
        court: prev[key]?.court ?? '',
        sequence: prev[key]?.sequence ?? '',
        ...patch,
      },
    }))
  }
async function loadTournamentOptions() {
  try {
    const res = await fetch('/api/tournaments', { cache: 'no-store' })
    const json = await res.json()
    const items = (json?.items || []) as TournamentOption[]
    setAvailableTournaments(items)
  } catch {
    setAvailableTournaments([])
  }
}
  useEffect(() => {
  void loadTournamentOptions()

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { a?: string; b?: string }
      const a = String(parsed?.a || '')
      const b = String(parsed?.b || '')

      setDraftTournamentA(a)
      setDraftTournamentB(b)
      setActiveTournamentA(a)
      setActiveTournamentB(b)
      return
    }
  } catch {}

  if (initialTournamentId) {
    setDraftTournamentA(initialTournamentId)
    setDraftTournamentB('')
    setActiveTournamentA(initialTournamentId)
    setActiveTournamentB('')
  }
}, [initialTournamentId])
  function tournamentIdForKey(key: string) {
  const row = rows.find((r) => r.key === key)
  return row?.tournament_id || ''
}
 async function mutate(
  key: string,
  action: 'save_assignment' | 'set_live' | 'stop_live' | 'close_match',
  extra?: { court?: number | null; sequence?: number | null }
) {
  const targetTournamentId = tournamentIdForKey(key)
  if (!targetTournamentId) return

  setSavingKey(key)

  try {
    const res = await fetch('/api/regia/state', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-role': 'admin',
      },
      body: JSON.stringify({
        tournament_id: targetTournamentId,
        action,
        key,
        ...extra,
      }),
    })

   

      const json = await res.json()
      if (!res.ok) {
        alert(json?.error || 'Errore regia')
        return
      }

           await loadData()
    } finally {
      setSavingKey(null)
    }
  }
function applyTournamentSelection() {
  if (!draftTournamentA) {
    alert('Seleziona almeno il Torneo A.')
    return
  }

  if (draftTournamentA && draftTournamentB && draftTournamentA === draftTournamentB) {
    alert('Torneo A e Torneo B non possono essere uguali.')
    return
  }

  const changed =
    draftTournamentA !== activeTournamentA ||
    draftTournamentB !== activeTournamentB

  if (!changed) return

  const hadActive = !!activeTournamentA || !!activeTournamentB
  if (hadActive) {
    const ok = window.confirm('Stai cambiando i tornei attivi della regia. Continuare?')
    if (!ok) return
  }

  setActiveTournamentA(draftTournamentA)
  setActiveTournamentB(draftTournamentB)

  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        a: draftTournamentA,
        b: draftTournamentB,
      })
    )
  } catch {}
}
  async function saveAssignment(row: RegiaRow) {
    if (row.status === 'live') {
      alert('Una partita LIVE non può essere spostata.')
      return
    }

    const court = drafts[row.key]?.court ? Number(drafts[row.key].court) : null
    const sequence =
      drafts[row.key]?.sequence && drafts[row.key].sequence !== '0'
        ? Number(drafts[row.key].sequence)
        : null

    const changed = row.court !== court || row.sequence !== sequence || (court == null && row.status !== 'waiting')
    if (!changed) return

    if (row.court != null || row.sequence != null) {
      const ok = window.confirm('Stai modificando un’assegnazione esistente. Continuare?')
      if (!ok) return
    }

    await mutate(row.key, 'save_assignment', { court, sequence })
  }

  const activeRows = useMemo(
    () => rows.filter((r) => r.status !== 'done' && r.status !== 'paused'),
    [rows]
  )

  const pausedRows = useMemo(
    () => rows.filter((r) => r.status === 'paused'),
    [rows]
  )

  const doneRows = useMemo(
    () => rows.filter((r) => r.status === 'done'),
    [rows]
  )

  const visibleActiveRows = useMemo(() => {
    if (viewMode === 'all') return activeRows

    const grouped = new Map<number, RegiaRow[]>()

    activeRows
      .filter((r) => r.court != null)
      .forEach((r) => {
        const court = r.court as number
        const arr = grouped.get(court) ?? []
        arr.push(r)
        grouped.set(court, arr)
      })

    const out: RegiaRow[] = []

    Array.from(grouped.entries())
      .sort((a, b) => a[0] - b[0])
      .forEach(([, list]) => {
        const sorted = [...list].sort((a, b) => (a.sequence ?? 999) - (b.sequence ?? 999))
        const liveIdx = sorted.findIndex((r) => r.status === 'live')

        if (viewMode === 'live') {
          if (liveIdx >= 0) out.push(sorted[liveIdx])
          else if (sorted[0]) out.push(sorted[0])
        }

        if (viewMode === 'live_plus_2') {
          if (liveIdx >= 0) out.push(...sorted.slice(liveIdx, liveIdx + 3))
          else out.push(...sorted.slice(0, 3))
        }
      })

    const unassigned = activeRows.filter((r) => r.court == null)
    return [...out, ...unassigned]
  }, [activeRows, viewMode])

 function courtBadge(court: number | null) {
  if (court === 1) return 'border-blue-500 bg-blue-950/40 text-blue-300'
  if (court === 2) return 'border-red-500 bg-red-950/40 text-red-300'
  if (court === 3) return 'border-green-500 bg-green-950/40 text-green-300'
  if (court === 4) return 'border-violet-500 bg-violet-950/40 text-violet-300'
  if (court === 5) return 'border-yellow-500 bg-yellow-950/40 text-yellow-300'
  if (court === 6) return 'border-pink-500 bg-pink-950/40 text-pink-300'
  if (court === 7) return 'border-cyan-500 bg-cyan-950/40 text-cyan-300'
  if (court === 8) return 'border-orange-500 bg-orange-950/40 text-orange-300'
  if (court === 9) return 'border-lime-500 bg-lime-950/40 text-lime-300'
  if (court === 10) return 'border-fuchsia-500 bg-fuchsia-950/40 text-fuchsia-300'
  return 'border-neutral-700 bg-neutral-950 text-neutral-300'
}

 function rowBg(status: RegiaStatus) {
  if (status === 'live') return 'bg-emerald-950/40'
  if (status === 'paused') return 'bg-amber-950/30'
  if (status === 'done') return 'bg-neutral-950 text-neutral-500'
  return 'bg-neutral-900'
}
  function renderCourt(row: RegiaRow) {
    if (row.court == null) {
      return (
       <span className="inline-flex rounded-full border border-neutral-700 bg-neutral-950 px-3 py-1 text-xs font-semibold text-neutral-300">
          NON ASSEGNATA
        </span>
      )
    }
    return (
      <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${courtBadge(row.court)}`}>
        CAMPO {row.court}
      </span>
    )
  }

  function renderState(row: RegiaRow) {
    if (row.status === 'live') {
      return <span className="font-semibold text-emerald-300">LIVE</span>
    }
    if (row.status === 'paused') {
     return <span className="font-semibold text-amber-300">SOSPESA</span>
    }
   return <span className="text-neutral-300">{row.scheduledTime || '-'}</span>
  }



  return (
    <div className="min-h-screen bg-neutral-950 p-4 md:p-6 text-white">
      <div className="mb-5 rounded-2xl border border-neutral-800 bg-neutral-900 p-4 shadow-sm">
       <div className="mb-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
  <div>
    <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">Torneo A</div>
    <select
      value={draftTournamentA}
      onChange={(e) => setDraftTournamentA(e.target.value)}
      className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white"
    >
      <option value="">Seleziona torneo</option>
      {availableTournaments.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}{t.date ? ` — ${new Date(t.date).toLocaleDateString()}` : ''}
        </option>
      ))}
    </select>
  </div>

  <div>
    <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">Torneo B</div>
    <select
      value={draftTournamentB}
      onChange={(e) => setDraftTournamentB(e.target.value)}
      className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white"
    >
      <option value="">Nessuno</option>
      {availableTournaments
        .filter((t) => t.id !== draftTournamentA)
        .map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}{t.date ? ` — ${new Date(t.date).toLocaleDateString()}` : ''}
          </option>
        ))}
    </select>
  </div>

  <div className="flex items-end">
    <button
      type="button"
      onClick={applyTournamentSelection}
      className="rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-2 text-sm font-medium text-white"
    >
      Applica selezione
    </button>
  </div>
</div>

{!activeTournamentA ? (
  <div className="mb-4 rounded-xl border border-neutral-800 bg-neutral-950 p-4 text-sm text-neutral-300">
    Seleziona almeno il <b>Torneo A</b> e premi <b>Applica selezione</b>.
  </div>
) : null}

<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
           <h1 className="text-2xl font-bold tracking-tight text-white">Regia Campi</h1>
<p className="text-sm text-neutral-400">
  Attivi:
  <span className="ml-2 font-mono">
    {activeTournamentA ? (tournamentNameById[activeTournamentA] || activeTournamentA) : '—'}
  </span>
  {activeTournamentB ? (
    <span className="ml-2 font-mono">
      + {tournamentNameById[activeTournamentB] || activeTournamentB}
    </span>
  ) : null}
</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setViewMode('live')}
             className={`rounded-xl px-3 py-2 text-sm font-medium ${
  viewMode === 'live'
    ? 'bg-white text-black'
    : 'border border-neutral-700 bg-neutral-900 text-neutral-300'
}`}
            >
              LIVE
            </button>
            <button
              type="button"
              onClick={() => setViewMode('live_plus_2')}
              className={`rounded-xl px-3 py-2 text-sm font-medium ${
  viewMode === 'live_plus_2'
    ? 'bg-white text-black'
    : 'border border-neutral-700 bg-neutral-900 text-neutral-300'
}`}
            >
              LIVE + 2
            </button>
            <button
              type="button"
              onClick={() => setViewMode('all')}
            className={`rounded-xl px-3 py-2 text-sm font-medium ${
  viewMode === 'all'
    ? 'bg-white text-black'
    : 'border border-neutral-700 bg-neutral-900 text-neutral-300'
}`}
            >
              TUTTE
            </button>
            <button
              type="button"
              onClick={() => void loadData()}
             className="rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-200"
            >
              Ricarica
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
         <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
           <div className="text-xs uppercase tracking-wide text-neutral-500">Attive</div>
           <div className="mt-1 text-2xl font-bold text-white">{activeRows.length}</div>
          </div>
         <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
           <div className="text-xs uppercase tracking-wide text-neutral-500">Non assegnate</div>
            <div className="mt-1 text-2xl font-bold text-white">
              {activeRows.filter((r) => r.court == null).length}
            </div>
          </div>
         <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
           <div className="text-xs uppercase tracking-wide text-neutral-500">Sospese</div>
           <div className="mt-1 text-2xl font-bold text-white">{pausedRows.length}</div>
          </div>
         <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
           <div className="text-xs uppercase tracking-wide text-neutral-500">Concluse</div>
           <div className="mt-1 text-2xl font-bold text-white">{doneRows.length}</div>
          </div>
        </div>
      </div>

     <div className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-[1180px] w-full text-sm">
            <thead className="bg-neutral-950 text-left">
            <tr className="border-b border-neutral-800">
  <th className="px-4 py-3 font-semibold text-neutral-300">Torneo</th>
  <th className="px-4 py-3 font-semibold text-neutral-300">Campo</th>
  <th className="px-4 py-3 font-semibold text-neutral-300">Seq</th>
  <th className="px-4 py-3 font-semibold text-neutral-300">Ora / Stato</th>
  <th className="px-4 py-3 font-semibold text-neutral-300">Fase</th>
  <th className="px-4 py-3 font-semibold text-neutral-300">Squadre</th>
  <th className="px-4 py-3 font-semibold text-neutral-300">Assegnazione</th>
  <th className="px-4 py-3 font-semibold text-neutral-300">Azioni</th>
</tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                 <td colSpan={8} className="px-4 py-8 text-center text-neutral-500">
                    Caricamento...
                  </td>
                </tr>
              ) : visibleActiveRows.length === 0 ? (
                <tr>
                 <td colSpan={8} className="px-4 py-8 text-center text-neutral-500">
                    Nessuna partita trovata.
                  </td>
                </tr>
              ) : (
                visibleActiveRows.map((row) => {
                  const busy = savingKey === row.key
                  return (
                  <tr key={row.key} className={`border-b border-neutral-800 ${rowBg(row.status)}`}>
  <td className="px-4 py-3 align-top">
    <span className="inline-flex rounded-full border border-neutral-700 bg-neutral-950 px-3 py-1 text-xs font-semibold text-neutral-300">
  {tournamentNameById[row.tournament_id] || row.tournament_id}
</span>
  </td>
  <td className="px-4 py-3 align-top">{renderCourt(row)}</td>
                    <td className="px-4 py-3 align-top font-semibold text-white">
                        {row.status === 'paused' ? '0' : row.sequence ?? '-'}
                      </td>
                      <td className="px-4 py-3 align-top">{renderState(row)}</td>
                      <td className="px-4 py-3 align-top">
                       <span className="rounded-lg bg-neutral-800 px-2 py-1 text-xs font-medium text-neutral-200">
                          {row.phase}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="font-medium text-white">
                          {row.teamA} <span className="text-neutral-500">vs</span> {row.teamB}
                        </div>
                        <div className="mt-1 text-xs text-neutral-500">
                          {row.sourceType === 'girone' ? 'Gironi' : 'Tabellone'} · {row.key}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        {row.status === 'live' ? (
                          <div className="text-sm text-neutral-500">
                            Campo e sequenza bloccati perché la partita è LIVE
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              value={drafts[row.key]?.court ?? ''}
                              onChange={(e) => {
                                const nextCourt = e.target.value
                                setDraft(row.key, {
                                  court: nextCourt,
                                  sequence: nextCourt ? String((row.sequence ?? 0) || 1) : '',
                                })
                              }}
                              disabled={busy}
                              className="rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-white"
                            >
                              <option value="">-</option>
                              {COURTS.map((court) => (
                                <option key={court} value={court}>
                                  Campo {court}
                                </option>
                              ))}
                            </select>

                            <select
                              value={drafts[row.key]?.sequence ?? ''}
                              onChange={(e) => setDraft(row.key, { sequence: e.target.value })}
                              disabled={busy || !(drafts[row.key]?.court ?? '')}
                              className="rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-white"
                            >
                              <option value="">Seq</option>
                              {SEQ_OPTIONS.map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                            </select>

                            <button
                              type="button"
                              onClick={() => void saveAssignment(row)}
                              disabled={busy}
                             className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              OK
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex flex-wrap items-center gap-2">
                          {row.status !== 'live' ? (
                            <button
                              type="button"
                              onClick={() => void mutate(row.key, 'set_live')}
                              disabled={busy || row.court == null}
                              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              LIVE
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                const ok = window.confirm('Togliere la partita da LIVE e metterla in sospesa?')
                                if (ok) void mutate(row.key, 'stop_live')
                              }}
                              disabled={busy}
                              className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              STOP LIVE
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              const ok = window.confirm('Segnare la partita come chiusa?')
                              if (ok) void mutate(row.key, 'close_match')
                            }}
                            disabled={busy || row.status === 'waiting'}
                           className="rounded-lg bg-neutral-800 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            CHIUDI
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pausedRows.length > 0 && (
       <div className="mt-6 overflow-hidden rounded-2xl border border-amber-800 bg-neutral-900 shadow-sm">
         <div className="border-b border-amber-800 bg-amber-950/40 px-4 py-3">
          <h2 className="font-semibold text-amber-300">Partite sospese</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[1100px] w-full text-sm">
             <thead className="bg-neutral-950 text-left">
<tr className="border-b border-neutral-800">
  <th className="px-4 py-3 text-neutral-300">Torneo</th>
                  <th className="px-4 py-3 text-neutral-300">Campo</th>
                  <th className="px-4 py-3 text-neutral-300">Seq</th>
                  <th className="px-4 py-3 text-neutral-300">Stato</th>
                  <th className="px-4 py-3 text-neutral-300">Fase</th>
                  <th className="px-4 py-3 text-neutral-300">Squadre</th>
                  <th className="px-4 py-3 text-neutral-300">Riassegna</th>
                </tr>
              </thead>
              <tbody>
                {pausedRows.map((row) => {
                  const busy = savingKey === row.key
                  return (
                  <tr key={row.key} className="border-b border-neutral-800 bg-amber-950/20">
                    <td className="px-4 py-3">
   <span className="inline-flex rounded-full border border-neutral-700 bg-neutral-950 px-3 py-1 text-xs font-semibold text-neutral-300">
  {tournamentNameById[row.tournament_id] || row.tournament_id}
</span>
  </td>
                      <td className="px-4 py-3">{renderCourt(row)}</td>
                      <td className="px-4 py-3">0</td>
                     <td className="px-4 py-3 font-semibold text-amber-300">SOSPESA</td>
                      <td className="px-4 py-3">{row.phase}</td>
                      <td className="px-4 py-3">
                        {row.teamA} <span className="text-neutral-500">vs</span> {row.teamB}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={drafts[row.key]?.court ?? ''}
                            onChange={(e) => setDraft(row.key, { court: e.target.value })}
                            disabled={busy}
                           className="rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-white"
                          >
                            <option value="">-</option>
                            {COURTS.map((court) => (
                              <option key={court} value={court}>
                                Campo {court}
                              </option>
                            ))}
                          </select>

                          <select
                            value={drafts[row.key]?.sequence === '0' ? '' : drafts[row.key]?.sequence ?? ''}
                            onChange={(e) => setDraft(row.key, { sequence: e.target.value })}
                            disabled={busy || !(drafts[row.key]?.court ?? '')}
                           className="rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-white"
                          >
                            <option value="">Seq</option>
                            {SEQ_OPTIONS.map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>

                          <button
                            type="button"
                            onClick={() => void saveAssignment(row)}
                            disabled={busy}
                           className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            OK
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {doneRows.length > 0 && (
       <div className="mt-6 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 shadow-sm">
          <div className="border-b border-neutral-800 bg-neutral-950 px-4 py-3">
           <h2 className="font-semibold text-white">Partite concluse</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[1000px] w-full text-sm">
             <thead className="bg-neutral-950 text-left">
  <tr className="border-b border-neutral-800">
    <th className="px-4 py-3 text-neutral-300">Torneo</th>
    <th className="px-4 py-3 text-neutral-300">Campo</th>
    <th className="px-4 py-3 text-neutral-300">Seq</th>
    <th className="px-4 py-3 text-neutral-300">Ora</th>
    <th className="px-4 py-3 text-neutral-300">Fase</th>
    <th className="px-4 py-3 text-neutral-300">Squadre</th>
  </tr>
</thead>
              <tbody>
  {doneRows.map((row) => (
    <tr key={row.key} className="border-b border-neutral-800 bg-neutral-950 text-neutral-500">
      <td className="px-4 py-3">
        <span className="inline-flex rounded-full border border-neutral-700 bg-neutral-950 px-3 py-1 text-xs font-semibold text-neutral-300">
          {tournamentNameById[row.tournament_id] || row.tournament_id}
        </span>
      </td>
      <td className="px-4 py-3">{renderCourt(row)}</td>
      <td className="px-4 py-3">{row.sequence ?? '-'}</td>
      <td className="px-4 py-3">{row.scheduledTime || '-'}</td>
      <td className="px-4 py-3">{row.phase}</td>
      <td className="px-4 py-3">
        {row.teamA} <span className="text-neutral-500">vs</span> {row.teamB}
      </td>
    </tr>
  ))}
</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
