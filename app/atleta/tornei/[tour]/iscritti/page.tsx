'use client'

import * as React from 'react'
import useSWR from 'swr'
import { useSearchParams } from 'next/navigation'
import ResponsiveDesktopTableWrapper from '../../../../../components/ResponsiveDesktopTable'

const fetcher = (url: string) => fetch(url).then(r => r.json())

type RegItemRaw = { id: string; label: string; paid?: boolean }
type RegItemUI  = RegItemRaw & { isWaiting: boolean }
type Tourn      = { id: string; name?: string; title?: string; max_teams?: number; event_date?: string }
// Capienza effettiva = priorità alla tappa (maxTeams). Se 0/assente, usa eventuale max dell'API iscritti.
function effectiveMaxFrom(regs: any, tournamentMax: number): number {
  const apiMaxRaw = regs?.max_teams ?? regs?.meta?.max_teams
  const apiMax = Number(apiMaxRaw)
  if (Number.isFinite(tournamentMax) && tournamentMax > 0) return tournamentMax
  if (Number.isFinite(apiMax) && apiMax > 0) return apiMax
  return 0
}

export default function AthleteIscrittiPage() {
  const params = useSearchParams()

// --------------------------
// 1) TID dalla query (solo da lì)
// --------------------------
const [tid, setTid] = React.useState<string>('')

React.useEffect(() => {
  const q = params.get('tid') || ''
  setTid(q)
}, [params])

 // --------------------------
// 2) Titolo tappa
// --------------------------
const [title, setTitle] = React.useState<string>('')

React.useEffect(() => {
  if (!tid) { setTitle(''); return }
  const tn = params.get('tname')
  if (tn) { setTitle(decodeURIComponent(tn)); return }

  ;(async () => {
    try {
      const r = await fetch(`/api/tournaments?id=${encodeURIComponent(tid)}`, { cache: 'no-store' })
      const js = await r.json()
      const items = Array.isArray(js?.items) ? js.items : js?.items ? [js.items] : []
      const row = items.find((t: any) => t.id === tid) || items[0]
      setTitle(row?.name || row?.title || '')
    } catch {}
  })()
}, [tid, params])

  // --------------------------
  // 3) Iscritti
  // --------------------------
  const { data: regs } = useSWR(
    tid ? `/api/registrations/by-tournament?tournament_id=${encodeURIComponent(tid)}` : null,
    fetcher
  )

// --------------------------
// 4) Max team della tappa
// --------------------------
const [maxTeams, setMaxTeams] = React.useState<number>(0)

React.useEffect(() => {
  if (!tid) { setMaxTeams(0); return }
  ;(async () => {
    try {
      const r = await fetch(`/api/tournaments?id=${encodeURIComponent(tid)}`, { cache: 'no-store' })
      const js = await r.json()

      // Prendo esattamente la riga del torneo richiesto (mai "la prima")
      const items = Array.isArray(js?.items) ? js.items : js?.items ? [js.items] : []
      const row: Tourn | undefined = items.find((t: any) => t.id === tid) || items[0]

      const mt = Number(row?.max_teams)
      setMaxTeams(Number.isFinite(mt) ? Math.max(0, mt) : 0)

      // DEBUG (puoi toglierlo)
      console.log('DEBUG atleta/iscritti', {
        tid,
        count_items: (Array.isArray(js?.items) ? js.items : js?.items ? [js.items] : []).length,
        picked_id: row?.id,
        max_teams: row?.max_teams,
      })
    } catch {
      setMaxTeams(0)
    }
  })()
}, [tid])

// --------------------------
// 5) Normalizzazione elenco (isWaiting con capienza "effettiva")
// --------------------------
const list: RegItemUI[] = React.useMemo(() => {
  const arr: RegItemRaw[] = regs?.items ?? []
  const effMax = effectiveMaxFrom(regs, maxTeams)
  return arr.map((r, idx) => ({
    ...r,
    isWaiting: effMax > 0 ? idx >= effMax : false,
  }))
}, [regs, maxTeams])



  // --------------------------
  // 6) Render
  // --------------------------
  if (!tid) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <div className="card p-4 text-sm">Tappa non valida.</div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      {/* Titolo */}
      <div className="text-2xl md:text-3xl font-semibold text-center">
        {title || 'Iscritti'}
      </div>

      {/* Lista iscritti - SOLO LETTURA */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Iscritti</h3>
      <div className="text-xs text-neutral-400">
  {(() => {
    const effMax = effectiveMaxFrom(regs, maxTeams)
    const waitingCount = list.filter(x => x.isWaiting).length
    return effMax > 0
      ? `Capienza: ${effMax} squadre — In attesa: ${waitingCount}`
      : `Nessun limite impostato — In attesa: ${waitingCount}`
  })()}
</div>


        </div>

        {list.length === 0 ? (
          <div className="text-sm text-neutral-500">Nessun iscritto per questa tappa.</div>
        ) : (
         <ResponsiveDesktopTableWrapper minWidthPx={900}>
 <ul className="space-y-1">
  {list.map((r, idx) => {
    const waiting = r.isWaiting
    return (
      <li
        key={r.id}
        className={[
          // ↓ un filo più compatta
          'flex items-center justify-between py-1.5 px-2 rounded-lg',
          waiting ? 'bg-amber-500/10' : '',
        ].join(' ')}
      >
        {/* Numero + Nome (più vicini) */}
        <div className="flex items-center gap-2 min-w-0">
          {/* Numero: più stretto, allineato a destra, font più piccolo */}
          <div className="w-6 text-[12px] md:text-[13px] text-neutral-500 text-right tabular-nums">
            {String(idx + 1).padStart(2, '0')}.
          </div>

          {/* Nome: font un filo più piccolo e tight */}
          <div
            className={[
              'truncate font-medium leading-tight tracking-tight',
              // ↓ leggermente downgrade del font
              'text-sm md:text-base lg:text-lg',
              waiting ? 'text-amber-400' : 'text-white',
            ].join(' ')}
            title={waiting ? 'In attesa' : 'Iscritto'}
          >
            {r.label}
          </div>
        </div>

        {/* Badge stato (invariato ma coerente col nuovo sizing) */}
        <div className="shrink-0">
          {waiting ? (
            <span className="badge badge-warning badge-sm">in attesa</span>
          ) : (
            <span className="badge badge-primary badge-sm">iscritto</span>
          )}
        </div>
      </li>
    )
  })}
</ul>

</ResponsiveDesktopTableWrapper>

        )}
      </div>
    </div>
  )
}
