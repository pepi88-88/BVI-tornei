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

const COURTS = [1, 2, 3, 4]
const SEQ_OPTIONS = Array.from({ length: 20 }, (_, i) => i + 1)

export default function RegiaPage() {
  const params = useParams()
  const searchParams = useSearchParams()

  const routeTour = String(params?.tour ?? '')
  const tournamentId = searchParams.get('tournament_id') || routeTour

  const [rows, setRows] = useState<RegiaRow[]>([])
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('all')
  const [drafts, setDrafts] = useState<Record<string, { court: string; sequence: string }>>({})

  async function loadData() {
    if (!tournamentId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/regia/state?tournament_id=${encodeURIComponent(tournamentId)}`, {
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
    void loadData()
  }, [tournamentId])

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

  async function mutate(
    key: string,
    action: 'save_assignment' | 'set_live' | 'stop_live' | 'close_match',
    extra?: { court?: number | null; sequence?: number | null }
  ) {
    if (!tournamentId) return
    setSavingKey(key)

    try {
      const res = await fetch('/api/regia/state', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-role': 'admin',
        },
        body: JSON.stringify({
          tournament_id: tournamentId,
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
      setSavingKey(null)
    }
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
    if (court === 1) return 'border-blue-400 bg-blue-50 text-blue-700'
    if (court === 2) return 'border-red-400 bg-red-50 text-red-700'
    if (court === 3) return 'border-green-400 bg-green-50 text-green-700'
    if (court === 4) return 'border-violet-400 bg-violet-50 text-violet-700'
    return 'border-slate-300 bg-slate-50 text-slate-700'
  }

  function rowBg(status: RegiaStatus) {
    if (status === 'live') return 'bg-emerald-50'
    if (status === 'paused') return 'bg-amber-50'
    if (status === 'done') return 'bg-slate-100 text-slate-500'
    return 'bg-white'
  }

  function renderCourt(row: RegiaRow) {
    if (row.court == null) {
      return (
        <span className="inline-flex rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
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
      return <span className="font-semibold text-emerald-700">LIVE</span>
    }
    if (row.status === 'paused') {
      return <span className="font-semibold text-amber-700">SOSPESA</span>
    }
    return <span>{row.scheduledTime || '-'}</span>
  }

  if (!tournamentId) {
    return (
      <div className="p-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-bold text-slate-900">Regia Campi</h1>
          <p className="mt-2 text-sm text-slate-600">
            Apri la pagina con un tournament id valido.
          </p>
          <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
            Esempio:
            <div className="mt-2 font-mono text-xs">
              /admin/tornei/[tour]/regia?tournament_id=ID_TAPPA
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Regia Campi</h1>
            <p className="text-sm text-slate-600">
              Tournament ID: <span className="font-mono">{tournamentId}</span>
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setViewMode('live')}
              className={`rounded-xl px-3 py-2 text-sm font-medium ${
                viewMode === 'live' ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700'
              }`}
            >
              LIVE
            </button>
            <button
              type="button"
              onClick={() => setViewMode('live_plus_2')}
              className={`rounded-xl px-3 py-2 text-sm font-medium ${
                viewMode === 'live_plus_2' ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700'
              }`}
            >
              LIVE + 2
            </button>
            <button
              type="button"
              onClick={() => setViewMode('all')}
              className={`rounded-xl px-3 py-2 text-sm font-medium ${
                viewMode === 'all' ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700'
              }`}
            >
              TUTTE
            </button>
            <button
              type="button"
              onClick={() => void loadData()}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700"
            >
              Ricarica
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Attive</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{activeRows.length}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Non assegnate</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">
              {activeRows.filter((r) => r.court == null).length}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Sospese</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{pausedRows.length}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Concluse</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{doneRows.length}</div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-[1180px] w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr className="border-b border-slate-200">
                <th className="px-4 py-3 font-semibold text-slate-700">Campo</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Seq</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Ora / Stato</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Fase</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Squadre</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Assegnazione</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Azioni</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    Caricamento...
                  </td>
                </tr>
              ) : visibleActiveRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    Nessuna partita trovata.
                  </td>
                </tr>
              ) : (
                visibleActiveRows.map((row) => {
                  const busy = savingKey === row.key
                  return (
                    <tr key={row.key} className={`border-b border-slate-100 ${rowBg(row.status)}`}>
                      <td className="px-4 py-3 align-top">{renderCourt(row)}</td>
                      <td className="px-4 py-3 align-top font-semibold text-slate-900">
                        {row.status === 'paused' ? '0' : row.sequence ?? '-'}
                      </td>
                      <td className="px-4 py-3 align-top">{renderState(row)}</td>
                      <td className="px-4 py-3 align-top">
                        <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                          {row.phase}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="font-medium text-slate-900">
                          {row.teamA} <span className="text-slate-500">vs</span> {row.teamB}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {row.sourceType === 'girone' ? 'Gironi' : 'Tabellone'} · {row.key}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        {row.status === 'live' ? (
                          <div className="text-sm text-slate-500">
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
                              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
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
                              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
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
                              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
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
                            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
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
        <div className="mt-6 overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm">
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-3">
            <h2 className="font-semibold text-amber-900">Partite sospese</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[1100px] w-full text-sm">
              <thead className="bg-slate-50 text-left">
                <tr className="border-b border-slate-200">
                  <th className="px-4 py-3">Campo</th>
                  <th className="px-4 py-3">Seq</th>
                  <th className="px-4 py-3">Stato</th>
                  <th className="px-4 py-3">Fase</th>
                  <th className="px-4 py-3">Squadre</th>
                  <th className="px-4 py-3">Riassegna</th>
                </tr>
              </thead>
              <tbody>
                {pausedRows.map((row) => {
                  const busy = savingKey === row.key
                  return (
                    <tr key={row.key} className="border-b border-slate-100 bg-amber-50/40">
                      <td className="px-4 py-3">{renderCourt(row)}</td>
                      <td className="px-4 py-3">0</td>
                      <td className="px-4 py-3 font-semibold text-amber-700">SOSPESA</td>
                      <td className="px-4 py-3">{row.phase}</td>
                      <td className="px-4 py-3">
                        {row.teamA} <span className="text-slate-500">vs</span> {row.teamB}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={drafts[row.key]?.court ?? ''}
                            onChange={(e) => setDraft(row.key, { court: e.target.value })}
                            disabled={busy}
                            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
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
                            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
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
                            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800"
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
        <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
            <h2 className="font-semibold text-slate-800">Partite concluse</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[1000px] w-full text-sm">
              <thead className="bg-slate-50 text-left">
                <tr className="border-b border-slate-200">
                  <th className="px-4 py-3">Campo</th>
                  <th className="px-4 py-3">Seq</th>
                  <th className="px-4 py-3">Ora</th>
                  <th className="px-4 py-3">Fase</th>
                  <th className="px-4 py-3">Squadre</th>
                </tr>
              </thead>
              <tbody>
                {doneRows.map((row) => (
                  <tr key={row.key} className="border-b border-slate-100 bg-slate-50 text-slate-500">
                    <td className="px-4 py-3">{renderCourt(row)}</td>
                    <td className="px-4 py-3">{row.sequence ?? '-'}</td>
                    <td className="px-4 py-3">{row.scheduledTime || '-'}</td>
                    <td className="px-4 py-3">{row.phase}</td>
                    <td className="px-4 py-3">
                      {row.teamA} <span className="text-slate-500">vs</span> {row.teamB}
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