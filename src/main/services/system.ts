import { getDb } from '../db'

/**
 * Permanently delete ALL business data. Requires the admin password.
 * Settings (including the admin password) are kept so the user stays logged in.
 * Children are cleared before parents to satisfy foreign keys; counters reset
 * so document numbering (PUR/PRD/DISP/RKL/SL) starts from 000001 again.
 */
export function wipeAllData(payload: { password: string }): { ok: boolean; error?: string } {
  const d = getDb()
  const row = d.prepare(`SELECT value FROM settings WHERE key = 'admin_password'`).get() as
    | { value: string }
    | undefined
  if (!row || row.value !== (payload.password ?? '')) {
    return { ok: false, error: 'Password is incorrect.' }
  }
  const tables = [
    'production_outputs',
    'productions',
    'rack_sales',
    'rack_expenses',
    'rack_loadings',
    'stock_movements',
    'dispatches',
    'purchases',
    'payments',
    'finished_goods_opening',
    'production_settings',
    'wage_entries',
    'employees',
    'diesel_issues',
    'diesel_purchases',
    'plant_expenses',
    'assets',
    'stock_locations',
    'racks',
    'expense_types',
    'customers',
    'suppliers',
    'transporters',
    'plants',
    'counters'
  ]
  const tx = d.transaction(() => {
    for (const t of tables) d.prepare(`DELETE FROM ${t}`).run()
  })
  tx()
  // Reclaim disk space (must run outside a transaction).
  d.exec('VACUUM')
  return { ok: true }
}

/* ---------------- Workday (payroll) settings ---------------- */

/** Weekly off days (0 = Sunday … 6 = Saturday). Default: Sunday off. */
export function getWorkdaySettings(): { weekly_offs: number[] } {
  const d = getDb()
  const row = d.prepare(`SELECT value FROM settings WHERE key = 'weekly_offs'`).get() as
    | { value: string }
    | undefined
  if (!row) return { weekly_offs: [0] }
  try {
    const arr = JSON.parse(row.value)
    return { weekly_offs: Array.isArray(arr) ? arr : [0] }
  } catch {
    return { weekly_offs: [0] }
  }
}

export function setWorkdaySettings(payload: { weekly_offs: number[] }): { ok: boolean } {
  const d = getDb()
  const value = JSON.stringify(payload.weekly_offs ?? [])
  d.prepare(
    `INSERT INTO settings (key, value) VALUES ('weekly_offs', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(value)
  return { ok: true }
}
