import { getDb, nextNumber, type Db } from '../db'
import type { DieselPurchase, DieselIssue, DieselStock, PaymentStatus } from '@shared/types'
import { derivePaymentStatus } from '@shared/types'

function money(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
function litres(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** Diesel litre stock for a plant (or all plants) = purchased − issued. */
export async function dieselStock(payload: { plant_id?: number } = {}): Promise<DieselStock> {
  return stockOf(getDb(), payload.plant_id)
}

/** Average purchase rate per litre across all priced diesel purchases (for valuing issues). */
export async function avgDieselRate(): Promise<number> {
  const r = (await getDb()
    .prepare(
      `SELECT COALESCE(SUM(amount),0) AS amt, COALESCE(SUM(litres),0) AS lit
       FROM diesel_purchases WHERE amount IS NOT NULL`
    )
    .get()) as { amt: number; lit: number }
  return r.lit > 0 ? r.amt / r.lit : 0
}

async function stockOf(d: Db, plantId?: number): Promise<DieselStock> {
  const pAnd = plantId ? ' WHERE plant_id = @pid' : ''
  const p = (
    (await d.prepare(`SELECT COALESCE(SUM(litres),0) AS q FROM diesel_purchases${pAnd}`).get({ pid: plantId })) as {
      q: number
    }
  ).q
  const i = (
    (await d.prepare(`SELECT COALESCE(SUM(litres),0) AS q FROM diesel_issues${pAnd}`).get({ pid: plantId })) as {
      q: number
    }
  ).q
  return { purchased: litres(p), issued: litres(i), balance: litres(p - i) }
}

/* ---------------- Purchases (from creditor) ---------------- */

export interface PurchaseFilter {
  plant_id?: number
  supplier_id?: number
  from?: string
  to?: string
}

export async function listDieselPurchases(filter: PurchaseFilter = {}): Promise<DieselPurchase[]> {
  const d = getDb()
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (filter.plant_id) {
    where.push('dp.plant_id = @plant_id')
    params.plant_id = filter.plant_id
  }
  if (filter.supplier_id) {
    where.push('dp.supplier_id = @supplier_id')
    params.supplier_id = filter.supplier_id
  }
  if (filter.from) {
    where.push('dp.date >= @from')
    params.from = filter.from
  }
  if (filter.to) {
    where.push('dp.date <= @to')
    params.to = filter.to
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  return (await d
    .prepare(
      `SELECT dp.*, s.name AS supplier_name, p.name AS plant_name
       FROM diesel_purchases dp
       JOIN suppliers s ON s.id = dp.supplier_id
       JOIN plants p ON p.id = dp.plant_id
       ${clause}
       ORDER BY dp.date DESC, dp.id DESC`
    )
    .all(params)) as DieselPurchase[]
}

export interface DieselPurchaseInput {
  id?: number
  supplier_id: number
  plant_id: number
  litres: number
  rate: number | null
  payment_status: PaymentStatus
  paid_amount?: number
  date: string
  remarks: string
}

function purchaseFields(p: DieselPurchaseInput): Record<string, unknown> {
  if (!(Number(p.litres) > 0)) throw new Error('Litres must be greater than 0.')
  const rate = p.rate == null || (p.rate as unknown) === '' ? null : Number(p.rate)
  const amount = rate == null ? null : money(Number(p.litres) * rate)
  const paid = money(Number(p.paid_amount) || 0)
  return {
    supplier_id: p.supplier_id,
    plant_id: p.plant_id,
    litres: litres(Number(p.litres)),
    rate,
    amount,
    payment_status: derivePaymentStatus(amount ?? 0, paid),
    paid_amount: paid,
    date: p.date,
    remarks: p.remarks ?? ''
  }
}

export async function createDieselPurchase(p: DieselPurchaseInput): Promise<DieselPurchase> {
  const d = getDb()
  const fields = purchaseFields(p)
  const no = await nextNumber('DSL', 'diesel_purchase')
  const info = await d
    .prepare(
      `INSERT INTO diesel_purchases
        (purchase_no, supplier_id, plant_id, litres, rate, amount, payment_status, paid_amount, date, remarks)
       VALUES (@purchase_no,@supplier_id,@plant_id,@litres,@rate,@amount,@payment_status,@paid_amount,@date,@remarks)`
    )
    .run({ purchase_no: no, ...fields })
  return (await d.prepare(`SELECT * FROM diesel_purchases WHERE id = ?`).get(info.lastInsertRowid)) as DieselPurchase
}

export async function updateDieselPurchase(p: DieselPurchaseInput): Promise<DieselPurchase> {
  const d = getDb()
  if (!p.id) throw new Error('Missing purchase id.')
  const fields = purchaseFields(p)
  await d.transaction(async () => {
    await d.prepare(
      `UPDATE diesel_purchases SET supplier_id=@supplier_id, plant_id=@plant_id, litres=@litres, rate=@rate,
         amount=@amount, payment_status=@payment_status, paid_amount=@paid_amount, date=@date, remarks=@remarks
       WHERE id=@id`
    ).run({ id: p.id, ...fields })
    if ((await stockOf(d, Number(fields.plant_id))).balance < 0)
      throw new Error('Edit would make diesel stock negative (more issued than purchased).')
  })
  return (await d.prepare(`SELECT * FROM diesel_purchases WHERE id = ?`).get(p.id)) as DieselPurchase
}

export async function deleteDieselPurchase(payload: {
  id: number
}): Promise<{ ok: boolean; error?: string }> {
  const d = getDb()
  const old = (await d.prepare(`SELECT * FROM diesel_purchases WHERE id = ?`).get(payload.id)) as
    | DieselPurchase
    | undefined
  if (!old) return { ok: false, error: 'Purchase not found.' }
  try {
    await d.transaction(async () => {
      await d.prepare(`DELETE FROM diesel_purchases WHERE id = ?`).run(payload.id)
      if ((await stockOf(d, old.plant_id)).balance < 0)
        throw new Error('Cannot delete: diesel from this purchase has already been issued.')
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/* ---------------- Issues (to machines / vehicles) ---------------- */

export interface IssueFilter {
  plant_id?: number
  asset_id?: number
  from?: string
  to?: string
}

export async function listDieselIssues(filter: IssueFilter = {}): Promise<DieselIssue[]> {
  const d = getDb()
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (filter.plant_id) {
    where.push('di.plant_id = @plant_id')
    params.plant_id = filter.plant_id
  }
  if (filter.asset_id) {
    where.push('di.asset_id = @asset_id')
    params.asset_id = filter.asset_id
  }
  if (filter.from) {
    where.push('di.date >= @from')
    params.from = filter.from
  }
  if (filter.to) {
    where.push('di.date <= @to')
    params.to = filter.to
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  return (await d
    .prepare(
      `SELECT di.*, p.name AS plant_name, a.name AS asset_name
       FROM diesel_issues di
       JOIN plants p ON p.id = di.plant_id
       LEFT JOIN assets a ON a.id = di.asset_id
       ${clause}
       ORDER BY di.date DESC, di.id DESC`
    )
    .all(params)) as DieselIssue[]
}

export interface DieselIssueInput {
  id?: number
  plant_id: number
  asset_id: number | null
  litres: number
  date: string
  remarks: string
}

export async function createDieselIssue(p: DieselIssueInput): Promise<DieselIssue> {
  const d = getDb()
  if (!(Number(p.litres) > 0)) throw new Error('Litres must be greater than 0.')
  const available = (await stockOf(d, p.plant_id)).balance
  if (Number(p.litres) > available)
    throw new Error(`Not enough diesel in stock. Available: ${available} L, requested: ${p.litres} L.`)
  const no = await nextNumber('DIS', 'diesel_issue')
  const info = await d
    .prepare(
      `INSERT INTO diesel_issues (issue_no, plant_id, asset_id, litres, date, remarks)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(no, p.plant_id, p.asset_id ?? null, litres(Number(p.litres)), p.date, p.remarks ?? '')
  return (await d.prepare(`SELECT * FROM diesel_issues WHERE id = ?`).get(info.lastInsertRowid)) as DieselIssue
}

export async function updateDieselIssue(p: DieselIssueInput): Promise<DieselIssue> {
  const d = getDb()
  if (!p.id) throw new Error('Missing issue id.')
  if (!(Number(p.litres) > 0)) throw new Error('Litres must be greater than 0.')
  await d.transaction(async () => {
    await d.prepare(
      `UPDATE diesel_issues SET plant_id=?, asset_id=?, litres=?, date=?, remarks=? WHERE id=?`
    ).run(p.plant_id, p.asset_id ?? null, litres(Number(p.litres)), p.date, p.remarks ?? '', p.id)
    if ((await stockOf(d, p.plant_id)).balance < 0)
      throw new Error('Edit would issue more diesel than is in stock.')
  })
  return (await d.prepare(`SELECT * FROM diesel_issues WHERE id = ?`).get(p.id)) as DieselIssue
}

export async function deleteDieselIssue(payload: { id: number }): Promise<{ ok: boolean }> {
  const d = getDb()
  await d.prepare(`DELETE FROM diesel_issues WHERE id = ?`).run(payload.id)
  return { ok: true }
}

/** Total litres issued per asset (for the consumption summary). */
export async function issuesByAsset(payload: { plant_id?: number } = {}): Promise<
  {
    asset_id: number | null
    asset_name: string
    litres: number
  }[]
> {
  const d = getDb()
  const clause = payload.plant_id ? 'WHERE di.plant_id = @plant_id' : ''
  return (await d
    .prepare(
      `SELECT di.asset_id, COALESCE(a.name, 'Unassigned') AS asset_name,
        ROUND(COALESCE(SUM(di.litres),0),2) AS litres
       FROM diesel_issues di LEFT JOIN assets a ON a.id = di.asset_id
       ${clause}
       GROUP BY di.asset_id ORDER BY litres DESC`
    )
    .all(payload)) as { asset_id: number | null; asset_name: string; litres: number }[]
}
