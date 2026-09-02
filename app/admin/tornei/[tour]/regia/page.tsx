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
type OrderMode = 'regia' | 'phase'
type TournamentOption = {
  id: string
  name: string
  date?: string
}
function rowUiKey(row: RegiaRow) {
  return `${row.tournament_id}::${row.key}`
}
const COURTS = Array.from({ length: 10 }, (_, i) => i + 1)
const SEQ_OPTIONS = Array.from({ length: 20 }, (_, i) => i + 1)
function getBracketStageRank(phase: string) {
  const p = String(phase || '').toLowerCase()

  if (p.includes('girone')) return 10

  if (p.includes('sedices')) return 20
  if (p.includes('ottav')) return 30
  if (p.includes('quarto')) return 40
  if (p.includes('semif')) return 50
  if (p.includes('3°') || p.includes('3 / 4') || p.includes('3° / 4°') || p.includes('finalina')) return 60
  if (p.includes('finale')) return 70

  const turnoMatch = p.match(/turno\s+(\d+)/i)
  if (turnoMatch) {
    const n = Number(turnoMatch[1])
    return 20 + n
  }

  if (p.includes('upper')) return 45
  if (p.includes('losers')) return 46

  return 999
}

function getGroupLetterRank(phase: string) {
  const m = String(phase || '').match(/girone\s+([A-Za-z]+)/i)
  if (!m) return 999
  return m[1].toUpperCase().charCodeAt(0)
}

function getPhaseOrderValue(row: RegiaRow) {
  return getBracketStageRank(row.phase)
}

function sortRowsByPhase(rows: RegiaRow[]) {
  return [...rows].sort((a, b) => {
    const ta = a.tournament_id.localeCompare(b.tournament_id)
    if (ta !== 0) return ta

    const pa = getPhaseOrderValue(a)
    const pb = getPhaseOrderValue(b)
    if (pa !== pb) return pa - pb

    const ga = getGroupLetterRank(a.phase)
    const gb = getGroupLetterRank(b.phase)
    if (ga !== gb) return ga - gb

    const ac = a.court == null ? 999 : a.court
    const bc = b.court == null ? 999 : b.court
    if (ac !== bc) return ac - bc

    const as = a.sequence == null ? 999 : a.sequence
    const bs = b.sequence == null ? 999 : b.sequence
    if (as !== bs) return as - bs

    return a.key.localeCompare(b.key)
  })
}
export default function RegiaPage() {
  const params = useParams()
  const searchParams = useSearchParams()

 const routeTour = String(params?.tour ?? '')
const initialTournamentId = searchParams.get('tournament_id') || routeTour

  const [rows, setRows] = useState<RegiaRow[]>([])
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('all')
  const [drafts, setDrafts] = useState<
  Record<string, { court: string; sequence: string; scheduledTime: string }>
>({})
const [dirtyKeys, setDirtyKeys] = useState<Record<string, true>>({})
const [availableTournaments, setAvailableTournaments] = useState<TournamentOption[]>([])
const [orderMode, setOrderMode] = useState<OrderMode>('regia')
const [draftTournamentA, setDraftTournamentA] = useState<string>('')
const [draftTournamentB, setDraftTournamentB] = useState<string>('')

const [activeTournamentA, setActiveTournamentA] = useState<string>('')
const [activeTournamentB, setActiveTournamentB] = useState<string>('')
  const dirtyCount = useMemo(() => Object.keys(dirtyKeys).length, [dirtyKeys])
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

   const nextDrafts: Record<string, { court: string; sequence: string; scheduledTime: string }> = {}
items.forEach((r) => {
  const id = rowUiKey(r)

  nextDrafts[id] = {
    court: r.court == null ? '' : String(r.court),
    sequence:
      r.status === 'paused'
        ? '0'
        : r.sequence == null
        ? ''
        : String(r.sequence),
    scheduledTime: r.scheduledTime || '',
  }
})
setDrafts(nextDrafts)
setDirtyKeys({})
  } finally {
    setLoading(false)
  }
}

  useEffect(() => {
  if (!activeTournamentA) return
  void loadData()
}, [activeTournamentA, activeTournamentB])

 function setDraft(
  row: RegiaRow,
  patch: Partial<{ court: string; sequence: string; scheduledTime: string }>
) {
  const id = rowUiKey(row)

  setDrafts((prev) => ({
    ...prev,
    [id]: {
      court: prev[id]?.court ?? '',
      sequence: prev[id]?.sequence ?? '',
      scheduledTime: prev[id]?.scheduledTime ?? '',
      ...patch,
    },
  }))

  setDirtyKeys((prev) => ({
    ...prev,
    [id]: true,
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
  
async function mutate(
  row: RegiaRow | null,
  action:
    | 'save_assignment'
    | 'save_assignment_batch'
    | 'set_live'
    | 'stop_live'
    | 'close_match'
    | 'reopen_match'
    | 'reset_tournament_regia',
  extra?: {
    court?: number | null
    sequence?: number | null
    scheduledTime?: string
    tournament_id?: string
    changes?: Array<{
      key: string
      court?: number | null
      sequence?: number | null
      scheduledTime?: string
    }>
  }
) {
  const targetTournamentId = extra?.tournament_id || row?.tournament_id || ''
  if (!targetTournamentId) return

  const rowKey = row?.key ?? null
  const busyId = row ? rowUiKey(row) : '__bulk__'

  setSavingKey(busyId)

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
        key: rowKey || undefined,
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
  async function resetSelectedTournaments() {
  if (!activeTournamentA && !activeTournamentB) {
    alert('Nessun torneo attivo da pulire.')
    return
  }

  const names = [
    activeTournamentA ? (tournamentNameById[activeTournamentA] || activeTournamentA) : null,
    activeTournamentB ? (tournamentNameById[activeTournamentB] || activeTournamentB) : null,
  ].filter(Boolean)

  const firstOk = window.confirm(
    `Stai per azzerare completamente campo, sequenza e stato della regia per: ${names.join(' + ')}. Continuare?`
  )
  if (!firstOk) return

  const secondOk = window.confirm(
    `Conferma definitiva: vuoi davvero pulire la regia del/dei torneo/i selezionato/i?`
  )
  if (!secondOk) return

  if (activeTournamentA) {
    await mutate(null, 'reset_tournament_regia', { tournament_id: activeTournamentA })
  }

  if (activeTournamentB) {
    await mutate(null, 'reset_tournament_regia', { tournament_id: activeTournamentB })
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

  async function saveAllAssignments() {
  const dirtyRows = rows.filter((row) => dirtyKeys[rowUiKey(row)])
  if (!dirtyRows.length) {
    alert('Nessuna modifica da salvare.')
    return
  }

  const byTournament: Record<
    string,
    Array<{ key: string; court?: number | null; sequence?: number | null; scheduledTime?: string }>
  > = {}

  for (const row of dirtyRows) {
    if (row.status === 'live') continue

    const id = rowUiKey(row)
    const draft = drafts[id]
    if (!draft) continue

    const court = draft.court ? Number(draft.court) : null
    const sequence =
      draft.sequence && draft.sequence !== '0'
        ? Number(draft.sequence)
        : null
    const scheduledTime = draft.scheduledTime ?? ''

    const changed =
      row.court !== court ||
      row.sequence !== sequence ||
      row.scheduledTime !== scheduledTime ||
      (court == null && row.status !== 'waiting')

    if (!changed) continue

    if (!byTournament[row.tournament_id]) {
      byTournament[row.tournament_id] = []
    }

    byTournament[row.tournament_id].push({
      key: row.key,
      court,
      sequence,
      scheduledTime,
    })
  }

  const tournamentIds = Object.keys(byTournament)
  if (!tournamentIds.length) {
    alert('Nessuna modifica valida da salvare.')
    return
  }

  setSavingKey('__bulk__')
  try {
    for (const tournamentId of tournamentIds) {
      const changes = byTournament[tournamentId]
      const res = await fetch('/api/regia/state', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-role': 'admin',
        },
        body: JSON.stringify({
          tournament_id: tournamentId,
          action: 'save_assignment_batch',
          changes,
        }),
      })

      const json = await res.json()
      if (!res.ok) {
        alert(json?.error || 'Errore salvataggio batch')
        return
      }
    }

    await loadData()
  } finally {
    setSavingKey(null)
  }
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
  if (orderMode === 'phase') {
    return sortRowsByPhase(activeRows)
  }

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
}, [activeRows, viewMode, orderMode])

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
function tournamentBadge(tournamentId: string) {
  if (tournamentId === activeTournamentA) {
    return 'border-sky-500 bg-sky-950/40 text-sky-300'
  }
  if (tournamentId === activeTournamentB) {
    return 'border-fuchsia-500 bg-fuchsia-950/40 text-fuchsia-300'
  }
  return 'border-neutral-700 bg-neutral-950 text-neutral-300'
}
function rowBg(status: RegiaStatus, tournamentId?: string) {
  if (status === 'live') return 'bg-emerald-950/40'
  if (status === 'paused') return 'bg-amber-950/30'
  if (status === 'done') return 'bg-neutral-950 text-neutral-500'

  if (tournamentId === activeTournamentA) return 'bg-sky-950/10'
  if (tournamentId === activeTournamentB) return 'bg-fuchsia-950/10'

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
      <div className="mb-4 grid gap-3 md:grid-cols-2">
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
  onClick={() => setOrderMode('regia')}
  className={`rounded-xl px-3 py-2 text-sm font-medium ${
    orderMode === 'regia'
      ? 'bg-white text-black'
      : 'border border-neutral-700 bg-neutral-900 text-neutral-300'
  }`}
>
  Ordine regia
</button>

<button
  type="button"
  onClick={() => setOrderMode('phase')}
  className={`rounded-xl px-3 py-2 text-sm font-medium ${
    orderMode === 'phase'
      ? 'bg-white text-black'
      : 'border border-neutral-700 bg-neutral-900 text-neutral-300'
  }`}
>
  Ordina per fase
</button>
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
  onClick={() => void saveAllAssignments()}
  disabled={savingKey === '__bulk__' || dirtyCount === 0}
  className="rounded-xl border border-emerald-700 bg-emerald-950/40 px-3 py-2 text-sm font-medium text-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
>
  Salva modifiche {dirtyCount > 0 ? `(${dirtyCount})` : ''}
</button>
<button
type="button"
onClick={() => void loadData()}
className="rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-200"
>
Ricarica
</button>

<button
type="button"
onClick={applyTournamentSelection}
disabled={savingKey === '__bulk__'}
className="rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
>
Applica selezione
</button>

<button
type="button"
onClick={() => void resetSelectedTournaments()}
disabled={savingKey === '__bulk__' || (!activeTournamentA && !activeTournamentB)}
className="rounded-xl border border-red-800 bg-red-950/40 px-3 py-2 text-sm font-medium text-red-200 disabled:cursor-not-allowed disabled:opacity-50"
>
Pulisci regia
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
                  const busy = savingKey === '__bulk__' || savingKey === rowUiKey(row)
                  return (
                 <tr key={rowUiKey(row)} className={`border-b border-neutral-800 ${rowBg(row.status, row.tournament_id)}`}>
  <td className="px-4 py-3 align-top">
   <span
  className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${tournamentBadge(row.tournament_id)}`}
>
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
      Campo, sequenza e orario bloccati perché la partita è LIVE
    </div>
  ) : (
    <div className="flex flex-wrap items-center gap-2">
      {row.sourceType === 'bracket' ? (
        <input
          type="time"
          value={drafts[rowUiKey(row)]?.scheduledTime ?? ''}
          onChange={(e) => setDraft(row, { scheduledTime: e.target.value })}
          disabled={busy}
          className="rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-white"
        />
      ) : null}

      <select
        value={drafts[rowUiKey(row)]?.court ?? ''}
        onChange={(e) => {
          const nextCourt = e.target.value
          const id = rowUiKey(row)

          setDraft(row, {
            court: nextCourt,
            sequence: nextCourt ? (drafts[id]?.sequence ?? '') : '',
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
        value={drafts[rowUiKey(row)]?.sequence ?? ''}
        onChange={(e) => setDraft(row, { sequence: e.target.value })}
        disabled={busy || !(drafts[rowUiKey(row)]?.court ?? '')}
        className="rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-white"
      >
        <option value="">Seq</option>
        {SEQ_OPTIONS.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </div>
  )}
</td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex flex-wrap items-center gap-2">
                       
                          {row.status !== 'live' ? (
                            <button
                              type="button"
                              onClick={() => void mutate(row, 'set_live')}
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
                                if (ok) void mutate(row, 'stop_live')
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
                              if (ok) void mutate(row, 'close_match')
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
                  const busy = savingKey === '__bulk__' || savingKey === rowUiKey(row)
                  return (
                  <tr key={rowUiKey(row)} className="border-b border-neutral-800 bg-amber-950/20">
                    <td className="px-4 py-3">
  <span
  className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${tournamentBadge(row.tournament_id)}`}
>
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
                          {row.sourceType === 'bracket' ? (
  <input
    type="time"
    value={drafts[rowUiKey(row)]?.scheduledTime ?? ''}
    onChange={(e) => setDraft(row, { scheduledTime: e.target.value })}
    disabled={busy}
    className="rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-white"
  />
) : null}
                          <select
                            value={drafts[rowUiKey(row)]?.court ?? ''}
                            onChange={(e) => setDraft(row, { court: e.target.value })}
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
                            value={drafts[rowUiKey(row)]?.sequence === '0' ? '' : drafts[rowUiKey(row)]?.sequence ?? ''}
                            onChange={(e) => setDraft(row, { sequence: e.target.value })}
                            disabled={busy || !(drafts[rowUiKey(row)]?.court ?? '')}
                           className="rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-white"
                          >
                            <option value="">Seq</option>
                            {SEQ_OPTIONS.map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>

                         
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
    <th className="px-4 py-3 text-neutral-300">Azioni</th>
  </tr>
</thead>
              <tbody>
  {doneRows.map((row) => {
    const busy = savingKey === '__bulk__' || savingKey === rowUiKey(row)

    return (
      <tr key={rowUiKey(row)} className="border-b border-neutral-800 bg-neutral-950 text-neutral-500">
        <td className="px-4 py-3">
          <span
            className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${tournamentBadge(row.tournament_id)}`}
          >
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
        <td className="px-4 py-3">
          <button
            type="button"
            onClick={() => {
              const ok = window.confirm('Riaprire questa partita chiusa?')
              if (ok) void mutate(row, 'reopen_match')
            }}
            disabled={busy}
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            RIAPRI
          </button>
        </td>
      </tr>
    )
  })}
</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
