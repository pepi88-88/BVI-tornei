'use client'
import { ReactNode } from 'react'

type Props = {
  children: ReactNode
  minWidthPx?: number
  className?: string
}

/** Mantiene una larghezza “da desktop” e abilita lo scroll orizzontale su mobile. */
export default function ResponsiveDesktopTableWrapper({
  children,
  minWidthPx = 1200,
  className = '',
}: Props) {
  return (
    <div className={`overflow-x-auto -mx-4 sm:mx-0 ${className}`}>
      <div style={{ minWidth: `${minWidthPx}px` }} className="inline-block align-middle">
        {children}
      </div>
    </div>
  )
}
