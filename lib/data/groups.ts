// lib/data/groups.ts
export async function listGroups(tournamentId: string) {
  const r = await fetch(`/api/groups?tournament_id=${tournamentId}`)
  const j = await r.json()
  if (!r.ok) throw new Error(j?.error || 'Errore caricamento gironi')
  return j.items as Array<{ id:string; label:string; sort_index:number }>
}

export async function createGroup(tournamentId: string, label: string) {
  const r = await fetch('/api/groups', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ tournament_id: tournamentId, label })
  })
  const j = await r.json()
  if (!r.ok) throw new Error(j?.error || 'Errore creazione girone')
  return j.item as { id:string; label:string; sort_index:number }
}

export async function deleteGroup(id: string) {
  const r = await fetch(`/api/groups?id=${id}`, { method:'DELETE' })
  const j = await r.json().catch(()=>({}))
  if (!r.ok) throw new Error(j?.error || 'Errore eliminazione girone')
}

// --- squadre nel girone ---
export async function listGroupEntries(groupId: string) {
  const r = await fetch(`/api/group-entries?group_id=${groupId}`)
  const j = await r.json()
  if (!r.ok) throw new Error(j?.error || 'Errore caricamento squadre del girone')
  return j.items as Array<{ id:string; team_id:string; seed:number }>
}

export async function addTeamToGroup(groupId: string, teamId: string) {
  const r = await fetch('/api/group-entries', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ group_id: groupId, team_id: teamId })
  })
  const j = await r.json()
  if (!r.ok) throw new Error(j?.error || 'Errore aggiunta squadra')
  return j.item as { id:string; team_id:string; seed:number }
}

export async function removeEntry(entryId: string) {
  const r = await fetch(`/api/group-entries?id=${entryId}`, { method:'DELETE' })
  const j = await r.json().catch(()=>({}))
  if (!r.ok) throw new Error(j?.error || 'Errore rimozione squadra dal girone')
}

export async function updateEntrySeed(entryId: string, seed: number) {
  const r = await fetch('/api/group-entries', {
    method:'PATCH', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ id: entryId, seed })
  })
  const j = await r.json().catch(()=>({}))
  if (!r.ok) throw new Error(j?.error || 'Errore riordino')
}
