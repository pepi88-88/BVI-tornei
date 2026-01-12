// app/atleta/classifica/page.tsx
'use client'
import { Suspense } from 'react'
import ClassificaInner from './ClassificaInner'

export default function Page() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-neutral-500">Carico…</div>}>
      <ClassificaInner />
    </Suspense>
  )
}
