// /lib/sorgenti.ts
// -------------------------------------------------------------
// Formati e helpers CENTRALIZZATI per Gironi + Avulsa.
// -------------------------------------------------------------

export type GroupMeta = { key: string; size: number };
export type GironiAssign = Record<string, string[]>; // A:[teamId,...], B:[...]
export type AvulsaRow =
  | string
  | { pos?: number; rank?: number; position?: number; name?: string; label?: string; team?: string; a?: any; b?: any };

export type SourcesSnapshot = {
  gironi: string[];   // es. ["A1","A2","A3","B1","B2",...]
  avulsa: string[];   // es. ["Rossi / Bianchi", ...] (ORDINATI)
  createdAt: string;
};

export const keySources = (tour: string, tappa: string) => `sources:${tour}:${tappa}`;

// Chiavi lette/scritte per gironi (supportiamo meta e assegnazioni)
export const GROUP_META_KEYS = [
  (tour: string, tappa: string) => `groups:${tour}:${tappa}`,
  (tour: string, tappa: string) => `gironi_meta:${tour}:${tappa}`,
  (_tour: string, tappa: string) => `meta_gironi_${tappa}`,
  (tour: string, tappa: string) => `gironi_meta_${tour}_${tappa}`,
];
export const GROUP_ASSIGN_KEYS = [
  (tour: string, tappa: string) => `gironi_assign:${tour}:${tappa}`,
  (tour: string, tappa: string) => `gironi_assign_${tour}_${tappa}`,
];

// Chiavi lette/scritte per avulsa
export const AVULSA_KEYS = [
  (tour: string, tappa: string) => `avulsa:${tour}:${tappa}`,
  (tour: string, tappa: string) => `classifica_avulsa:${tour}:${tappa}`,
  (tour: string, tappa: string) => `results:avulsa:${tour}:${tappa}`,
  (tour: string, tappa: string) => `risultati:avulsa:${tour}:${tappa}`,
  (_tour: string, tappa: string) => `avulsa:${tappa}`,
];

// ------------------- UTIL -------------------

function uniqPush(out: string[], s: string | undefined | null) {
  const t = String(s ?? '').trim();
  if (t && !out.includes(t)) out.push(t);
}

// Ordina e normalizza la classifica avulsa in una lista di stringhe (1..N)
export function normalizeAvulsa(rows: AvulsaRow[]): string[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  // già stringhe -> mantengo l'ordine come arriva
  if (rows.every(x => typeof x === 'string')) {
    const cleaned = (rows as string[]).map(s => s.trim()).filter(Boolean);
    return Array.from(new Set(cleaned));
  }
  // oggetti -> ordino per posizione e prendo il nome/label
  type R = { pos?: number; rank?: number; position?: number; name?: string; label?: string; team?: string; a?: any; b?: any };
  const getPos = (r: R) => Number(r.pos ?? r.rank ?? r.position ?? 0) || 0;
  const getName = (r: R) =>
    (r.name ?? r.label ?? r.team ?? [r.a, r.b].filter(Boolean).join(' / ')) as string;

  const out: string[] = [];
  (rows as R[]).slice().sort((A,B)=> getPos(A) - getPos(B)).forEach(r => uniqPush(out, getName(r)));
  return out;
}

// Espande meta gironi in lista posizioni (A1..An, B1..Bn, ...)
export function expandGironi(meta: GroupMeta[] | null): string[] {
  if (!meta || !meta.length) return [];
  const ord = [...meta].sort((a,b)=> String(a.key).localeCompare(String(b.key)));
  const out: string[] = [];
  for (const g of ord) {
    const L = String(g.key).toUpperCase();
    const n = Number(g.size) || 0;
    for (let p=1; p<=n; p++) out.push(`${L}${p}`);
  }
  return out;
}

// ------------------- SALVATAGGIO LOCALSTORAGE -------------------

export function saveGironiLS(tour: string, tappa: string, meta: GroupMeta[], assign?: GironiAssign) {
  try {
    // meta in tutte le chiavi meta conosciute
    for (const k of GROUP_META_KEYS) {
      localStorage.setItem(k(tour, tappa), JSON.stringify(meta));
    }
    // assegnazioni se presenti
    if (assign && Object.keys(assign).length) {
      for (const k of GROUP_ASSIGN_KEYS) {
        localStorage.setItem(k(tour, tappa), JSON.stringify(assign));
      }
    }
  } catch {}
}

export function saveAvulsaLS(tour: string, tappa: string, rows: AvulsaRow[]) {
  const ordered = normalizeAvulsa(rows);
  try {
    for (const k of AVULSA_KEYS) {
      localStorage.setItem(k(tour, tappa), JSON.stringify(ordered));
    }
  } catch {}
  return ordered;
}

// Letture (usate anche da Sorgenti)
export function loadGironiMetaLS(tour: string, tappa: string): GroupMeta[] {
  // prova tutte le chiavi meta, poi prova dalle assegnazioni calcolando size
  for (const k of GROUP_META_KEYS) {
    try {
      const raw = localStorage.getItem(k(tour, tappa));
      if (!raw) continue;
      const j = JSON.parse(raw);
      if (Array.isArray(j) && j[0]?.key && (j[0]?.size ?? j[0]?.teams)) {
        return j.map((r: any) => ({ key: String(r.key).toUpperCase(), size: Number(r.size ?? r.teams) || 0 }))
                .filter((g: GroupMeta) => g.size > 0);
      }
    } catch {}
  }
  // dalle assegnazioni (A:[…]) → size = length
  for (const k of GROUP_ASSIGN_KEYS) {
    try {
      const raw = localStorage.getItem(k(tour, tappa));
      if (!raw) continue;
      const j = JSON.parse(raw);
      if (j && typeof j === 'object' && !Array.isArray(j)) {
        return Object.entries(j).map(([key, list]) => ({
          key: String(key).toUpperCase(),
          size: Array.isArray(list) ? list.length : 0,
        })).filter(g => g.size > 0);
      }
    } catch {}
  }
  return [];
}

export function loadAvulsaOrderedLS(tour: string, tappa: string): string[] {
  for (const k of AVULSA_KEYS) {
    try {
      const raw = localStorage.getItem(k(tour, tappa));
      if (!raw) continue;
      const j = JSON.parse(raw);
      return normalizeAvulsa(j);
    } catch {}
  }
  return [];
}

export function saveSnapshotLS(tour: string, tappa: string, s: SourcesSnapshot) {
  try { localStorage.setItem(keySources(tour, tappa), JSON.stringify(s)); } catch {}
}

export function loadSnapshotLS(tour: string, tappa: string): SourcesSnapshot | null {
  try {
    const raw = localStorage.getItem(keySources(tour, tappa));
    return raw ? JSON.parse(raw) as SourcesSnapshot : null;
  } catch { return null; }
}
