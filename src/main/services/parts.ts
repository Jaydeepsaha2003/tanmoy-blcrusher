import { getDb, type Db } from '../db'
import type { SparePart, SparePartMovement, SparePartType } from '@shared/types'
import { properCase } from '@shared/types'

const TYPES: SparePartType[] = ['new', 'repairable', 'scrap']

function round3(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 1000) / 1000
}
function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100
}
function rateOrNull(v: unknown): number | null {
  const n = Number(v)
  return v != null && (v as string) !== '' && n > 0 ? round2(n) : null
}

function normalizeType(value: unknown): SparePartType {
  return TYPES.includes(value as SparePartType) ? (value as SparePartType) : 'new'
}

export async function partBalance(d: Db, partId: number): Promise<number> {
  const row = (await d
    .prepare(`SELECT COALESCE(SUM(quantity),0) AS qty FROM spare_part_movements WHERE part_id = ?`)
    .get(partId)) as { qty: number }
  return round3(Number(row.qty) || 0)
}

export interface PartFifoResult {
  amount: number
  /** Weighted unit cost over the priced quantity drawn (0 when none priced). */
  rate: number
  available: number
  /** Quantity drawn from priced layers, and from unpriced/over-stock layers. */
  pricedQty: number
  unpricedQty: number
}

/**
 * FIFO cost of issuing `qty` of a part: walk the inbound layers (opening + stock-in) oldest
 * first, skip what prior stock-outs already consumed, then value the next `qty` at each layer's
 * rate. Layers added without a rate contribute quantity but no cost — so a stock-out can come out
 * partly or wholly "no cost". `exclude` drops a movement (when re-costing an edited one).
 */
export async function partFifoCost(
  d: Db,
  partId: number,
  qty: number,
  excludeMovementId?: number,
  /** Ignore prior stock-outs tagged to this ref (so an edit re-costs as if they were reversed). */
  excludeRef?: string
): Promise<PartFifoResult> {
  const q = round3(Math.abs(Number(qty) || 0))
  const exId = excludeMovementId ? Number(excludeMovementId) : 0
  const layers = (await d
    .prepare(
      `SELECT quantity, rate FROM spare_part_movements
       WHERE part_id = ? AND quantity > 0 ${exId ? 'AND id <> ?' : ''}
       ORDER BY date, id`
    )
    .all(...(exId ? [partId, exId] : [partId]))) as { quantity: number; rate: number | null }[]
  const totalIn = layers.reduce((a, l) => a + (Number(l.quantity) || 0), 0)
  const outClauses = ['part_id = @pid', 'quantity < 0']
  const outParams: Record<string, unknown> = { pid: partId }
  if (exId) { outClauses.push('id <> @exid'); outParams.exid = exId }
  if (excludeRef) { outClauses.push('ref_no <> @ref'); outParams.ref = excludeRef }
  const outRow = (await d
    .prepare(`SELECT COALESCE(SUM(-quantity),0) AS q FROM spare_part_movements WHERE ${outClauses.join(' AND ')}`)
    .get(outParams)) as { q: number }
  const prior = round3(Number(outRow.q) || 0)
  const available = round3(totalIn - prior)
  if (!(q > 0)) return { amount: 0, rate: 0, available, pricedQty: 0, unpricedQty: 0 }
  let skip = prior
  let need = q
  let cost = 0
  let priced = 0
  let unpriced = 0
  for (const layer of layers) {
    let avail = Number(layer.quantity) || 0
    if (skip > 0) {
      const s = Math.min(skip, avail)
      skip -= s
      avail -= s
    }
    if (avail <= 0 || need <= 0) continue
    const take = Math.min(avail, need)
    if (layer.rate != null && Number(layer.rate) > 0) {
      cost += take * Number(layer.rate)
      priced += take
    } else unpriced += take
    need -= take
  }
  const amount = round2(cost)
  return {
    amount,
    rate: priced > 0 ? round2(amount / priced) : 0,
    available,
    pricedQty: round3(priced),
    unpricedQty: round3(unpriced + Math.max(0, need))
  }
}

export interface PartFifoQuote {
  amount: number
  rate: number
  available: number
  hasCost: boolean
  unpricedQty: number
}

/** Live FIFO quote for one part issue (UI preview). */
export async function partFifoQuote(payload: {
  part_id: number
  quantity: number
  exclude?: number
}): Promise<PartFifoQuote> {
  if (!payload.part_id) return { amount: 0, rate: 0, available: 0, hasCost: false, unpricedQty: 0 }
  const f = await partFifoCost(getDb(), Number(payload.part_id), Number(payload.quantity) || 0, payload.exclude)
  return { amount: f.amount, rate: f.rate, available: f.available, hasCost: f.amount > 0, unpricedQty: f.unpricedQty }
}

/** FIFO quote for several part issues at once (e.g. the parts used on a maintenance entry). */
export async function partFifoQuoteMany(payload: {
  items: { part_id: number; quantity: number }[]
  /** When previewing an edit, ignore the parts already issued against this ref. */
  exclude_ref?: string
}): Promise<{ items: (PartFifoQuote & { part_id: number; quantity: number })[]; total: number }> {
  const d = getDb()
  const items: (PartFifoQuote & { part_id: number; quantity: number })[] = []
  let total = 0
  for (const it of payload.items ?? []) {
    const pid = Number(it.part_id)
    const qty = Number(it.quantity) || 0
    if (!pid || !(qty > 0)) continue
    const f = await partFifoCost(d, pid, qty, undefined, payload.exclude_ref)
    items.push({ part_id: pid, quantity: qty, amount: f.amount, rate: f.rate, available: f.available, hasCost: f.amount > 0, unpricedQty: f.unpricedQty })
    total += f.amount
  }
  return { items, total: round2(total) }
}

/** Issue several parts from stock against a reference (e.g. a maintenance expense), FIFO-costed,
 *  tied to a machine. Returns the total FIFO cost. Throws if any part goes short. */
export async function issuePartsForRef(
  d: Db,
  opts: { asset_id: number | null; ref_no: string; date: string; note?: string; parts: { part_id: number; quantity: number }[] }
): Promise<number> {
  let total = 0
  for (const it of opts.parts ?? []) {
    const pid = Number(it.part_id)
    const qty = round3(Math.abs(Number(it.quantity) || 0))
    if (!pid || !(qty > 0)) continue
    const fifo = await partFifoCost(d, pid, qty)
    await addPartMovement(d, {
      part_id: pid,
      asset_id: opts.asset_id ?? null,
      movement_type: 'stock_out',
      ref_no: opts.ref_no,
      quantity: -qty,
      rate: fifo.rate > 0 ? fifo.rate : null,
      amount: fifo.amount > 0 ? fifo.amount : null,
      date: opts.date,
      note: opts.note || 'Used in maintenance'
    })
    if ((await partBalance(d, pid)) < 0) throw new Error('Not enough stock for a part used in this maintenance.')
    total += fifo.amount
  }
  return round2(total)
}

/** Remove the stock-outs previously issued against a reference (restores stock). */
export async function clearPartsForRef(d: Db, refNo: string): Promise<void> {
  if (!refNo) return
  await d.prepare(`DELETE FROM spare_part_movements WHERE ref_no = ? AND movement_type='stock_out'`).run(refNo)
}

export async function addPartMovement(
  d: Db,
  input: {
    part_id: number
    asset_id?: number | null
    movement_type: SparePartMovement['movement_type']
    ref_no?: string
    quantity: number
    rate?: number | null
    /** Explicit line value (e.g. a FIFO-computed cost); else derived as |qty| × rate. */
    amount?: number | null
    date: string
    note?: string
  }
): Promise<void> {
  const qty = round3(input.quantity)
  if (!qty) return
  const rate = rateOrNull(input.rate)
  const amount =
    input.amount != null && (input.amount as unknown) !== ''
      ? round2(Number(input.amount))
      : rate != null
        ? round2(Math.abs(qty) * rate)
        : null
  await d
    .prepare(
      `INSERT INTO spare_part_movements
       (part_id, asset_id, movement_type, ref_no, quantity, rate, amount, date, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.part_id,
      input.asset_id ?? null,
      input.movement_type,
      input.ref_no ?? '',
      qty,
      rate,
      amount,
      input.date,
      input.note ?? ''
    )
}

export async function listParts(payload: {
  plant_id?: number
  part_type?: SparePartType
} = {}): Promise<SparePart[]> {
  const d = getDb()
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (payload.plant_id) {
    where.push('(sp.plant_id IS NULL OR sp.plant_id = @plant_id)')
    params.plant_id = payload.plant_id
  }
  if (payload.part_type) {
    where.push('sp.part_type = @part_type')
    params.part_type = payload.part_type
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  return (await d
    .prepare(
      `SELECT sp.*, p.name AS plant_name,
              COALESCE((SELECT SUM(m.quantity) FROM spare_part_movements m WHERE m.part_id = sp.id),0) AS balance_qty
       FROM spare_parts sp
       LEFT JOIN plants p ON p.id = sp.plant_id
       ${clause}
       ORDER BY sp.name, sp.part_type, sp.id`
    )
    .all(params)) as SparePart[]
}

export async function createPart(p: {
  name: string
  part_no?: string
  part_type?: SparePartType
  unit?: string
  plant_id?: number | null
  opening_qty?: number
  opening_date?: string
  opening_note?: string
  rate?: number | null
  min_qty?: number
  remarks?: string
}): Promise<SparePart> {
  const d = getDb()
  const name = properCase(p.name)
  if (!name) throw new Error('Part name is required.')
  const partType = normalizeType(p.part_type)
  const unit = properCase(p.unit || 'PCS') || 'PCS'
  const partNo = (p.part_no || '').trim().toUpperCase()
  const rate = rateOrNull(p.rate)
  const duplicate = await d
    .prepare(
      `SELECT id FROM spare_parts
       WHERE name=? AND part_type=? AND COALESCE(plant_id,0)=COALESCE(?,0)`
    )
    .get(name, partType, p.plant_id ?? null)
  if (duplicate) throw new Error('This part and stock type already exists for the selected plant.')
  const id = await d.transaction(async () => {
    const info = await d
      .prepare(
        `INSERT INTO spare_parts (name, part_no, part_type, unit, plant_id, min_qty, rate, remarks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        name,
        partNo,
        partType,
        unit,
        p.plant_id ?? null,
        Math.max(0, Number(p.min_qty) || 0),
        rate,
        p.remarks ?? ''
      )
    const partId = Number(info.lastInsertRowid)
    const opening = Math.max(0, Number(p.opening_qty) || 0)
    if (opening > 0) {
      await addPartMovement(d, {
        part_id: partId,
        asset_id: null,
        movement_type: 'opening',
        quantity: opening,
        rate,
        date: p.opening_date || new Date().toISOString().slice(0, 10),
        note: p.opening_note || 'Opening stock'
      })
    }
    return partId
  })
  return (await listParts()).find((x) => x.id === id) as SparePart
}

export async function updatePart(p: {
  id: number
  name: string
  part_no?: string
  part_type?: SparePartType
  unit?: string
  plant_id?: number | null
  rate?: number | null
  min_qty?: number
  remarks?: string
}): Promise<SparePart> {
  if (!p.id) throw new Error('Missing part id.')
  const name = properCase(p.name)
  if (!name) throw new Error('Part name is required.')
  await getDb()
    .prepare(
      `UPDATE spare_parts SET name=?, part_no=?, part_type=?, unit=?, plant_id=?, min_qty=?, rate=?, remarks=? WHERE id=?`
    )
    .run(
      name,
      (p.part_no || '').trim().toUpperCase(),
      normalizeType(p.part_type),
      properCase(p.unit || 'PCS') || 'PCS',
      p.plant_id ?? null,
      Math.max(0, Number(p.min_qty) || 0),
      rateOrNull(p.rate),
      p.remarks ?? '',
      p.id
    )
  return (await listParts()).find((x) => x.id === p.id) as SparePart
}

export async function stockIn(payload: {
  part_id: number
  quantity: number
  rate?: number | null
  date: string
  note?: string
}): Promise<{ ok: boolean }> {
  const d = getDb()
  const qty = round3(Math.abs(Number(payload.quantity)))
  if (!(qty > 0)) throw new Error('Stock-in quantity must be greater than 0.')
  const rate = rateOrNull(payload.rate)
  await d.transaction(async () => {
    await addPartMovement(d, {
      part_id: payload.part_id,
      asset_id: null,
      movement_type: 'stock_in',
      quantity: qty,
      rate,
      date: payload.date,
      note: payload.note || 'Stock received'
    })
    // Keep the part's reference rate in step with the latest purchase.
    if (rate != null) {
      await d.prepare(`UPDATE spare_parts SET rate=? WHERE id=?`).run(rate, payload.part_id)
    }
  })
  return { ok: true }
}

export async function stockOut(payload: {
  part_id: number
  asset_id: number
  quantity: number
  date: string
  note?: string
}): Promise<{ ok: boolean; cost: number; hasCost: boolean; unpricedQty: number }> {
  const d = getDb()
  const qty = round3(Math.abs(Number(payload.quantity)))
  if (!payload.asset_id) throw new Error('Select the machine or vehicle using this part.')
  if (!(qty > 0)) throw new Error('Stock-out quantity must be greater than 0.')
  let fifo = { amount: 0, rate: 0, unpricedQty: 0 } as PartFifoResult
  await d.transaction(async () => {
    // Value the issue FIFO from the priced stock-in layers (oldest first).
    fifo = await partFifoCost(d, payload.part_id, qty)
    await addPartMovement(d, {
      part_id: payload.part_id,
      asset_id: payload.asset_id,
      movement_type: 'stock_out',
      quantity: -qty,
      rate: fifo.rate > 0 ? fifo.rate : null,
      amount: fifo.amount > 0 ? fifo.amount : null,
      date: payload.date,
      note: payload.note || 'Issued to machine / vehicle'
    })
    if ((await partBalance(d, payload.part_id)) < 0) throw new Error('Not enough stock for this part.')
  })
  return { ok: true, cost: fifo.amount, hasCost: fifo.amount > 0, unpricedQty: fifo.unpricedQty }
}

export async function listPartMovements(payload: {
  part_id?: number
  asset_id?: number
  ref_no?: string
  from?: string
  to?: string
} = {}): Promise<SparePartMovement[]> {
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (payload.part_id) { where.push('m.part_id=@part_id'); params.part_id = payload.part_id }
  if (payload.asset_id) { where.push('m.asset_id=@asset_id'); params.asset_id = payload.asset_id }
  if (payload.ref_no) { where.push('m.ref_no=@ref_no'); params.ref_no = payload.ref_no }
  if (payload.from) { where.push('m.date>=@from'); params.from = payload.from }
  if (payload.to) { where.push('m.date<=@to'); params.to = payload.to }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  return (await getDb()
    .prepare(
      `SELECT m.*, sp.name AS part_name, sp.part_type, sp.unit, a.name AS asset_name
       FROM spare_part_movements m
       JOIN spare_parts sp ON sp.id=m.part_id
       LEFT JOIN assets a ON a.id=m.asset_id
       ${clause}
       ORDER BY m.date DESC, m.id DESC`
    )
    .all(params)) as SparePartMovement[]
}

export async function deletePart(payload: { id: number }): Promise<{ ok: boolean; error?: string }> {
  const d = getDb()
  const used = (await d
    .prepare(`SELECT COUNT(*) AS n FROM spare_part_movements WHERE part_id=? AND movement_type<>'opening'`)
    .get(payload.id)) as { n: number }
  if (Number(used.n) > 0) return { ok: false, error: 'This part has stock activity and cannot be deleted.' }
  await d.transaction(async () => {
    await d.prepare(`DELETE FROM spare_part_movements WHERE part_id=?`).run(payload.id)
    await d.prepare(`DELETE FROM spare_parts WHERE id=?`).run(payload.id)
  })
  return { ok: true }
}
