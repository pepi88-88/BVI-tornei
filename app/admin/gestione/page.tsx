'use client'
import useSWR from 'swr'
import { useEffect, useMemo, useState } from 'react'

const fetcher = (u: string) => fetch(u).then(r => r.json())

export default function Page() {
  // ====== Selettori Tour / Tappa ============================================
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

  const { data: taps } = useSWR(tourId ? `/api/tournaments?tour_id=${tourId}` : null, fetcher)
  const [tId, setTId] = useState('')

  useEffect(() => {
    const s = localStorage.getItem('selectedTournamentId')
    if (s) setTId(s)
  }, [])
  useEffect(() => {
    if (taps?.items?.length && !tId) setTId(taps.items[0].id)
  }, [taps, tId])

  function onPickTappa(id: string) {
    setTId(id)
    localStorage.setItem('selectedTournamentId', id)
  }

  const tappa = useMemo(
    () => taps?.items?.find((x: any) => x.id === tId) ?? null,
    [taps, tId]
  )

  async function patchTournament(update: Record<string, any>) {
    if (!tId) return
    const res = await fetch('/api/tournaments', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: tId, ...update }),
    })
    if (!res.ok) {
      const js = await res.json().catch(() => ({}))
      alert(js?.error || 'Aggiornamento non riuscito')
    } else {
      // ricarica elenco tappe
      try {
        const r = await fetch(`/api/tournaments?tour_id=${tourId}`)
        const js = await r.json()
        ;(taps as any).items = js.items
      } catch {}
      setTId(prev => (prev ? prev + '' : ''))
    }
  }

  function onClose() {
    if (!confirm('Chiudere definitivamente la tappa?')) return
    patchTournament({ status: 'closed', closed_at: new Date().toISOString() })
  }
  function onReopen() {
    if (!confirm('Riaprire la tappa?')) return
    patchTournament({ status: 'open', closed_at: null })
  }
  function onArchive() {
    if (!confirm('Archiviare la tappa?')) return
    patchTournament({ archived: true })
  }
  function onUnarchive() {
    patchTournament({ archived: false })
  }

  // ====== DEMO RAPIDO (wipe + seed) =========================================
  const [key, setKey] = useState('')            // ADMIN_DELETE_KEY
  const [pairs, setPairs] = useState(16)        // numero coppie demo
  const [wipePlayers, setWipePlayers] = useState(true) // elimina anche Giocatori

  async function doWipe() {
    if (!key) return alert('Inserisci ADMIN_DELETE_KEY')
    if (!confirm('CANCELLERÀ tours/tappe/iscrizioni/gironi/partite/teams e (opzionale) giocatori. Procedere?')) return

    const res = await fetch('/api/debug/wipe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, wipe_players: wipePlayers }),
    })
    const js = await res.json().catch(() => ({}))
    if (!res.ok) return alert(js?.error || 'Wipe fallito')
    alert('Wipe completato')
  }

  async function doSeed() {
    const res = await fetch('/api/debug/seed-example', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairs }),
    })
    const js = await res.json().catch(() => ({}))
    if (!res.ok) return alert(js?.error || 'Seed fallito')
    alert('Demo creata. Seleziona il nuovo tour/tappa dai menu in alto.')
  }

  // ====== RENDER =============================================================
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold">Gestione Torneo</h1>

      {/* Selettori */}
      <div className="card p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <div className="text-sm text-neutral-400 mb-1">Tour</div>
          <select className="input" value={tourId} onChange={e => onPickTour(e.target.value)}>
            {tours?.items?.map((tr: any) => (
              <option key={tr.id} value={tr.id}>
                {tr.name}
                {tr.season_start && tr.season_end ? ` (${tr.season_start}/${tr.season_end})` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="text-sm text-neutral-400 mb-1">Tappa</div>
          <select className="input" value={tId} onChange={e => onPickTappa(e.target.value)}>
            {taps?.items?.map((t: any) => (
              <option key={t.id} value={t.id}>
                {t.event_date ? `${t.event_date} — ` : ''}
                {t.name}
                {t.archived ? ' (archiviata)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          {tappa ? (
            <div className="text-sm text-neutral-400">
              Stato: <b>{tappa.status ?? 'open'}</b>
              {tappa.closed_at && <> · chiusa il {new Date(tappa.closed_at).toLocaleString()}</>}
              {tappa.archived && <> · <b>archiviata</b></>}
            </div>
          ) : (
            <div className="text-sm text-neutral-400">—</div>
          )}
        </div>
      </div>

      {/* Azioni tappa */}
      <div className="card p-4 space-y-3">
        <div className="text-sm text-neutral-400">Azioni sulla tappa selezionata</div>
        <div className="flex flex-wrap gap-2">
          {!tappa?.closed_at ? (
            <button className="btn" onClick={onClose}>Chiudi tappa</button>
          ) : (
            <button className="btn" onClick={onReopen}>Riapri tappa</button>
          )}
          {!tappa?.archived ? (
            <button className="btn" onClick={onArchive} disabled={!tappa?.closed_at}>
              Archivia tappa
            </button>
          ) : (
            <button className="btn" onClick={onUnarchive}>Ripristina da archivio</button>
          )}
        </div>
      </div>

      {/* DEMO RAPIDO (wipe + seed) */}
      <div className="card p-4 space-y-3">
        <h3 className="font-semibold">Demo rapido (wipe + seed)</h3>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <div className="text-sm text-neutral-400 mb-1">ADMIN_SUPER_KEY</div>
            <input
              className="input w-full"
              type="password"
              value={key}
              onChange={e => setKey(e.target.value)}
              placeholder="Inserisci chiave per abilitare Wipe"
            />
          </div>
          <div>
            <div className="text-sm text-neutral-400 mb-1"># coppie demo</div>
            <input
              className="input w-full"
              type="number"
              min={2}
              step={1}
              value={pairs}
              onChange={e => setPairs(Number(e.target.value) || 16)}
            />
          </div>
          <div className="flex items-end">
            <label className="text-sm flex items-center gap-2">
              <input
                type="checkbox"
                checked={wipePlayers}
                onChange={e => setWipePlayers(e.target.checked)}
              />
              Elimina anche <b>Giocatori</b>
            </label>
          </div>
        </div>

        <div className="flex gap-2">
          <button className="btn" onClick={doWipe}>
            Wipe (tours/tappe/iscrizioni/gironi/partite/teams)
          </button>
          <button className="btn" onClick={doSeed}>Crea esempio 16 coppie</button>
        </div>

        <div className="text-xs text-neutral-500">
          Il wipe cancella tutto (e i giocatori se selezionato). Il seed crea: 1 tour, 1 tappa (tra 7 giorni), 16 coppie e 16 iscrizioni.
        </div>
      </div>
    </div>
  )
}
