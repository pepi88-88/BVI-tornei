// app/auth/role.ts
'use client'
import * as React from 'react'

export type Role = 'admin' | 'coach' | 'athlete' | null

export function getRole(): Role {
  if (typeof window === 'undefined') return null
  return (localStorage.getItem('role') as Role) ?? null
}

export function setRole(r: Exclude<Role, null>) {
  if (typeof window === 'undefined') return
  localStorage.setItem('role', r)
}

export function clearRole() {
  if (typeof window === 'undefined') return
  localStorage.removeItem('role')
}

export function useRole() {
  const [role, set] = React.useState<Role>(getRole())
  React.useEffect(() => { set(getRole()) }, [])
  const change = (r: Exclude<Role, null>) => { setRole(r); set(r) }
  return { role, setRole: change, clearRole }
}
