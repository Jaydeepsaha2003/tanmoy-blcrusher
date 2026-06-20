import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileSpreadsheet } from 'lucide-react'
import { api } from '@/lib/api'
import { PageHeader, Page } from '@/components/layout'
import {
  Button,
  Input,
  Select,
  SearchSelect,
  Badge,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
  EmptyState
} from '@/components/ui'
import { fmtQty, fmtMoney, fmtDate, downloadExcel } from '@/lib/utils'
import { usePlant } from '@/lib/plant'

type ReportType =
  | 'raw_location'
  | 'raw_plant'
  | 'finished'
  | 'supplier_purchases'
  | 'production'
  | 'rack_summary'
  | 'rack_sales'
  | 'rack_expenses'
  | 'dispatch'
  | 'pending_delivery'
  | 'delivered_no_rate'

const REPORTS: { value: ReportType; label: string }[] = [
  { value: 'raw_location', label: 'Raw Material Stock by Location' },
  { value: 'raw_plant', label: 'Raw Material Stock by Plant' },
  { value: 'finished', label: 'Finished Goods Stock' },
  { value: 'supplier_purchases', label: 'Supplier Purchase Summary' },
  { value: 'production', label: 'Production Summary' },
  { value: 'rack_summary', label: 'Rack Profit & Loss' },
  { value: 'rack_sales', label: 'Rack Sales Register' },
  { value: 'rack_expenses', label: 'Rack Expenses Register' },
  { value: 'dispatch', label: 'Direct Sale Summary' },
  { value: 'pending_delivery', label: 'Pending Deliveries' },
  { value: 'delivered_no_rate', label: 'Delivered Orders — Rate Pending' }
]

export function Reports(): React.JSX.Element {
  const { plantId: globalPlant } = usePlant()
  const [type, setType] = React.useState<ReportType>('raw_location')
  const [plantId, setPlantId] = React.useState<number | ''>(globalPlant ?? '')
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')

  React.useEffect(() => {
    if (globalPlant) setPlantId(globalPlant)
  }, [globalPlant])

  const { data: plants = [] } = useQuery({ queryKey: ['plants'], queryFn: api.plants.list })
  const usesDate = ['supplier_purchases', 'production', 'dispatch', 'rack_summary', 'rack_sales', 'rack_expenses'].includes(type)

  const built = useReport(type, { plant_id: plantId || undefined, from: from || undefined, to: to || undefined })

  function exportExcel(): void {
    const label = REPORTS.find((r) => r.value === type)?.label ?? 'Report'
    downloadExcel(type, label.slice(0, 31), built.headers, built.rows.map((r) => r.cells))
  }

  return (
    <>
      <PageHeader
        title="Reports"
        description="Filterable, exportable business reports"
        actions={
          <Button variant="outline" onClick={exportExcel} disabled={!built.rows.length}>
            <FileSpreadsheet size={16} /> Export Excel
          </Button>
        }
      />
      <Page>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <SearchSelect className="w-full sm:w-72" value={type} onChange={(v) => setType(v as ReportType)} options={REPORTS.map((r) => ({ value: r.value, label: r.label }))} />
          <SearchSelect className="w-full sm:w-44" value={plantId} disabled={!!globalPlant} onChange={(v) => setPlantId(v ? Number(v) : '')} options={[{ value: '', label: 'All plants' }, ...plants.map((p) => ({ value: p.id, label: p.name }))]} />
          {usesDate && (
            <>
              <Input type="date" className="w-full sm:w-36" value={from} onChange={(e) => setFrom(e.target.value)} />
              <span className="text-muted-foreground">to</span>
              <Input type="date" className="w-full sm:w-36" value={to} onChange={(e) => setTo(e.target.value)} />
            </>
          )}
        </div>

        {built.rows.length === 0 ? (
          <EmptyState message="No data for this report." />
        ) : (
          <Table>
            <THead>
              <TR>{built.headers.map((h, i) => <TH key={i} className={built.align?.[i] === 'right' ? 'text-right' : ''}>{h}</TH>)}</TR>
            </THead>
            <TBody>
              {built.rows.map((r, ri) => (
                <TR key={ri}>
                  {r.cells.map((c, ci) => (
                    <TD key={ci} className={built.align?.[ci] === 'right' ? 'text-right' : ''}>
                      {r.render?.[ci] ?? c}
                    </TD>
                  ))}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Page>
    </>
  )
}

interface BuiltReport {
  headers: string[]
  align?: ('left' | 'right')[]
  rows: { cells: (string | number)[]; render?: (React.ReactNode | undefined)[] }[]
}

function useReport(type: ReportType, f: { plant_id?: number; from?: string; to?: string }): BuiltReport {
  const filter = clean(f)
  const enabledRawLoc = type === 'raw_location' || type === 'raw_plant'
  const locations = useQuery({ queryKey: ['locations', f.plant_id ?? 0], queryFn: () => api.locations.list(f.plant_id || undefined), enabled: enabledRawLoc })
  const finished = useQuery({ queryKey: ['finished', filter], queryFn: () => api.finished.list(filter), enabled: type === 'finished' })
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api.suppliers.list(), enabled: type === 'supplier_purchases' })
  const productions = useQuery({ queryKey: ['productions', filter], queryFn: () => api.productions.list(filter), enabled: type === 'production' })
  const dispatches = useQuery({
    queryKey: ['dispatches', type, filter],
    queryFn: () =>
      api.dispatches.list(
        type === 'pending_delivery'
          ? { ...filter, delivery_status: 'pending' }
          : type === 'delivered_no_rate'
            ? { ...filter, delivery_status: 'delivered', rate_pending: true }
            : filter
      ),
    enabled: ['dispatch', 'pending_delivery', 'delivered_no_rate'].includes(type)
  })
  const dateOnly = clean({ from: f.from, to: f.to })
  const racks = useQuery({
    queryKey: ['racks', dateOnly],
    queryFn: () => api.racks.list(dateOnly),
    enabled: type === 'rack_summary'
  })
  const rackSales = useQuery({
    queryKey: ['rack-sales', dateOnly],
    queryFn: () => api.racks.listSales(dateOnly),
    enabled: type === 'rack_sales'
  })
  const rackExpenses = useQuery({
    queryKey: ['rack-expenses', dateOnly],
    queryFn: () => api.racks.listExpenses(dateOnly),
    enabled: type === 'rack_expenses'
  })

  switch (type) {
    case 'raw_location': {
      const rows = (locations.data ?? []).map((l) => ({
        cells: [l.plant_name ?? '', l.name, l.opening_qty ?? 0, l.purchased_qty ?? 0, l.consumed_qty ?? 0, l.balance_qty ?? 0]
      }))
      return { headers: ['Plant', 'Location', 'Opening', 'Purchased', 'To Production', 'Balance (m³)'], align: ['left', 'left', 'right', 'right', 'right', 'right'], rows }
    }
    case 'raw_plant': {
      const map = new Map<string, { opening: number; purchased: number; consumed: number; balance: number }>()
      for (const l of locations.data ?? []) {
        const k = l.plant_name ?? ''
        const cur = map.get(k) ?? { opening: 0, purchased: 0, consumed: 0, balance: 0 }
        cur.opening += l.opening_qty ?? 0
        cur.purchased += l.purchased_qty ?? 0
        cur.consumed += l.consumed_qty ?? 0
        cur.balance += l.balance_qty ?? 0
        map.set(k, cur)
      }
      const rows = [...map.entries()].map(([plant, v]) => ({
        cells: [plant, round(v.opening), round(v.purchased), round(v.consumed), round(v.balance)]
      }))
      return { headers: ['Plant', 'Opening', 'Purchased', 'To Production', 'Balance (m³)'], align: ['left', 'right', 'right', 'right', 'right'], rows }
    }
    case 'finished': {
      const rows = (finished.data ?? []).map((x) => ({
        cells: [x.plant_name, x.product_name, x.opening_qty, x.produced_qty, x.dispatched_qty, x.loaded_qty, x.balance_qty]
      }))
      return { headers: ['Plant', 'Product', 'Opening', 'Produced', 'Dispatched', 'To Rack', 'Balance (m³)'], align: ['left', 'left', 'right', 'right', 'right', 'right', 'right'], rows }
    }
    case 'rack_summary': {
      const rows = (racks.data ?? []).map((r) => ({
        cells: [
          r.rack_no, fmtDate(r.date), r.destination, r.status,
          r.loaded_cm ?? 0, r.sold_cm ?? 0, r.balance_cm ?? 0,
          fmtMoney(r.transport_cost), fmtMoney(r.expense_total), fmtMoney(r.sales_amount), fmtMoney(r.profit)
        ],
        render: [
          undefined, undefined, undefined,
          <Badge variant={r.status === 'reached' ? 'success' : r.status === 'closed' ? 'muted' : 'warning'}>{r.status}</Badge>,
          fmtQty(r.loaded_cm), fmtQty(r.sold_cm), fmtQty(r.balance_cm),
          undefined, undefined, undefined,
          <span className={(r.profit ?? 0) < 0 ? 'font-semibold text-destructive' : 'font-semibold text-success'}>{fmtMoney(r.profit)}</span>
        ]
      }))
      return {
        headers: ['Rack No', 'Date', 'Destination', 'Status', 'Loaded (m³)', 'Sold (m³)', 'In Rack (m³)', 'Transport', 'Expenses', 'Sales', 'Profit'],
        align: ['left', 'left', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
        rows
      }
    }
    case 'rack_expenses': {
      const rows = (rackExpenses.data ?? []).map((x) => ({
        cells: [fmtDate(x.date), x.rack_no ?? '', x.expense_type, fmtMoney(x.amount), x.remarks]
      }))
      return {
        headers: ['Date', 'Rack', 'Expense Type', 'Amount', 'Remarks'],
        align: ['left', 'left', 'left', 'right', 'left'],
        rows
      }
    }
    case 'rack_sales': {
      const rows = (rackSales.data ?? []).map((s) => ({
        cells: [
          s.sale_no, fmtDate(s.date), s.rack_no ?? '', s.customer_name ?? '', s.product_name,
          s.quantity, s.uom, s.qty_cm, s.rate == null ? '' : fmtMoney(s.rate), s.amount == null ? '' : fmtMoney(s.amount)
        ],
        render: [
          undefined, undefined, undefined, undefined, undefined,
          fmtQty(s.quantity), <Badge variant="muted">{s.uom}</Badge>, fmtQty(s.qty_cm), undefined, undefined
        ]
      }))
      return {
        headers: ['Sale No', 'Date', 'Rack', 'Customer', 'Product', 'Qty', 'UOM', 'Qty (m³)', 'Rate', 'Amount'],
        align: ['left', 'left', 'left', 'left', 'left', 'right', 'left', 'right', 'right', 'right'],
        rows
      }
    }
    case 'supplier_purchases': {
      const rows = (suppliers.data ?? []).map((s) => ({
        cells: [s.name, s.total_purchased ?? 0, fmtMoney(s.total_amount), fmtMoney(s.paid_amount), fmtMoney(s.unpaid_amount)]
      }))
      return { headers: ['Supplier', 'Purchased (m³)', 'Total Amount', 'Paid', 'Unpaid'], align: ['left', 'right', 'right', 'right', 'right'], rows }
    }
    case 'production': {
      const rows = (productions.data ?? []).map((p) => ({
        cells: [p.production_no, fmtDate(p.date), p.plant_name ?? '', p.stock_location_name ?? '', p.raw_qty, (p.outputs ?? []).map((o) => `${o.product_name}:${o.quantity}`).join(', ')]
      }))
      return { headers: ['Production No', 'Date', 'Plant', 'Location', 'Raw (m³)', 'Outputs'], align: ['left', 'left', 'left', 'left', 'right', 'left'], rows }
    }
    case 'dispatch':
    case 'pending_delivery':
    case 'delivered_no_rate': {
      const rows = (dispatches.data ?? []).map((d) => ({
        cells: [d.dispatch_no, fmtDate(d.date), d.customer_name ?? '', d.plant_name ?? '', d.product_name, d.quantity, d.rate == null ? 'No rate' : fmtMoney(d.rate), d.delivery_status],
        render: [undefined, undefined, undefined, undefined, undefined, fmtQty(d.quantity), d.rate == null ? <Badge variant="warning">No rate</Badge> : fmtMoney(d.rate), <Badge variant={d.delivery_status === 'delivered' ? 'success' : 'muted'}>{d.delivery_status}</Badge>]
      }))
      return { headers: ['Dispatch No', 'Date', 'Customer', 'Plant', 'Product', 'Qty (m³)', 'Rate', 'Delivery'], align: ['left', 'left', 'left', 'left', 'left', 'right', 'right', 'left'], rows }
    }
    default:
      return { headers: [], rows: [] }
  }
}

function clean(f: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(f)) if (v != null && v !== '') out[k] = v
  return out
}
function round(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000
}
