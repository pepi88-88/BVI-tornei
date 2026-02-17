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

// form: 2x2 / 3x3 / 4x4
const [teamFormat, setTeamFormat] = useState<2 | 3 | 4>(2)
const [teamName, setTeamName] = useState<string>('')

// A/B/C/D
const [playerA, setPlayerA] = useState<PickerPlayer | null>(null)
const [playerB, setPlayerB] = useState<PickerPlayer | null>(null)
const [playerC, setPlayerC] = useState<PickerPlayer | null>(null)
const [playerD, setPlayerD] = useState<PickerPlayer | null>(null)

// solo per 2x2 (come prima)
const [bMode, setBMode] = useState<'player'|'looking'|'cdc'>('player')
const [cMode, setCMode] = useState<'player'|'looking'|'cdc'>('player')
const [dMode, setDMode] = useState<'player'|'looking'|'cdc'>('player')

// reset totale quando cambi formato (evita residui)
function onChangeFormat(next: 2 | 3 | 4) {
  setTeamFormat(next)
  setTeamName('')
  setPlayerA(null)
  setPlayerB(null)
  setPlayerC(null)
  setPlayerD(null)
  setBMode('player')
  setCMode('player')
  setDMode('player')

}


  async function createTeam() {
  if (!tId) return

  // A sempre obbligatorio
  if (!playerA) return alert('Seleziona il Giocatore A')

  // ===== 2x2 (vecchio comportamento) =====
  if (teamFormat === 2) {
    const payload: any = { tournament_id: tId, a: { id: playerA.id } }

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

    // reset
    setPlayerA(null); setPlayerB(null); setBMode('player')
    mutate()
    return
  }

// ===== 3x3 / 4x4 (squadra anche incompleta su B/C/D) =====
if (!teamName.trim()) return alert('Inserisci il Nome squadra')

// obbligatori solo se il tipo è "player"
if (bMode === 'player' && !playerB) return alert('Seleziona il Giocatore B')
if (cMode === 'player' && !playerC) return alert('Seleziona il Giocatore C')
if (teamFormat === 4 && dMode === 'player' && !playerD) return alert('Seleziona il Giocatore D')

// duplicati solo tra i player scelti davvero
const ids = [
  playerA.id,
  bMode === 'player' ? playerB?.id : null,
  cMode === 'player' ? playerC?.id : null,
  teamFormat === 4 && dMode === 'player' ? playerD?.id : null,
].filter(Boolean) as string[]

if (new Set(ids).size !== ids.length) return alert('Hai selezionato lo stesso giocatore più volte')

const payload: any = {
  tournament_id: tId,
  team_name: teamName.trim(),
  team_format: teamFormat,
  a: { id: playerA.id },

  b: bMode === 'player' ? { existingId: playerB!.id } : { mode: bMode },
  c: cMode === 'player' ? { existingId: playerC!.id } : { mode: cMode },
  d: teamFormat === 4
    ? (dMode === 'player' ? { existingId: playerD!.id } : { mode: dMode })
    : null,
}

const res = await fetch('/api/registrations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-role': 'admin' },
  body: JSON.stringify(payload),
})

if (!res.ok) {
  const js = await res.json().catch(()=>({}))
  alert(js?.error || 'Errore creazione squadra')
  return
}

// reset
setTeamName('')
setTeamFormat(2)
setPlayerA(null); setPlayerB(null); setPlayerC(null); setPlayerD(null)
setBMode('player'); setCMode('player'); setDMode('player')
mutate()
return
}  // ✅ CHIUDE createTeam()


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
    {/* Formato + Nome squadra (Nome squadra solo 3x3/4x4) */}
<div className="grid grid-cols-1 md:grid-cols-12 gap-3">
  <div className="md:col-span-3">
    <div className="text-base text-neutral-400 mb-1">Formato</div>
    <select
      className="input w-full"
      value={teamFormat}
      onChange={(e) => onChangeFormat(Number(e.target.value) as 2 | 3 | 4)}
    >
      <option value={2}>2x2</option>
      <option value={3}>3x3</option>
      <option value={4}>4x4</option>
    </select>
  </div>

  {teamFormat !== 2 && (
    <div className="md:col-span-9">
      <div className="text-base text-neutral-400 mb-1">Nome squadra</div>
      <input
        className="input w-full"
        value={teamName}
        onChange={(e) => setTeamName(e.target.value)}
        placeholder="Es. BVI Wolves"
      />
    </div>
  )}
</div>



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
        Nessun giocatore da cercare ({bMode === 'looking' ? 'IN CERCA' : 'CDC'})
      </div>
    )}
  </div>

  <div className="md:col-span-3">
    <div className="text-base text-neutral-400 mb-1">Tipo B</div>
    <select className="input w-full" value={bMode} onChange={(e)=>setBMode(e.target.value as any)}>
      <option value="player">Giocatore</option>
      <option value="looking">In cerca</option>
      <option value="cdc">CDC</option>
    </select>
  </div>
</div>


 
{/* Riga C (solo 3x3/4x4) */}
{teamFormat !== 2 && (
  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
    <div className="md:col-span-9">
      <div className="text-base text-neutral-400 mb-1">Giocatore C</div>

      {cMode === 'player' ? (
        <PlayerPicker value={playerC} onChange={setPlayerC} placeholder="Cerca Giocatore C…" />
      ) : (
        <div className="text-neutral-400 text-sm border border-neutral-800 rounded-xl px-3 py-2">
          Nessun giocatore da cercare ({cMode === 'looking' ? 'IN CERCA' : 'CDC'})
        </div>
      )}
    </div>

    <div className="md:col-span-3">
      <div className="text-base text-neutral-400 mb-1">Tipo C</div>
      <select className="input w-full" value={cMode} onChange={(e)=>setCMode(e.target.value as any)}>
        <option value="player">Giocatore</option>
        <option value="looking">In cerca</option>
        <option value="cdc">CDC</option>
      </select>
    </div>
  </div>
)}


{/* Riga D (solo 4x4) */}
{teamFormat === 4 && (
  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
    <div className="md:col-span-9">
      <div className="text-base text-neutral-400 mb-1">Giocatore D</div>

      {dMode === 'player' ? (
        <PlayerPicker value={playerD} onChange={setPlayerD} placeholder="Cerca Giocatore D…" />
      ) : (
        <div className="text-neutral-400 text-sm border border-neutral-800 rounded-xl px-3 py-2">
          Nessun giocatore da cercare ({dMode === 'looking' ? 'IN CERCA' : 'CDC'})
        </div>
      )}
    </div>

    <div className="md:col-span-3">
      <div className="text-base text-neutral-400 mb-1">Tipo D</div>
      <select className="input w-full" value={dMode} onChange={(e)=>setDMode(e.target.value as any)}>
        <option value="player">Giocatore</option>
        <option value="looking">In cerca</option>
        <option value="cdc">CDC</option>
      </select>
    </div>
  </div>
)}
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
