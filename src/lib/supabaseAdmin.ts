// src/lib/supabaseAdmin.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

export function getSupabaseAdmin(): SupabaseClient {
  if (client) return client

  // Preferisci var server, altrimenti fallback alle NEXT_PUBLIC per ambienti locali
  const url =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    // ⚠️ errore solo quando CERCHI di usare il client, non a import-time
    throw new Error('Supabase non configurato: definisci SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (o le NEXT_PUBLIC_*)')
  }

  client = createClient(url, key, { auth: { persistSession: false } })
  return client
}
// alias compat per il resto del codice
export const supabaseAdmin = getSupabaseAdmin()
