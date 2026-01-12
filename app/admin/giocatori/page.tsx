'use client'
import useSWR from 'swr'

import { useMemo, useState } from 'react'


// fetcher che aggiunge l’header richiesto dalle API
const fetcher = (u: string) =>
  fetch(u, { headers: { 'x-role': 'admin' } }).then(r => r.json())

export default function Page(){
  const [q, setQ] = useState('')
  const [gender, setGender] = useState<'all'|'M'|'F'>('all')
  const [page, setPage] = useState(1)

  const url = useMemo(()=>{
    const p = new URLSearchParams()
    if (q) p.set('q', q)
    if (gender !== 'all') p.set('gender', gender)
    p.set('limit','200'); p.set('page', String(page))
    return `/api/players/list?${p.toString()}`
  }, [q, gender, page])

  const { data, mutate: revalidate, isLoading } = useSWR(url, fetcher)

  const [first_name, setFirst] = useState('')
  const [last_name, setLast]   = useState('')
  const [g, setG]              = useState<'M'|'F'>('M')
  const [err, setErr]          = useState<string>('')

  async function createPlayer(){
    setErr('')
    if (!first_name || !last_name) { setErr('Compila nome e cognome'); return }
   const res = await fetch('/api/players', {
  method:'POST',
  headers:{
    'Content-Type':'application/json',
    'x-role':'admin',            // ← IMPORTANTE
  },
  body: JSON.stringify({ first_name, last_name, gender: g })
})
    const js = await res.json()
    if (!res.ok) { setErr(js?.error || 'Errore creazione'); return }
    setFirst(''); setLast(''); setG('M'); revalidate()
  }

  const [editId, setEditId] = useState<string | null>(null)
  const [eFirst, setEFirst] = useState(''); const [eLast, setELast] = useState(''); const [eG, setEG] = useState<'M'|'F'>('M')
  const [rowErr, setRowErr] = useState('')

  function startEdit(p:any){
    setEditId(p.id); setEFirst(p.first_name); setELast(p.last_name); setEG(p.gender); setRowErr('')
  }
  function cancelEdit(){ setEditId(null); setRowErr('') }

  async function saveEdit(){
    if (!editId) return
    if (!eFirst || !eLast) { setRowErr('Compila nome e cognome'); return }
    const res = await fetch('/api/players', {
  method:'PATCH',
  headers:{
    'Content-Type':'application/json',
    'x-role':'admin',            // ← IMPORTANTE
  },
  body: JSON.stringify({ id: editId, first_name: eFirst, last_name: eLast, gender: eG })
})
    const js = await res.json()
    if (!res.ok) { setRowErr(js?.error || 'Errore modifica'); return }
    setEditId(null); revalidate()
  }

  async function askDelete(p:any){
    const ok = confirm(`Eliminare definitivamente ${p.last_name} ${p.first_name}?`)
    if (!ok) return
    const key = prompt('Super password per cancellare:')
    if (!key) return
    const res = await fetch(`/api/players?id=${p.id}`, {
  method:'DELETE',
  headers:{
    'x-role':'admin',                 // ← IMPORTANTE
    'x-admin-super-key': key,         // usa minuscolo: combacia con l’API
  }
})
    const js = await res.json().catch(()=>({}))
    if (!res.ok) { alert(js?.error || 'Impossibile eliminare'); return }
    revalidate()
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold">Giocatori</h1>

      <div className="card p-4 space-y-3">
        <h3 className="font-semibold">Nuovo giocatore</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input className="input" placeholder="Nome" value={first_name} onChange={e=>setFirst(e.target.value)} />
          <input className="input" placeholder="Cognome" value={last_name} onChange={e=>setLast(e.target.value)} />
          <select className="input" value={g} onChange={e=>setG(e.target.value as any)}>
            <option value="M">M</option><option value="F">F</option>
          </select>
          <button className="btn" onClick={createPlayer}>Crea</button>
        </div>
        {err && <div className="text-red-400 text-sm">{err}</div>}
      </div>

      <div className="card p-4 space-y-3">
        <h3 className="font-semibold">Cerca giocatori</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input className="input" placeholder="Cognome o nome…" value={q} onChange={e=>{ setQ(e.target.value); setPage(1) }} />
          <select className="input" value={gender} onChange={e=>{ setGender(e.target.value as any); setPage(1) }}>
            <option value="all">Tutti</option><option value="M">Maschile</option><option value="F">Femminile</option>
          </select>
          <div className="flex items-center text-sm text-neutral-400">
            {isLoading ? 'Caricamento…' : `Trovati: ${data?.total ?? 0}`}
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-neutral-800 overflow-hidden">
          {data?.items?.map((p:any)=>(
            <div key={p.id} className="px-3 py-2 border-b border-neutral-800">
              {editId === p.id ? (
                <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-center">
                  <input className="input" value={eLast} onChange={e=>setELast(e.target.value)} placeholder="Cognome" />
                  <input className="input" value={eFirst} onChange={e=>setEFirst(e.target.value)} placeholder="Nome" />
                  <select className="input" value={eG} onChange={e=>setEG(e.target.value as any)}>
                    <option value="M">M</option><option value="F">F</option>
                  </select>
                  <div className="flex gap-2">
                    <button className="btn" onClick={saveEdit}>Salva</button>
                    <button className="btn" onClick={cancelEdit}>Annulla</button>
                  </div>
                  {rowErr && <div className="text-red-400 text-sm col-span-full">{rowErr}</div>}
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>{p.last_name} {p.first_name}</div>
                  <div className="flex items-center gap-3">
                    <span className="text-neutral-400 text-sm">{p.gender}</span>
                    <button className="btn" onClick={()=>startEdit(p)}>Modifica</button>
                    <button className="btn" onClick={()=>askDelete(p)}>Elimina</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {!data?.items?.length && (
            <div className="px-3 py-2 text-neutral-400">Nessun giocatore trovato.</div>
          )}
        </div>
      </div>
    </div>
  )
}
