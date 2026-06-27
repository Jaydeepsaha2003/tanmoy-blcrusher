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

/** Source of a diesel issuance, so an edit can exclude its own litres when recomputing. */
export type DieselSource = { src: 'issue' | 'loading' | 'unloading' | 'sale_transport'; id: number }

/** Total diesel litres issued from a plant across every source (issues + rack loadings/unloadings
 *  + rack-sale transport). Rack unloadings/sale transport carry no plant of their own, so they
 *  scope to the rack's source plant. */
async function issuedLitres(d: Db, plantId: number | undefined, exclude?: DieselSource): Promise<number> {
  const pid = plantId
  const ex = (src: string, col = 'id'): string =>
    exclude && exclude.src === src ? ` AND ${col} <> ${Number(exclude.id)}` : ''
  const issuesWhere = pid ? 'WHERE plant_id = @pid' : 'WHERE 1=1'
  const a = (await d.prepare(`SELECT COALESCE(SUM(litres),0) AS q FROM diesel_issues ${issuesWhere}${ex('issue')}`).get({ pid })) as { q: number }
  const b = (await d.prepare(`SELECT COALESCE(SUM(diesel_litres),0) AS q FROM rack_loadings ${issuesWhere}${ex('loading')}`).get({ pid })) as { q: number }
  const uWhere = pid ? 'WHERE r.plant_id = @pid' : 'WHERE 1=1'
  const c = (await d
    .prepare(`SELECT COALESCE(SUM(ru.diesel_litres),0) AS q FROM rack_unloadings ru JOIN racks r ON r.id = ru.rack_id ${uWhere}${ex('unloading', 'ru.id')}`)
    .get({ pid })) as { q: number }
  const e = (await d
    .prepare(
      `SELECT COALESCE(SUM(rst.diesel_litres),0) AS q FROM rack_sale_transporters rst
         JOIN rack_sales rs ON rs.id = rst.rack_sale_id JOIN racks r ON r.id = rs.rack_id ${uWhere}${ex('sale_transport', 'rst.id')}`
    )
    .get({ pid })) as { q: number }
  return litres((a.q || 0) + (b.q || 0) + (c.q || 0) + (e.q || 0))
}

async function stockOf(d: Db, plantId?: number): Promise<DieselStock> {
  const pAnd = plantId ? ' WHERE plant_id = @pid' : ''
  const p = (
    (await d.prepare(`SELECT COALESCE(SUM(litres),0) AS q FROM diesel_purchases${pAnd}`).get({ pid: plantId })) as {
      q: number
    }
  ).q
  const i = await issuedLitres(d, plantId)
  return { purchased: litres(p), issued: litres(i), balance: litres(p - i) }
}

/**
 * FIFO cost of issuing `qty` litres from a plant's diesel: walk the plant's purchase
 * layers oldest-first, skip the litres other issuances already consumed, then cost the
 * next `qty` litres at each layer's rate. Throws if `qty` exceeds available stock (block).
 */
export async function dieselFifoCost(
  d: Db,
  plantId: number,
  qty: number,
  exclude?: DieselSource
): Promise<{ amount: number; rate: number; available: number }> {
  const q = litres(Number(qty) || 0)
  const purchased = (
    (await d.prepare(`SELECT COALESCE(SUM(litres),0) AS q FROM diesel_purchases WHERE plant_id = @pid`).get({ pid: plantId })) as { q: number }
  ).q
  const prior = await issuedLitres(d, plantId, exclude)
  const available = litres(purchased - prior)
  if (q <= 0) return { amount: 0, rate: 0, available }
  if (q > available + 0.001)
    throw new Error(`Not enough diesel in stock for this plant. Available: ${available} L, requested: ${q} L.`)
  const layers = (await d
    .prepare(`SELECT litres, rate FROM diesel_purchases WHERE plant_id = @pid ORDER BY date, id`)
    .all({ pid: plantId })) as { litres: number; rate: number | null }[]
  let skip = prior
  let need = q
  let cost = 0
  for (const layer of layers) {
    let avail = Number(layer.litres) || 0
    if (skip > 0) {
      const s = Math.min(skip, avail)
      skip -= s
      avail -= s
    }
    if (avail <= 0 || need <= 0) continue
    const take = Math.min(avail, need)
    cost += take * (layer.rate ?? 0)
    need -= take
  }
  const amount = money(cost)
  return { amount, rate: q > 0 ? money(amount / q) : 0, available }
}

/** Live FIFO quote for a UI preview (amount/rate for `litres` at `plant_id`, excluding an edited record). */
export async function dieselFifoQuote(payload: {
  plant_id: number
  litres: number
  exclude?: DieselSource
}): Promise<{ amount: number; rate: number; available: number }> {
  if (!payload.plant_id) return { amount: 0, rate: 0, available: 0 }
  try {
    return await dieselFifoCost(getDb(), Number(payload.plant_id), Number(payload.litres) || 0, payload.exclude)
  } catch {
    // Over-stock: still report availability so the UI can warn without throwing.
    const d = getDb()
    const purchased = (
      (await d.prepare(`SELECT COALESCE(SUM(litres),0) AS q FROM diesel_purchases WHERE plant_id=@pid`).get({ pid: payload.plant_id })) as { q: number }
    ).q
    const prior = await issuedLitres(d, Number(payload.plant_id), payload.exclude)
    return { amount: 0, rate: 0, available: litres(purchased - prior) }
  }
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
      `SELECT di.*, p.name AS plant_name, a.name AS asset_name, t.name AS transporter_name
       FROM diesel_issues di
       JOIN plants p ON p.id = di.plant_id
       LEFT JOIN assets a ON a.id = di.asset_id
       LEFT JOIN transporters t ON t.id = di.transporter_id
       ${clause}
       ORDER BY di.date DESC, di.id DESC`
    )
    .all(params)) as DieselIssue[]
}

export interface DieselIssueInput {
  id?: number
  plant_id: number
  asset_id: number | null
  transporter_id?: number | null
  /** Tick to debit the FIFO diesel cost to the transporter's ledger. */
  charged?: boolean | number
  litres: number
  date: string
  remarks: string
}

export async function createDieselIssue(p: DieselIssueInput): Promise<DieselIssue> {
  const d = getDb()
  if (!(Number(p.litres) > 0)) throw new Error('Litres must be greater than 0.')
  return d.transaction(async () => {
    // FIFO cost of the issued litres; throws (blocks) if it exceeds the plant's stock.
    const fifo = await dieselFifoCost(d, Number(p.plant_id), Number(p.litres))
    const transporter_id = p.transporter_id ? Number(p.transporter_id) : null
    const charged = transporter_id && p.charged ? 1 : 0
    const no = await nextNumber('DIS', 'diesel_issue')
    const info = await d
      .prepare(
        `INSERT INTO diesel_issues (issue_no, plant_id, asset_id, transporter_id, litres, rate, amount, charged, date, remarks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(no, p.plant_id, p.asset_id ?? null, transporter_id, litres(Number(p.litres)), fifo.rate, fifo.amount, charged, p.date, p.remarks ?? '')
    return (await d.prepare(`SELECT * FROM diesel_issues WHERE id = ?`).get(info.lastInsertRowid)) as DieselIssue
  })
}

export async function updateDieselIssue(p: DieselIssueInput): Promise<DieselIssue> {
  const d = getDb()
  if (!p.id) throw new Error('Missing issue id.')
  if (!(Number(p.litres) > 0)) throw new Error('Litres must be greater than 0.')
  await d.transaction(async () => {
    const fifo = await dieselFifoCost(d, Number(p.plant_id), Number(p.litres), { src: 'issue', id: p.id! })
    const transporter_id = p.transporter_id ? Number(p.transporter_id) : null
    const charged = transporter_id && p.charged ? 1 : 0
    await d.prepare(
      `UPDATE diesel_issues SET plant_id=?, asset_id=?, transporter_id=?, litres=?, rate=?, amount=?, charged=?, date=?, remarks=? WHERE id=?`
    ).run(
      p.plant_id,
      p.asset_id ?? null,
      transporter_id,
      litres(Number(p.litres)),
      fifo.rate,
      fifo.amount,
      charged,
      p.date,
      p.remarks ?? '',
      p.id
    )
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
       GROUP BY di.asset_id, a.name ORDER BY litres DESC`
    )
    .all(payload)) as { asset_id: number | null; asset_name: string; litres: number }[]
}
