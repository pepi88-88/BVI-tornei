'use client'

import React, { useEffect, useMemo, useState } from 'react'

/* ===================== Costanti UI ===================== */
const BASE_CARD_W = 320
const CARD_W      = Math.round(BASE_CARD_W * 0.8)   // 256 ~ -20%
const CARD_H      = 148
const COL_GAP     = 140                              // ⬅️ distanza tra colonne
const ROW_GAP     = 28                               // ⬅️ distanza verticale tra match della stessa colonna
const HSCROLL_PAD = -100

const SE_FINAL_TUNE = { lineDX: 0, lineDY: 0, lineLEN: 48, boxDX: 0, boxDY: 0 }
/* ===================== Tipi esportati ===================== */
export type Bracket = {
  id: string
  title: string
  color: string
  type: 'SE' | 'DE' | 'ITA'
  nTeams: number
  source: 'gironi'|'avulsa'|'eliminati'|'gironi+eliminati'
  fromTableId?: string
  r1: { A: string; B: string }[]
  slots: string[]
}
export type WinnerMap = Record<string, 'A'|'B'|undefined>
export type ScoreMap = Record<string, { A: number; B: number }>;

/* ===================== Utils comuni ===================== */
const nextPow2 = (n:number) => { let p=1; while(p<n) p<<=1; return p }
const uid = () => Math.random().toString(36).slice(2,10)

function lastSurnames(label: string) {
  const ln = (s: string) => s.trim().replace(/\s+[A-Z]\.?$/u, '').split(/\s+/)[0] || ''
  const parts = String(label).replace(/—/g,'/').split('/').map(p=>p.trim()).filter(Boolean)
  return parts.length>=2 ? `${ln(parts[0])} / ${ln(parts[1])}` : ln(String(label))
}
function parseRefToken(token: string): { kind: 'WIN'|'LOSE'; ref: string } | null {
  // accetta: "Vincente R1M1", "Winner R1M1", "Perdente A1", "Loser 7", "Vincente (A1)"
  const m = String(token).trim().match(/^(Vincente|Winner|Perdente|Loser)\s+\(?(.+?)\)?$/i);
  if (!m) return null;
  const kind = /^(Vincente|Winner)$/i.test(m[1]) ? 'WIN' : 'LOSE';
  return { kind, ref: m[2].trim() };
}

/* ---------- risoluzione slot: A1, “3”, “Perdente <TITOLO> Mx” ---------- */
function makeSlotResolver(
  tourId?: string,
  tId?: string,
  externalResolver?: (token: string) => string | undefined
) {
  // risolve SOLO codici base (A1, B2, "3", BYE, ecc.)
  const basic = (token: string): string => {
    if (!token) return '—'
    if (token === '-' || token === '—') return '—'
    if (token === 'BYE') return 'BYE'

   // Gironi: A1, B2, ...  -> PRIMA prova la classifica per girone salvata (groups_rank); fallback a assegnazioni
const m = token.match(/^([A-Z])(\d{1,2})$/)
if (m && tId) {
  const letter = m[1]
  const pos = Number(m[2]) - 1
  // 1) classifica per girone aggiornata
  try {
    const rawRank =
      localStorage.getItem(`groups_rank:${tourId}:${tId}`) ||
      localStorage.getItem(`groups_rank:${tId}`) ||
      localStorage.getItem(`gironi_rank_${tourId}_${tId}`)
  if (rawRank) {
      const byGroup = JSON.parse(rawRank) as Record<string, string[]>
      const name = byGroup?.[letter]?.[pos]
      if (name) return lastSurnames(name)
    }
  } catch {}
  // 2) fallback: assegnazioni originali
  try {
    const js = JSON.parse(localStorage.getItem(`gm:${tId}`) || 'null')
    const rid = js?.assign?.[`${letter}-${pos + 1}`]
    const lbl = rid && js?.labels?.[rid]
    if (lbl) return lastSurnames(lbl)
  } catch {}
  return token
}

    // Avulsa: "3" => posizione nella classifica avulsa
    if (/^\d+$/.test(token) && tourId && tId) {
      try {
        const raw =
          localStorage.getItem(`classifica_avulsa:${tourId}:${tId}`) ||
          localStorage.getItem(`avulsa:${tourId}:${tId}`)
        const arr: string[] = raw ? JSON.parse(raw) : []
        const i = Number(token) - 1
        if (arr[i]) return lastSurnames(arr[i])
      } catch {}
      return token
    }

    return token
  }

  // wrapper: gestisce "Perdente <tab> Mx"
  // ⬇️ IMPORTANTE: se l'altro tab NON è deciso, lascia il testo così com'è
   return (token: string): string => {
  if (/^(Perdente|Loser)\b/i.test(token)) {
    const v = externalResolver?.(token)
    if (v) return basic(v)          // deciso: traduco in nomi (A1/C3/“3” ecc.)
    // non deciso: normalizzo la label visuale a "Loser ..."
    return token.replace(/^Perdente/i, 'Loser')
  }
  return basic(token)
}
}

/* ===================== SE — Layout ===================== */
type Node = { id:string; round:number; mIndex:number; left:number; top:number; fromA?:number; fromB?:number; code:string }
const centerOf = (n: Node) => ({ cx: n.left + CARD_W/2, cy: n.top + CARD_H/2 })
const LETTER_BY_ROUND = ['R','Z','Y','X','W']
const codeFor = (round:number, idx:number) => `${(LETTER_BY_ROUND[round-1]||'R')}${idx+1}`

function buildSELayout(title:string, nTeams:number) {
  const pow = nextPow2(nTeams)
  const rounds = Math.log2(pow)
  const r1Matches = pow/2
  const nodes: Node[] = []
  const byRound: Node[][] = []

  const r1: Node[] = []
  for (let i=0;i<r1Matches;i++){
    r1.push({ id:`${title}-N${uid()}`, round:1, mIndex:i, left:0, top:i*(CARD_H+ROW_GAP), code:codeFor(1,i)})
  }
  byRound.push(r1); nodes.push(...r1)

  for (let r=2;r<=rounds;r++){
    const prev = byRound[r-2]; const cur: Node[]=[]
    for (let i=0;i<prev.length/2;i++){
      const A = prev[2*i], B = prev[2*i+1]
      const cy = (A.top + CARD_H/2 + B.top + CARD_H/2)/2
      const top = cy - CARD_H/2
      const left = (r-1)*(CARD_W+COL_GAP)
      const node: Node = { id:`${title}-N${uid()}`, round:r, mIndex:i, left, top, fromA:nodes.indexOf(A), fromB:nodes.indexOf(B), code:codeFor(r,i) }
      cur.push(node); nodes.push(node)
    }
    byRound.push(cur)
  }

  const width  = rounds*(CARD_W+COL_GAP)-COL_GAP+20
  const height = Math.max(...nodes.map(n=>n.top),0)+CARD_H
  return { nodes, byRound, width, height }
}

/* ===================== Helpers linee (DE) ===================== */
const HLine = ({ x1, y, x2, width = 3, color = '#22c55e' }:{ x1:number; y:number; x2:number; width?:number; color?:string }) =>
  <path d={`M ${x1} ${y} H ${x2}`} stroke={color} strokeWidth={width} fill="none" />
const VLine = ({ x, y1, y2, width = 3, color = '#22c55e' }:{ x:number; y1:number; y2:number; width?:number; color?:string }) =>
  <path d={`M ${x} ${y1} V ${y2}`} stroke={color} strokeWidth={width} fill="none" />

/* ===================== COMPONENTE ===================== */
type Props = {
  bracket: Bracket
  winners?: WinnerMap
  onWinnersChange?: (w: WinnerMap)=>void
  interactive?: boolean
  confirmOnPick?: boolean
  tourId?: string
  tId?: string
  externalResolver?: (token:string)=>string|undefined
  /** ⬇️ nuovo: punteggi per auto-determinare WIN/LOSE */
  scores?: ScoreMap
}


export default function BracketCanvas({
  bracket,
  winners: winnersProp = {},
  onWinnersChange,
  interactive = false,
  confirmOnPick = false,
  tourId,
  tId,
  externalResolver,
  scores,  // ⬅️ aggiungi qui
}: Props) {


  const [localWinners, setLocalWinners] = useState<WinnerMap>(winnersProp)
  useEffect(()=>{ setLocalWinners(winnersProp) }, [winnersProp])
// Se non c'è un pick manuale, prova a inferire il vincitore dai punteggi (scores)
const winnerSide = (code: string): 'A'|'B'|undefined => {
  const pick = localWinners[code];
  if (pick === 'A' || pick === 'B') return pick;
  const sc = scores?.[code];
  if (sc && Number.isFinite(sc.A) && Number.isFinite(sc.B)) {
    if (sc.A > sc.B) return 'A';
    if (sc.B > sc.A) return 'B';
  }
  return undefined;
};

  const setWin = (code:string, side:'A'|'B') => {
    const next = { ...localWinners, [code]: (localWinners[code]===side ? undefined : side) }
    setLocalWinners(next)
    onWinnersChange?.(next)
  }
  const confirmAndSet = (code:string, side:'A'|'B', label:string) => {
    if (!interactive) return
    const isUnset = !localWinners[code]
    const msg = isUnset
      ? `Confermi la vittoria di "${label}" in ${code}?`
      : `Annullare la vittoria attuale in ${code}?`
    if (!confirmOnPick || window.confirm(msg)) setWin(code, side)
  }

  const resolveSlot = useMemo(
    () => makeSlotResolver(tourId, tId, externalResolver),
    [tourId, tId, externalResolver]
  )

  /* ---------- PRE-computo layout SE SENZA hook condizionali ---------- */
  const seLayout = useMemo(
    () => bracket.type === 'SE' ? buildSELayout(bracket.title, bracket.nTeams) : null,
    [bracket.type, bracket.title, bracket.nTeams]
  )

  /* =========================================================
     SINGOLA ELIMINAZIONE (SE)
  ========================================================= */
  if (bracket.type === 'SE' && seLayout) {
    const se = seLayout
    const W = localWinners

    const winnerOfNode = (n: Node): string => {
      if (n.round === 1) {
        const m = bracket.r1?.[n.mIndex] ?? {A:'-',B:'-'}
        const a = resolveSlot(m.A), b = resolveSlot(m.B)
        const side = W[n.code]
        if (side === 'A') return a
        if (side === 'B') return b
        return ''
      } else {
        const pa = se.nodes[n.fromA!], pb = se.nodes[n.fromB!]
        const wa = winnerOfNode(pa), wb = winnerOfNode(pb)
        const side = W[n.code]
        if (side === 'A') return wa
        if (side === 'B') return wb
        return ''
      }
    }
    const loserOfNode = (n: Node): string => {
      if (n.round === 1) {
        const m = bracket.r1?.[n.mIndex] ?? {A:'-',B:'-'}
        const a = resolveSlot(m.A), b = resolveSlot(m.B)
        const side = W[n.code]
        if (side === 'A') return b
        if (side === 'B') return a
        return ''
      } else {
        const pa = se.nodes[n.fromA!], pb = se.nodes[n.fromB!]
        const wa = winnerOfNode(pa), wb = winnerOfNode(pb)
        const side = W[n.code]
        if (side === 'A') return wb
        if (side === 'B') return wa
        return ''
      }
    }

    // semifinali e 3/4
    const semis  = se.byRound.length>=2 ? se.byRound[se.byRound.length-2] : []
    const SF1 = semis?.[0], SF2 = semis?.[1]
    const thirdCode = 'THIRD'
    const thirdA = SF1 ? (loserOfNode(SF1) || `Loser ${SF1.code} — ${bracket.title}`) : ''
const thirdB = SF2 ? (loserOfNode(SF2) || `Loser ${SF2.code} — ${bracket.title}`) : ''

    const thirdWin = localWinners[thirdCode]

  return (
   <div className="bracket-scope relative">
        {/* Titolo */}
        <div className="mt-1 mb-4 flex justify-center">
          <div
            className="relative flex items-center justify-center text-center px-8 py-3 rounded-xl font-extrabold uppercase tracking-wide text-2xl md:text-3xl"
            style={{ background: bracket.color, color:'#000', minWidth: 380 }}
          >
            <span className="pointer-events-none">{bracket.title}</span>
          </div>
        </div>

        <div className="relative overflow-x-auto overflow-y-hidden card" style={{ height: se.height + 120 }}>
          <div className="relative" style={{ width: se.width + HSCROLL_PAD, height: se.height + 100 }}>
            {/* linee */}
            <svg width={se.width} height={se.height} className="absolute top-4 left-4" style={{ overflow:'visible' }}>
              {se.nodes.map((n, idx) => {
                if (n.round === 1) return null
                const A = se.nodes[n.fromA!], B = se.nodes[n.fromB!]
                const ca = centerOf(A), cb = centerOf(B), c = centerOf(n)
                const SHORT = 24, ENTER = 50
                const midAX = A.left + CARD_W + SHORT
                const midBX = B.left + CARD_W + SHORT
                const dstX  = n.left - ENTER
                return (
                  <g key={`ln-${idx}`} stroke={bracket.color} strokeWidth={3} fill="none">
                    <path d={`M ${A.left+CARD_W} ${ca.cy} H ${midAX} H ${dstX} V ${c.cy}`} />
                    <path d={`M ${B.left+CARD_W} ${cb.cy} H ${midBX} H ${dstX} V ${c.cy}`} />
                    <path d={`M ${dstX} ${c.cy} H ${n.left}`} />
                  </g>
                )
              })}
            </svg>

            {/* cards */}
            <div className="absolute top-4 left-4" style={{ width: se.width, height: se.height }}>
              {se.nodes.map((n) => {
                const header = (
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[11px] uppercase opacity-70">{n.code} — {bracket.title}</div>
                    <div className="text-[10px] opacity-50 font-mono">M{n.mIndex+1}</div>
                  </div>
                )

                if (n.round === 1) {
                  const pair = n.mIndex
                  const m = bracket.r1?.[pair] ?? { A: '-', B: '-' }
                  const labA = resolveSlot(m.A)
                  const labB = resolveSlot(m.B)
                  const win = localWinners[n.code]
                  // 🔎 cerca il piccolo componente Row dentro il ramo "if (n.round === 1) { ... }"
// e sostituiscilo con questo:

const Row = ({ side, text }: { side: 'A'|'B'; text: string }) => (
  <button
    type="button"
    onClick={() => interactive && confirmAndSet(n.code!, side, text)}
    className={`w-full h-10 rounded-md px-2 text-left truncate transition
      ${interactive ? 'cursor-pointer' : 'cursor-default'}
      ${win === side ? 'bg-yellow-500/20 ring-1 ring-yellow-500' : 'bg-neutral-800/40 hover:bg-neutral-700/40'}`}
    title={text}
    disabled={!interactive}
  >
    {/* ❌ rimosso il badge "A"/"B" per guadagnare spazio */}
    <span className="font-mono">{text}</span>
  </button>
)
                  return (
                    <div key={n.id} className="absolute card p-3 shadow-lg" style={{ width: CARD_W, height: CARD_H, left: n.left, top: n.top }}>
                      {header}
                      <div className="space-y-2">
                        <Row side="A" text={labA || '—'} />
                        <Row side="B" text={labB || '—'} />
                      </div>
                    </div>
                  )
                }

                const pa = se.nodes[n.fromA!], pb = se.nodes[n.fromB!]
                const wa = winnerOfNode(pa), wb = winnerOfNode(pb)
                const rowA = wa || `Winner ${pa.code} — ${bracket.title}`
const rowB = wb || `Winner ${pb.code} — ${bracket.title}`
                const win  = localWinners[n.code]

                // 🔎 cerca il piccolo componente Row dentro il ramo "if (n.round === 1) { ... }"
// e sostituiscilo con questo:

const Row = ({ side, text }: { side: 'A'|'B'; text: string }) => (
  <button
    type="button"
    onClick={() => interactive && confirmAndSet(n.code!, side, text)}
    className={`w-full h-10 rounded-md px-2 text-left truncate transition
      ${interactive ? 'cursor-pointer' : 'cursor-default'}
      ${win === side ? 'bg-yellow-500/20 ring-1 ring-yellow-500' : 'bg-neutral-800/40 hover:bg-neutral-700/40'}`}
    title={text}
    disabled={!interactive}
  >
    {/* ❌ rimosso il badge "A"/"B" per guadagnare spazio */}
    <span className="font-mono">{text}</span>
  </button>
)


                return (
                  <div key={n.id} className="absolute card p-3 shadow-lg" style={{ width: CARD_W, height: CARD_H, left: n.left, top: n.top }}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[11px] uppercase opacity-70">{n.code} — {bracket.title}</div>
                      <div className="text-[10px] opacity-50 font-mono">M{n.mIndex+1}</div>
                    </div>
                    <div className="space-y-2">
                      <Row side="A" text={rowA} />
                      <Row side="B" text={rowB} />
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Finale + Vincitore + 3°/4° */}
            {se.nodes.length>0 && (() => {
              const final = se.nodes[se.nodes.length-1]
              const lineLeft  = final.left + CARD_W + SE_FINAL_TUNE.lineDX
              const lineTop   = final.top  + SE_FINAL_TUNE.lineDY
              const lineWidth = SE_FINAL_TUNE.lineLEN
              const winnerLeft = lineLeft + lineWidth + 8 + SE_FINAL_TUNE.boxDX
              const winnerTop  = final.top + SE_FINAL_TUNE.boxDY

              // semifinali (per il 3/4)
              const rounds = se.byRound.length
              const semis  = se.byRound[rounds - 2] || []
              const SF1 = semis[0], SF2 = semis[1]
              const thirdCode = 'THIRD'
              const thirdA = SF1 ? (loserOfNode(SF1) || `Loser ${SF1.code} — ${bracket.title}`) : ''
const thirdB = SF2 ? (loserOfNode(SF2) || `Loser ${SF2.code} — ${bracket.title}`) : ''

              const thirdWin = localWinners[thirdCode]

              return (
                <>
                  <svg width={lineWidth} height={CARD_H} className="absolute" style={{ left: lineLeft, top: lineTop }}>
                    <path d={`M 0 ${CARD_H/2} H ${lineWidth}`} stroke={bracket.color} strokeWidth={3} fill="none" />
                  </svg>
                  <div className="absolute card p-4 shadow-lg" style={{ width: CARD_W, height: CARD_H, left: winnerLeft, top: winnerTop }}>
                    <div className="text-[11px] uppercase opacity-70 mb-2">VINCITORE TORNEO</div>
                    <div className="text-sm text-neutral-300">
                      {(() => {
                        // vincente della finale (se selezionato)
                        const w = localWinners[final.code]
                        if (!w) return `Winner ${final.code} — ${bracket.title}`
                        const pa = se.nodes[final.fromA!], pb = se.nodes[final.fromB!]
                        const wa = winnerOfNode(pa), wb = winnerOfNode(pb)
                        return lastSurnames(w === 'A' ? (wa || `Winner ${pa.code} — ${bracket.title}`) : (wb || `Winner ${pb.code} — ${bracket.title}`))
                      })()}
                    </div>
                  </div>

                  {/* 3°/4° cliccabile */}
                  {SF1 && SF2 && (
                    <div className="absolute card p-3 shadow-lg" style={{ width: CARD_W, height: CARD_H, left: final.left, top: final.top + CARD_H + 48 }}>
                      <div className="text-[11px] uppercase opacity-70 mb-2">3° / 4° posto — {bracket.title}</div>
                      <div className="space-y-2">
                        <button
                          type="button"
                          onClick={()=>confirmAndSet('THIRD', 'A', thirdA)}
                          className={`w-full h-10 rounded-md px-2 text-left truncate transition
                            ${interactive ? 'cursor-pointer' : 'cursor-default'}
                            ${thirdWin==='A' ? 'bg-yellow-500/20 ring-1 ring-yellow-500' : 'bg-neutral-800/40 hover:bg-neutral-700/40'}`}
                          disabled={!interactive}
                          title={thirdA}
                        >
                          <span className="mr-2 w-5 inline-block text-xs opacity-70">A</span>
                          <span className="font-mono">{thirdA}</span>
                        </button>
                        <button
                          type="button"
                          onClick={()=>confirmAndSet('THIRD', 'B', thirdB)}
                          className={`w-full h-10 rounded-md px-2 text-left truncate transition
                            ${interactive ? 'cursor-pointer' : 'cursor-default'}
                            ${thirdWin==='B' ? 'bg-yellow-500/20 ring-1 ring-yellow-500' : 'bg-neutral-800/40 hover:bg-neutral-700/40'}`}
                          disabled={!interactive}
                          title={thirdB}
                        >
                          <span className="mr-2 w-5 inline-block text-xs opacity-70">B</span>
                          <span className="font-mono">{thirdB}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )
            })()}
          </div>
        </div>
      </div>
    )
  }

  /* =========================================================
     DOPPIA ELIMINAZIONE (5–8 MANUALE)
  ========================================================= */
  if (bracket.type === 'DE') {
    const W = localWinners
    const title = bracket.title
// --- small boxes: metà altezza, centrati sul vecchio centro ---
const SMALL_H = Math.round(CARD_H / 2);
const centerTop = (baseTop: number, h: number) => baseTop + (CARD_H - h) / 2;


    // helper: label A/B per R1..R4 (dai menu r1)
    const rLabel = (i:0|1|2|3) => {
      const m = bracket.r1?.[i] ?? {A:'-',B:'-'}
      return { a: resolveSlot(m.A), b: resolveSlot(m.B) }
    }

    // labels per un match code
    const labelsFor = (code:string): {a:string; b:string} => {
      switch (code) {
        case 'R1': return rLabel(0)
        case 'R2': return rLabel(1)
        case 'R3': return rLabel(2)
        case 'R4': return rLabel(3)
        case 'Z1': return { a: winnerOf('R1') || `Winner R1 — ${title}`, b: winnerOf('R2') || `Winner R2 — ${title}` }
case 'Z2': return { a: winnerOf('R3') || `Winner R3 — ${title}`, b: winnerOf('R4') || `Winner R4 — ${title}` }

case 'X1': return { a: loserOf('R1')  || `Loser R1 — ${title}`,  b: loserOf('R2')  || `Loser R2 — ${title}` }
case 'X2': return { a: loserOf('R3')  || `Loser R3 — ${title}`,  b: loserOf('R4')  || `Loser R4 — ${title}` }

case 'W1': return {
  a: (loserOf('Z1') || `Loser Z1 — ${title}`),   // prende il nome che Q1 sta mostrando
  b: (winnerOf('X1') || `Winner X1 — ${title}`), // prende il nome che X3 sta mostrando
}
case 'W2': return {
  a: (loserOf('Z2') || `Loser Z2 — ${title}`),   // prende il nome che Q2 sta mostrando
  b: (winnerOf('X2') || `Winner X2 — ${title}`), // prende il nome che X4 sta mostrando
}

case 'CO1':return { a: winnerOf('Z1') || `Winner Z1 — ${title}`, b: winnerOf('W2') || `Winner W2 — ${title}` }
case 'CO2':return { a: winnerOf('Z2') || `Winner Z2 — ${title}`, b: winnerOf('W1') || `Winner W1 — ${title}` }

case 'F':  return { a: winnerOf('CO1') || `Winner CO1`,          b: winnerOf('CO2') || `Winner CO2` }
case 'THIRD': return { a: loserOf('CO1') || `Loser CO1`,         b: loserOf('CO2') || `Loser CO2` }

        default: return { a:'', b:'' }
      }
    }

    const winnerOf = (code:string): string => {
      const w = W[code]
      const {a,b} = labelsFor(code)
      if (w==='A') return a
      if (w==='B') return b
      return ''
    }
    const loserOf = (code:string): string => {
      const w = W[code]
      const {a,b} = labelsFor(code)
      if (w==='A') return b
      if (w==='B') return a
      return ''
    }

    const BoxAB = ({ code, left, top }: { code:string; left:number; top:number }) => {
      const { a, b } = labelsFor(code)
      const win = localWinners[code]
      // 🔎 cerca il piccolo componente Row dentro il ramo "if (n.round === 1) { ... }"
// e sostituiscilo con questo:

const Row = ({ side, text }: { side: 'A'|'B'; text: string }) => (
  <button
    type="button"
    onClick={() => interactive && confirmAndSet(code!, side, text)}
    className={`w-full h-10 rounded-md px-2 text-left truncate transition
      ${interactive ? 'cursor-pointer' : 'cursor-default'}
      ${win === side ? 'bg-yellow-500/20 ring-1 ring-yellow-500' : 'bg-neutral-800/40 hover:bg-neutral-700/40'}`}
    title={text}
    disabled={!interactive}
  >
    {/* ❌ rimosso il badge "A"/"B" per guadagnare spazio */}
    <span className="font-mono">{text}</span>
  </button>
)

      return (
        <div className="absolute card p-3 shadow-lg" style={{ width:CARD_W, height:CARD_H, left, top }}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] uppercase opacity-70">{code} — {title}</div>
          </div>
          <div className="space-y-2">
            <Row side="A" text={a || '—'} />
            <Row side="B" text={b || '—'} />
          </div>
        </div>
      )
    }

    const BoxSingle = ({
  code, label, left, top, h = CARD_H,
}:{ code:string; label:string; left:number; top:number; h?:number }) => {
  // ricentra rispetto al vecchio centro (le linee usano ancora CARD_H)
  const top2 = centerTop(top, h);
  return (
    <div className="absolute card p-4 shadow-lg" style={{ width: CARD_W, height: h, left, top: top2 }}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] uppercase opacity-70">{code}</div>
      </div>
      <div className="text-sm">{label}</div>
    </div>
  )
}


    // layout posizioni (come "creazione tabellone")
    const left1 = 12, top1 = 40, gapV = CARD_H+28, dx = CARD_W+100
    const pos = {
      R1:{left:left1, top:top1},
      R2:{left:left1, top:top1+gapV},
      R3:{left:left1, top:top1+gapV*2},
      R4:{left:left1, top:top1+gapV*3},

      Z1:{left:left1+dx, top:top1+gapV/2},
      Z2:{left:left1+dx, top:top1+gapV*2.5},
      Y1:{left:left1+dx*2, top:top1+gapV/2},
      Y2:{left:left1+dx*2, top:top1+gapV*2.5},

      X1:{left:left1, top:400 + (CARD_H + 40)*3},
      X2:{left:left1, top:400 + (CARD_H + 40)*5},
      X3:{left:left1+dx, top:400 + (CARD_H + 40)*3},
      X4:{left:left1+dx, top:400 + (CARD_H + 40)*5},

      Q1:{left:left1+dx, top:400 + (CARD_H + 40)*3 - CARD_H - 24},
      Q2:{left:left1+dx, top:400 + (CARD_H + 40)*5 - CARD_H - 24},

      W1:{left:left1+dx*2, top:400 + (CARD_H + 40)*3 - CARD_H/2},
      W2:{left:left1+dx*2, top:400 + (CARD_H + 40)*5 - CARD_H/2},

      CO1:{left:left1+dx*3, top:220},
      CO2:{left:left1+dx*3, top:220 + (CARD_H + 28)},
      F:{left:left1+dx*4, top:220 + (CARD_H + 14)/2},
      WIN:{left:left1+dx*5, top:220 + (CARD_H + 14)/2},
      THIRD:{left:left1+dx*4, top:220 + (CARD_H + 14)/2 + CARD_H + 48},
    }

    // helpers per connettori
    const L = (c:string)=>pos[c as keyof typeof pos].left
    const T = (c:string)=>pos[c as keyof typeof pos].top
    const R = (c:string)=>L(c)+CARD_W
    const C = (c:string)=>T(c)+CARD_H/2

   return (
  <div className="bracket-scope relative">
        {/* titolo grande */}
        <div className="mt-1 mb-4 flex justify-center">
          <div
            className="relative flex items-center justify-center text-center px-8 py-3 rounded-xl font-extrabold uppercase tracking-wide text-2xl md:text-3xl"
            style={{ background: bracket.color, color:'#000', minWidth: 380 }}
          >
            <span className="pointer-events-none">{title}</span>
          </div>
        </div>

        <div className="relative card overflow-x-auto overflow-y-auto" style={{ height: 1100 }}>
          <div className="relative" style={{ width: left1+dx*6, height: 1080 }}>
<div className="absolute top-2 left-6 text-xs font-semibold text-neutral-400 tracking-widest">WINNERS</div>
<div className="absolute text-xs font-semibold text-neutral-400 tracking-widest" style={{ top: 740, left: 24 }}>LOSERS</div>
            {/* BOX */}
            <BoxAB code="R1" {...pos.R1} />
            <BoxAB code="R2" {...pos.R2} />
            <BoxAB code="R3" {...pos.R3} />
            <BoxAB code="R4" {...pos.R4} />

            <BoxAB     code="Z1" {...pos.Z1} />
            <BoxAB     code="Z2" {...pos.Z2} />
            <BoxSingle code="Y1" label={winnerOf('Z1') || `Winner Z1 — ${title}`} {...pos.Y1}  h={SMALL_H}/>
            <BoxSingle code="Y2" label={winnerOf('Z2') || `Winner Z2 — ${title}`} {...pos.Y2}  h={SMALL_H}/>

            <BoxAB     code="X1" {...pos.X1} />
            <BoxAB     code="X2" {...pos.X2} />
            <BoxSingle code="X3" label={winnerOf('X1') || `Winner X1 — ${title}`} {...pos.X3}  h={SMALL_H}/>
            <BoxSingle code="X4" label={winnerOf('X2') || `Winnere X2 — ${title}`} {...pos.X4}  h={SMALL_H}/>

            <BoxSingle code="Q1" label={loserOf('Z1') || `Loser Z1 — ${title}`} {...pos.Q1}  h={SMALL_H}/>
            <BoxSingle code="Q2" label={loserOf('Z2') || `Loser Z2 — ${title}`} {...pos.Q2}  h={SMALL_H}/>

            <BoxAB     code="W1" {...pos.W1} />
            <BoxAB     code="W2" {...pos.W2} />

            <BoxAB     code="CO1" {...pos.CO1} />
            <BoxAB     code="CO2" {...pos.CO2} />
            <BoxAB     code="F"   {...pos.F} />
            <BoxSingle code="VINCITORE TORNEO" label={winnerOf('F') || 'Winner Final'} {...pos.WIN} h={SMALL_H} />
            <BoxAB     code="THIRD" {...pos.THIRD} />

            {/* LINEE */}
            <svg className="absolute top-0 left-0 pointer-events-none" width={left1+dx*6} height={1080} style={{ overflow:'visible' }}>
              {/* R1/R2 -> Z1 */}
              <HLine x1={R('R1')} y={C('R1')} x2={(L('Z1')+R('R1'))/2} color={bracket.color}/>
              <VLine x={(L('Z1')+R('R1'))/2} y1={C('R1')} y2={C('Z1')} color={bracket.color}/>
              <HLine x1={(L('Z1')+R('R1'))/2} y={C('Z1')} x2={L('Z1')} color={bracket.color}/>
              <HLine x1={R('R2')} y={C('R2')} x2={(L('Z1')+R('R2'))/2} color={bracket.color}/>
              <VLine x={(L('Z1')+R('R2'))/2} y1={C('R2')} y2={C('Z1')} color={bracket.color}/>

              {/* R3/R4 -> Z2 */}
              <HLine x1={R('R3')} y={C('R3')} x2={(L('Z2')+R('R3'))/2} color={bracket.color}/>
              <VLine x={(L('Z2')+R('R3'))/2} y1={C('R3')} y2={C('Z2')} color={bracket.color}/>
              <HLine x1={(L('Z2')+R('R3'))/2} y={C('Z2')} x2={L('Z2')} color={bracket.color}/>
              <HLine x1={R('R4')} y={C('R4')} x2={(L('Z2')+R('R4'))/2} color={bracket.color}/>
              <VLine x={(L('Z2')+R('R4'))/2} y1={C('R4')} y2={C('Z2')} color={bracket.color}/>

              {/* Z1->Y1, Z2->Y2 */}
              <HLine x1={R('Z1')} y={C('Z1')} x2={(L('Y1')+R('Z1'))/2} color={bracket.color}/>
              <VLine x={(L('Y1')+R('Z1'))/2} y1={C('Z1')} y2={C('Y1')} color={bracket.color}/>
              <HLine x1={(L('Y1')+R('Z1'))/2} y={C('Y1')} x2={L('Y1')} color={bracket.color}/>
              <HLine x1={R('Z2')} y={C('Z2')} x2={(L('Y2')+R('Z2'))/2} color={bracket.color}/>
              <VLine x={(L('Y2')+R('Z2'))/2} y1={C('Z2')} y2={C('Y2')} color={bracket.color}/>
              <HLine x1={(L('Y2')+R('Z2'))/2} y={C('Y2')} x2={L('Y2')} color={bracket.color}/>

              {/* X1->X3, X2->X4 */}
              <HLine x1={R('X1')} y={C('X1')} x2={(L('X3')+R('X1'))/2} color={bracket.color}/>
              <VLine x={(L('X3')+R('X1'))/2} y1={C('X1')} y2={C('X3')} color={bracket.color}/>
              <HLine x1={(L('X3')+R('X1'))/2} y={C('X3')} x2={L('X3')} color={bracket.color}/>
              <HLine x1={R('X2')} y={C('X2')} x2={(L('X4')+R('X2'))/2} color={bracket.color}/>
              <VLine x={(L('X4')+R('X2'))/2} y1={C('X2')} y2={C('X4')} color={bracket.color}/>
              <HLine x1={(L('X4')+R('X2'))/2} y={C('X4')} x2={L('X4')} color={bracket.color}/>

              {/* Q1->W1, X3->W1 */}
              <HLine x1={R('Q1')} y={C('Q1')} x2={(L('W1')+R('Q1'))/2} color={bracket.color}/>
              <VLine x={(L('W1')+R('Q1'))/2} y1={C('Q1')} y2={C('W1')} color={bracket.color}/>
              <HLine x1={(L('W1')+R('Q1'))/2} y={C('W1')} x2={L('W1')} color={bracket.color}/>
              <HLine x1={R('X3')} y={C('X3')} x2={(L('W1')+R('X3'))/2 + 0} color={bracket.color}/>
              <VLine x={(L('W1')+R('X3'))/2 + 0} y1={C('X3')} y2={C('W1')} color={bracket.color}/>
              <HLine x1={(L('W1')+R('X3'))/2 + 0} y={C('W1')} x2={L('W1')} color={bracket.color}/>

              {/* Q2->W2, X4->W2 */}
              <HLine x1={R('Q2')} y={C('Q2')} x2={(L('W2')+R('Q2'))/2} color={bracket.color}/>
              <VLine x={(L('W2')+R('Q2'))/2} y1={C('Q2')} y2={C('W2')} color={bracket.color}/>
              <HLine x1={(L('W2')+R('Q2'))/2} y={C('W2')} x2={L('W2')} color={bracket.color}/>
              <HLine x1={R('X4')} y={C('X4')} x2={(L('W2')+R('X4'))/2 + 0} color={bracket.color}/>
              <VLine x={(L('W2')+R('X4'))/2 + 0} y1={C('X4')} y2={C('W2')} color={bracket.color}/>
              <HLine x1={(L('W2')+R('X4'))/2 + 0} y={C('W2')} x2={L('W2')} color={bracket.color}/>

             {/* CO1/CO2 -> F  e  F -> WIN */}
{(() => {
  const midCO1 = (L('F') + R('CO1')) / 2
  const midCO2 = (L('F') + R('CO2')) / 2

  return (
    <>
      {/* CO1 -> F */}
      <HLine x1={R('CO1')} y={C('CO1')} x2={midCO1} color={bracket.color}/>
      <VLine x={midCO1} y1={C('CO1')} y2={C('F')} color={bracket.color}/>
      <HLine x1={midCO1} y={C('F')} x2={L('F')} color={bracket.color}/>

      {/* CO2 -> F */}
      <HLine x1={R('CO2')} y={C('CO2')} x2={midCO2} color={bracket.color}/>
      <VLine x={midCO2} y1={C('CO2')} y2={C('F')} color={bracket.color}/>
      <HLine x1={midCO2} y={C('F')} x2={L('F')} color={bracket.color}/>

      {/* F -> WIN (dal bordo destro di F) */}
      <HLine x1={R('F')} y={C('F')} x2={L('WIN')} color={bracket.color}/>
    </>
  )
})()}

            </svg>
          </div>
        </div>
      </div>
    )
  }

 /* ===================== ITA (placeholder) ===================== */
if (bracket.type === 'ITA') {
  return (
  <div className="bracket-scope p-6 text-sm text-neutral-400">
      Modalità “Girone all’italiana”: l’editor è in questa pagina (sopra), non nel canvas.
    </div>
  )
}
}
