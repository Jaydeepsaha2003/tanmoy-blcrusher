import { getDb, dbKind } from '../db'
import { verifyPassword } from '../crypto'
import { getCurrentUser } from '../context'

// Data deletion is scheduled, not immediate: it runs 3 days after the admin
// requests it, leaving a grace period to cancel.
const DELETE_DELAY_MS = 3 * 24 * 60 * 60 * 1000

async function getSetting(key: string): Promise<string | null> {
  const row = (await getDb().prepare('SELECT value FROM settings WHERE `key` = ?').get(key)) as
    | { value: string }
    | undefined
  return row?.value ?? null
}
async function setSetting(key: string, value: string): Promise<void> {
  const sql =
    dbKind() === 'mysql'
      ? 'INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)'
      : 'INSERT INTO settings (`key`, value) VALUES (?, ?) ON CONFLICT(`key`) DO UPDATE SET value = excluded.value'
  await getDb().prepare(sql).run(key, value)
}
async function delSetting(key: string): Promise<void> {
  await getDb().prepare('DELETE FROM settings WHERE `key` = ?').run(key)
}

const DATA_TABLES = [
  'spare_part_movements',
  'production_outputs',
  'productions',
  'rack_sales',
  'rack_expenses',
  'rack_unloadings',
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
  'spare_parts',
  'assets',
  'stock_locations',
  'racks',
  'expense_types',
  'businesses',
  'outsource',
  'companies',
  'customers',
  'suppliers',
  'transporters',
  'plants',
  'counters'
]

/** Clear all business data (keeps users, settings, sessions). Internal. */
async function clearAllData(): Promise<void> {
  const d = getDb()
  await d.transaction(async () => {
    for (const t of DATA_TABLES) await d.prepare(`DELETE FROM ${t}`).run()
  })
  if (dbKind() === 'sqlite') await getDb().run('VACUUM')
}

/** Admin requests deletion; scheduled for 3 days later (verifies their password). */
export async function requestDataDeletion(payload: { password: string }): Promise<{
  ok: boolean
  error?: string
  scheduled_at?: number
}> {
  const me = getCurrentUser()
  if (!me) return { ok: false, error: 'Not signed in.' }
  const row = (await getDb().prepare('SELECT password_hash FROM users WHERE id = ?').get(me.id)) as
    | { password_hash: string }
    | undefined
  if (!row || !verifyPassword(payload.password ?? '', row.password_hash)) {
    return { ok: false, error: 'Password is incorrect.' }
  }
  const scheduled = Date.now() + DELETE_DELAY_MS
  await setSetting('delete_scheduled_at', String(scheduled))
  await setSetting('delete_requested_by', me.username)
  await setSetting('delete_requested_at', String(Date.now()))
  return { ok: true, scheduled_at: scheduled }
}

export async function cancelDataDeletion(): Promise<{ ok: boolean }> {
  await delSetting('delete_scheduled_at')
  await delSetting('delete_requested_by')
  await delSetting('delete_requested_at')
  return { ok: true }
}

export async function deletionStatus(): Promise<{
  scheduled_at: number | null
  requested_by: string | null
  requested_at: number | null
}> {
  const at = await getSetting('delete_scheduled_at')
  const reqAt = await getSetting('delete_requested_at')
  return {
    scheduled_at: at ? Number(at) : null,
    requested_by: await getSetting('delete_requested_by'),
    requested_at: reqAt ? Number(reqAt) : null
  }
}

/** Execute the wipe if a scheduled deletion is now due. Called on boot/interval/activity. */
export async function maybeRunScheduledDeletion(): Promise<boolean> {
  const at = await getSetting('delete_scheduled_at')
  if (at && Number(at) <= Date.now()) {
    await clearAllData()
    await cancelDataDeletion()
    return true
  }
  return false
}

/* ---------------- Workday (payroll) settings ---------------- */

/** Weekly off days (0 = Sunday … 6 = Saturday). Default: Sunday off. */
export async function getWorkdaySettings(): Promise<{ weekly_offs: number[] }> {
  const v = await getSetting('weekly_offs')
  if (!v) return { weekly_offs: [0] }
  try {
    const arr = JSON.parse(v)
    return { weekly_offs: Array.isArray(arr) ? arr : [0] }
  } catch {
    return { weekly_offs: [0] }
  }
}

export async function setWorkdaySettings(payload: { weekly_offs: number[] }): Promise<{ ok: boolean }> {
  await setSetting('weekly_offs', JSON.stringify(payload.weekly_offs ?? []))
  return { ok: true }
}
