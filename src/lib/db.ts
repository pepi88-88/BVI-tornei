// src/lib/db.ts
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

export async function query(text: string, params?: any[]) {
  return pool.query(text, params)
}

export async function tx<T>(fn: (c: any) => Promise<T>) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const res = await fn(client)
    await client.query('COMMIT')
    return res
  } catch (e) {
    try { await client.query('ROLLBACK') } catch {}
    throw e
  } finally {
    client.release()
  }
}

export async function connect() {
  return pool.connect()
}

// 👉 AGGIUNGI QUESTE DUE RIGHE:
export const db = { query, tx, connect }   // named export (compat)
export default db                           // default export
