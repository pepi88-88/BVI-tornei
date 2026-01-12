// lib/names.ts
export type PlayerLike =
  | string
  | { [k: string]: any }
  | null
  | undefined

const LN_KEYS = ['cognome','surname','last_name','lastName','family_name']
const FN_KEYS = ['nome','first_name','name','firstName','given_name']

const lastFromString = (s: any) => {
  const str = String(s ?? '').trim()
  if (!str) return ''
  // rimuove iniziali finali tipo "P." / "P"
  const cleaned = str.replace(/\s+[A-Z]\.?$/u, '')
  const parts = cleaned.split(/\s+/)
  return parts[parts.length - 1] || ''
}

const lastFromObj = (p: PlayerLike): string => {
  if (!p) return ''
  if (typeof p === 'string') return lastFromString(p)
  for (const k of LN_KEYS) if (p[k]) return String(p[k])
  for (const k of [...FN_KEYS,'full_name','display_name','label']) if (p[k]) {
    const v = lastFromString(p[k])
    if (v) return v
  }
  return ''
}

const lastFromFlat = (row: any, which: 'a'|'b'): string => {
  // player_a_surname, playerA_last_name, a_last_name, cognome_a, last_name_b, ...
  const bases = [
    which,
    `player_${which}`,
    `player${which.toUpperCase()}`,
    which === 'a' ? 'pa' : 'pb',
  ]
  for (const base of bases) {
    for (const k of LN_KEYS) {
      const snake = `${base}_${k}`
      const camel = `${base}${k[0].toUpperCase()}${k.slice(1)}`
      if (row?.[snake]) return String(row[snake])
      if (row?.[camel]) return String(row[camel])
    }
  }
  // invertiti tipo cognome_a
  for (const k of LN_KEYS) {
    const inv = `${k}_${which}`
    if (row?.[inv]) return String(row[inv])
  }
  return ''
}

const lastFromLabel = (row: any, which: 'a'|'b'): string => {
  const label = row?.team || row?.label || ''
  if (!label) return ''
  const [la='', lb=''] = String(label).replace(/—/g,'/').split('/').map(s=>s.trim())
  return lastFromString(which === 'a' ? la : lb)
}

/** Restituisce "CognomeA / CognomeB" per una riga iscrizione */
export function teamSurname(row: any): string {
  const a =
    lastFromObj(row?.player_a) ||
    lastFromObj(row?.playerA)  ||
    lastFromObj(row?.a)        ||
    lastFromObj(row?.pa)       ||
    lastFromFlat(row,'a')      ||
    lastFromLabel(row,'a')

  const b =
    lastFromObj(row?.player_b) ||
    lastFromObj(row?.playerB)  ||
    lastFromObj(row?.b)        ||
    lastFromObj(row?.pb)       ||
    lastFromFlat(row,'b')      ||
    lastFromLabel(row,'b')

  return [a,b].filter(Boolean).join(' / ')
}
