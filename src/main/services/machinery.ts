import { getDb, dbKind } from '../db'
import type {
  MachineLog,
  AssetDocument,
  AssetDocType,
  MachineBalanceSheet,
  MeterType
} from '@shared/types'
import { properCase } from '@shared/types'
import { avgDieselRate } from './diesel'

function money(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100
}
function round3(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 1000) / 1000
}

/* ---------------- Machine logbook (meter readings + work) ---------------- */

export interface MachineLogInput {
  id?: number
  asset_id: number
  date: string
  work_type?: string
  opening_meter?: number
  closing_meter?: number
  fuel_litres?: number | null
  rate?: number | null
  remarks?: string
}

export async function listMachineLogs(payload: {
  asset_id: number
  from?: string
  to?: string
}): Promise<MachineLog[]> {
  const d = getDb()
  const where = ['ml.asset_id = @asset_id']
  const params: Record<string, unknown> = { asset_id: payload.asset_id }
  if (payload.from) {
    where.push('ml.date >= @from')
    params.from = payload.from
  }
  if (payload.to) {
    where.push('ml.date <= @to')
    params.to = payload.to
  }
  return (await d
    .prepare(
      `SELECT ml.*, a.name AS asset_name FROM machine_logs ml
       JOIN assets a ON a.id = ml.asset_id
       WHERE ${where.join(' AND ')}
       ORDER BY ml.date DESC, ml.id DESC`
    )
    .all(params)) as MachineLog[]
}

function normalizeLog(p: MachineLogInput): {
  work_type: string
  opening: number
  closing: number
  usage: number
  fuel: number | null
  rate: number | null
  amount: number | null
} {
  const opening = Number(p.opening_meter) || 0
  const closing = Number(p.closing_meter) || 0
  if (closing < opening) throw new Error('Closing meter cannot be less than the opening meter.')
  const fuel = p.fuel_litres == null || (p.fuel_litres as unknown) === '' ? null : Number(p.fuel_litres)
  if (fuel != null && fuel < 0) throw new Error('Fuel cannot be negative.')
  const rate = p.rate == null || (p.rate as unknown) === '' ? null : Number(p.rate)
  if (rate != null && rate < 0) throw new Error('Rate cannot be negative.')
  const usage = round3(closing - opening)
  return {
    work_type: properCase(p.work_type || ''),
    opening: round3(opening),
    closing: round3(closing),
    usage,
    fuel: fuel == null ? null : round3(fuel),
    rate: rate == null ? null : round3(rate),
    amount: rate == null ? null : money(usage * rate)
  }
}

export async function addMachineLog(p: MachineLogInput): Promise<MachineLog> {
  const d = getDb()
  if (!p.asset_id) throw new Error('Select a machine.')
  if (!p.date) throw new Error('Date is required.')
  const n = normalizeLog(p)
  const info = await d
    .prepare(
      `INSERT INTO machine_logs (asset_id, date, work_type, opening_meter, closing_meter, usage_qty, fuel_litres, rate, amount, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(p.asset_id, p.date, n.work_type, n.opening, n.closing, n.usage, n.fuel, n.rate, n.amount, p.remarks ?? '')
  return (await d.prepare(`SELECT * FROM machine_logs WHERE id = ?`).get(info.lastInsertRowid)) as MachineLog
}

export async function updateMachineLog(p: MachineLogInput): Promise<MachineLog> {
  const d = getDb()
  if (!p.id) throw new Error('Missing log id.')
  if (!p.date) throw new Error('Date is required.')
  const n = normalizeLog(p)
  await d
    .prepare(
      `UPDATE machine_logs SET date=?, work_type=?, opening_meter=?, closing_meter=?, usage_qty=?, fuel_litres=?, rate=?, amount=?, remarks=? WHERE id=?`
    )
    .run(p.date, n.work_type, n.opening, n.closing, n.usage, n.fuel, n.rate, n.amount, p.remarks ?? '', p.id)
  return (await d.prepare(`SELECT * FROM machine_logs WHERE id = ?`).get(p.id)) as MachineLog
}

export async function deleteMachineLog(payload: { id: number }): Promise<{ ok: boolean }> {
  await getDb().prepare(`DELETE FROM machine_logs WHERE id = ?`).run(payload.id)
  return { ok: true }
}

/* ---------------- Machine balance sheet ---------------- */

export async function machineBalanceSheet(payload: {
  asset_id: number
  from?: string
  to?: string
}): Promise<MachineBalanceSheet> {
  const d = getDb()
  const a = (await d
    .prepare(
      `SELECT a.name, a.meter_type, a.standard_consumption, b.name AS business_name
       FROM assets a LEFT JOIN businesses b ON b.id = a.business_id WHERE a.id = ?`
    )
    .get(payload.asset_id)) as
    | { name: string; meter_type: MeterType; standard_consumption: number | null; business_name: string | null }
    | undefined
  if (!a) throw new Error('Machine not found.')

  // Build a reusable date filter for any table with a `date` column.
  const dateClause = (alias: string): { sql: string; params: Record<string, unknown> } => {
    const parts: string[] = []
    const params: Record<string, unknown> = {}
    if (payload.from) {
      parts.push(`${alias}.date >= @from`)
      params.from = payload.from
    }
    if (payload.to) {
      parts.push(`${alias}.date <= @to`)
      params.to = payload.to
    }
    return { sql: parts.length ? ' AND ' + parts.join(' AND ') : '', params }
  }

  // Logbook usage + fuel.
  const dl = dateClause('ml')
  const logAgg = (await d
    .prepare(
      `SELECT COALESCE(SUM(usage_qty),0) AS usage_qty,
              COALESCE(SUM(CASE WHEN fuel_litres IS NOT NULL THEN fuel_litres ELSE 0 END),0) AS log_fuel,
              SUM(CASE WHEN fuel_litres IS NOT NULL THEN 1 ELSE 0 END) AS fuel_rows,
              COALESCE(SUM(CASE WHEN amount IS NOT NULL THEN amount ELSE 0 END),0) AS run_income,
              MIN(opening_meter) AS min_open, MAX(closing_meter) AS max_close
       FROM machine_logs ml WHERE ml.asset_id = @asset_id${dl.sql}`
    )
    .get({ asset_id: payload.asset_id, ...dl.params })) as {
    usage_qty: number
    log_fuel: number
    fuel_rows: number
    run_income: number
    min_open: number | null
    max_close: number | null
  }

  // Diesel issued (fallback fuel source).
  const di = dateClause('di')
  const dieselLitres = (
    (await d
      .prepare(
        `SELECT COALESCE(SUM(litres),0) AS q FROM diesel_issues di WHERE di.asset_id = @asset_id${di.sql}`
      )
      .get({ asset_id: payload.asset_id, ...di.params })) as { q: number }
  ).q

  // Fuel: prefer logbook entries when present, else fall back to diesel.
  let fuel = 0
  let fuelSource: MachineBalanceSheet['fuel_source'] = 'none'
  if (logAgg.fuel_rows > 0) {
    fuel = logAgg.log_fuel
    fuelSource = 'logbook'
  } else if (dieselLitres > 0) {
    fuel = dieselLitres
    fuelSource = 'diesel'
  }

  const usage = round3(logAgg.usage_qty)
  const rate = await avgDieselRate()
  // Fuel COST is the diesel actually issued to this machine (× avg rate) — this matches the
  // machine ledger. The logbook `fuel`/`fuelSource` above drives only the consumption check.
  const dieselCost = money(dieselLitres * rate)

  // Costs from plant expenses + wages (date-filtered).
  const pe = dateClause('pe')
  const exp = (await d
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN category='maintenance' THEN amount ELSE 0 END),0) AS maintenance,
        COALESCE(SUM(CASE WHEN category IN ('tipper_rent','equipment_rent') THEN amount ELSE 0 END),0) AS rent,
        COALESCE(SUM(CASE WHEN category NOT IN ('maintenance','tipper_rent','equipment_rent') THEN amount ELSE 0 END),0) AS other
       FROM plant_expenses pe WHERE pe.asset_id = @asset_id${pe.sql}`
    )
    .get({ asset_id: payload.asset_id, ...pe.params })) as {
    maintenance: number
    rent: number
    other: number
  }
  const we = dateClause('we')
  const wages = (
    (await d
      .prepare(`SELECT COALESCE(SUM(amount),0) AS q FROM wage_entries we WHERE we.asset_id = @asset_id${we.sql}`)
      .get({ asset_id: payload.asset_id, ...we.params })) as { q: number }
  ).q

  const totalCost = money(dieselCost + exp.maintenance + exp.other + wages)
  const runIncome = money(logAgg.run_income)
  const totalIncome = money(exp.rent + runIncome)
  return {
    asset_id: payload.asset_id,
    asset_name: a.name,
    meter_type: a.meter_type === 'km' ? 'km' : 'hour',
    business_name: a.business_name,
    from: payload.from ?? '',
    to: payload.to ?? '',
    usage_qty: usage,
    fuel_litres: round3(fuel),
    fuel_source: fuelSource,
    actual_consumption: usage > 0 ? round3(fuel / usage) : null,
    standard_consumption: a.standard_consumption ?? null,
    opening_meter: logAgg.min_open,
    closing_meter: logAgg.max_close,
    diesel_cost: dieselCost,
    maintenance: money(exp.maintenance),
    other_expense: money(exp.other),
    wages: money(wages),
    rent_income: money(exp.rent),
    run_income: runIncome,
    total_income: totalIncome,
    total_cost: totalCost,
    net: money(totalIncome - totalCost),
    cost_per_unit: usage > 0 ? money(totalCost / usage) : null
  }
}

/** Cross-machine mileage / consumption report: standard vs actual per asset. */
export interface MileageRow {
  asset_id: number
  asset_name: string
  asset_type: string
  meter_type: MeterType
  usage_qty: number
  fuel_litres: number
  actual_consumption: number | null
  standard_consumption: number | null
  over: boolean
}
export async function mileageReport(payload: {
  from?: string
  to?: string
  asset_type?: string
}): Promise<MileageRow[]> {
  const d = getDb()
  const typeClause = payload.asset_type === 'machine' || payload.asset_type === 'vehicle' ? ' AND a.asset_type = @atype' : ''
  const assets = (await d
    .prepare(
      `SELECT a.id, a.name, a.asset_type, a.meter_type, a.standard_consumption
       FROM assets a WHERE a.status = 'active'${typeClause} ORDER BY a.asset_type, a.name`
    )
    .all(payload.asset_type ? { atype: payload.asset_type } : {})) as {
    id: number
    name: string
    asset_type: string
    meter_type: MeterType
    standard_consumption: number | null
  }[]
  const rows: MileageRow[] = []
  for (const a of assets) {
    const bs = await machineBalanceSheet({ asset_id: a.id, from: payload.from, to: payload.to })
    if (bs.usage_qty <= 0 && bs.fuel_litres <= 0) continue
    rows.push({
      asset_id: a.id,
      asset_name: a.name,
      asset_type: a.asset_type,
      meter_type: a.meter_type === 'km' ? 'km' : 'hour',
      usage_qty: bs.usage_qty,
      fuel_litres: bs.fuel_litres,
      actual_consumption: bs.actual_consumption,
      standard_consumption: bs.standard_consumption,
      over:
        bs.actual_consumption != null &&
        bs.standard_consumption != null &&
        bs.actual_consumption > bs.standard_consumption
    })
  }
  return rows
}

/** All logbook entries across machines (for the cross-machine logbook page). */
export async function listAllLogs(payload: { from?: string; to?: string; asset_id?: number } = {}): Promise<MachineLog[]> {
  const d = getDb()
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (payload.asset_id) {
    where.push('ml.asset_id = @asset_id')
    params.asset_id = payload.asset_id
  }
  if (payload.from) {
    where.push('ml.date >= @from')
    params.from = payload.from
  }
  if (payload.to) {
    where.push('ml.date <= @to')
    params.to = payload.to
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  return (await d
    .prepare(
      `SELECT ml.*, a.name AS asset_name FROM machine_logs ml
       JOIN assets a ON a.id = ml.asset_id ${clause}
       ORDER BY ml.date DESC, ml.id DESC`
    )
    .all(params)) as MachineLog[]
}

/* ---------------- Documents + insurance/expiry reminders ---------------- */

const DOC_TYPES: AssetDocType[] = ['insurance', 'permit', 'fitness', 'puc', 'rc', 'tax', 'other']

export interface AssetDocumentInput {
  id?: number
  asset_id: number
  doc_type?: AssetDocType
  number?: string
  issue_date?: string | null
  expiry_date?: string | null
  file_data?: string | null
  remarks?: string
}

export async function listAssetDocuments(payload: { asset_id: number }): Promise<AssetDocument[]> {
  const d = getDb()
  const rows = (await d
    .prepare(`SELECT * FROM asset_documents WHERE asset_id = ? ORDER BY expiry_date IS NULL, expiry_date, id`)
    .all(payload.asset_id)) as AssetDocument[]
  return rows.map((r) => ({ ...r, ...reminderFields(r.expiry_date) }))
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}
function reminderFields(expiry: string | null): { days_left: number | null; reminder_status: AssetDocument['reminder_status'] } {
  if (!expiry) return { days_left: null, reminder_status: 'ok' }
  const ms = new Date(expiry + 'T00:00:00').getTime() - new Date(todayStr() + 'T00:00:00').getTime()
  const days = Math.round(ms / 86_400_000)
  return { days_left: days, reminder_status: days < 0 ? 'expired' : 'ok' }
}

function normalizeDoc(p: AssetDocumentInput): {
  doc_type: AssetDocType
  number: string
  issue_date: string | null
  expiry_date: string | null
  file_data: string | null
} {
  const file = (p.file_data ?? '').trim()
  if (file && !file.startsWith('data:')) throw new Error('Attachment must be a file.')
  if (file.length > 6_000_000) throw new Error('Attachment is too large — use a smaller file.')
  return {
    doc_type: DOC_TYPES.includes(p.doc_type as AssetDocType) ? (p.doc_type as AssetDocType) : 'other',
    number: (p.number ?? '').trim().toUpperCase(),
    issue_date: p.issue_date || null,
    expiry_date: p.expiry_date || null,
    file_data: file || null
  }
}

export async function addAssetDocument(p: AssetDocumentInput): Promise<{ ok: boolean; error?: string }> {
  const d = getDb()
  if (!p.asset_id) return { ok: false, error: 'Select a machine.' }
  try {
    const n = normalizeDoc(p)
    await d
      .prepare(
        `INSERT INTO asset_documents (asset_id, doc_type, number, issue_date, expiry_date, file_data, remarks)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(p.asset_id, n.doc_type, n.number, n.issue_date, n.expiry_date, n.file_data, p.remarks ?? '')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function updateAssetDocument(p: AssetDocumentInput): Promise<{ ok: boolean; error?: string }> {
  const d = getDb()
  if (!p.id) return { ok: false, error: 'Missing document id.' }
  try {
    const n = normalizeDoc(p)
    await d
      .prepare(
        `UPDATE asset_documents SET doc_type=?, number=?, issue_date=?, expiry_date=?, file_data=?, remarks=? WHERE id=?`
      )
      .run(n.doc_type, n.number, n.issue_date, n.expiry_date, n.file_data, p.remarks ?? '', p.id)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function deleteAssetDocument(payload: { id: number }): Promise<{ ok: boolean }> {
  await getDb().prepare(`DELETE FROM asset_documents WHERE id = ?`).run(payload.id)
  return { ok: true }
}

/** Documents that are expired or expiring within the reminder window. */
export async function getDocumentReminders(payload: { days?: number } = {}): Promise<AssetDocument[]> {
  const d = getDb()
  const days = payload.days != null ? Number(payload.days) : await getReminderDays()
  const rows = (await d
    .prepare(
      `SELECT ad.id, ad.asset_id, ad.doc_type, ad.number, ad.issue_date, ad.expiry_date, ad.remarks, ad.created_at,
              a.name AS asset_name
       FROM asset_documents ad JOIN assets a ON a.id = ad.asset_id
       WHERE ad.expiry_date IS NOT NULL AND ad.expiry_date <> ''
       ORDER BY ad.expiry_date`
    )
    .all()) as AssetDocument[]
  return rows
    .map((r) => {
      const f = reminderFields(r.expiry_date)
      const status = f.days_left == null ? 'ok' : f.days_left < 0 ? 'expired' : f.days_left <= days ? 'due' : 'ok'
      return { ...r, days_left: f.days_left, reminder_status: status as AssetDocument['reminder_status'] }
    })
    .filter((r) => r.reminder_status !== 'ok')
}

/* ---------------- Reminder lead-time setting ---------------- */

async function putSetting(key: string, value: string): Promise<void> {
  const sql =
    dbKind() === 'mysql'
      ? 'INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)'
      : 'INSERT INTO settings (`key`, value) VALUES (?, ?) ON CONFLICT(`key`) DO UPDATE SET value = excluded.value'
  await getDb().prepare(sql).run(key, value)
}

export async function getReminderDays(): Promise<number> {
  const row = (await getDb()
    .prepare('SELECT value FROM settings WHERE `key` = ?')
    .get('reminder_days')) as { value: string } | undefined
  const n = Number(row?.value)
  return Number.isFinite(n) && n > 0 ? n : 30
}

export async function getReminderSettings(): Promise<{ days: number }> {
  return { days: await getReminderDays() }
}

export async function setReminderDays(payload: { days: number }): Promise<{ ok: boolean }> {
  const n = Math.max(1, Math.round(Number(payload.days) || 30))
  await putSetting('reminder_days', String(n))
  return { ok: true }
}
