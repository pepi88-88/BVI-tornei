'use client'
import * as React from 'react'

type Item = {
  id: string
  label: string
  paid?: boolean
  isWaiting?: boolean
}

type Props = {
  items: Item[]
  onReorder?: (ids: string[]) => void
  onDelete?: (id: string) => void
}

export default function RegistrationList({ items, onReorder, onDelete }: Props) {
  const [dragId, setDragId] = React.useState<string | null>(null)
  const [local, setLocal] = React.useState(items)

  React.useEffect(() => setLocal(items), [items])

  function onDragStart(id: string) { setDragId(id) }
  function onDragOver(e: React.DragEvent<HTMLDivElement>, overId: string) {
    e.preventDefault()
    if (!dragId || dragId === overId) return
    const current = [...local]
    const from = current.findIndex(i => i.id === dragId)
    const to   = current.findIndex(i => i.id === overId)
    if (from < 0 || to < 0) return
    const [moved] = current.splice(from, 1)
    current.splice(to, 0, moved)
    setLocal(current)
  }
  async function onDragEnd() {
    if (!onReorder || !dragId) { setDragId(null); return }
    setDragId(null)
    onReorder(local.map(i => i.id))
  }

  return (
    <div className="rounded-xl border border-neutral-800 overflow-hidden">
      {local.length === 0 && (
        <div className="px-4 py-4 text-neutral-400 text-base">Nessun iscritto.</div>
      )}
      {local.map((it, idx) => {
        const waiting = Boolean(it.isWaiting)
        return (
          <div
            key={it.id}
            draggable
            onDragStart={() => onDragStart(it.id)}
            onDragOver={(e) => onDragOver(e, it.id)}
            onDragEnd={onDragEnd}
            className={[
              'flex items-center justify-between',
              'px-4 py-3',                // 👈 più alto
              'border-b border-neutral-800 last:border-b-0',
              dragId === it.id ? 'bg-neutral-800/50' : '',
            ].join(' ')}
          >
            <div className="flex items-center gap-3">
              <span className="text-sm px-2 py-0.5 rounded bg-neutral-800 text-neutral-300">
                #{idx + 1}
              </span>

              <span
                className={[
                  'font-medium',
                  'text-lg md:text-xl leading-tight',             // 👈 più grande
                  waiting ? 'text-amber-400' : 'text-white', // 👈 evidenzia ATTESA
                ].join(' ')}
                title={waiting ? 'In attesa' : 'Iscritto'}
              >
                {it.label}
              </span>

              {!waiting && !it.paid && (
                <span className="text-xs text-neutral-400">Da pagare</span>
              )}
              {waiting && (
                <span className="text-xs text-amber-400/80">In attesa</span>
              )}
            </div>

            {onDelete && (
              <button
                className="btn"
                onClick={() => onDelete(it.id)}
                title="Elimina iscrizione"
              >
                Elimina
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
