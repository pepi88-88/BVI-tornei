// app/admin/classifica/legenda/page.tsx
'use client'

import * as React from 'react'

type ScoreCfg = { base:number; minLast:number; curvePercent:number }
type ScoreCfgSet = { S:ScoreCfg; M:ScoreCfg; L:ScoreCfg; XL:ScoreCfg }

const DEFAULT_SET: ScoreCfgSet = {
  S: { base:100, minLast:10, curvePercent:100 },
  M: { base:100, minLast:10, curvePercent:100 },
  L: { base:100, minLast:10, curvePercent:100 },
  XL:{ base:100, minLast:10, curvePercent:100 },
}

const pickBucket = (n:number): keyof ScoreCfgSet => (n<=8?'S':n<=16?'M':n<=32?'L':'XL')

const pointsOfBucket = (pos:number, total:number, mult:number, set:ScoreCfgSet) => {
  const cfg = set[pickBucket(total)]
  if (total<=1) return Math.round(cfg.base * mult)
  const alpha = Math.max(0.01, cfg.curvePercent/100)
  const t = (total - pos) / (total - 1)
  const raw = cfg.minLast + (cfg.base - cfg.minLast) * Math.pow(t, alpha)
  return Math.round(raw * mult)
}

/* API helpers */
async function apiGetSettings() {
  const r = await fetch('/api/ranking/legend-curve?ts=' + Date.now(), { cache: 'no-store' })
  if (!r.ok) return { settings: DEFAULT_SET }
  return r.json() as Promise<{ settings: ScoreCfgSet|null }>
}
async function apiSaveSettings(settings: ScoreCfgSet) {
  const r = await fetch('/api/ranking/legend-curve', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings, totalsFrom: 2, totalsTo: 64 }),
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}


export default function LegendAdminPage() {
  const [setCfg, setSetCfg] = React.useState<ScoreCfgSet>(DEFAULT_SET)
  const [totalTeams, setTotalTeams] = React.useState<number>(8)
  const [multiplier, setMultiplier] = React.useState<number>(1)

  React.useEffect(()=>{
    let alive = true
    apiGetSettings()
      .then(j => { if (alive) setSetCfg(j?.settings ?? DEFAULT_SET) })
      .catch(()=>{ if (alive) setSetCfg(DEFAULT_SET) })
    return ()=>{ alive = false }
  },[])

  const legend = React.useMemo(()=>{
    if (!totalTeams || totalTeams < 1) return []
    return Array.from({length: totalTeams}, (_,i)=>({
      pos: i+1, pts: pointsOfBucket(i+1, totalTeams, multiplier, setCfg)
    }))
  },[totalTeams, multiplier, setCfg])

  return (
    <div className="p-6 space-y-6">
      {/* Tabs */}
      <div className="flex items-center gap-2">
        <a className="btn btn-outline btn-sm" href="/admin/classifica">Classifica</a>
        <span className="btn btn-primary btn-sm border-2 border-primary ring-2 ring-primary/30">
          Legenda punti
        </span>
      </div>

      {/* Preview parametri */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-40 text-sm text-neutral-400">Totale squadre</div>
          <input
            className="input w-40" type="number" min={2} max={128}
            value={totalTeams} onChange={e=>setTotalTeams(Math.max(2, Number(e.target.value)||0))}
          />
        </div>
        <div className="flex items-center gap-3">
          <div className="w-40 text-sm text-neutral-400">Moltiplicatore (preview)</div>
          <input
            className="input w-40" type="number" step="0.01" min={0}
            value={multiplier} onChange={e=>setMultiplier(Math.max(0, Number(e.target.value)||0))}
          />
        </div>
        <div className="text-xs text-neutral-500">
          Questi valori sono solo per la <b>preview</b>. Il moltiplicatore reale si imposta per tappa nella pagina Classifica.
        </div>
      </div>

      {/* Legenda calcolata */}
      <div className="card p-4">
        <div className="font-medium mb-2">Legenda calcolata</div>
        {legend.length === 0 ? (
          <div className="text-sm text-neutral-500">Imposta un numero di squadre valido.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-sm">
              <thead className="text-neutral-400">
                <tr><th className="text-left pr-4">Pos</th><th className="text-left">Punti</th></tr>
              </thead>
              <tbody>
                {legend.map(r => (
                  <tr key={r.pos}><td className="py-1 pr-4">{r.pos}</td><td className="py-1">{r.pts}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Parametri S/M/L/XL */}
      <div className="card p-4 space-y-3">
        <div className="font-medium">Parametri di calcolo (S/M/L/XL)</div>

        {(['S','M','L','XL'] as (keyof ScoreCfgSet)[]).map(k=>(
          <div key={k} className="grid grid-cols-4 gap-3 items-end border-t border-neutral-800 pt-3 mt-3">
            <div className="font-medium">
              {k==='S' ? '1–8 squadre'
               : k==='M' ? '9–16 squadre'
               : k==='L' ? '17–32 squadre'
               : '33+ squadre'}
            </div>
            <div>
              <div className="text-xs mb-1">Punteggio 1° (BASE)</div>
              <input className="input w-full" type="number"
                value={setCfg[k].base}
                onChange={e=>setSetCfg({...setCfg, [k]: {...setCfg[k], base: Number(e.target.value)}})} />
            </div>
            <div>
              <div className="text-xs mb-1">Punteggio ultimo (MIN_LAST)</div>
              <input className="input w-full" type="number"
                value={setCfg[k].minLast}
                onChange={e=>setSetCfg({...setCfg, [k]: {...setCfg[k], minLast: Number(e.target.value)}})} />
            </div>
            <div>
              <div className="text-xs mb-1">Curvatura %</div>
              <input className="input w-full" type="number" step="1"
                value={setCfg[k].curvePercent}
                onChange={e=>setSetCfg({...setCfg, [k]: {...setCfg[k], curvePercent: Number(e.target.value)}})} />
            </div>
          </div>
        ))}

        <div className="flex items-center gap-3">
          <button
            className="btn"
            onClick={async ()=>{
              try {
                await apiSaveSettings(setCfg)
                alert('Impostazioni salvate.\nAttenzione: la classifica cambierà dopo aver salvato le nuove impostazioni.')
              } catch (e:any) {
                alert('Errore salvataggio: ' + (e?.message || ''))
              }
            }}
          >
            Salva impostazioni
          </button>
          <span className="text-xs text-neutral-500">Verranno rigenerate le voci 2..64 in <code>rank_legend</code>.</span>
        </div>
      </div>

      <div className="text-xs text-neutral-500">
        Formula: <code>punti = minLast + (base - minLast) * ((total - pos)/(total - 1))^(curvatura/100)</code>, poi × moltiplicatore.
      </div>
    </div>
  )
}
