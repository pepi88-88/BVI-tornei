'use client'
import useSWR from 'swr'
import { useEffect, useMemo, useState } from 'react'

const fetcher = (u: string) =>
  fetch(u, { headers: { 'x-role': 'admin' } }).then(r => r.json())

export default function Page(){
  const { data: tours, mutate: refreshTours } = useSWR('/api/tours', fetcher)
  const [tourId, setTourId] = useState<string>('')

  useEffect(()=>{
    const saved = localStorage.getItem('selectedTourId')
    if (!tourId && saved) setTourId(saved)
  }, [tourId])

  useEffect(()=>{
    if (tours?.items?.length && !tourId) {
      setTourId(tours.items[0].id)
      localStorage.setItem('selectedTourId', tours.items[0].id)
    }
  }, [tours, tourId])

  function pickTour(id:string){
    setTourId(id)
    localStorage.setItem('selectedTourId', id)
  }

  const { data: taps, mutate: refreshTaps } = useSWR(
    tourId ? `/api/tournaments?tour_id=${tourId}` : null,
    fetcher
  )

  // Ordina le tappe: APERTE → CHIUSE → ARCHIVIATE
  const tapSorted = useMemo(() => {
    const arr = (taps?.items ?? []).slice()
    const rank = (t: any) => {
      if (t?.archived) return 2
      const s = String(t?.status || '').toLowerCase()
      return s === 'closed' ? 1 : 0
    }
    arr.sort((a: any, b: any) => {
      const ra = rank(a), rb = rank(b)
      if (ra !== rb) return ra - rb
      const da = a?.event_date ? new Date(a.event_date).getTime() : Number.MAX_SAFE_INTEGER
      const db = b?.event_date ? new Date(b.event_date).getTime() : Number.MAX_SAFE_INTEGER
      if (da !== db) return da - db
      return String(a?.name || '').localeCompare(String(b?.name || ''))
    })
    return arr
  }, [taps?.items])

  // --- form CREAZIONE TOUR ---
  const [tName,  setTName]  = useState('2025/2026')
  const [tStart, setTStart] = useState<number | ''>(2025)
  const [tEnd,   setTEnd]   = useState<number | ''>(2026)

  // >>> UNICA createTour (usa name, non title)
  async function createTour(){
    const payload = {
      name: (tName || '').trim(),                              // <-- campo corretto
      season_start: tStart === '' ? null : Number(tStart),
      season_end:   tEnd   === '' ? null : Number(tEnd),
    }
    if (!payload.name) { alert('Inserisci il nome del tour'); return }

    const res = await fetch('/api/tours', {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'x-role':'admin',
      },
      body: JSON.stringify(payload),
    })
    const j = await res.json().catch(()=>({}))
    if (!res.ok) { alert(j?.error || 'Errore creazione tour'); return }

    // opzionale: lasciamo gli anni come sono per creare più tour di fila
    setTName('')
    refreshTours()
  }

  async function deleteTour(id:string){
    const key = prompt('Password cancellazione TOUR:')
    if(!key) return
    const res = await fetch(`/api/tours?id=${encodeURIComponent(id)}`, {
      method:'DELETE',
      headers:{
        'x-role':'admin',
        'x-admin-delete-key': key,   // <-- DEVE combaciare con la route API
      }
    })
    const js = await res.json().catch(()=>({}))
    if (!res.ok) { alert(js?.error || 'Password errata o errore.'); return }
    if (id===tourId) localStorage.removeItem('selectedTourId')
    refreshTours(); refreshTaps()
  }

  // --- form CREAZIONE TAPPA ---
  const [name, setName] = useState('Nuova tappa')
  const [date, setDate] = useState<string>('')
  const [mult, setMult] = useState<number>(1)
  const [max,  setMax]  = useState<number | ''>('')

  async function createTappa(){
    if (!tourId) return alert('Seleziona prima un Tour')
    const res = await fetch('/api/tournaments', {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'x-role':'admin',
      },
      body: JSON.stringify({
        tour_id: tourId,
        name,
        event_date: date || null,
        multiplier: mult,
        max_teams:  max === '' ? null : Number(max),
      })
    })
    const j = await res.json().catch(()=>({}))
    if (!res.ok) { alert(j?.error || 'Errore creazione tappa'); return }
    setName('Nuova tappa'); setDate(''); setMult(1); setMax('')
    refreshTaps()
  }

  async function updateMaxTeams(tappaId:string, value:number | ''){
    const res = await fetch('/api/tournaments', {
      method:'PATCH',
      headers:{
        'Content-Type':'application/json',
        'x-role':'admin',
      },
      body: JSON.stringify({ id: tappaId, max_teams: value===''? null : Number(value) })
    })
    const j = await res.json().catch(()=>({}))
    if (!res.ok) { alert(j?.error || 'Errore aggiornamento'); return }
    refreshTaps()
  }

  // >>> UNICA patchTappaSecure (niente duplicati)
  async function patchTappaSecure(id: string, update: Record<string, any>) {
    const key = prompt('Password amministratore (ADMIN_DELETE_KEY):')
    if (!key) return
    const res = await fetch('/api/tournaments', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-role':'admin',
        'x-admin-delete-key': key,      // <-- DEVE combaciare con la route API
      },
      body: JSON.stringify({ id, ...update }),
    })
    const j = await res.json().catch(()=>({}))
    if (!res.ok) { alert(j?.error || 'Password errata o errore.'); return }
    refreshTaps()
  }

  async function deleteTappa(id:string){
    const key = prompt('Password cancellazione TAPPA:')
    if(!key) return
    const res = await fetch(`/api/tournaments?id=${encodeURIComponent(id)}`, {
      method:'DELETE',
      headers:{
        'x-role':'admin',
        'x-admin-delete-key': key,      // <-- stesso header
      }
    })
    const j = await res.json().catch(()=>({}))
    if (!res.ok) { alert(j?.error || 'Password errata o errore.'); return }
    refreshTaps()
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold">Tour / Tappe</h1>

      {/* Crea tour */}
      <div className="card p-4 grid grid-cols-1 md:grid-cols-5 gap-3">
        <input className="input" placeholder="Nome tour (es. 2025/2026)" value={tName} onChange={e=>setTName(e.target.value)} />
        <input className="input" type="number" placeholder="Anno iniziale" value={tStart} onChange={e=>setTStart(e.target.value===''? '': Number(e.target.value))} />
        <input className="input" type="number" placeholder="Anno finale" value={tEnd} onChange={e=>setTEnd(e.target.value===''? '': Number(e.target.value))} />
        <button className="btn" onClick={createTour}>Crea Tour</button>
      </div>

      {/* Lista tour */}
      <div className="card p-4 space-y-2">
        {!tours?.items?.length && <div className="text-neutral-400">Nessun tour.</div>}
        {tours?.items?.map((t:any)=>(
          <div key={t.id} className={`flex items-center justify-between border-b border-neutral-800 py-2 ${t.id===tourId?'bg-neutral-900/40 rounded-xl px-3':''}`}>
            <div className="flex flex-col">
              <span className="font-medium">{t.name}</span>  {/* <-- usa name */}
              <span className="text-xs text-neutral-400">
                Stagione: {t.season_start ?? '—'} / {t.season_end ?? '—'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button className="btn" onClick={()=>pickTour(t.id)}>Seleziona</button>
              <button className="btn" onClick={()=>deleteTour(t.id)}>Elimina Tour</button>
            </div>
          </div>
        ))}
      </div>

      {/* Crea tappa */}
      <div className="card p-4 grid grid-cols-1 md:grid-cols-6 gap-3">
        <input className="input" placeholder="Nome tappa" value={name} onChange={e=>setName(e.target.value)} />
        <div>
          <div className="text-xs text-neutral-400 mb-1">Data tappa</div>
          <input className="input" type="date" value={date} onChange={e=>setDate(e.target.value)} />
        </div>
        <input className="input" type="number" placeholder="Moltiplicatore" value={mult} onChange={e=>setMult(Number(e.target.value))} />
        <input className="input" type="number" placeholder="Max squadre (opz.)" value={max} onChange={e=>setMax(e.target.value===''? '': Number(e.target.value))} />
        <button className="btn" onClick={createTappa}>Crea Tappa</button>
      </div>

      {/* Lista tappe */}
      <div className="card p-4">
        {tapSorted.length ? (
          <div className="space-y-2">
            {tapSorted.map((tp: any) => (
              <div key={tp.id} className="flex items-center justify-between border-b border-neutral-800 py-2">
                <div>
                  <div className="font-medium">{tp.name}</div>
                  <div className="text-xs text-neutral-400">
                    Data: {tp.event_date ?? '—'} · Moltiplicatore: {tp.multiplier}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-xs text-neutral-400">Stato:</span>
                    <span
                      className={
                        'px-2 py-0.5 rounded text-[11px] font-semibold ' +
                        (tp.archived
                          ? 'bg-amber-600/20 text-amber-400 border border-amber-700/50'
                          : tp.status === 'closed'
                          ? 'bg-red-600/20 text-red-400 border border-red-700/50'
                          : 'bg-emerald-600/20 text-emerald-400 border border-emerald-700/50')
                      }
                    >
                      {tp.archived ? 'ARCHIVIATA' : tp.status === 'closed' ? 'CHIUSA' : 'APERTA'}
                    </span>
                    {tp.closed_at && (
                      <span className="text-xs text-neutral-500">
                        · chiusa il {new Date(tp.closed_at).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-neutral-400">Max</span>
                    <input
                      className="input w-20"
                      type="number"
                      value={tp.max_teams ?? ''}
                      onChange={(e) =>
                        updateMaxTeams(tp.id, e.target.value === '' ? '' : Number(e.target.value))
                      }
                    />
                  </div>

                  {tp.status !== 'closed' && (
                    <button className="btn" title="Chiudi tappa" onClick={() => patchTappaSecure(tp.id, { status: 'closed' })}>
                      Chiudi
                    </button>
                  )}
                  {tp.status === 'closed' && (
                    <button className="btn" title="Riapri tappa" onClick={() => patchTappaSecure(tp.id, { status: 'open' })}>
                      Riapri
                    </button>
                  )}

                  <button className="btn" onClick={() => deleteTappa(tp.id)}>Elimina</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-neutral-400">Nessuna tappa per questo tour.</div>
        )}
      </div>
    </div>
  )
}
