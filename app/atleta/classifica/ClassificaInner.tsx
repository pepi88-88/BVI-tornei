// app/atleta/classifica/ClassificaInner.tsx
'use client'

import * as React from 'react'
import useSWR from 'swr'

type Gender  = 'M' | 'F'
type Edition = { id: string; name: string }
type Player  = { player_id: string; display_name: string }
type Stage   = { id: string; name: string; day: number; month: number; multiplier: number; total_teams: number }

/** Legenda (curva) unica globale */
type ScoreCfg = { base:number; minLast:number; curvePercent:number }
type ScoreCfgSet = { S:ScoreCfg; M:ScoreCfg; L:ScoreCfg; XL:ScoreCfg }

// fetch helper
const fetcher = (u: string) => fetch(u, { cache:'no-store' }).then(r => r.json()).catch(()=>null)

// curve default (fallback UI)
const DEFAULT_SET: ScoreCfgSet = {
  S:{ base:100, minLast:10, curvePercent:100 },
  M:{ base:100, minLast:10, curvePercent:100 },
  L:{ base:100, minLast:10, curvePercent:100 },
  XL:{ base:100, minLast:10, curvePercent:100 },
}

const pickBucket = (n:number): keyof ScoreCfgSet => (n<=8?'S':n<=16?'M':n<=32?'L':'XL')
const pointsOfBucket = (pos:number, total:number, mult:number, set:ScoreCfgSet) => {
  const cfg = set[pickBucket(total)]
  if (!pos || pos<1 || total<1) return 0
  if (total<=1) return Math.round(cfg.base * mult)
  const alpha = Math.max(0.01, cfg.curvePercent/100)
  const t = (total - pos) / (total - 1)
  const raw = cfg.minLast + (cfg.base - cfg.minLast) * Math.pow(t, alpha)
  return Math.round(raw * mult)
}

// NB: il backend usa tour_id fisso "GLOBAL"
const TOUR_ID = 'GLOBAL'

export default function ClassificaInner() {
  const [gender, setGender] = React.useState<Gender>(() =>
    ((typeof window !== 'undefined' && (localStorage.getItem('ath:lastGender') as Gender|null)) || 'M')
  )
  React.useEffect(()=>{ if (typeof window!=='undefined') localStorage.setItem('ath:lastGender', gender) },[gender])

  // --- Legenda (curva unica) ---
  const { data: legendRes } = useSWR('/api/ranking/legend-curve', fetcher, { revalidateOnFocus:false })
  const legendSet: ScoreCfgSet = legendRes?.settings ?? DEFAULT_SET

  // --- Edizioni per GENERE ---
  const { data: edRes } = useSWR(
    `/api/ranking/editions?tour_id=${encodeURIComponent(TOUR_ID)}&gender=${gender}`,
    fetcher, { revalidateOnFocus:false }
  )
  const editions: Edition[] = edRes?.items ?? []

  const [editionId, setEditionId] = React.useState('')

  // ogni volta che cambiano GENERE o LISTA edizioni => punta alla PRIMA
  React.useEffect(()=>{
    if (editions.length) {
      setEditionId(editions[0].id)
    } else {
      setEditionId('')
    }
  }, [gender, editions.map(e=>e.id).join(',')])

  // --- Dati dell’edizione selezionata ---
  const { data: plRes } = useSWR(
    editionId ? `/api/ranking/players?edition_id=${editionId}` : null, fetcher, { revalidateOnFocus:false }
  )
  const players: Player[] = plRes?.items ?? []

  const { data: stRes } = useSWR(
    editionId ? `/api/ranking/stages?edition_id=${editionId}` : null, fetcher, { revalidateOnFocus:false }
  )
  const stages: Stage[] = stRes?.items ?? []

  // risultati salvati (posizioni per (stage,player))
  const { data: resRes } = useSWR(
    editionId ? `/api/ranking/stages/results?edition_id=${editionId}` : null, fetcher, { revalidateOnFocus:false }
  )

  // mappa veloce: stageId -> (playerId -> posizione)
  const placementsByStage = React.useMemo(()=>{
    const m: Record<string, Record<string, number>> = {}
    const items: Array<{stage_id:string; player_id:string; position:number}> = resRes?.items || []
    for (const it of items) {
      if (!m[it.stage_id]) m[it.stage_id] = {}
      m[it.stage_id][it.player_id] = Number(it.position)
    }
    return m
  }, [resRes?.items ? JSON.stringify(resRes.items) : ''])

  // --- calcolo totale per player in base alla curva e alle tappe ---
  const pointsForPlayer = React.useCallback((pid: string) => {
    let sum = 0
    for (const st of stages) {
      const pos = placementsByStage[st.id]?.[pid] ?? 0
      if (pos>0) {
        sum += pointsOfBucket(
          pos,
          Number(st.total_teams || 0),
          Number(st.multiplier || 1),
          legendSet
        )
      }
    }
    return sum
  }, [stages, placementsByStage, legendSet])

  // ordinamento: totale desc, miglior piazzamento asc, nome asc
  const rows = React.useMemo(()=>{
    const bestPlacementOf = (pid:string) => {
      let best = Infinity
      for (const st of stages) {
        const p = placementsByStage[st.id]?.[pid]
        if (p && p < best) best = p
      }
      return best
    }

    const out = players.map(p => ({
      player_id: p.player_id,
      name: p.display_name,
      total: pointsForPlayer(p.player_id),
      best: bestPlacementOf(p.player_id)
    }))
    out.sort((a,b)=>{
      const t = b.total - a.total
      if (t) return t
      if (a.best !== b.best) return a.best - b.best
      return a.name.localeCompare(b.name, 'it')
    })
    return out
  }, [players, stages, placementsByStage, pointsForPlayer])

  const classForRow = (rank:number)=>
    rank===1 ? 'bg-yellow-500/15'
    : (rank>=2 && rank<=8 ? 'bg-emerald-500/10' : '')

  // ------------------------ RENDER ------------------------
  return (
    <div className="p-6 space-y-6">
      {/* Top: genere + select edizione */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl overflow-hidden border border-neutral-700">
          <button
            className={`px-3 py-2 text-sm ${gender==='M'?'bg-neutral-800 text-white':'bg-neutral-900 text-neutral-300'}`}
            onClick={()=>setGender('M')}
          >
            Maschile
          </button>
          <button
            className={`px-3 py-2 text-sm ${gender==='F'?'bg-neutral-800 text-white':'bg-neutral-900 text-neutral-300'}`}
            onClick={()=>setGender('F')}
          >
            Femminile
          </button>
        </div>
        <select className="input w-80 ml-auto" value={editionId} onChange={e=>setEditionId(e.target.value)}>
          {editions.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </div>

      {/* Card classifica */}
      <div className="card p-0 overflow-hidden">
        <div className="px-3 py-2 border-b border-neutral-800 flex items-center justify-between">
          <div className="text-sm font-semibold">Classifica</div>
        </div>

        {/* ---- DESKTOP: tabella completa ---- */}
        <div className="hidden sm:block p-3 overflow-x-auto">
          <table className="w-full text-sm">
           <thead className="text-xs uppercase">
              <tr>
                <th className="text-left w-12">#</th>
                <th className="text-left">Giocatore</th>
                <th className="text-right w-28 pr-4">Totale</th>

                {stages.map((st, idx)=>(
                 <th key={st.id} className={`min-w-[120px] align-bottom border-l border-neutral-800`}>
                    <div className="flex flex-col items-center gap-1 py-1">
                      <div className="font-medium">{st.name}</div>
                      <div className="text-xs text-neutral-400">
                        {String(st.day).padStart(2,'0')}/{String(st.month).padStart(2,'0')}
                      </div>
                      <div className="text-[11px] text-neutral-500">x{Number(st.multiplier).toFixed(2)} · {st.total_teams} sq</div>
                    </div>
                  </th>
                ))}
              </tr>
              {stages.length>0 && (
                <tr className="text-neutral-400">
                  <th /><th /><th />
                  {stages.map(st=>(
                    <th key={st.id} className="py-1 border-l border-neutral-800">
                      <div className="grid grid-cols-2 w-24 mx-auto">
                        <span className="text-left">POS</span>
                        <span className="text-right">PTS</span>
                      </div>
                    </th>
                  ))}
                </tr>
              )}
            </thead>

            <tbody>
              {rows.map((r, i)=>(
                <tr key={r.player_id} className={`border-t border-neutral-800 ${classForRow(i+1)}`}>
                  <td className="py-1">{i+1}</td>
                 <td className="py-1 whitespace-nowrap max-w-[240px] truncate" title={r.name}>
  {r.name}
</td>
                  <td className="py-1 text-right font-semibold pr-4">
                    {new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 }).format(r.total)}
                  </td>

                  {stages.map((st, idx2)=>{
                    const pos = placementsByStage[st.id]?.[r.player_id] ?? 0
                    const pts = pos ? pointsOfBucket(pos, Number(st.total_teams||0), Number(st.multiplier||1), legendSet) : 0
                    return (
                      <td key={`${st.id}-${r.player_id}`} className={`py-1 ${idx2>0 ? 'border-l border-neutral-800' : ''}`}>
                        <div className="grid grid-cols-2 items-center w-24 mx-auto">
  <div className="w-12 tabular-nums text-left">{pos || '—'}</div>
  <div className="w-12 tabular-nums text-right">{pts ? pts : '—'}</div>
</div>
                      </td>
                    )
                  })}
                </tr>
              ))}

              {rows.length===0 && (
                <tr>
                  <td colSpan={3 + stages.length} className="py-4 text-center text-neutral-500">
                    Nessun dato
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ---- MOBILE: riga unica orizzontale (pos • nome • totale • tappe→scroll) ---- */}
        <div className="sm:hidden p-3 space-y-2">
          {rows.length === 0 ? (
            <div className="text-sm text-neutral-500">Nessun dato</div>
          ) : rows.map((r, i) => (
            <div key={r.player_id} className="overflow-x-auto">
              <div
                className={
                  `inline-flex items-center gap-1.5 border border-neutral-800 rounded-lg px-2.5 py-1.5 whitespace-nowrap min-w-max ` +
                  `${classForRow(i+1)}`
                }
              >
                {/* posizione compatta */}
                <span className="text-[11px] px-1.5 py-0.5 rounded bg-neutral-800 tabular-nums shrink-0">
                  {i+1}
                </span>

                {/* nome senza truncate, leggermente più piccolo */}
                <span className="text-sm font-medium">
                  {r.name}
                </span>

                {/* totale subito dopo il nome */}
                <span className="ml-2 text-sm tabular-nums font-semibold shrink-0">
                  {new Intl.NumberFormat('it-IT',{maximumFractionDigits:0}).format(r.total)}
                </span>

                {/* separatore sottile prima delle tappe */}
                {stages.length > 0 && <span className="mx-1 w-px h-4 bg-neutral-800 shrink-0" />}

                {/* chip tappe scorrevoli */}
                {stages.map((st) => {
                  const pos = placementsByStage[st.id]?.[r.player_id] ?? 0
                  const pts = pos
                    ? pointsOfBucket(pos, Number(st.total_teams||0), Number(st.multiplier||1), legendSet)
                    : 0
                  return (
                    <span
                      key={st.id}
                      className="shrink-0 px-2 py-1 rounded-md border border-neutral-800 text-[11px] inline-flex items-center gap-2"
                      title={`${st.name} — ${String(st.day).padStart(2,'0')}/${String(st.month).padStart(2,'0')} · x${Number(st.multiplier).toFixed(2)}`}
                    >
                      <span className="text-[10px] text-neutral-400">
                        {String(st.day).padStart(2,'0')}/{String(st.month).padStart(2,'0')} · x{Number(st.multiplier).toFixed(2)}
                      </span>
                      <span className="tabular-nums">
                        {pos || '—'} • {pts || '—'}
                      </span>
                    </span>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
