'use client'

import * as React from 'react'
import AthleteClassificaPage from './ClassificaInner'

export default function ClassificaClient() {
  // Niente useSearchParams qui: lo userà direttamente ClassificaInner
  return <AthleteClassificaPage />
}
