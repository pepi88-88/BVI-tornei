import { createClient } from '@supabase/supabase-js'
export function supabaseAdmin(){const u=process.env.NEXT_PUBLIC_SUPABASE_URL!, k=process.env.SUPABASE_SERVICE_ROLE_KEY!; if(!u||!k) throw new Error('ENV Supabase'); return createClient(u,k,{auth:{persistSession:false}})}
