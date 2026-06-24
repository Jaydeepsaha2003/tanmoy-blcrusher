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
  // When a plant is active, everything is scoped to it: stock, throughput, direct
  // sales, dues, sales charts and the master counts (parties available at that
  // plant). Only the rail-rack pipeline is company-wide — the UI hides that section
  // for a single plant, so it isn't shown stale.
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
       WHERE m.material_type='finished'${mAnd} GROUP BY m.product_name HAVING qty > 0 ORDER BY m.product_name`
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
  // "Direct Sales" = real customer sales only. Inter-plant transfers (to_plant_id set)
  // are internal stock moves, not sales, so they are excluded everywhere below.
  const totalDispatched = num(
    (await d.prepare(`SELECT COALESCE(SUM(qty_cm),0) AS q FROM dispatches WHERE to_plant_id IS NULL${plAnd}`).get()) as { q: number }
  )

  const pendingDeliveries = (
    (await d.prepare(`SELECT COUNT(*) AS q FROM dispatches WHERE delivery_status='pending' AND to_plant_id IS NULL${plAnd}`).get()) as { q: number }
  ).q
  const deliveredNoRate = (
    (await d.prepare(`SELECT COUNT(*) AS q FROM dispatches WHERE delivery_status='delivered' AND rate IS NULL AND to_plant_id IS NULL${plAnd}`).get()) as { q: number }
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
    ? `COALESCE((SELECT SUM(amount) FROM dispatches WHERE customer_id=c.id AND plant_id=${pid} AND to_plant_id IS NULL AND amount IS NOT NULL),0)`
    : `COALESCE((SELECT SUM(amount) FROM rack_sales WHERE customer_id=c.id AND amount IS NOT NULL),0) +
       COALESCE((SELECT SUM(amount) FROM dispatches WHERE customer_id=c.id AND to_plant_id IS NULL AND amount IS NOT NULL),0)`
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
    ? `SELECT substr(date,1,7) AS month, COALESCE(amount,0) AS amount FROM dispatches WHERE amount IS NOT NULL AND to_plant_id IS NULL AND plant_id=${pid}`
    : `SELECT substr(date,1,7) AS month, COALESCE(amount,0) AS amount FROM rack_sales WHERE amount IS NOT NULL
       UNION ALL
       SELECT substr(date,1,7) AS month, COALESCE(amount,0) AS amount FROM dispatches WHERE amount IS NOT NULL AND to_plant_id IS NULL`
  const monthlySales = (
    (await d
      .prepare(
        `SELECT month, SUM(amount) AS amount FROM (${monthlySrc}) AS t GROUP BY month ORDER BY month DESC LIMIT 6`
      )
      .all()) as { month: string; amount: number }[]
  )
    .map((r) => ({ month: r.month, amount: money({ q: r.amount }) }))
    .reverse()

  // ---- Plant-wise dues (attributed to the plant each bill was raised at) ----
  // Shown as four figures so the picture is clear at a glance:
  //  • Opening Balance — net carried forward (customers Dr − suppliers/outsource Cr)
  //  • Bill Receivable — unpaid on this period's direct sales
  //  • Bills Payable   — unpaid on this period's supplier/diesel/outsource bills
  //  • Net Position    — Receivable − Payable + Opening (computed in the UI)
  // Bills are attributed to the plant each was raised at; opening balances are
  // party-level so they follow the party's plant (its own + common).
  const obCust = pid ? ` AND (c.plant_id = ${pid} OR c.plant_id IS NULL)` : ''
  const obSup = pid ? ` AND (s.plant_id = ${pid} OR s.plant_id IS NULL)` : ''
  const billReceivable = money(
    (await d
      .prepare(
        `SELECT COALESCE(SUM(
            (COALESCE(amount,0)
             + CASE WHEN transport_billed=1 THEN transport_charge ELSE 0 END
             + CASE WHEN other_billed=1 THEN other_charge ELSE 0 END)
            - COALESCE(paid_amount,0)),0) AS q
         FROM dispatches WHERE to_plant_id IS NULL${plAnd}`
      )
      .get()) as { q: number }
  )
  const billsPayable = money(
    (await d
      .prepare(
        `SELECT
          (SELECT COALESCE(SUM(COALESCE(amount,0) - COALESCE(paid_amount,0)),0)
             FROM purchases WHERE linked_dispatch_id IS NULL${plAnd}) +
          (SELECT COALESCE(SUM(COALESCE(amount,0) - COALESCE(paid_amount,0)),0)
             FROM diesel_purchases WHERE 1=1${plAnd}) +
          (SELECT COALESCE(SUM(COALESCE(amount,0) - COALESCE(paid_amount,0)),0)
             FROM plant_expenses WHERE outsource_id IS NOT NULL${plAnd}) +
          (SELECT COALESCE(SUM(ROUND(COALESCE(buy_rate,0) * COALESCE(sale_quantity, quantity), 2)),0)
             FROM dispatches WHERE outsourced=1 AND outsource_id IS NOT NULL AND to_plant_id IS NULL${plAnd}) AS q`
      )
      .get()) as { q: number }
  )
  // Net opening carried forward: customer debit balances add (they owe us),
  // supplier/outsource credit balances subtract (we owe them).
  const openingBalance = money(
    (await d
      .prepare(
        `SELECT
          (SELECT COALESCE(SUM(CASE WHEN ob.direction='debit' THEN ob.amount ELSE -ob.amount END),0)
             FROM opening_balances ob JOIN customers c ON c.id = ob.party_id
             WHERE ob.party_type='customer'${obCust})
          - (SELECT COALESCE(SUM(CASE WHEN ob.direction='credit' THEN ob.amount ELSE -ob.amount END),0)
             FROM opening_balances ob JOIN suppliers s ON s.id = ob.party_id
             WHERE ob.party_type='supplier'${obSup})
          - (SELECT COALESCE(SUM(CASE WHEN ob.direction='credit' THEN ob.amount ELSE -ob.amount END),0)
             FROM opening_balances ob WHERE ob.party_type='outsource') AS q`
      )
      .get()) as { q: number }
  )

  // Parties that carry a plant scope are counted for the active plant (its own +
  // common, plant-unassigned ones), matching their list pages. Plants and companies
  // are global by nature; racks are counted by those loaded from the active plant.
  const partyWhere = pid ? ` WHERE (plant_id IS NULL OR plant_id = ${pid})` : ''
  const counts = {
    plants: ((await d.prepare(`SELECT COUNT(*) AS q FROM plants`).get()) as { q: number }).q,
    suppliers: ((await d.prepare(`SELECT COUNT(*) AS q FROM suppliers${partyWhere}`).get()) as { q: number }).q,
    customers: ((await d.prepare(`SELECT COUNT(*) AS q FROM customers${partyWhere}`).get()) as { q: number }).q,
    transporters: ((await d.prepare(`SELECT COUNT(*) AS q FROM transporters${partyWhere}`).get()) as { q: number })
      .q,
    companies: ((await d.prepare(`SELECT COUNT(*) AS q FROM companies`).get()) as { q: number }).q,
    racks: pid
      ? ((await d
          .prepare(`SELECT COUNT(*) AS q FROM racks WHERE id IN (SELECT DISTINCT rack_id FROM rack_loadings WHERE plant_id = ${pid})`)
          .get()) as { q: number }).q
      : ((await d.prepare(`SELECT COUNT(*) AS q FROM racks`).get()) as { q: number }).q
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
    pendingDeliveries,
    deliveredNoRate,
    rackStockCm,
    openRacks,
    rackShortageCm,
    rackSalesAmount,
    totalRackExpenses,
    rackTransportCost,
    rackProfit,
    openingBalance,
    billReceivable,
    billsPayable,
    topCustomers,
    monthlySales,
    counts
  }
}
