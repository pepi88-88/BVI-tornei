'use client'

import { useEffect, useMemo, useState } from 'react'

// --- utils -------------------------------------------------

type Team = { id: string; label: string }
type Format = 'ITA' | 'POOL'
type Group = {
  letter: string
  size: number
  format: Format
  slots: (string | null)[] // array di teamId o null
  matches: { time?: string; field?: string; a: string; b: string }[]
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').slice(0, 16) // A..P

// Colori stabili per A..P (usati ovunque)
export const GROUP_COLORS: Record<string, string> = {
  A: '#F4D03F', // yellow
  B: '#E74C3C', // red
  C: '#F39C12', // orange
  D: '#2ECC71', // green
  E: '#3498DB', // blue
  F: '#D35400', // dark orange
  G: '#95A5A6', // gray
  H: '#8E44AD', // purple
  I: '#1ABC9C', // teal
  J: '#D98880', // salmon
  K: '#5D6D7E', // steel
  L: '#16A085', // green-teal
  M: '#A569BD', // violet
  N: '#52BE80', // green
  O: '#F5B7B1', // light pink
  P: '#7FB3D5', // light blue
}

function combinations(n: number): [number, number][] {
  // tutte le coppie 1..n, i<j (per ITA)
  const out: [number, number][] = []
  for (let i = 1; i <= n; i++) for (let j = i + 1; j <= n; j++) out.push([i, j])
  return out
}

function poolScheme() {
  // schema fisso per 4: semi + finali
  // useremo etichette Slot 1..4, poi “V1 vs V2”, “P1 vs P2”
  return [
    { a: 'Slot 1', b: 'Slot 4' },
    { a: 'Slot 2', b: 'Slot 3' },
    { a: 'V1', b: 'V2' },
    { a: 'P1', b: 'P2' },
  ]
}

function makeMatches(g: Group): Group['matches'] {
  if (g.format === 'POOL') {
    // solo per 4 ha senso il pool
    return poolScheme().map(m => ({ a: m.a, b: m.b }))
  }
  // ITA: tutte le combinazioni in ordine
  const pairs = combinations(g.size || 0)
  return pairs.map(([a, b]) => ({ a: `Slot ${a}`, b: `Slot ${b}` }))
}

function localKey(tournamentId?: string) {
  return tournamentId ? `groups_state:${tournamentId}` : 'groups_state:__none__'
}

// --- fetch helpers (sufficienti per il tuo setup corrente) --
async function j<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

// --- page ---------------------------------------------------

export default function GironiPage() {
  // Tour + Tappa
  const [tours, setTours] = useState<any[]>([])
  const [tourId, setTourId] = useState<string>('')
  const [tournaments, setTournaments] = useState<any[]>([])
  const [tournamentId, setTournamentId] = useState<string>('')

  // Iscritti (teams)
  const [teams, setTeams] = useState<Team[]>([])

  // Stato gironi
  const [groups, setGroups] = useState<Group[]>([])
  const [numGroups, setNumGroups] = useState<number>(4)

  // --- load tours
  useEffect(() => {
    j<{ items: any[] }>('/api/tours')
      .then(d => {
        setTours(d.items || [])
        if (!tourId && d.items?.length) setTourId(d.items[0].id)
      })
      .catch(() => {})
  }, [])

  // --- load tournaments when tour changes
  useEffect(() => {
    if (!tourId) return
    j<{ items: any[] }>(`/api/tournaments?tour_id=${tourId}`)
      .then(d => {
        setTournaments(d.items || [])
        if (!tournamentId && d.items?.length) setTournamentId(d.items[0].id)
      })
      .catch(() => {})
  }, [tourId])

  // --- load teams for tournament
  useEffect(() => {
    if (!tournamentId) return
    j<{ items: { id: string; label: string }[] }>(
      `/api/registrations/by-tournament?tournament_id=${tournamentId}`
    )
      .then(d => setTeams(d.items || []))
      .catch(() => setTeams([]))
  }, [tournamentId])

  // --- init groups from localStorage or default
  useEffect(() => {
    if (!tournamentId) return
    try {
      const raw = localStorage.getItem(localKey(tournamentId))
      if (raw) {
        const parsed = JSON.parse(raw) as Group[]
        setGroups(parsed)
        setNumGroups(parsed.length || 1)
      } else {
        const base = Array.from({ length: numGroups }, (_, i) => {
          const letter = LETTERS[i]
          const g: Group = {
            letter,
            size: 4,
            format: 'ITA',
            slots: [null, null, null, null],
            matches: [],
          }
          g.matches = makeMatches(g)
          return g
        })
        setGroups(base)
      }
    } catch {
      // fallback “pulito”
      const base = Array.from({ length: numGroups }, (_, i) => {
        const letter = LETTERS[i]
        const g: Group = {
          letter,
          size: 4,
          format: 'ITA',
          slots: [null, null, null, null],
          matches: [],
        }
        g.matches = makeMatches(g)
        return g
      })
      setGroups(base)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId])

  // quando cambia il numero totale, aggiungo o tronco
  useEffect(() => {
    setGroups(prev => {
      if (!prev.length) {
        const base = Array.from({ length: numGroups }, (_, i) => {
          const letter = LETTERS[i]
          const g: Group = {
            letter,
            size: 4,
            format: 'ITA',
            slots: [null, null, null, null],
            matches: [],
          }
          g.matches = makeMatches(g)
          return g
        })
        return base
      }
      if (numGroups === prev.length) return prev
      if (numGroups > prev.length) {
        const extra = Array.from({ length: numGroups - prev.length }, (_, k) => {
          const letter = LETTERS[prev.length + k]
          const g: Group = {
            letter,
            size: 4,
            format: 'ITA',
            slots: [null, null, null, null],
            matches: [],
          }
          g.matches = makeMatches(g)
          return g
        })
        return [...prev, ...extra]
      }
      return prev.slice(0, numGroups)
    })
  }, [numGroups])

  // helpers
  const usedTeamIds = useMemo(
    () =>
      new Set(
        groups.flatMap(g => g.slots.filter(Boolean) as string[])
      ),
    [groups]
  )

  function setGroup(upd: Group, idx: number) {
    setGroups(prev => {
      const copy = [...prev]
      copy[idx] = { ...upd }
      return copy
    })
  }

  function saveLocal() {
    if (!tournamentId) return
    localStorage.setItem(localKey(tournamentId), JSON.stringify(groups))
    alert('Salvato localmente.')
  }

  function resetAll() {
    // usa la chiave che avevamo già in “gestione” (se presente)
    const stored = localStorage.getItem('admin_delete_key') || ''
    const key = prompt('Chiave ADMIN_SUPER_KEY per resettare i gironi', stored || '')
    if (!key) return
    localStorage.setItem('admin_delete_key', key)
    // niente chiamate server: pulizia locale
    localStorage.removeItem(localKey(tournamentId))
    const base = Array.from({ length: numGroups }, (_, i) => {
      const letter = LETTERS[i]
      const g: Group = {
        letter,
        size: 4,
        format: 'ITA',
        slots: [null, null, null, null],
        matches: [],
      }
      g.matches = makeMatches(g)
      return g
    })
    setGroups(base)
    alert('Reset locale completato.')
  }

  // --- UI ---------------------------------------------------
  return (
    <div className="space-y-4 p-6">
      {/* riga di controllo */}
      <div className="flex items-end gap-3">
        <div className="flex flex-col">
          <span className="text-xs text-neutral-400">Tour</span>
          <select className="input" value={tourId} onChange={e=>setTourId(e.target.value)}>
            {tours.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>

        <div className="flex flex-col">
          <span className="text-xs text-neutral-400">Tappa</span>
          <select className="input" value={tournamentId} onChange={e=>setTournamentId(e.target.value)}>
            {tournaments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>

        <div className="flex flex-col">
          <span className="text-xs text-neutral-400"># Gironi</span>
          <input
            type="number"
            min={1}
            max={16}
            className="input w-20 text-center"
            value={numGroups}
            onChange={(e)=>setNumGroups(Math.max(1, Math.min(16, Number(e.target.value||'1'))))}
          />
        </div>

        <div className="ml-auto flex gap-2">
          <button className="btn" onClick={resetAll}>Reset</button>
          <button className="btn" onClick={saveLocal}>Salva</button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {groups.map((g, gi) => {
          const color = GROUP_COLORS[g.letter] || '#666'
          const available = (current?: string|null) =>
            teams.filter(t => !usedTeamIds.has(t.id) || t.id === current)

          function updateSize(n: number) {
            const next: Group = { ...g, size: n, slots: [...g.slots] }
            next.slots = Array.from({ length: n }, (_, i) => g.slots[i] ?? null)
            next.matches = makeMatches(next)
            setGroup(next, gi)
          }
          function updateFormat(fmt: Format) {
            const next: Group = { ...g, format: fmt }
            next.matches = makeMatches(next)
            setGroup(next, gi)
          }
          function setSlot(idx: number, val: string|null) {
            const next: Group = { ...g, slots: [...g.slots] }
            next.slots[idx] = val
            setGroup(next, gi)
          }
          function slotLabel(idx: number) {
            const id = g.slots[idx]
            const t = teams.find(x=>x.id===id)
            return t?.label ?? `Slot ${idx+1}`
          }
          function matchName(name: string) {
            if (name.startsWith('Slot ')) {
              const s = Number(name.replace('Slot ',''))
              return slotLabel(s-1)
            }
            // V1,V2,P1,P2 rimangono come placeholder
            return name
          }

          return (
            <div className="card p-3 space-y-3" key={g.letter}>
              {/* header compatto in un’unica riga */}
              <div
                className="rounded-xl px-3 py-2 flex items-center gap-2"
                style={{ background: color, color: '#111' }}
              >
                <div className="font-semibold">GIRONE {g.letter}</div>
                <div className="ml-auto flex items-center gap-2">
                  <input
                    type="number"
                    min={2} max={6}
                    className="input h-8 w-14 text-center !bg-white !border-white"
                    value={g.size}
                    onChange={e=>updateSize(Math.max(2, Math.min(6, Number(e.target.value||'4'))))}
                    title="Numero squadre"
                  />
                  <select
                    className="input h-8 w-24 !bg-white !border-white"
                    value={g.format}
                    onChange={e=>updateFormat(e.target.value as Format)}
                    title="Formato"
                  >
                    <option value="ITA">ITA</option>
                    <option value="POOL">Pool</option>
                  </select>
                </div>
              </div>

              {/* slots */}
              <div className="space-y-2">
                {Array.from({ length: g.size }, (_, i)=>(
                  <div key={i} className="flex items-center gap-2">
                    <div className="w-6 text-xs text-neutral-400">{i+1}.</div>
                    <select
                      className="input w-full"
                      value={g.slots[i] ?? ''}
                      onChange={e=>setSlot(i, e.target.value || null)}
                    >
                      <option value="">—</option>
                      {available(g.slots[i]).map(t=>(
                        <option key={t.id} value={t.id}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              {/* partite */}
              <div className="space-y-2">
                <div
                  className="rounded-lg px-3 py-1 text-xs font-semibold tracking-wide"
                  style={{ background: color, color: '#111', width: '80%' }} // barra colore più lunga
                >
                  Partite {g.letter} — {g.format}
                </div>

                {g.matches.map((m, mi)=>(
                  <div className="flex items-center gap-2" key={mi}>
                    <input
                      className="input w-20"
                      placeholder="19:30"
                      value={m.time ?? ''}
                      onChange={e=>{
                        const next = {...m, time: e.target.value}
                        const gnext = {...g, matches:[...g.matches]}
                        gnext.matches[mi]=next
                        setGroup(gnext, gi)
                      }}
                    />
                    <input
                      className="input w-28"
                      placeholder="Campo"
                      value={m.field ?? ''}
                      onChange={e=>{
                        const next = {...m, field: e.target.value}
                        const gnext = {...g, matches:[...g.matches]}
                        gnext.matches[mi]=next
                        setGroup(gnext, gi)
                      }}
                    />
                    <div className="text-sm flex-1">
                      {matchName(m.a)} <span className="text-neutral-500">vs</span> {matchName(m.b)}
                    </div>
                    <div className="input w-24 text-center">{/* spazio risultato */}</div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* pannello giocatori a destra (sticky) */}
      <aside className="card p-3 md:fixed md:right-6 md:top-6 md:bottom-6 md:w-96 overflow-auto">
        <div className="text-sm font-semibold mb-2">Giocatori</div>
        <ol className="space-y-1 text-sm">
          {teams.map((t, i) => {
            const used = usedTeamIds.has(t.id)
            // colora con il colore del girone in cui sta
            const where = groups.find(g=>g.slots.includes(t.id))
            const b = where ? GROUP_COLORS[where.letter] : undefined
            return (
              <li
                key={t.id}
                className="rounded px-2 py-1 border border-neutral-800 flex items-center justify-between"
                style={{ opacity: used ? 0.6 : 1, background: b ? `${b}22` : undefined }}
              >
                <span className="text-neutral-500 w-8">{String(i+1).padStart(2,'0')}</span>
                <span className="flex-1">{t.label}</span>
                {where && <span className="text-xs font-semibold ml-2">G{where.letter}</span>}
              </li>
            )
          })}
        </ol>
      </aside>
    </div>
  )
}
