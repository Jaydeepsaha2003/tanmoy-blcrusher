import * as React from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  Truck,
  PackageOpen,
  Receipt,
  ShoppingCart,
  BookOpen,
  AlertTriangle,
  X
} from 'lucide-react'
import { api } from '@/lib/api'
import type { RackLoading, RackUnloading, RackExpense, RackSale, RackStatus, Uom } from '@shared/types'
import { toCm, fromCm, UOMS } from '@shared/types'
import { PageHeader, Page } from '@/components/layout'
import {
  Button,
  Input,
  Select,
  SearchSelect,
  Field,
  Badge,
  Modal,
  Card,
  CardContent,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
  EmptyState
} from '@/components/ui'
import { useToast } from '@/components/toast'
import { confirmDialog } from '@/components/confirm'
import { usePlant } from '@/lib/plant'
import { fmtQty, fmtMoney, fmtDate, today } from '@/lib/utils'
import { statusLabel, statusBadge } from './Racks'

const nextStep: Partial<Record<RackStatus, { to: RackStatus; label: string }>> = {
  loading: { to: 'in_transit', label: 'Mark In Transit' },
  in_transit: { to: 'reached', label: 'Mark Reached' },
  reached: { to: 'closed', label: 'Close Rack' },
  closed: { to: 'reached', label: 'Re-open Rack' }
}

export function RackDetail(): React.JSX.Element {
  const { id } = useParams()
  const rackId = Number(id)
  const qc = useQueryClient()
  const toast = useToast()
  const nav = useNavigate()
  const { plantId } = usePlant()

  const { data } = useQuery({
    queryKey: ['rack', rackId],
    queryFn: () => api.racks.detail(rackId),
    enabled: !!rackId
  })
  const { data: plants = [] } = useQuery({ queryKey: ['plants'], queryFn: api.plants.list })
  const { data: transporters = [] } = useQuery({
    queryKey: ['transporters'],
    queryFn: () => api.transporters.list()
  })
  const { data: customers = [] } = useQuery({ queryKey: ['customers'], queryFn: () => api.customers.list() })
  const { data: assets = [] } = useQuery({ queryKey: ['assets'], queryFn: () => api.assets.list() })
  const { data: outsourceVendors = [] } = useQuery({ queryKey: ['outsource'], queryFn: () => api.outsource.list() })
  const { data: expenseTypes = [] } = useQuery({
    queryKey: ['expenseTypes'],
    queryFn: api.racks.expenseTypes
  })

  const [loadingForm, setLoadingForm] = React.useState<any>(null)
  const [unloadForm, setUnloadForm] = React.useState<any>(null)
  const [expenseForm, setExpenseForm] = React.useState<any>(null)
  const [saleForm, setSaleForm] = React.useState<any>(null)

  const { data: availableFg = [] } = useQuery({
    queryKey: ['finished-available', loadingForm?.plant_id],
    queryFn: () => api.finished.available(loadingForm.plant_id),
    enabled: !!loadingForm?.plant_id
  })

  function refresh(): void {
    qc.invalidateQueries({ queryKey: ['rack', rackId] })
    qc.invalidateQueries({ queryKey: ['racks'] })
    qc.invalidateQueries({ queryKey: ['finished'] })
    qc.invalidateQueries({ queryKey: ['finished-available'] })
    qc.invalidateQueries({ queryKey: ['movements'] })
    qc.invalidateQueries({ queryKey: ['transporters'] })
    qc.invalidateQueries({ queryKey: ['expenseTypes'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
    qc.invalidateQueries({ queryKey: ['ledger'] })
    qc.invalidateQueries({ queryKey: ['ledger-balances'] })
    qc.invalidateQueries({ queryKey: ['allDues'] })
  }

  const setStatus = useMutation({
    mutationFn: (status: RackStatus) => api.racks.setStatus(rackId, status),
    onSuccess: (r) => {
      refresh()
      toast.success(`Rack ${r.rack_no} is now "${statusLabel[r.status]}".`)
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const saveLoading = useMutation({
    mutationFn: (p: any) => (p.id ? api.racks.updateLoading(p) : api.racks.addLoading(p)),
    onSuccess: () => {
      refresh()
      setLoadingForm(null)
      toast.success('Loading saved. Plant stock moved to rack.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const saveUnloading = useMutation({
    mutationFn: (p: any) => (p.id ? api.racks.updateUnloading(p) : api.racks.addUnloading(p)),
    onSuccess: () => {
      refresh()
      setUnloadForm(null)
      toast.success('Unloading saved.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const saveExpense = useMutation({
    mutationFn: (p: any) => (p.id ? api.racks.updateExpense(p) : api.racks.addExpense(p)),
    onSuccess: () => {
      refresh()
      setExpenseForm(null)
      toast.success('Expense saved.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const saveSale = useMutation({
    mutationFn: (p: any) => (p.id ? api.racks.updateSale(p) : api.racks.addSale(p)),
    onSuccess: () => {
      refresh()
      setSaleForm(null)
      toast.success('Sale saved.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  if (!data) return <Page>Loading…</Page>
  const { rack, loadings, unloadings, expenses, sales, products } = data
  const step = nextStep[rack.status]
  const isClosed = rack.status === 'closed'
  // Best-effort per-plant UOM factors from the rack's first loading plant.
  const rackFactors = plants.find((pl) => pl.id === loadings[0]?.plant_id)

  async function removeLoading(l: RackLoading): Promise<void> {
    const ok = await confirmDialog({
      title: 'Delete loading',
      message: `Delete ${l.loading_no}? Plant stock will be restored.`
    })
    if (!ok) return
    const res = await api.racks.deleteLoading(l.id)
    if (res.ok) {
      refresh()
      toast.success('Loading deleted.')
    } else toast.error(res.error || 'Could not delete loading.')
  }

  async function removeUnloading(u: RackUnloading): Promise<void> {
    const ok = await confirmDialog({
      title: 'Delete unloading',
      message: `Delete ${u.unloading_no}?`
    })
    if (!ok) return
    const res = await api.racks.deleteUnloading(u.id)
    if (res.ok) {
      refresh()
      toast.success('Unloading deleted.')
    } else toast.error(res.error || 'Could not delete unloading.')
  }

  async function removeExpense(x: RackExpense): Promise<void> {
    const ok = await confirmDialog({
      title: 'Delete expense',
      message: `Delete ${x.expense_type} (${fmtMoney(x.amount)})?`
    })
    if (!ok) return
    await api.racks.deleteExpense(x.id)
    refresh()
    toast.success('Expense deleted.')
  }

  async function removeSale(s: RackSale): Promise<void> {
    const ok = await confirmDialog({
      title: 'Delete sale',
      message: `Delete ${s.sale_no}? Material returns to rack balance.`
    })
    if (!ok) return
    await api.racks.deleteSale(s.id)
    refresh()
    toast.success('Sale deleted.')
  }

  function openNewLoading(): void {
    setLoadingForm({
      rack_id: rackId,
      // Default to the rack's source plant, else the active plant, else the first plant.
      plant_id: data?.rack?.plant_id ?? plantId ?? plants[0]?.id,
      product_name: '',
      transporter_id: transporters[0]?.id,
      vehicle_no: '',
      trips: '',
      per_trip_cm: '',
      rate: '',
      diesel_litres: '',
      diesel_amount: '',
      outsourced: false,
      date: today(),
      remarks: ''
    })
  }

  function openNewUnloading(): void {
    const first = products.find((p) => p.transit_shortage_cm > 0)
    setUnloadForm({
      rack_id: rackId,
      product_name: first?.product_name || '',
      transporter_id: transporters[0]?.id ?? null,
      vehicle_no: '',
      trips: '',
      per_trip_cm: '',
      rate: '',
      diesel_litres: '',
      diesel_amount: '',
      date: today(),
      remarks: ''
    })
  }

  function openNewSale(): void {
    const first = products.find((p) => p.balance_cm > 0)
    setSaleForm({
      rack_id: rackId,
      customer_id: customers[0]?.id,
      product_name: first?.product_name || '',
      uom: 'CM' as Uom,
      quantity: '',
      rate: '',
      truck_no: '',
      date: today(),
      remarks: '',
      transporters: [],
      machines: []
    })
  }

  async function openEditSale(s: RackSale): Promise<void> {
    const det = await api.racks.saleDetail(s.id).catch(() => null)
    const src = det ?? s
    setSaleForm({
      ...src,
      rate: src.rate ?? '',
      transporters: (src.transporters ?? []).map((t) => ({ transporter_id: t.transporter_id, vehicle_no: t.vehicle_no, basis: t.basis || 'flat', qty: t.qty || '', rate: t.rate || '', charge: t.charge })),
      machines: (src.machines ?? []).map((m) => ({ asset_id: m.asset_id, basis: m.basis, qty: m.qty, rate: m.rate, outsource_id: m.outsource_id }))
    })
  }

  // Sale cost-line helpers
  const sTLines = saleForm?.transporters ?? []
  function addSaleTransporter(): void { setSaleForm({ ...saleForm, transporters: [...sTLines, { transporter_id: 0, vehicle_no: '', basis: 'flat', qty: '', rate: '', charge: '' }] }) }
  function setSaleTransporter(i: number, patch: any): void { setSaleForm({ ...saleForm, transporters: sTLines.map((t: any, idx: number) => (idx === i ? { ...t, ...patch } : t)) }) }
  function delSaleTransporter(i: number): void { setSaleForm({ ...saleForm, transporters: sTLines.filter((_: any, idx: number) => idx !== i) }) }
  const sMLines = saleForm?.machines ?? []
  function addSaleMachine(): void { setSaleForm({ ...saleForm, machines: [...sMLines, { asset_id: 0, basis: 'hour', qty: '', rate: '', outsource_id: null }] }) }
  function setSaleMachine(i: number, patch: any): void { setSaleForm({ ...saleForm, machines: sMLines.map((m: any, idx: number) => (idx === i ? { ...m, ...patch } : m)) }) }
  function delSaleMachine(i: number): void { setSaleForm({ ...saleForm, machines: sMLines.filter((_: any, idx: number) => idx !== i) }) }
  const saleLineCharge = (t: any): number =>
    t.basis === 'trip' || t.basis === 'uom' ? (Number(t.qty) || 0) * (Number(t.rate) || 0) : Number(t.charge) || 0

  const loadingTotal =
    loadingForm ? (Number(loadingForm.trips) || 0) * (Number(loadingForm.per_trip_cm) || 0) : 0
  const loadingAmount = loadingForm && loadingForm.rate !== '' ? loadingTotal * Number(loadingForm.rate) : null

  const unloadTotal =
    unloadForm ? (Number(unloadForm.trips) || 0) * (Number(unloadForm.per_trip_cm) || 0) : 0
  const unloadAmount = unloadForm && unloadForm.rate !== '' ? unloadTotal * Number(unloadForm.rate) : null
  const unloadAvailable = unloadForm
    ? (products.find((p) => p.product_name === unloadForm.product_name)?.transit_shortage_cm ?? 0) +
      (unloadForm.id ? unloadings.find((u) => u.id === unloadForm.id)?.total_cm ?? 0 : 0)
    : 0

  const saleQtyCm = saleForm ? toCm(Number(saleForm.quantity) || 0, saleForm.uom, rackFactors) : 0
  const saleAmount =
    saleForm && saleForm.rate !== '' ? (Number(saleForm.quantity) || 0) * Number(saleForm.rate) : null
  const saleAvailable = saleForm
    ? (products.find((p) => p.product_name === saleForm.product_name)?.balance_cm ?? 0) +
      (saleForm.id ? sales.find((s) => s.id === saleForm.id)?.qty_cm ?? 0 : 0)
    : 0

  return (
    <>
      <PageHeader
        title={`Rack ${rack.rack_no}`}
        description={`${rack.destination ? `To ${rack.destination} · ` : ''}${fmtDate(rack.date)}`}
        actions={
          <>
            <Button variant="ghost" onClick={() => nav('/racks')}>
              <ArrowLeft size={16} /> All Racks
            </Button>
            <Button variant="outline" onClick={() => nav('/ledgers', { state: { type: 'rack', id: rackId } })}>
              <BookOpen size={16} /> Rack Ledger
            </Button>
            <Badge variant={statusBadge[rack.status]} className="px-3 py-1.5 text-sm">
              {statusLabel[rack.status]}
            </Badge>
            {step && (
              <Button
                variant={rack.status === 'reached' ? 'outline' : 'default'}
                onClick={() => setStatus.mutate(step.to)}
              >
                {step.label}
              </Button>
            )}
          </>
        }
      />
      <Page>
        {/* ---- Summary ---- */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Stat label="Loaded (m³)" value={fmtQty(rack.loaded_cm)} />
          <Stat label="Unloaded (m³)" value={fmtQty(rack.unloaded_cm)} />
          <Stat label="Sold (m³)" value={fmtQty(rack.sold_cm)} />
          <Stat
            label={isClosed ? 'Shortage / Wastage (m³)' : 'Balance (m³)'}
            value={fmtQty(rack.balance_cm)}
            tone={isClosed && (rack.balance_cm ?? 0) > 0 ? 'warning' : undefined}
          />
          <Stat label="Transport Cost" value={fmtMoney(rack.transport_cost)} tone="destructive" />
          <Stat label="Other Expenses" value={fmtMoney(rack.expense_total)} tone="destructive" />
          <Stat label="Sales Revenue" value={fmtMoney(rack.sales_amount)} tone="success" />
          <Stat
            label="Profit (excl. material)"
            value={fmtMoney(rack.profit)}
            tone={(rack.profit ?? 0) < 0 ? 'destructive' : 'success'}
          />
        </div>

        {isClosed && (rack.balance_cm ?? 0) > 0 && (
          <div className="mb-6 flex items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
            <AlertTriangle className="shrink-0 text-warning" size={18} />
            <span>
              Rack closed with <strong>{fmtQty(rack.balance_cm)} m³</strong> unsold — booked as{' '}
              <strong>shortage / transport wastage</strong>
              {(rack.transit_shortage_cm ?? 0) > 0 && (
                <> (of which {fmtQty(rack.transit_shortage_cm)} m³ never reached the destination)</>
              )}
              .
            </span>
          </div>
        )}

        {/* ---- Product balances ---- */}
        {products.length > 0 && (
          <div className="mb-6">
            <SectionTitle icon={<Truck size={16} />} title="Material Movement in Rack" />
            <Table>
              <THead>
                <TR>
                  <TH>Product</TH>
                  <TH className="text-right">Loaded (m³)</TH>
                  <TH className="text-right">Unloaded (m³)</TH>
                  <TH className="text-right">Sold (m³)</TH>
                  <TH className="text-right">In Transit (m³)</TH>
                  <TH className="text-right">{isClosed ? 'Shortage (m³)' : 'Balance (m³)'}</TH>
                  <TH className="text-right">Bal (Ton)</TH>
                  <TH className="text-right">Bal (CFT)</TH>
                </TR>
              </THead>
              <TBody>
                {products.map((p) => {
                  const leftover = p.loaded_cm - p.sold_cm
                  return (
                    <TR key={p.product_name}>
                      <TD className="font-medium">{p.product_name}</TD>
                      <TD className="text-right">{fmtQty(p.loaded_cm)}</TD>
                      <TD className="text-right">{fmtQty(p.unloaded_cm)}</TD>
                      <TD className="text-right">{fmtQty(p.sold_cm)}</TD>
                      <TD className={`text-right ${p.transit_shortage_cm > 0 ? 'text-warning' : 'text-muted-foreground'}`}>
                        {fmtQty(p.transit_shortage_cm)}
                      </TD>
                      <TD className={`text-right font-semibold ${isClosed && leftover > 0 ? 'text-warning' : ''}`}>
                        {fmtQty(isClosed ? leftover : p.balance_cm)}
                      </TD>
                      <TD className="text-right text-muted-foreground">{fmtQty(fromCm(p.balance_cm, 'TON', rackFactors))}</TD>
                      <TD className="text-right text-muted-foreground">{fmtQty(fromCm(p.balance_cm, 'CFT', rackFactors))}</TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          </div>
        )}

        {/* ---- Loadings ---- */}
        <div className="mb-6">
          <SectionTitle
            icon={<Truck size={16} />}
            title="Loadings — Plant to Railway Yard"
            action={
              <Button size="sm" onClick={openNewLoading} disabled={rack.status === 'closed' || !transporters.length || !plants.length}>
                <Plus size={15} /> Add Loading
              </Button>
            }
          />
          {!transporters.length && (
            <p className="mb-2 text-xs text-warning">Add a transporter first (Rail Dispatch → Transporters).</p>
          )}
          {loadings.length === 0 ? (
            <EmptyState message="Nothing loaded to this rack yet." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>No</TH>
                  <TH>Date</TH>
                  <TH>Plant</TH>
                  <TH>Product</TH>
                  <TH>Transporter / Vehicle</TH>
                  <TH className="text-right">Trips</TH>
                  <TH className="text-right">Per Trip (m³)</TH>
                  <TH className="text-right">Total (m³)</TH>
                  <TH className="text-right">Rate</TH>
                  <TH className="text-right">Amount</TH>
                  <TH className="text-right">Diesel</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {loadings.map((l) => (
                  <TR key={l.id}>
                    <TD className="font-mono text-xs">{l.loading_no}</TD>
                    <TD>{fmtDate(l.date)}</TD>
                    <TD className="text-muted-foreground">{l.plant_name}</TD>
                    <TD className="font-medium">{l.product_name}</TD>
                    <TD className="text-muted-foreground">
                      {l.transporter_name}
                      {l.vehicle_no ? ` · ${l.vehicle_no}` : ''}
                    </TD>
                    <TD className="text-right">{fmtQty(l.trips)}</TD>
                    <TD className="text-right">{fmtQty(l.per_trip_cm)}</TD>
                    <TD className="text-right font-semibold">{fmtQty(l.total_cm)}</TD>
                    <TD className="text-right">{l.rate == null ? '-' : fmtMoney(l.rate)}</TD>
                    <TD className="text-right">{fmtMoney(l.amount)}</TD>
                    <TD className="text-right text-muted-foreground">
                      {l.diesel_amount ? fmtMoney(l.diesel_amount) : '-'}
                      {l.diesel_litres ? ` (${fmtQty(l.diesel_litres)} L)` : ''}
                    </TD>
                    <TD className="text-right">
                      <Button variant="ghost" size="icon" onClick={() =>
                        setLoadingForm({
                          ...l,
                          trips: l.trips || '',
                          per_trip_cm: l.per_trip_cm || '',
                          rate: l.rate ?? '',
                          diesel_litres: l.diesel_litres ?? '',
                          diesel_amount: l.diesel_amount ?? ''
                        })
                      }>
                        <Pencil size={15} />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => removeLoading(l)}>
                        <Trash2 size={15} className="text-destructive" />
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>

        {/* ---- Expenses ---- */}
        <div className="mb-6">
          <SectionTitle
            icon={<Receipt size={16} />}
            title="Rack Expenses"
            action={
              <Button size="sm" variant="secondary" onClick={() =>
                setExpenseForm({ rack_id: rackId, expense_type: '', amount: '', date: today(), remarks: '' })
              } disabled={rack.status === 'closed'}>
                <Plus size={15} /> Add Expense
              </Button>
            }
          />
          {expenses.length === 0 ? (
            <EmptyState message="No expenses recorded for this rack (railway freight, loading labour, etc.)." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Date</TH>
                  <TH>Expense Type</TH>
                  <TH className="text-right">Amount</TH>
                  <TH>Remarks</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {expenses.map((x) => (
                  <TR key={x.id}>
                    <TD>{fmtDate(x.date)}</TD>
                    <TD className="font-medium">{x.expense_type}</TD>
                    <TD className="text-right">{fmtMoney(x.amount)}</TD>
                    <TD className="text-muted-foreground">{x.remarks || '-'}</TD>
                    <TD className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => setExpenseForm({ ...x })}>
                        <Pencil size={15} />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => removeExpense(x)}>
                        <Trash2 size={15} className="text-destructive" />
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>

        {/* ---- Unloadings ---- */}
        <div className="mb-6">
          <SectionTitle
            icon={<PackageOpen size={16} />}
            title="Unloadings — Received at Destination"
            action={
              <Button
                size="sm"
                variant="secondary"
                onClick={openNewUnloading}
                disabled={isClosed || rack.status === 'loading' || !products.some((p) => p.transit_shortage_cm > 0)}
              >
                <Plus size={15} /> Add Unloading
              </Button>
            }
          />
          {rack.status === 'loading' ? (
            <p className="mb-2 text-xs text-muted-foreground">
              Unloading opens once the rack leaves the plant (mark <b>In Transit</b> / <b>Reached</b>).
              Any quantity loaded but never unloaded is treated as transit shortage.
            </p>
          ) : null}
          {unloadings.length === 0 ? (
            <EmptyState message="Nothing unloaded yet. Record what physically arrives at the destination — the gap from the loaded quantity is the transport shortage." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>No</TH>
                  <TH>Date</TH>
                  <TH>Product</TH>
                  <TH>Transporter / Vehicle</TH>
                  <TH className="text-right">Trips</TH>
                  <TH className="text-right">Per Trip (m³)</TH>
                  <TH className="text-right">Total (m³)</TH>
                  <TH className="text-right">Rate</TH>
                  <TH className="text-right">Amount</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {unloadings.map((u) => (
                  <TR key={u.id}>
                    <TD className="font-mono text-xs">{u.unloading_no}</TD>
                    <TD>{fmtDate(u.date)}</TD>
                    <TD className="font-medium">{u.product_name}</TD>
                    <TD className="text-muted-foreground">
                      {u.transporter_name ?? '-'}
                      {u.vehicle_no ? ` · ${u.vehicle_no}` : ''}
                    </TD>
                    <TD className="text-right">{fmtQty(u.trips)}</TD>
                    <TD className="text-right">{fmtQty(u.per_trip_cm)}</TD>
                    <TD className="text-right font-semibold">{fmtQty(u.total_cm)}</TD>
                    <TD className="text-right">{u.rate == null ? '-' : fmtMoney(u.rate)}</TD>
                    <TD className="text-right">{fmtMoney(u.amount)}</TD>
                    <TD className="text-right">
                      <Button variant="ghost" size="icon" onClick={() =>
                        setUnloadForm({
                          ...u,
                          trips: u.trips || '',
                          per_trip_cm: u.per_trip_cm || '',
                          rate: u.rate ?? '',
                          diesel_litres: u.diesel_litres ?? '',
                          diesel_amount: u.diesel_amount ?? ''
                        })
                      }>
                        <Pencil size={15} />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => removeUnloading(u)}>
                        <Trash2 size={15} className="text-destructive" />
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>

        {/* ---- Sales ---- */}
        <div className="mb-6">
          <SectionTitle
            icon={<ShoppingCart size={16} />}
            title="Customer Sales at Destination"
            action={
              <Button size="sm" variant="success" onClick={openNewSale}
                disabled={rack.status !== 'reached' || !customers.length || !products.some((p) => p.balance_cm > 0)}>
                <Plus size={15} /> Add Sale
              </Button>
            }
          />
          {rack.status === 'loading' || rack.status === 'in_transit' ? (
            <p className="mb-2 text-xs text-muted-foreground">
              Sales open once the rack is marked <b>Reached</b>.
            </p>
          ) : rack.status === 'reached' && !products.some((p) => p.balance_cm > 0) ? (
            <p className="mb-2 text-xs text-muted-foreground">
              Record an <b>Unloading</b> above first — sales are made from the unloaded quantity at the destination.
            </p>
          ) : null}
          {sales.length === 0 ? (
            <EmptyState message="No sales from this rack yet." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Sale No</TH>
                  <TH>Date</TH>
                  <TH>Customer</TH>
                  <TH>Product</TH>
                  <TH className="text-right">Qty</TH>
                  <TH>UOM</TH>
                  <TH className="text-right">Qty (m³)</TH>
                  <TH className="text-right">Rate</TH>
                  <TH className="text-right">Amount</TH>
                  <TH>Truck</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {sales.map((s) => (
                  <TR key={s.id}>
                    <TD className="font-mono text-xs">{s.sale_no}</TD>
                    <TD>{fmtDate(s.date)}</TD>
                    <TD className="font-medium">{s.customer_name}</TD>
                    <TD>
                      {s.product_name}
                      {((s.transport_total ?? 0) > 0 || (s.machine_total ?? 0) > 0) && (
                        <span className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                          {(s.transport_total ?? 0) > 0 && <span>🚚 {fmtMoney(s.transport_total)}</span>}
                          {(s.machine_total ?? 0) > 0 && <span>⚙ {fmtMoney(s.machine_total)}</span>}
                        </span>
                      )}
                      {s.remarks && <span className="mt-0.5 block text-[11px] italic text-muted-foreground">“{s.remarks}”</span>}
                    </TD>
                    <TD className="text-right">{fmtQty(s.quantity)}</TD>
                    <TD><Badge variant="muted">{s.uom}</Badge></TD>
                    <TD className="text-right text-muted-foreground">{fmtQty(s.qty_cm)}</TD>
                    <TD className="text-right">{s.rate == null ? '-' : fmtMoney(s.rate)}</TD>
                    <TD className="text-right font-semibold">{fmtMoney(s.amount)}</TD>
                    <TD className="font-mono text-xs">{s.truck_no || '-'}</TD>
                    <TD className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => openEditSale(s)}>
                        <Pencil size={15} />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => removeSale(s)}>
                        <Trash2 size={15} className="text-destructive" />
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
      </Page>

      {/* ---- Loading modal ---- */}
      {loadingForm && (
        <Modal open onClose={() => setLoadingForm(null)}
          title={loadingForm.id ? `Edit ${loadingForm.loading_no}` : 'Add Loading (Plant → Railway Yard)'}
          width="max-w-2xl">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Plant">
              <SearchSelect
                value={loadingForm.plant_id || ''}
                onChange={(v) =>
                  setLoadingForm({ ...loadingForm, plant_id: Number(v), product_name: '' })}
                options={plants.map((p) => ({ value: p.id, label: p.name }))}
              />
            </Field>
            <Field label="Product">
              {loadingForm.outsourced ? (
                <Input value={loadingForm.product_name} onChange={(e) =>
                  setLoadingForm({ ...loadingForm, product_name: e.target.value })} placeholder="Outsourced product name" />
              ) : (
                <SearchSelect
                  value={loadingForm.product_name}
                  onChange={(v) =>
                    setLoadingForm({ ...loadingForm, product_name: v })}
                  options={[
                    ...availableFg.map((f) => ({
                      value: f.product_name,
                      label: `${f.product_name} (${fmtQty(f.balance_qty)} m³ available)`
                    })),
                    ...(loadingForm.id && !availableFg.some((f) => f.product_name === loadingForm.product_name)
                      ? [{ value: loadingForm.product_name, label: loadingForm.product_name }]
                      : [])
                  ]}
                  placeholder="Select product…"
                />
              )}
            </Field>
            <div className="col-span-2 -mt-1">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" className="h-4 w-4" checked={!!loadingForm.outsourced} onChange={(e) =>
                  setLoadingForm({ ...loadingForm, outsourced: e.target.checked, product_name: '' })} />
                Outsourced material (bought-in directly — does <b>not</b> use plant finished stock)
              </label>
            </div>
            <Field label="Transporter">
              <SearchSelect
                value={loadingForm.transporter_id || ''}
                onChange={(v) =>
                  setLoadingForm({ ...loadingForm, transporter_id: Number(v) })}
                options={transporters.map((t) => ({ value: t.id, label: t.name }))}
              />
            </Field>
            <Field label="Vehicle No.">
              <Input value={loadingForm.vehicle_no || ''} onChange={(e) =>
                setLoadingForm({ ...loadingForm, vehicle_no: e.target.value })} placeholder="e.g. JH-01-AB-1234" />
            </Field>
            <Field label="No. of Trips">
              <Input type="number" step="1" value={loadingForm.trips} onChange={(e) =>
                setLoadingForm({ ...loadingForm, trips: e.target.value })} />
            </Field>
            <Field label="Per Trip (m³)">
              <Input type="number" step="0.001" value={loadingForm.per_trip_cm} onChange={(e) =>
                setLoadingForm({ ...loadingForm, per_trip_cm: e.target.value })} />
            </Field>
            <Field label="Total Quantity (m³)" hint={`= trips × per trip${loadingTotal > 0 ? ` · ${fmtQty(fromCm(loadingTotal, 'TON', rackFactors))} ton · ${fmtQty(fromCm(loadingTotal, 'CFT', rackFactors))} cft` : ''}`}>
              <Input value={fmtQty(loadingTotal)} disabled />
            </Field>
            <Field label="Rate per m³ (transport)">
              <Input type="number" step="0.01" value={loadingForm.rate} onChange={(e) =>
                setLoadingForm({ ...loadingForm, rate: e.target.value })} placeholder="Optional" />
            </Field>
            <Field label="Diesel (litres, optional)">
              <Input type="number" step="0.01" value={loadingForm.diesel_litres} onChange={(e) =>
                setLoadingForm({ ...loadingForm, diesel_litres: e.target.value })} />
            </Field>
            <Field label="Diesel Amount (deducted from transporter)">
              <Input type="number" step="0.01" value={loadingForm.diesel_amount} onChange={(e) =>
                setLoadingForm({ ...loadingForm, diesel_amount: e.target.value })} />
            </Field>
            <Field label="Date">
              <Input type="date" value={loadingForm.date} onChange={(e) =>
                setLoadingForm({ ...loadingForm, date: e.target.value })} />
            </Field>
            <Field label="Remarks">
              <Input value={loadingForm.remarks || ''} onChange={(e) =>
                setLoadingForm({ ...loadingForm, remarks: e.target.value })} />
            </Field>
          </div>
          <div className="mt-4 rounded-lg bg-muted/60 px-4 py-2.5 text-sm">
            Transport bill: <b>{loadingAmount == null ? '—' : fmtMoney(loadingAmount)}</b>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setLoadingForm(null)}>Cancel</Button>
            <Button
              onClick={() =>
                saveLoading.mutate({
                  ...loadingForm,
                  trips: Number(loadingForm.trips) || 0,
                  per_trip_cm: Number(loadingForm.per_trip_cm) || 0,
                  total_cm: loadingTotal,
                  rate: loadingForm.rate === '' ? null : Number(loadingForm.rate),
                  diesel_litres: loadingForm.diesel_litres === '' ? null : Number(loadingForm.diesel_litres),
                  diesel_amount: loadingForm.diesel_amount === '' ? null : Number(loadingForm.diesel_amount)
                })
              }
              disabled={!loadingForm.plant_id || !loadingForm.product_name || !loadingForm.transporter_id || !(loadingTotal > 0)}
            >
              Save Loading
            </Button>
          </div>
        </Modal>
      )}

      {/* ---- Unloading modal ---- */}
      {unloadForm && (
        <Modal open onClose={() => setUnloadForm(null)}
          title={unloadForm.id ? `Edit ${unloadForm.unloading_no}` : 'Add Unloading (Yard → Destination)'}
          width="max-w-2xl">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Product">
              <SearchSelect
                value={unloadForm.product_name}
                onChange={(v) =>
                  setUnloadForm({ ...unloadForm, product_name: v })}
                options={products
                  .filter((p) => p.transit_shortage_cm > 0 || p.product_name === unloadForm.product_name)
                  .map((p) => ({
                    value: p.product_name,
                    label: `${p.product_name} (${fmtQty(p.transit_shortage_cm)} m³ on rake)`
                  }))}
                placeholder="Select product…"
              />
            </Field>
            <Field label="Transporter">
              <SearchSelect
                value={unloadForm.transporter_id ?? ''}
                onChange={(v) =>
                  setUnloadForm({ ...unloadForm, transporter_id: v ? Number(v) : null })}
                options={[
                  { value: '', label: '— Select —' },
                  ...transporters.map((t) => ({ value: t.id, label: t.name }))
                ]}
              />
            </Field>
            <Field label="Vehicle No.">
              <Input value={unloadForm.vehicle_no || ''} onChange={(e) =>
                setUnloadForm({ ...unloadForm, vehicle_no: e.target.value })} placeholder="e.g. JH-01-AB-1234" />
            </Field>
            <Field label="No. of Trips">
              <Input type="number" step="1" value={unloadForm.trips} onChange={(e) =>
                setUnloadForm({ ...unloadForm, trips: e.target.value })} />
            </Field>
            <Field label="Per Trip (m³)">
              <Input type="number" step="0.001" value={unloadForm.per_trip_cm} onChange={(e) =>
                setUnloadForm({ ...unloadForm, per_trip_cm: e.target.value })} />
            </Field>
            <Field label="Total Unloaded (m³)" hint="= trips × per trip">
              <Input value={fmtQty(unloadTotal)} disabled />
            </Field>
            <Field label="Rate per m³ (transport)">
              <Input type="number" step="0.01" value={unloadForm.rate} onChange={(e) =>
                setUnloadForm({ ...unloadForm, rate: e.target.value })} placeholder="Optional" />
            </Field>
            <Field label="Diesel (litres, optional)">
              <Input type="number" step="0.01" value={unloadForm.diesel_litres} onChange={(e) =>
                setUnloadForm({ ...unloadForm, diesel_litres: e.target.value })} />
            </Field>
            <Field label="Diesel Amount (deducted from transporter)">
              <Input type="number" step="0.01" value={unloadForm.diesel_amount} onChange={(e) =>
                setUnloadForm({ ...unloadForm, diesel_amount: e.target.value })} />
            </Field>
            <Field label="Date">
              <Input type="date" value={unloadForm.date} onChange={(e) =>
                setUnloadForm({ ...unloadForm, date: e.target.value })} />
            </Field>
            <Field label="Remarks">
              <Input value={unloadForm.remarks || ''} onChange={(e) =>
                setUnloadForm({ ...unloadForm, remarks: e.target.value })} />
            </Field>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/60 px-4 py-2.5 text-sm">
            <span>
              On rake (loaded − unloaded): <b>{fmtQty(unloadAvailable)} m³</b>
              {unloadTotal > unloadAvailable && (
                <span className="ml-2 font-medium text-destructive">— more than was loaded!</span>
              )}
            </span>
            <span>Transport bill: <b>{unloadAmount == null ? '—' : fmtMoney(unloadAmount)}</b></span>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setUnloadForm(null)}>Cancel</Button>
            <Button
              onClick={() =>
                saveUnloading.mutate({
                  ...unloadForm,
                  trips: Number(unloadForm.trips) || 0,
                  per_trip_cm: Number(unloadForm.per_trip_cm) || 0,
                  total_cm: unloadTotal,
                  rate: unloadForm.rate === '' ? null : Number(unloadForm.rate),
                  diesel_litres: unloadForm.diesel_litres === '' ? null : Number(unloadForm.diesel_litres),
                  diesel_amount: unloadForm.diesel_amount === '' ? null : Number(unloadForm.diesel_amount)
                })
              }
              disabled={!unloadForm.product_name || !(unloadTotal > 0) || unloadTotal > unloadAvailable}
            >
              Save Unloading
            </Button>
          </div>
        </Modal>
      )}

      {/* ---- Expense modal ---- */}
      {expenseForm && (
        <Modal open onClose={() => setExpenseForm(null)}
          title={expenseForm.id ? 'Edit Expense' : 'Add Rack Expense'}>
          <div className="space-y-4">
            <Field label="Expense Type" hint="Type a new name or pick an existing one — new types are saved automatically">
              <Input list="expense-types" value={expenseForm.expense_type} onChange={(e) =>
                setExpenseForm({ ...expenseForm, expense_type: e.target.value })}
                placeholder="e.g. Railway Freight, Loading Labour, Yard Charges" />
              <datalist id="expense-types">
                {expenseTypes.map((t) => <option key={t} value={t} />)}
              </datalist>
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Amount">
                <Input type="number" step="0.01" value={expenseForm.amount} onChange={(e) =>
                  setExpenseForm({ ...expenseForm, amount: e.target.value })} />
              </Field>
              <Field label="Date">
                <Input type="date" value={expenseForm.date} onChange={(e) =>
                  setExpenseForm({ ...expenseForm, date: e.target.value })} />
              </Field>
            </div>
            <Field label="Remarks">
              <Input value={expenseForm.remarks || ''} onChange={(e) =>
                setExpenseForm({ ...expenseForm, remarks: e.target.value })} />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setExpenseForm(null)}>Cancel</Button>
              <Button onClick={() =>
                saveExpense.mutate({ ...expenseForm, amount: Number(expenseForm.amount) })}
                disabled={!expenseForm.expense_type?.trim() || !(Number(expenseForm.amount) > 0)}>
                Save Expense
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ---- Sale modal ---- */}
      {saleForm && (
        <Modal open onClose={() => setSaleForm(null)}
          title={saleForm.id ? `Edit ${saleForm.sale_no}` : 'New Sale from Rack'} width="max-w-3xl">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Customer">
              <SearchSelect
                value={saleForm.customer_id || ''}
                onChange={(v) =>
                  setSaleForm({ ...saleForm, customer_id: Number(v) })}
                options={customers.map((c) => ({ value: c.id, label: c.name }))}
              />
            </Field>
            <Field label="Unit of Measure" hint="Pick the selling unit first — stock shows in this unit">
              <SearchSelect
                value={saleForm.uom}
                onChange={(v) =>
                  setSaleForm({ ...saleForm, uom: v as Uom })}
                options={UOMS.map((u) => ({
                  value: u,
                  label: u === 'CM' ? 'Cubic Meter (m³)' : u === 'TON' ? 'Ton' : 'Cubic Feet (CFT)'
                }))}
              />
            </Field>
            <Field label="Product">
              <SearchSelect
                value={saleForm.product_name}
                onChange={(v) =>
                  setSaleForm({ ...saleForm, product_name: v })}
                options={products
                  .filter((p) => p.balance_cm > 0 || p.product_name === saleForm.product_name)
                  .map((p) => ({
                    value: p.product_name,
                    label: `${p.product_name} (${fmtQty(fromCm(p.balance_cm, saleForm.uom, rackFactors))} ${saleForm.uom === 'CM' ? 'm³' : saleForm.uom === 'TON' ? 'ton' : 'cft'} in rack)`
                  }))}
              />
            </Field>
            <Field label={`Quantity (${saleForm.uom})`}
              hint={saleQtyCm > 0 ? `= ${fmtQty(saleQtyCm)} m³ · ${fmtQty(fromCm(saleQtyCm, 'TON', rackFactors))} ton · ${fmtQty(fromCm(saleQtyCm, 'CFT', rackFactors))} cft` : undefined}>
              <Input type="number" step="0.001" value={saleForm.quantity} onChange={(e) =>
                setSaleForm({ ...saleForm, quantity: e.target.value })} />
            </Field>
            <Field label={`Rate per ${saleForm.uom}`}>
              <Input type="number" step="0.01" value={saleForm.rate} onChange={(e) =>
                setSaleForm({ ...saleForm, rate: e.target.value })} placeholder="Optional" />
            </Field>
            <Field label="Truck No." hint="Truck delivering to the customer">
              <Input value={saleForm.truck_no || ''} onChange={(e) =>
                setSaleForm({ ...saleForm, truck_no: e.target.value })} placeholder="e.g. JH-01-AB-1234" />
            </Field>
            <Field label="Date">
              <Input type="date" value={saleForm.date} onChange={(e) =>
                setSaleForm({ ...saleForm, date: e.target.value })} />
            </Field>
            <div className="col-span-2">
              <Field label="Remarks">
                <Input value={saleForm.remarks || ''} onChange={(e) =>
                  setSaleForm({ ...saleForm, remarks: e.target.value })} />
              </Field>
            </div>
          </div>

          {/* Transport cost lines */}
          <div className="mt-5 space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground/80">Transport — cost lines (optional)</span>
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="space-y-2">
              {sTLines.length > 0 && (
                <div className="grid grid-cols-[1fr_92px_96px_64px_76px_90px_32px] gap-2 px-1 text-[11px] font-semibold uppercase text-muted-foreground">
                  <div>Transporter</div><div>Vehicle</div><div>Basis</div><div>Qty</div><div>Rate ₹</div><div>Charge ₹</div><div></div>
                </div>
              )}
              {sTLines.map((t: any, i: number) => {
                const computed = t.basis === 'trip' || t.basis === 'uom'
                return (
                  <div key={i} className="grid grid-cols-[1fr_92px_96px_64px_76px_90px_32px] items-center gap-2">
                    <SearchSelect
                      value={t.transporter_id || ''}
                      onChange={(v) => setSaleTransporter(i, { transporter_id: Number(v) })}
                      options={transporters.map((tr) => ({ value: tr.id, label: tr.name }))}
                      placeholder="Transporter…"
                    />
                    <Input value={t.vehicle_no} onChange={(e) => setSaleTransporter(i, { vehicle_no: e.target.value })} placeholder="JH01AB1234" />
                    <SearchSelect
                      value={t.basis || 'flat'}
                      onChange={(v) => setSaleTransporter(i, { basis: v })}
                      options={[{ value: 'flat', label: 'Flat' }, { value: 'trip', label: 'Per Trip' }, { value: 'uom', label: `Per ${saleForm.uom || 'UOM'}` }]}
                    />
                    <Input type="number" step="0.01" value={computed ? t.qty : ''} disabled={!computed}
                      placeholder={computed ? '' : '—'} onChange={(e) => setSaleTransporter(i, { qty: e.target.value })} />
                    <Input type="number" step="0.01" value={computed ? t.rate : ''} disabled={!computed}
                      placeholder={computed ? '' : '—'} onChange={(e) => setSaleTransporter(i, { rate: e.target.value })} />
                    {computed ? (
                      <Input type="text" value={fmtMoney(saleLineCharge(t))} disabled className="text-right font-medium" />
                    ) : (
                      <Input type="number" step="0.01" value={t.charge} onChange={(e) => setSaleTransporter(i, { charge: e.target.value })} />
                    )}
                    <Button variant="ghost" size="icon" onClick={() => delSaleTransporter(i)}><X size={15} className="text-destructive" /></Button>
                  </div>
                )
              })}
            </div>
            <Button variant="outline" size="sm" disabled={!transporters.length} onClick={addSaleTransporter}>
              <Plus size={14} /> Add Transporter
            </Button>
            <p className="text-[11px] text-muted-foreground">Posts to the transporter ledger and the rack's profit/loss.</p>
          </div>

          {/* Machine cost lines */}
          <div className="mt-5 space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground/80">Machines (optional)</span>
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="space-y-2">
              {sMLines.length > 0 && (
                <div className="grid grid-cols-[1fr_90px_80px_90px_1fr_32px] gap-2 px-1 text-[11px] font-semibold uppercase text-muted-foreground">
                  <div>Machine</div><div>Basis</div><div>Qty</div><div>Rate ₹</div><div>Vendor (opt)</div><div></div>
                </div>
              )}
              {sMLines.map((m: any, i: number) => (
                <div key={i} className="grid grid-cols-[1fr_90px_80px_90px_1fr_32px] items-center gap-2">
                  <SearchSelect
                    value={m.asset_id || ''}
                    onChange={(v) => setSaleMachine(i, { asset_id: Number(v) })}
                    options={assets.map((a) => ({ value: a.id, label: a.name }))}
                    placeholder="Machine…"
                  />
                  <SearchSelect
                    value={m.basis || 'hour'}
                    onChange={(v) => setSaleMachine(i, { basis: v })}
                    options={[{ value: 'hour', label: 'Per Hour' }, { value: 'cm', label: 'Per m³' }]}
                  />
                  <Input type="number" step="0.01" value={m.qty} onChange={(e) => setSaleMachine(i, { qty: e.target.value })} />
                  <Input type="number" step="0.01" value={m.rate} onChange={(e) => setSaleMachine(i, { rate: e.target.value })} />
                  <SearchSelect
                    value={m.outsource_id ?? ''}
                    onChange={(v) => setSaleMachine(i, { outsource_id: v ? Number(v) : null })}
                    options={[{ value: '', label: '— None —' }, ...outsourceVendors.map((o) => ({ value: o.id, label: o.name }))]}
                    placeholder="— None —"
                  />
                  <Button variant="ghost" size="icon" onClick={() => delSaleMachine(i)}><X size={15} className="text-destructive" /></Button>
                </div>
              ))}
            </div>
            <Button variant="outline" size="sm" disabled={!assets.length} onClick={addSaleMachine}>
              <Plus size={14} /> Add Machine
            </Button>
            {!assets.length && <p className="text-[11px] text-muted-foreground">Add machines under Machinery &amp; Vehicles first.</p>}
          </div>

          <div className="mt-4 flex items-center justify-between rounded-lg bg-muted/60 px-4 py-2.5 text-sm">
            <span>
              Available in rack: <b>{fmtQty(saleAvailable)} m³</b>
              {saleQtyCm > saleAvailable && (
                <span className="ml-2 font-medium text-destructive">— exceeds rack balance!</span>
              )}
            </span>
            <span>Amount: <b>{saleAmount == null ? '—' : fmtMoney(saleAmount)}</b></span>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setSaleForm(null)}>Cancel</Button>
            <Button
              onClick={() =>
                saveSale.mutate({
                  ...saleForm,
                  quantity: Number(saleForm.quantity),
                  rate: saleForm.rate === '' ? null : Number(saleForm.rate),
                  transporters: (saleForm.transporters ?? [])
                    .filter((t: any) => t.transporter_id)
                    .map((t: any) => ({
                      transporter_id: Number(t.transporter_id),
                      vehicle_no: t.vehicle_no || '',
                      basis: t.basis || 'flat',
                      qty: Number(t.qty) || 0,
                      rate: Number(t.rate) || 0,
                      charge: Number(t.charge) || 0
                    })),
                  machines: (saleForm.machines ?? [])
                    .filter((m: any) => m.asset_id)
                    .map((m: any) => ({ asset_id: Number(m.asset_id), basis: m.basis || 'hour', qty: Number(m.qty) || 0, rate: Number(m.rate) || 0, outsource_id: m.outsource_id ? Number(m.outsource_id) : null }))
                })
              }
              disabled={!saleForm.customer_id || !saleForm.product_name || !(Number(saleForm.quantity) > 0) || saleQtyCm > saleAvailable}
            >
              Save Sale
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}

function Stat({
  label,
  value,
  tone
}: {
  label: string
  value: string
  tone?: 'success' | 'destructive' | 'warning'
}): React.JSX.Element {
  const toneClass =
    tone === 'success'
      ? 'text-success'
      : tone === 'destructive'
        ? 'text-destructive'
        : tone === 'warning'
          ? 'text-warning'
          : ''
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className={`mt-1 text-lg font-bold tnum ${toneClass}`}>{value}</div>
      </CardContent>
    </Card>
  )
}

function SectionTitle({
  icon,
  title,
  action
}: {
  icon: React.ReactNode
  title: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        {icon} {title}
      </h2>
      {action}
    </div>
  )
}
