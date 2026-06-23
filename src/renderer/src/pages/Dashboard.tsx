import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'
import {
  Mountain,
  Boxes,
  Wallet,
  Truck,
  TrainFront,
  HandCoins,
  TrendingUp,
  Receipt,
  AlertTriangle,
  PackagePlus,
  Cog,
  Factory,
  Building2,
  UserSquare2,
  Coins,
  ArrowUpFromLine
} from 'lucide-react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  CartesianGrid
} from 'recharts'
import { api } from '@/lib/api'
import { usePlant } from '@/lib/plant'
import { PageHeader, Page } from '@/components/layout'
import { Badge, Card, CardContent, CardHeader, CardTitle, Table, THead, TBody, TR, TH, TD, EmptyState } from '@/components/ui'
import { fmtQty, fmtMoney } from '@/lib/utils'

const PIE = ['#2563eb', '#16a34a', '#f59e0b', '#db2777', '#7c3aed', '#0891b2', '#ca8a04', '#dc2626']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-')
  const mi = Number(m) - 1
  return `${MONTHS[mi] ?? m} ${y?.slice(2) ?? ''}`
}

function Stat({
  icon: Icon,
  label,
  value,
  tone = 'default',
  suffix,
  hint
}: {
  icon: LucideIcon
  label: string
  value: string | number
  tone?: 'default' | 'success' | 'warning' | 'destructive'
  suffix?: string
  hint?: string
}): React.JSX.Element {
  const tones = {
    default: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/15 text-warning',
    destructive: 'bg-destructive/10 text-destructive'
  }
  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="flex items-center gap-3.5 p-4">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}>
          <Icon size={21} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
          <div className="tnum text-xl font-bold leading-tight">
            {value}
            {suffix && <span className="ml-1 text-sm font-normal text-muted-foreground">{suffix}</span>}
          </div>
          {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
        </div>
      </CardContent>
    </Card>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mb-2.5 mt-6 text-xs font-bold uppercase tracking-wider text-muted-foreground first:mt-0">
      {children}
    </div>
  )
}

export function Dashboard(): React.JSX.Element {
  const { plantId } = usePlant()
  const nav = useNavigate()
  const { data: plants = [] } = useQuery({ queryKey: ['plants'], queryFn: api.plants.list })
  const { data: reminders = [] } = useQuery({ queryKey: ['reminders'], queryFn: () => api.machinery.reminders() })
  const { data } = useQuery({
    queryKey: ['dashboard', plantId],
    queryFn: () => api.dashboard.get(plantId),
    refetchInterval: 4000
  })
  const activePlant = plants.find((p) => p.id === plantId)?.name
  const allP = plantId ? ' (all plants)' : ''

  if (!data) {
    return (
      <>
        <PageHeader title="Dashboard" description="Business overview at a glance" />
        <Page><EmptyState message="Loading…" /></Page>
      </>
    )
  }

  const maxCustomer = Math.max(1, ...data.topCustomers.map((c) => c.amount))

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={plantId ? `Showing data for ${activePlant ?? 'selected plant'}` : 'Business overview — all plants'}
        actions={
          <Badge variant={plantId ? 'default' : 'muted'} className="px-3 py-1.5 text-sm">
            {plantId ? activePlant ?? 'Plant' : 'All Plants'}
          </Badge>
        }
      />
      <Page>
        {reminders.length > 0 && (
          <button
            onClick={() => nav('/reminders')}
            className="mb-4 flex w-full items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-left text-sm transition-colors hover:bg-warning/15"
          >
            <AlertTriangle size={18} className="shrink-0 text-warning" />
            <span>
              <b>{reminders.filter((r) => r.reminder_status === 'expired').length}</b> document(s) expired and{' '}
              <b>{reminders.filter((r) => r.reminder_status === 'due').length}</b> expiring soon on your machines.
            </span>
            <span className="ml-auto font-medium text-primary">View reminders →</span>
          </button>
        )}
        {/* Inventory & sales — plant-specific */}
        <SectionLabel>Inventory &amp; Sales{plantId ? ` — ${activePlant}` : ''}</SectionLabel>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat icon={Mountain} label="Raw Material Stock" value={fmtQty(data.rawTotal)} suffix="m³" />
          <Stat icon={Boxes} label="Finished Goods Stock" value={fmtQty(data.finishedTotal)} suffix="m³" tone="success" />
          <Stat icon={ArrowUpFromLine} label="Direct Sales" value={fmtQty(data.totalDispatched)} suffix="m³" />
          <Stat icon={Truck} label="Pending Deliveries" value={data.pendingDeliveries} tone="warning" />
        </div>

        {/* Receivables & payables — plant-specific */}
        <SectionLabel>Receivables &amp; Payables{plantId ? ` — ${activePlant}` : ''}</SectionLabel>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat icon={Coins} label="Bill Receivable" value={fmtMoney(data.billReceivable)} tone="warning" hint="Sales dues + opening (Dr)" />
          <Stat icon={Wallet} label="Bills Payable" value={fmtMoney(data.billsPayable)} tone="destructive" hint="Supplier/outsource bills + opening (Cr)" />
          <Stat
            icon={HandCoins}
            label="Net Position"
            value={fmtMoney(data.billReceivable - data.billsPayable)}
            tone={data.billReceivable - data.billsPayable < 0 ? 'destructive' : 'success'}
            hint={data.billReceivable - data.billsPayable < 0 ? 'Net payable (incl. opening)' : 'Net receivable (incl. opening)'}
          />
        </div>

        {/* Rail-rack pipeline — company-wide; only meaningful across all plants */}
        {!plantId && (
          <>
            <SectionLabel>Rail-Rack Pipeline{allP}</SectionLabel>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Stat icon={TrainFront} label="Stock in Racks" value={fmtQty(data.rackStockCm)} suffix="m³" hint={`${data.openRacks} open rack${data.openRacks === 1 ? '' : 's'}`} />
              <Stat icon={HandCoins} label="Rack Sales Revenue" value={fmtMoney(data.rackSalesAmount)} tone="success" />
              <Stat icon={TrendingUp} label="Rack Profit" value={fmtMoney(data.rackProfit)} tone={data.rackProfit < 0 ? 'destructive' : 'success'} hint="sales − transport − expenses" />
              <Stat icon={AlertTriangle} label="Shortage (closed)" value={fmtQty(data.rackShortageCm)} suffix="m³" tone="warning" />
            </div>
          </>
        )}

        {/* Throughput */}
        <SectionLabel>Production Throughput</SectionLabel>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat icon={PackagePlus} label="Total Purchased" value={fmtQty(data.totalPurchased)} suffix="m³" />
          <Stat icon={Cog} label="Consumed in Production" value={fmtQty(data.totalConsumed)} suffix="m³" />
          <Stat icon={Factory} label="Total Produced" value={fmtQty(data.totalProduced)} suffix="m³" tone="success" />
          {!plantId && (
            <Stat icon={TrainFront} label="Open Racks" value={data.openRacks} hint={`${data.counts.racks} total`} />
          )}
        </div>

        {data.deliveredNoRate > 0 && (
          <div className="mt-5 flex items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
            <AlertTriangle className="text-warning" size={18} />
            <span>
              <strong>{data.deliveredNoRate}</strong> delivered direct dispatch
              {data.deliveredNoRate > 1 ? 'es' : ''} still need a rate. Update them in Delivery Status.
            </span>
          </div>
        )}

        {/* Charts */}
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Monthly Sales (last 6 months)</CardTitle></CardHeader>
            <CardContent>
              {data.monthlySales.length === 0 ? (
                <EmptyState message="No sales recorded yet." />
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={data.monthlySales.map((m) => ({ ...m, label: monthLabel(m.month) }))}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                    <XAxis dataKey="label" fontSize={12} />
                    <YAxis fontSize={12} width={70} tickFormatter={(v: number) => fmtMoney(v)} />
                    <Tooltip formatter={(v: number) => fmtMoney(v)} />
                    <Bar dataKey="amount" name="Sales ₹" fill="#16a34a" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Finished Goods by Product</CardTitle></CardHeader>
            <CardContent>
              {data.finishedByProduct.length === 0 ? (
                <EmptyState message="No data yet." />
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={data.finishedByProduct} dataKey="qty" nameKey="product_name" outerRadius={95} label={(e: { product_name: string }) => e.product_name}>
                      {data.finishedByProduct.map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => `${fmtQty(v)} m³`} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Raw Material Stock by Plant</CardTitle></CardHeader>
            <CardContent>
              {data.rawByPlant.length === 0 ? (
                <EmptyState message="No data yet." />
              ) : (
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={data.rawByPlant}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                    <XAxis dataKey="plant_name" fontSize={12} />
                    <YAxis fontSize={12} />
                    <Tooltip formatter={(v: number) => `${fmtQty(v)} m³`} />
                    <Bar dataKey="qty" name="m³" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Top Customers by Sales</CardTitle></CardHeader>
            <CardContent>
              {data.topCustomers.length === 0 ? (
                <EmptyState message="No customer sales yet." />
              ) : (
                <div className="space-y-3 py-1">
                  {data.topCustomers.map((c, i) => (
                    <div key={c.name}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="font-medium">{c.name}</span>
                        <span className="tnum text-muted-foreground">{fmtMoney(c.amount)}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${(c.amount / maxCustomer) * 100}%`, background: PIE[i % PIE.length] }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Raw Material by Stock Location</CardTitle></CardHeader>
            <CardContent>
              {data.rawByLocation.length === 0 ? (
                <EmptyState message="No locations yet." />
              ) : (
                <Table>
                  <THead><TR><TH>Location</TH><TH>Plant</TH><TH className="text-right">Balance (m³)</TH></TR></THead>
                  <TBody>
                    {data.rawByLocation.map((l) => (
                      <TR key={l.id}>
                        <TD className="font-medium">{l.name}</TD>
                        <TD className="text-muted-foreground">{l.plant_name}</TD>
                        <TD className="text-right font-semibold">{fmtQty(l.qty)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Finished Goods by Plant</CardTitle></CardHeader>
            <CardContent>
              {data.finishedByPlant.length === 0 ? (
                <EmptyState message="No data yet." />
              ) : (
                <Table>
                  <THead><TR><TH>Plant</TH><TH className="text-right">Balance (m³)</TH></TR></THead>
                  <TBody>
                    {data.finishedByPlant.map((p) => (
                      <TR key={p.plant_id}>
                        <TD className="font-medium">{p.plant_name}</TD>
                        <TD className="text-right font-semibold">{fmtQty(p.qty)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Master counts */}
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 rounded-lg border bg-card px-5 py-4 text-sm">
          <div className="flex items-center gap-2"><Factory size={16} className="text-muted-foreground" /> Plants: <strong>{data.counts.plants}</strong></div>
          <div className="flex items-center gap-2"><PackagePlus size={16} className="text-muted-foreground" /> Suppliers: <strong>{data.counts.suppliers}</strong></div>
          <div className="flex items-center gap-2"><UserSquare2 size={16} className="text-muted-foreground" /> Customers: <strong>{data.counts.customers}</strong></div>
          <div className="flex items-center gap-2"><Truck size={16} className="text-muted-foreground" /> Transporters: <strong>{data.counts.transporters}</strong></div>
          <div className="flex items-center gap-2"><Building2 size={16} className="text-muted-foreground" /> Companies: <strong>{data.counts.companies}</strong></div>
          <div className="flex items-center gap-2"><TrainFront size={16} className="text-muted-foreground" /> Racks: <strong>{data.counts.racks}</strong></div>
        </div>
      </Page>
    </>
  )
}
