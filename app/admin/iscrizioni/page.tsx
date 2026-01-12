'use client'
/**
 * Iscrizioni:
 * - Selettori Tour + Tappa (persistenti)
 * - Nuova squadra SOLO con ricerca giocatori
 *   A: PlayerPicker (obbligatorio) + bottone a destra
 *   B: PlayerPicker (solo se Tipo=Giocatore) + select Tipo a destra
 * - Lista iscritti con DnD + Elimina
 */
import useSWR from 'swr'
import { useEffect, useMemo, useState } from 'react'
import RegistrationList from '@/components/RegistrationList'
import PlayerPicker, { type Player as PickerPlayer } from '@/components/PlayerPicker'

const fetcher = (url: string) =>
  fetch(url, { headers: { 'x-role': 'admin' } }).then(r => r.json())

type Player = { id:string; first_name:string; last_name:string; gender:'M'|'F' }

export default function IscrizioniPage() {
  // TOUR
  const { data: toursList } = useSWR('/api/tours', fetcher)
  const [tourId, setTourId] = useState<string>('')
  useEffect(() => { const s = localStorage.getItem('selectedTourId'); if (s) setTourId(s) }, [])
  function onPickTour(id: string) { setTourId(id); localStorage.setItem('selectedTourId', id); setTId('') }

  // TAPPA
  const { data: tournaments } = useSWR(tourId ? `/api/tournaments?tour_id=${tourId}` : null, fetcher)
  const [tId, setTId] = useState<string>('')
// helper ordinamento (data desc)
const parseDate = (s?: string|null) => (s ? new Date(s).getTime() : 0)

// SOLO tappe visibili in admin: nascondi quelle CHIUSE
const tappeVisibili = useMemo(() => {
  const arr = (tournaments?.items ?? []) as any[]
  return arr
    .filter(tp => tp?.status !== 'closed')                      // 👈 NASCONDI CHIUSE
    .sort((a,b) => parseDate(b?.event_date) - parseDate(a?.event_date))
}, [tournaments])

// se la tappa salvata è chiusa o non più in elenco → reset
useEffect(() => {
  if (!tId) return
  const cur = (tournaments?.items ?? []).find((t:any) => t.id === tId)
  const stillVisible = tappeVisibili.some(t => t.id === tId)
  if (!cur || cur?.status === 'closed' || !stillVisible) {
    setTId('')
    // opzionale: pulisci anche il localStorage
    const saved = localStorage.getItem('selectedTournamentId')
    if (saved === tId) localStorage.removeItem('selectedTournamentId')
  }
}, [tId, tournaments, tappeVisibili])

  useEffect(() => { const s = localStorage.getItem('selectedTournamentId'); if (s) setTId(s) }, [])
  useEffect(() => {
  if (!tId && tappeVisibili.length) {
    setTId(tappeVisibili[0].id)
  }
}, [tappeVisibili, tId])

  function onPickTappa(id: string) { setTId(id); localStorage.setItem('selectedTournamentId', id) }

  // iscritti
  const key = tId ? `/api/registrations/by-tournament?tournament_id=${tId}` : null
const { data: regs, mutate } = useSWR(key, fetcher)

// max squadre della tappa selezionata (normalizzato a numero >= 0)
const maxTeamsRaw =
  tId ? (tappeVisibili.find((t: any) => t.id === tId)?.max_teams) : undefined
const maxTeams = Number.isFinite(+maxTeamsRaw) ? Math.max(0, +maxTeamsRaw) : 0

// elenco voci da mostrare nella lista (con flag "isWaiting")
const items = useMemo(() => {
  if (!regs?.items) return []
  // NB: l'API deve già restituire gli iscritti nell'ordine "ufficiale"
  return regs.items.map((r: any, idx: number) => ({
    id: r.id,
    label: r.label,
    paid: r.paid,
    // è in attesa solo se eccede la capienza (0-based → idx >= maxTeams)
    isWaiting: maxTeams > 0 ? idx >= maxTeams : false,
  }))
}, [regs, maxTeams])


  async function onReorder(ids: string[]) {
  if (!regs?.items || !key) return

  // ricostruisco l’array riordinato a partire dagli ids
  const byId = new Map(regs.items.map((r: any) => [r.id, r]))
  const reordered = ids.map(id => byId.get(id)).filter(Boolean)

  // tengo copia per rollback
  const prev = regs

  // 1) aggiornamento OTTIMISTICO (UI subito aggiornata)
  await mutate(
    { ...prev, items: reordered },
    { optimisticData: { ...prev, items: reordered }, rollbackOnError: true, revalidate: false }
  )

  // 2) PATCH al server
  const res = await fetch('/api/registrations/reorder', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', 'x-role': 'admin' },
  body: JSON.stringify({ tournament_id: tId, orderedRegistrationIds: ids }),
})


  // 3) errore → rollback + alert
  if (!res.ok) {
    await mutate(prev, { revalidate: false })
    const js = await res.json().catch(()=>({}))
    alert(js?.error || 'Impossibile salvare il nuovo ordine.')
    return
  }

  // 4) revalidate silenziosa
  await mutate()
}

  async function deleteTeam(regId: string) {
    const res = await fetch(`/api/registrations?id=${regId}`, {
  method: 'DELETE',
  headers: { 'x-role': 'admin' },
})

    const js = await res.json().catch(() => ({}))
    if (!res.ok) return alert(js?.error || 'Impossibile eliminare la squadra.')
    mutate()
  }

  // form SOLO ricerca
 const [playerA, setPlayerA] = useState<PickerPlayer | null>(null)
  const [bMode, setBMode] = useState<'player'|'looking'|'cdc'>('player')
  const [playerB, setPlayerB] = useState<PickerPlayer | null>(null)

  async function createTeam() {
    if (!tId) return
    if (!playerA) return alert('Seleziona il Giocatore A')
    const payload:any = { tournament_id: tId, a: { id: playerA.id } }
    if (bMode === 'player') {
      if (!playerB) return alert('Seleziona il Giocatore B')
      payload.b = { existingId: playerB.id }
    } else if (bMode === 'looking') payload.b = { mode: 'looking' }
    else payload.b = { mode: 'cdc' }

   const res = await fetch('/api/registrations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-role': 'admin' },
  body: JSON.stringify(payload),
})

    if (!res.ok) { const js = await res.json().catch(()=>({})); alert(js?.error || 'Errore creazione squadra'); return }
    setPlayerA(null); setPlayerB(null); setBMode('player'); mutate()
  }

  return (
    <div className="space-y-6 p-6">
      {/* intestazione */}
      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-neutral-400">Tour</span>
          <select className="input" value={tourId} onChange={(e) => onPickTour(e.target.value)}>
            {toursList?.items?.map((tr: any) => (
              <option key={tr.id} value={tr.id}>
                {tr.name}{tr.season_start && tr.season_end ? ` (${tr.season_start}/${tr.season_end})` : ''}
              </option>
            ))}
          </select>
        </div>
      {/* Tappa */}
<div className="flex flex-col gap-1">
  <span className="text-sm text-neutral-400">Tappa</span>
  <select
    className="input"
    value={tId}
    onChange={(e) => onPickTappa(e.target.value)}
  >
    {!tappeVisibili.length && <option value="">— Nessuna tappa aperta —</option>}
    {tappeVisibili.map((t: any) => (
      <option key={t.id} value={t.id}>
        {t.event_date ? `${t.event_date} — ` : ''}{t.name}
      </option>
    ))}
  </select>
</div>

        <div className="ml-auto text-sm text-neutral-400">Max squadre: {maxTeams ?? '∞'}</div>
      </div>

      {/* NUOVA SQUADRA: A in alto (larga) + bottone a destra / B sotto con select a destra */}
      <div className="card p-4 space-y-4">
        <h3 className="font-semibold">Nuova squadra</h3>

        {/* Riga A */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <div className="md:col-span-9">
            <div className="text-base text-neutral-400 mb-1">Giocatore A</div>
            <PlayerPicker value={playerA} onChange={setPlayerA} placeholder="Cerca Giocatore A…" />
          </div>
          <div className="md:col-span-3">
            <button className="btn w-full" onClick={createTeam}>Aggiungi squadra</button>
          </div>
        </div>

        {/* Riga B */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <div className="md:col-span-9">
            <div className="text-base text-neutral-400 mb-1">Giocatore B</div>
            {bMode === 'player' ? (
              <PlayerPicker value={playerB} onChange={setPlayerB} placeholder="Cerca Giocatore B…" />
            ) : (
              <div className="text-neutral-400 text-sm border border-neutral-800 rounded-xl px-3 py-2">
                Nessun giocatore da cercare (placeholder)
              </div>
            )}
          </div>
          <div className="md:col-span-3">
            <div className="text-base text-neutral-400 mb-1">Tipo B</div>
            <select className="input w-full" value={bMode} onChange={(e)=>setBMode(e.target.value as any)}>
              <option value="player">Giocatore</option>
              <option value="looking">In cerca compagno</option>
              <option value="cdc">CDC</option>
            </select>
          </div>
        </div>
      </div>

      {/* lista iscritti */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-lg">Iscritti</h3>
          <div className="text-xs text-neutral-400">Trascina per riordinare</div>
        </div>
        <RegistrationList items={items} onReorder={onReorder} onDelete={deleteTeam} />
      </div>
    </div>
  )
}
