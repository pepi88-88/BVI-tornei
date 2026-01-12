'use client'

import { useEffect, useMemo, useState } from 'react'
import { GROUP_COLORS } from '@/app/admin/gironi/page' // riusa la stessa palette

type Team = { id: string; label: string }
type Match = { time?: string; field?: string; a: string; b: string }
type GroupPrint = {
  letter: string
  slots: string[] // team ids (lunghezza variabile)
  matches: Match[]
}

function localKey(tournamentId?: string) {
  return tournamentId ? `groups_state:${tournamentId}` : 'groups_state:__none__'
}

export default function StampaPage() {
  const [tours, setTours] = useState<any[]>([])
  const [tourId, setTourId] = useState<string>('')
  const [tournaments, setTournaments] = useState<any[]>([])
  const [tournamentId, setTournamentId] = useState<string>('')

  const [teams, setTeams] = useState<Team[]>([])
  const [groups, setGroups] = useState<GroupPrint[]>([])

  // load tours
  useEffect(()=> {
    fetch('/api/tours').then(r=>r.json()).then(d=>{
      setTours(d.items||[])
      if (!tourId && d.items?.length) setTourId(d.items[0].id)
    })
  },[])
  // load tappe
  useEffect(()=> {
    if (!tourId) return
    fetch(`/api/tournaments?tour_id=${tourId}`).then(r=>r.json()).then(d=>{
      setTournaments(d.items||[])
      if (!tournamentId && d.items?.length) setTournamentId(d.items[0].id)
    })
  },[tourId])
  // load iscritti
  useEffect(()=> {
    if (!tournamentId) return
    fetch(`/api/registrations/by-tournament?tournament_id=${tournamentId}`)
      .then(r=>r.json()).then(d=>setTeams(d.items||[]))
  },[tournamentId])
  // load groups from local
  useEffect(()=> {
    if (!tournamentId) return
    try {
      const raw = localStorage.getItem(localKey(tournamentId))
      if (!raw) { setGroups([]); return }
      const parsed = JSON.parse(raw) as any[]
      const mapped: GroupPrint[] = parsed.map(g => ({
        letter: g.letter,
        slots: (g.slots||[]).filter(Boolean),
        matches: g.matches || [],
      }))
      setGroups(mapped)
    } catch {
      setGroups([])
    }
  },[tournamentId])

  const teamById = useMemo(()=>Object.fromEntries(teams.map(t=>[t.id, t.label])),[teams])

  return (
    <div className="p-6 print:p-0">
      {/* Selettori (nascosti in stampa grazie a @media print) */}
      <div className="flex items-end gap-3 mb-6 no-print">
        <div className="flex flex-col">
          <span className="text-xs text-neutral-400">Tour</span>
          <select className="input" value={tourId} onChange={e=>setTourId(e.target.value)}>
            {tours.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="flex flex-col">
          <span className="text-xs text-neutral-400">Tappa</span>
          <select className="input" value={tournamentId} onChange={e=>setTournamentId(e.target.value)}>
            {tournaments.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <button className="btn ml-auto" onClick={()=>window.print()}>Stampa</button>
      </div>

      {/* Gironi: 4 per riga */}
      <div className="grid gap-6 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
        {groups.map(g=>{
          const color = GROUP_COLORS[g.letter] || '#666'
          return (
            <div key={g.letter} className="rounded-xl border border-neutral-800 overflow-hidden break-inside-avoid">
              {/* testata colorata */}
              <div className="px-3 py-2" style={{ background: color, color: '#111' }}>
                <div className="font-bold tracking-wide">GIRONE {g.letter}</div>
              </div>

              {/* elenco squadre */}
              <div className="p-3">
                <ol className="space-y-1 text-sm">
                  {g.slots.map((id, i)=>(
                    <li key={i} className="flex items-center gap-2">
                      <span className="w-5 text-neutral-400">{i+1}.</span>
                      <span className="flex-1 border-b border-neutral-700 pb-0.5">
                        {teamById[id] ?? '—'}
                      </span>
                    </li>
                  ))}
                  {/* se meno di 4, completa righe vuote per estetica stampa */}
                  {Array.from({length: Math.max(0, 4 - g.slots.length)}).map((_,i)=>(
                    <li key={`v${i}`} className="flex items-center gap-2">
                      <span className="w-5 text-neutral-400">{g.slots.length+i+1}.</span>
                      <span className="flex-1 border-b border-neutral-700 pb-0.5">&nbsp;</span>
                    </li>
                  ))}
                </ol>
              </div>

              {/* Tabella partite sotto a tutti i gironi (nello stesso riquadro) */}
              <div className="px-3 pb-3">
                <div
                  className="rounded-md px-3 py-1 text-xs font-semibold mb-2"
                  style={{ background: color, color: '#111', width: '90%' }}
                >
                  Partite {g.letter}
                </div>
                <div className="text-xs">
                  <div className="grid grid-cols-12 gap-2 font-semibold mb-1">
                    <div className="col-span-2">Ora</div>
                    <div className="col-span-2">Campo</div>
                    <div className="col-span-3">Coppia 1</div>
                    <div className="col-span-3">Coppia 2</div>
                    <div className="col-span-2 text-center">Ris.</div>
                  </div>
                  {g.matches.map((m, i)=>(
                    <div key={i} className="grid grid-cols-12 gap-2 mb-1">
                      <div className="col-span-2 border-b border-neutral-300">&nbsp;</div>
                      <div className="col-span-2 border-b border-neutral-300">&nbsp;</div>
                      <div className="col-span-3 border-b border-neutral-300">
                        {m.a.startsWith('Slot ')
                          ? (teamById[ g.slots[ Number(m.a.replace('Slot ','')) - 1 ] ] ?? m.a)
                          : m.a}
                      </div>
                      <div className="col-span-3 border-b border-neutral-300">
                        {m.b.startsWith('Slot ')
                          ? (teamById[ g.slots[ Number(m.b.replace('Slot ','')) - 1 ] ] ?? m.b)
                          : m.b}
                      </div>
                      <div className="col-span-2 border-b border-neutral-300">&nbsp;</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
