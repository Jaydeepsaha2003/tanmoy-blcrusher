import { getDb } from '../db'
import type { DashboardData } from '@shared/types'

function num(row: { q: number } | undefined): number {
  return Math.round(((row?.q ?? 0) + Number.EPSILON) * 1000) / 1000
}

function money(row: { q: number } | undefined): number {
  return Math.round(((row?.q ?? 0) + Number.EPSILON) * 100) / 100
}

export async function getDashboard(payload: { plant_id?: number } = {}): Promise<DashboardData> {
  const d = getDb()
  // Plant filter applies to stock + throughput + direct-sale figures. Rack flow and
  // company-wide dues span plants, so those stay global.
  const pid = Number(payload.plant_id) || 0
  const mAnd = pid ? ` AND m.plant_id = ${pid}` : ''
  const plAnd = pid ? ` AND plant_id = ${pid}` : ''
  const plWhere = pid ? ` WHERE plant_id = ${pid}` : ''

  const rawTotal = num(
    (await d.prepare(`SELECT COALESCE(SUM(change_qty),0) AS q FROM stock_movements m WHERE material_type='raw'${mAnd}`).get()) as { q: number }
  )
  const rawByPlant = (await d
    .prepare(
      `SELECT m.plant_id, p.name AS plant_name, ROUND(COALESCE(SUM(m.change_qty),0),3) AS qty
       FROM stock_movements m JOIN plants p ON p.id = m.plant_id
       WHERE m.material_type='raw'${mAnd} GROUP BY m.plant_id, p.name ORDER BY p.name`
    )
    .all()) as DashboardData['rawByPlant']
  const rawByLocation = (await d
    .prepare(
      `SELECT l.id, l.name, p.name AS plant_name, ROUND(COALESCE(SUM(m.change_qty),0),3) AS qty
       FROM stock_locations l
       JOIN plants p ON p.id = l.plant_id
       LEFT JOIN stock_movements m ON m.stock_location_id = l.id AND m.material_type='raw'
       ${pid ? `WHERE l.plant_id = ${pid}` : ''}
       GROUP BY l.id, l.name, p.name ORDER BY p.name, l.name`
    )
    .all()) as DashboardData['rawByLocation']

  const finishedTotal = num(
    (await d.prepare(`SELECT COALESCE(SUM(change_qty),0) AS q FROM stock_movements m WHERE material_type='finished'${mAnd}`).get()) as { q: number }
  )
  const finishedByPlant = (await d
    .prepare(
      `SELECT m.plant_id, p.name AS plant_name, ROUND(COALESCE(SUM(m.change_qty),0),3) AS qty
       FROM stock_movements m JOIN plants p ON p.id = m.plant_id
       WHERE m.material_type='finished'${mAnd} GROUP BY m.plant_id, p.name ORDER BY p.name`
    )
    .all()) as DashboardData['finishedByPlant']
  const finishedByProduct = (await d
    .prepare(
      `SELECT m.product_name, ROUND(COALESCE(SUM(m.change_qty),0),3) AS qty
       FROM stock_movements m
       WHERE m.material_type='finished'${mAnd} GROUP BY m.product_name HAVING qty <> 0 ORDER BY m.product_name`
    )
    .all()) as DashboardData['finishedByProduct']

  const totalPurchased = num(
    (await d
      .prepare(`SELECT COALESCE(SUM(qty_cm),0) AS q FROM purchases WHERE COALESCE(material_type,'raw')='raw'${plAnd}`)
      .get()) as { q: number }
  )
  const totalConsumed = num(
    (await d.prepare(`SELECT COALESCE(SUM(raw_qty),0) AS q FROM productions${plWhere}`).get()) as { q: number }
  )
  const totalProduced = num(
    (await d.prepare(`SELECT COALESCE(SUM(change_qty),0) AS q FROM stock_movements m WHERE type='production_output'${mAnd}`).get()) as { q: number }
  )
  const totalDispatched = num(
    (await d.prepare(`SELECT COALESCE(SUM(qty_cm),0) AS q FROM dispatches${plWhere}`).get()) as { q: number }
  )

  const pendingSupplierPayment = money(
    (await d.prepare(`SELECT COALESCE(SUM(COALESCE(amount,0) - paid_amount),0) AS q FROM purchases WHERE payment_status <> 'paid'${plAnd}`).get()) as { q: number }
  )
  const pendingDeliveries = (
    (await d.prepare(`SELECT COUNT(*) AS q FROM dispatches WHERE delivery_status='pending'${plAnd}`).get()) as { q: number }
  ).q
  const deliveredNoRate = (
    (await d.prepare(`SELECT COUNT(*) AS q FROM dispatches WHERE delivery_status='delivered' AND rate IS NULL${plAnd}`).get()) as { q: number }
  ).q

  // ---- Rail rack pipeline ----
  // Material still in the pipeline (open racks) vs. unsold leftover booked as shortage (closed racks).
  const rackStockCm = num(
    (await d
      .prepare(
        `SELECT
          (SELECT COALESCE(SUM(total_cm),0) FROM rack_loadings WHERE rack_id IN (SELECT id FROM racks WHERE status<>'closed')) -
          (SELECT COALESCE(SUM(qty_cm),0) FROM rack_sales WHERE rack_id IN (SELECT id FROM racks WHERE status<>'closed')) AS q`
      )
      .get()) as { q: number }
  )
  const rackShortageCm = num(
    (await d
      .prepare(
        `SELECT
          (SELECT COALESCE(SUM(total_cm),0) FROM rack_loadings WHERE rack_id IN (SELECT id FROM racks WHERE status='closed')) -
          (SELECT COALESCE(SUM(qty_cm),0) FROM rack_sales WHERE rack_id IN (SELECT id FROM racks WHERE status='closed')) AS q`
      )
      .get()) as { q: number }
  )
  const openRacks = (
    (await d.prepare(`SELECT COUNT(*) AS q FROM racks WHERE status <> 'closed'`).get()) as { q: number }
  ).q
  const rackSalesAmount = money(
    (await d.prepare(`SELECT COALESCE(SUM(amount),0) AS q FROM rack_sales`).get()) as { q: number }
  )
  const rackTransportCost = money(
    (await d.prepare(
      `SELECT (SELECT COALESCE(SUM(amount),0) FROM rack_loadings)
            + (SELECT COALESCE(SUM(amount),0) FROM rack_unloadings) AS q`
    ).get()) as { q: number }
  )
  const totalRackExpenses = money(
    (await d.prepare(`SELECT COALESCE(SUM(amount),0) AS q FROM rack_expenses`).get()) as { q: number }
  )
  const rackProfit = money({ q: rackSalesAmount - rackTransportCost - totalRackExpenses })

  // For a single plant, show that plant's direct sales only; for All Plants include rack sales too.
  const custSalesExpr = pid
    ? `COALESCE((SELECT SUM(amount) FROM dispatches WHERE customer_id=c.id AND plant_id=${pid} AND amount IS NOT NULL),0)`
    : `COALESCE((SELECT SUM(amount) FROM rack_sales WHERE customer_id=c.id AND amount IS NOT NULL),0) +
       COALESCE((SELECT SUM(amount) FROM dispatches WHERE customer_id=c.id AND amount IS NOT NULL),0)`
  const topCustomers = (
    (await d
      .prepare(
        `SELECT c.name AS name, ${custSalesExpr} AS amount
         FROM customers c ORDER BY amount DESC LIMIT 5`
      )
      .all()) as { name: string; amount: number }[]
  )
    .filter((r) => r.amount > 0)
    .map((r) => ({ name: r.name, amount: money({ q: r.amount }) }))

  const monthlySrc = pid
    ? `SELECT substr(date,1,7) AS month, COALESCE(amount,0) AS amount FROM dispatches WHERE amount IS NOT NULL AND plant_id=${pid}`
    : `SELECT substr(date,1,7) AS month, COALESCE(amount,0) AS amount FROM rack_sales WHERE amount IS NOT NULL
       UNION ALL
       SELECT substr(date,1,7) AS month, COALESCE(amount,0) AS amount FROM dispatches WHERE amount IS NOT NULL`
  const monthlySales = (
    (await d
      .prepare(
        `SELECT month, SUM(amount) AS amount FROM (${monthlySrc}) AS t GROUP BY month ORDER BY month DESC LIMIT 6`
      )
      .all()) as { month: string; amount: number }[]
  )
    .map((r) => ({ month: r.month, amount: money({ q: r.amount }) }))
    .reverse()

  // ---- Party dues ----
  // For a specific plant: scope to that plant's own direct sales / loadings.
  // For All Plants: include rack sales and the general payments ledger.
  const custRow = (await (
    pid
      ? d.prepare(
          `SELECT COALESCE(SUM(COALESCE(amount,0)
             + CASE WHEN transport_billed=1 THEN transport_charge ELSE 0 END
             + CASE WHEN other_billed=1 THEN other_charge ELSE 0 END
             - paid_amount),0) AS q FROM dispatches WHERE plant_id = ${pid}`
        )
      : d.prepare(
          `SELECT
            (SELECT COALESCE(SUM(COALESCE(amount,0)
                + CASE WHEN transport_billed=1 THEN transport_charge ELSE 0 END
                + CASE WHEN other_billed=1 THEN other_charge ELSE 0 END
                - paid_amount),0) FROM dispatches) +
            (SELECT COALESCE(SUM(amount),0) FROM rack_sales WHERE amount IS NOT NULL) +
            (SELECT COALESCE(SUM(amount),0) FROM payments WHERE party_type='customer' AND direction='out') -
            (SELECT COALESCE(SUM(amount),0) FROM payments WHERE party_type='customer' AND direction='in') AS q`
        )
  ).get()) as { q: number }
  const customerReceivable = money(custRow)

  const transRow = (await (
    pid
      ? d.prepare(
          `SELECT COALESCE(SUM(COALESCE(amount,0) - COALESCE(diesel_amount,0)),0) AS q FROM rack_loadings WHERE plant_id = ${pid}`
        )
      : d.prepare(
          `SELECT
            (SELECT COALESCE(SUM(COALESCE(amount,0) - COALESCE(diesel_amount,0)),0) FROM rack_loadings) +
            (SELECT COALESCE(SUM(COALESCE(amount,0) - COALESCE(diesel_amount,0)),0) FROM rack_unloadings) -
            (SELECT COALESCE(SUM(amount),0) FROM payments WHERE party_type='transporter' AND direction='out') +
            (SELECT COALESCE(SUM(amount),0) FROM payments WHERE party_type='transporter' AND direction='in') AS q`
        )
  ).get()) as { q: number }
  const transporterPayable = money(transRow)

  const counts = {
    plants: ((await d.prepare(`SELECT COUNT(*) AS q FROM plants`).get()) as { q: number }).q,
    suppliers: ((await d.prepare(`SELECT COUNT(*) AS q FROM suppliers`).get()) as { q: number }).q,
    customers: ((await d.prepare(`SELECT COUNT(*) AS q FROM customers`).get()) as { q: number }).q,
    transporters: ((await d.prepare(`SELECT COUNT(*) AS q FROM transporters`).get()) as { q: number })
      .q,
    companies: ((await d.prepare(`SELECT COUNT(*) AS q FROM companies`).get()) as { q: number }).q,
    racks: ((await d.prepare(`SELECT COUNT(*) AS q FROM racks`).get()) as { q: number }).q
  }

  return {
    rawTotal,
    rawByPlant,
    rawByLocation,
    finishedTotal,
    finishedByPlant,
    finishedByProduct,
    totalPurchased,
    totalConsumed,
    totalProduced,
    totalDispatched,
    pendingSupplierPayment,
    pendingDeliveries,
    deliveredNoRate,
    rackStockCm,
    openRacks,
    rackShortageCm,
    rackSalesAmount,
    totalRackExpenses,
    rackTransportCost,
    rackProfit,
    customerReceivable,
    transporterPayable,
    topCustomers,
    monthlySales,
    counts
  }
}
