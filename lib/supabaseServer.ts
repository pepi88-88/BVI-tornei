import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export function supabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Config Supabase mancante (.env.local)')
  return createClient(url, key, { auth: { persistSession: false } })
}
