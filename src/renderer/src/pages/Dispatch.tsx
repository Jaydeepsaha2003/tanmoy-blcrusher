import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, FileSpreadsheet, X } from 'lucide-react'
import { api } from '@/lib/api'
import type { Dispatch as DispatchT, PaymentStatus, Uom, VehicleType, MachineBasis } from '@shared/types'
import { toCm, UOMS, derivePaymentStatus } from '@shared/types'
import { PageHeader, Page } from '@/components/layout'
import {
  Button,
  Input,
  SearchSelect,
  Field,
  Badge,
  Modal,
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
import { fmtQty, fmtMoney, fmtDate, today, downloadExcel, cn } from '@/lib/utils'

const payBadge: Record<PaymentStatus, 'success' | 'warning' | 'destructive'> = {
  paid: 'success',
  partial: 'warning',
  unpaid: 'destructive'
}
const vehicleLabel: Record<VehicleType, string> = {
  party: 'From Party',
  own: 'Own Vehicle',
  rented: 'Rented'
}

export function Dispatch(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const { plantId } = usePlant()
  const { data: plants = [] } = useQuery({ queryKey: ['plants'], queryFn: api.plants.list })
  const { data: customers = [] } = useQuery({
    queryKey: ['customers', plantId],
    queryFn: () => api.customers.list(plantId)
  })
  const { data: outsourceVendors = [] } = useQuery({ queryKey: ['outsource'], queryFn: () => api.outsource.list() })
  const { data: transporters = [] } = useQuery({ queryKey: ['transporters', plantId], queryFn: () => api.transporters.list(plantId) })
  const { data: assets = [] } = useQuery({ queryKey: ['assets', plantId], queryFn: () => api.assets.list(plantId) })
  const [filter, setFilter] = React.useState<{
    customer_id?: number
    delivery_status?: string
    payment_status?: string
  }>({})
  const { data = [] } = useQuery({
    queryKey: ['dispatches', filter, plantId],
    queryFn: () => api.dispatches.list(cleanFilter({ ...filter, plant_id: plantId }))
  })

  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState<any>(null)
  const { data: avail = [] } = useQuery({
    queryKey: ['available', form?.plant_id],
    queryFn: () => api.finished.available(form.plant_id),
    enabled: !!form?.plant_id
  })
  const selProduct = avail.find((a) => a.product_name === form?.product_name)

  const save = useMutation({
    mutationFn: (p: any) => (p.id ? api.dispatches.update(p) : api.dispatches.create(p)),
    onSuccess: () => {
      qc.invalidateQueries()
      setOpen(false)
      toast.success('Direct sale saved. Finished goods stock updated.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  function blankForm(): any {
    return {
      sell_mode: 'customer',
      dispatch_no: '',
      customer_id: customers[0]?.id,
      to_plant_id: null,
      plant_id: plantId ?? plants[0]?.id,
      product_name: '',
      outsource_id: null,
      uom: 'CM' as Uom,
      quantity: '',
      sale_quantity: '',
      rate: '',
      transport_charge: '',
      transport_billed: false,
      other_charge: '',
      other_billed: false,
      vehicle_no: '',
      vehicle_type: 'own' as VehicleType,
      transporter_id: null,
      driver: '',
      challan_no: '',
      outsourced: false,
      delivery_status: 'pending',
      paid_amount: '',
      date: today(),
      remarks: '',
      transporters: [],
      machines: []
    }
  }

  function openNew(): void {
    setForm(blankForm())
    setOpen(true)
  }

  async function openEdit(d: DispatchT): Promise<void> {
    const det = await api.dispatches.detail(d.id).catch(() => null)
    const src = det ?? d
    setForm({
      ...src,
      sell_mode: src.to_plant_id ? 'plant' : 'customer',
      rate: src.rate ?? '',
      sale_quantity: src.sale_quantity ?? '',
      transport_charge: src.transport_charge ?? '',
      other_charge: src.other_charge ?? '',
      paid_amount: src.paid_amount ?? '',
      transport_billed: !!src.transport_billed,
      other_billed: !!src.other_billed,
      transporters: (src.transporters ?? []).map((t) => ({ transporter_id: t.transporter_id, vehicle_no: t.vehicle_no, basis: t.basis || 'flat', qty: t.qty || '', rate: t.rate || '', charge: t.charge })),
      machines: (src.machines ?? []).map((m) => ({ asset_id: m.asset_id, basis: m.basis, qty: m.qty, rate: m.rate, outsource_id: m.outsource_id }))
    })
    setOpen(true)
  }

  async function remove(d: DispatchT): Promise<void> {
    const ok = await confirmDialog({ title: 'Delete sale', message: `Delete ${d.dispatch_no}? Stock will be restored.${d.linked_purchase_id ? ' The linked inter-plant purchase will also be removed.' : ''}` })
    if (!ok) return
    const res = await api.dispatches.delete(d.id)
    if (res.ok) {
      qc.invalidateQueries()
      toast.success('Sale deleted.')
    } else toast.error(res.error || 'Could not delete.')
  }

  // Transporter cost-line helpers
  const tlines = form?.transporters ?? []
  function addTransporter(): void { setForm({ ...form, transporters: [...tlines, { transporter_id: 0, vehicle_no: '', basis: 'flat', qty: '', rate: '', charge: '' }] }) }
  function setTransporter(i: number, patch: any): void { setForm({ ...form, transporters: tlines.map((t: any, idx: number) => (idx === i ? { ...t, ...patch } : t)) }) }
  function delTransporter(i: number): void { setForm({ ...form, transporters: tlines.filter((_: any, idx: number) => idx !== i) }) }

  // Machine cost-line helpers
  const mlines = form?.machines ?? []
  function addMachine(): void { setForm({ ...form, machines: [...mlines, { asset_id: 0, basis: 'hour', qty: '', rate: '', outsource_id: null }] }) }
  function setMachine(i: number, patch: any): void { setForm({ ...form, machines: mlines.map((m: any, idx: number) => (idx === i ? { ...m, ...patch } : m)) }) }
  function delMachine(i: number): void { setForm({ ...form, machines: mlines.filter((_: any, idx: number) => idx !== i) }) }

  function submit(): void {
    const interPlant = form.sell_mode === 'plant'
    save.mutate({
      ...form,
      to_plant_id: interPlant ? Number(form.to_plant_id) || null : null,
      quantity: Number(form.quantity),
      sale_quantity: form.sale_quantity === '' || form.sale_quantity == null ? null : Number(form.sale_quantity),
      rate: form.rate === '' || form.rate == null ? null : Number(form.rate),
      transport_charge: Number(form.transport_charge) || 0,
      other_charge: Number(form.other_charge) || 0,
      paid_amount: Number(form.paid_amount) || 0,
      transport_billed: !!form.transport_billed,
      other_billed: !!form.other_billed,
      // Inter-plant always uses real plant stock (never outsourced).
      outsourced: interPlant ? false : !!form.outsourced,
      transporters: (form.transporters ?? [])
        .filter((t: any) => t.transporter_id)
        .map((t: any) => ({
          transporter_id: Number(t.transporter_id),
          vehicle_no: t.vehicle_no || '',
          basis: t.basis || 'flat',
          qty: Number(t.qty) || 0,
          rate: Number(t.rate) || 0,
          charge: Number(t.charge) || 0
        })),
      machines: (form.machines ?? [])
        .filter((m: any) => m.asset_id)
        .map((m: any) => ({ asset_id: Number(m.asset_id), basis: m.basis || 'hour', qty: Number(m.qty) || 0, rate: Number(m.rate) || 0, outsource_id: m.outsource_id ? Number(m.outsource_id) : null }))
    })
  }

  function exportExcel(): void {
    downloadExcel(
      'direct-sales',
      'Direct Sales',
      ['Sale No', 'Date', 'Customer / Plant', 'Plant', 'Product', 'Qty', 'UOM', 'Rate', 'Goods Amt',
        'Transport', 'Other', 'Invoice Total', 'Transport Cost', 'Machine Cost', 'Paid', 'Vehicle', 'Vehicle Type', 'Challan', 'Delivery', 'Payment'],
      data.map((d) => [
        d.dispatch_no, fmtDate(d.date), d.to_plant_id ? `${d.to_plant_name} (plant)` : d.customer_name, d.plant_name, d.product_name,
        d.quantity, d.uom, d.rate ?? '', d.amount ?? '', d.transport_charge, d.other_charge,
        d.billed_total ?? '', d.transport_total ?? 0, d.machine_total ?? 0, d.paid_amount, d.vehicle_no, vehicleLabel[d.vehicle_type], d.challan_no,
        d.delivery_status, d.payment_status
      ])
    )
  }

  const interPlant = form?.sell_mode === 'plant'
  const formPlant = plants.find((pl) => pl.id === form?.plant_id)
  const actualQty = Number(form?.quantity) || 0
  // Sale qty is optional; until it's entered the bill uses the actual quantity.
  const saleSet = !!form && form.sale_quantity !== '' && form.sale_quantity != null
  const saleQty = saleSet ? Number(form.sale_quantity) || 0 : null
  const billableQty = saleQty != null ? saleQty : actualQty
  const shortageQty = saleQty != null ? actualQty - saleQty : 0
  const qtyCm = form ? toCm(actualQty, form.uom, formPlant) : 0
  const goods = form && form.rate !== '' ? billableQty * Number(form.rate) : 0
  const billedExtra = form
    ? (form.transport_billed ? Number(form.transport_charge) || 0 : 0) +
      (form.other_billed ? Number(form.other_charge) || 0 : 0)
    : 0
  const invoiceTotal = goods + billedExtra
  const available = form
    ? (selProduct?.balance_qty ?? 0) + (form.id ? Number(form.qty_cm) || 0 : 0)
    : 0
  const lineCharge = (t: any): number =>
    t.basis === 'trip' || t.basis === 'uom' ? (Number(t.qty) || 0) * (Number(t.rate) || 0) : Number(t.charge) || 0
  const transportCost = (form?.transporters ?? []).reduce((s: number, t: any) => s + lineCharge(t), 0)
  const machineCost = (form?.machines ?? []).reduce((s: number, m: any) => s + (Number(m.qty) || 0) * (Number(m.rate) || 0), 0)
  const destPlants = plants.filter((p) => p.id !== form?.plant_id)

  const canSave =
    !!form &&
    !!form.product_name &&
    Number(form.quantity) > 0 &&
    (interPlant ? !!form.to_plant_id : !!form.customer_id) &&
    (interPlant || !form.outsourced ? qtyCm <= available : true)

  return (
    <>
      <PageHeader
        title="Direct Sale"
        description="Load from the plant and sell to a customer — or transfer to your own other plant"
        actions={
          <>
            <Button variant="outline" onClick={exportExcel} disabled={!data.length}>
              <FileSpreadsheet size={16} /> Excel
            </Button>
            <Button onClick={openNew} disabled={!customers.length || !plants.length}>
              <Plus size={16} /> New Sale
            </Button>
          </>
        }
      />
      <Page>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <SearchSelect
            className="w-full sm:w-48"
            value={filter.customer_id ?? ''}
            onChange={(v) => setFilter({ ...filter, customer_id: v ? Number(v) : undefined })}
            options={[{ value: '', label: 'All customers' }, ...customers.map((c) => ({ value: c.id, label: c.name }))]}
            placeholder="All customers"
          />
          <SearchSelect
            className="w-full sm:w-44"
            value={filter.delivery_status ?? ''}
            onChange={(v) => setFilter({ ...filter, delivery_status: v || undefined })}
            options={[{ value: '', label: 'All deliveries' }, { value: 'pending', label: 'Pending' }, { value: 'delivered', label: 'Delivered' }]}
            placeholder="All deliveries"
          />
          <SearchSelect
            className="w-full sm:w-44"
            value={filter.payment_status ?? ''}
            onChange={(v) => setFilter({ ...filter, payment_status: v || undefined })}
            options={[{ value: '', label: 'All payments' }, { value: 'unpaid', label: 'Unpaid' }, { value: 'partial', label: 'Partial' }, { value: 'paid', label: 'Paid' }]}
            placeholder="All payments"
          />
        </div>

        {data.length === 0 ? (
          <EmptyState message="No direct sales found." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Sale</TH>
                <TH>Buyer</TH>
                <TH>Item</TH>
                <TH className="text-right">Quantity</TH>
                <TH className="text-right">Rate</TH>
                <TH className="text-right">Invoice</TH>
                <TH>Status</TH>
                <TH className="text-right"></TH>
              </TR>
            </THead>
            <TBody>
              {data.map((d) => (
                <TR key={d.id}>
                  <TD>
                    <div className="font-mono text-[13px] font-semibold">{d.dispatch_no}</div>
                    <div className="text-[11px] text-muted-foreground">{fmtDate(d.date)}</div>
                  </TD>
                  <TD>
                    {d.to_plant_id ? (
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        {d.to_plant_name}<Badge variant="default">Plant</Badge>
                      </span>
                    ) : (
                      <span className="font-medium">{d.customer_name}</span>
                    )}
                  </TD>
                  <TD>
                    <div className="text-[13px]">
                      <span className="text-muted-foreground">{d.plant_name}</span>
                      <span className="mx-1 text-muted-foreground">·</span>
                      <span className="font-medium">{d.product_name}</span>
                    </div>
                    {d.outsourced ? (
                      <div className="text-[11px] text-muted-foreground">
                        Outsourced{d.outsource_name ? ` · ${d.outsource_name}${d.outsource_head ? ` (${d.outsource_head})` : ''}` : ''}
                      </div>
                    ) : null}
                    {(d.vehicle_no || d.challan_no) && (
                      <div className="text-[11px] text-muted-foreground">
                        {vehicleLabel[d.vehicle_type]}
                        {d.vehicle_no ? ` · ${d.vehicle_no}` : ''}
                        {d.challan_no ? ` · Challan ${d.challan_no}` : ''}
                      </div>
                    )}
                    {((d.transport_total ?? 0) > 0 || (d.machine_total ?? 0) > 0) && (
                      <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                        {(d.transport_total ?? 0) > 0 && <span>🚚 {fmtMoney(d.transport_total)}</span>}
                        {(d.machine_total ?? 0) > 0 && <span>⚙ {fmtMoney(d.machine_total)}</span>}
                      </div>
                    )}
                  </TD>
                  <TD className="text-right">
                    <span className="tnum">{fmtQty(d.quantity)}</span> <span className="text-xs text-muted-foreground">{d.uom}</span>
                    {d.sale_quantity != null && d.quantity - d.sale_quantity !== 0 && (
                      <div className="text-[11px] text-muted-foreground">
                        sold {fmtQty(d.sale_quantity)}
                        <span className={d.quantity - d.sale_quantity > 0 ? 'text-warning' : 'text-destructive'}>
                          {' · '}±{fmtQty(Math.abs(d.quantity - d.sale_quantity))}
                        </span>
                      </div>
                    )}
                  </TD>
                  <TD className="tnum text-right">{d.rate == null ? <Badge variant="warning">No rate</Badge> : fmtMoney(d.rate)}</TD>
                  <TD className="tnum text-right font-semibold">{fmtMoney(d.billed_total)}</TD>
                  <TD>
                    <div className="flex flex-col items-start gap-1">
                      <Badge variant={d.delivery_status === 'delivered' ? 'success' : 'muted'}>{d.delivery_status}</Badge>
                      <Badge variant={payBadge[d.payment_status]}>{d.payment_status}</Badge>
                    </div>
                  </TD>
                  <TD className="text-right">
                    <div className="flex justify-end">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(d)}>
                        <Pencil size={15} />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => remove(d)}>
                        <Trash2 size={15} className="text-destructive" />
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Page>

      {form && (
        <Modal open={open} onClose={() => setOpen(false)} title={form.id ? `Edit ${form.dispatch_no}` : 'New Direct Sale'} width="max-w-4xl">
          <div className="space-y-5">
            {/* Sell-to mode */}
            <div className="flex flex-wrap gap-2">
              {([['customer', 'Sell to Customer'], ['plant', 'Transfer to Own Plant']] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setForm({ ...form, sell_mode: key, to_plant_id: key === 'plant' ? form.to_plant_id : null, outsourced: key === 'plant' ? false : form.outsourced })}
                  className={cn(
                    'rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors',
                    form.sell_mode === key ? 'border-primary bg-primary/5 text-foreground' : 'border-input text-muted-foreground hover:bg-accent'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Buyer & product */}
            <Section title={interPlant ? 'Destination & Product' : 'Customer & Product'}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Invoice / Voucher No." hint={form.id ? 'Edit to renumber' : 'Blank = auto'}>
                  <Input value={form.dispatch_no || ''} onChange={(e) => setForm({ ...form, dispatch_no: e.target.value })} placeholder="Auto-generate" />
                </Field>
                {interPlant ? (
                  <Field label="Destination Plant" required hint="Auto-creates a finished-goods purchase there">
                    <SearchSelect
                      value={form.to_plant_id ?? ''}
                      onChange={(v) => setForm({ ...form, to_plant_id: v ? Number(v) : null })}
                      options={destPlants.map((p) => ({ value: p.id, label: p.name }))}
                      placeholder="Select plant…"
                    />
                  </Field>
                ) : (
                  <Field label="Customer / Party" required>
                    <SearchSelect
                      value={form.customer_id || ''}
                      onChange={(v) => setForm({ ...form, customer_id: Number(v) })}
                      options={customers.map((c) => ({ value: c.id, label: c.name }))}
                      placeholder="Select customer…"
                    />
                  </Field>
                )}
                <Field label="Source Plant" required hint={plantId ? 'Locked to active plant' : undefined}>
                  <SearchSelect
                    value={form.plant_id || ''}
                    disabled={!!plantId}
                    onChange={(v) => setForm({ ...form, plant_id: Number(v), product_name: '', to_plant_id: form.to_plant_id === Number(v) ? null : form.to_plant_id })}
                    options={plants.map((p) => ({ value: p.id, label: p.name }))}
                    placeholder="Select plant…"
                  />
                </Field>
                <Field label="Date" required>
                  <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                </Field>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <Field label="Product" required hint={!form.outsourced && selProduct ? `Available: ${fmtQty(selProduct.balance_qty)} m³` : undefined}>
                    {form.outsourced ? (
                      <Input value={form.product_name} onChange={(e) => setForm({ ...form, product_name: e.target.value })} placeholder="Outsourced product name" />
                    ) : (
                      <SearchSelect
                        value={form.product_name}
                        onChange={(v) => setForm({ ...form, product_name: v })}
                        options={[
                          ...avail.map((a) => ({ value: a.product_name, label: `${a.product_name} (${fmtQty(a.balance_qty)} m³)` })),
                          ...(form.id && form.product_name && !avail.some((a) => a.product_name === form.product_name)
                            ? [{ value: form.product_name, label: form.product_name }]
                            : [])
                        ]}
                        placeholder="Select product…"
                      />
                    )}
                  </Field>
                </div>
                {!interPlant && (
                  <label
                    className={cn(
                      'flex cursor-pointer items-start gap-2 self-end rounded-lg border px-3 py-2 text-sm transition-colors',
                      form.outsourced ? 'border-primary bg-primary/5' : 'border-input hover:bg-accent'
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0"
                      checked={!!form.outsourced}
                      onChange={(e) => setForm({ ...form, outsourced: e.target.checked, product_name: '', outsource_id: e.target.checked ? form.outsource_id : null })}
                    />
                    <span className="font-medium leading-tight">
                      Outsourced
                      <span className="block text-[11px] font-normal text-muted-foreground">Sold without using plant stock</span>
                    </span>
                  </label>
                )}
              </div>
              {form.outsourced && !interPlant && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Outsource Vendor" hint="Who the outsourced material came from">
                    <SearchSelect
                      value={form.outsource_id ?? ''}
                      onChange={(v) => setForm({ ...form, outsource_id: v ? Number(v) : null })}
                      options={[{ value: '', label: '— Select vendor —' }, ...outsourceVendors.map((o) => ({ value: o.id, label: `${o.name}${o.head ? ` — ${o.head}` : ''}` }))]}
                      placeholder="— Select vendor —"
                    />
                  </Field>
                </div>
              )}
            </Section>

            {/* Quantity & rate */}
            <Section title="Quantity & Rate">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Field label="Unit (UOM)" required hint="1 m³ = 1.6 ton = 35.31 cft">
                  <SearchSelect
                    value={form.uom}
                    onChange={(v) => setForm({ ...form, uom: v as Uom })}
                    options={UOMS.map((u) => ({ value: u, label: u === 'CM' ? 'm³' : u === 'TON' ? 'Ton' : 'CFT' }))}
                  />
                </Field>
                <Field label={`Actual Qty (${form.uom})`} required hint={qtyCm > 0 ? `${fmtQty(qtyCm)} m³ off stock` : 'Dispatched from plant'}>
                  <Input type="number" step="0.001" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
                </Field>
                <Field
                  label={`Sale Qty (${form.uom})`}
                  hint={
                    saleQty != null
                      ? shortageQty > 0
                        ? `Shortage ${fmtQty(shortageQty)} ${form.uom}`
                        : shortageQty < 0
                          ? `Excess ${fmtQty(-shortageQty)} ${form.uom}`
                          : 'No shortage'
                      : 'Add later — bills actual until set'
                  }
                >
                  <Input type="number" step="0.001" value={form.sale_quantity} onChange={(e) => setForm({ ...form, sale_quantity: e.target.value })} placeholder="Optional" />
                </Field>
                <Field label={`Rate per ${form.uom}`} hint={interPlant ? 'Transfer price to the other plant' : undefined}>
                  <Input type="number" step="0.01" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} placeholder="Optional" />
                </Field>
              </div>
            </Section>

            {/* Vehicle & delivery */}
            <Section title="Vehicle & Delivery">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Field label="Vehicle Type" required>
                  <SearchSelect
                    value={form.vehicle_type}
                    onChange={(v) => setForm({ ...form, vehicle_type: v as VehicleType })}
                    options={[{ value: 'own', label: 'Own Vehicle' }, { value: 'rented', label: 'Rented' }, { value: 'party', label: 'From Party' }]}
                  />
                </Field>
                <Field label="Vehicle No.">
                  <Input value={form.vehicle_no} onChange={(e) => setForm({ ...form, vehicle_no: e.target.value })} placeholder="e.g. JH-01-AB-1234" />
                </Field>
                <Field label="Driver">
                  <Input value={form.driver} onChange={(e) => setForm({ ...form, driver: e.target.value })} />
                </Field>
                <Field label="Challan No.">
                  <Input value={form.challan_no} onChange={(e) => setForm({ ...form, challan_no: e.target.value })} />
                </Field>
                <Field label="Delivery Status" required>
                  <SearchSelect
                    value={form.delivery_status}
                    onChange={(v) => setForm({ ...form, delivery_status: v })}
                    options={[{ value: 'pending', label: 'Pending' }, { value: 'delivered', label: 'Delivered' }]}
                  />
                </Field>
              </div>
            </Section>

            {/* Transport cost lines */}
            <Section title="Transport — cost lines (optional)">
              <div className="space-y-2">
                {tlines.length > 0 && (
                  <div className="grid grid-cols-[1fr_92px_96px_64px_76px_90px_32px] gap-2 px-1 text-[11px] font-semibold uppercase text-muted-foreground">
                    <div>Transporter</div><div>Vehicle</div><div>Basis</div><div>Qty</div><div>Rate ₹</div><div>Charge ₹</div><div></div>
                  </div>
                )}
                {tlines.map((t: any, i: number) => {
                  const computed = t.basis === 'trip' || t.basis === 'uom'
                  return (
                    <div key={i} className="grid grid-cols-[1fr_92px_96px_64px_76px_90px_32px] items-center gap-2">
                      <SearchSelect
                        value={t.transporter_id || ''}
                        onChange={(v) => setTransporter(i, { transporter_id: Number(v) })}
                        options={transporters.map((tr) => ({ value: tr.id, label: tr.name }))}
                        placeholder="Transporter…"
                      />
                      <Input value={t.vehicle_no} onChange={(e) => setTransporter(i, { vehicle_no: e.target.value })} placeholder="JH01AB1234" />
                      <SearchSelect
                        value={t.basis || 'flat'}
                        onChange={(v) => setTransporter(i, { basis: v })}
                        options={[{ value: 'flat', label: 'Flat' }, { value: 'trip', label: 'Per Trip' }, { value: 'uom', label: `Per ${form.uom || 'UOM'}` }]}
                      />
                      <Input type="number" step="0.01" value={computed ? t.qty : ''} disabled={!computed}
                        placeholder={computed ? '' : '—'} onChange={(e) => setTransporter(i, { qty: e.target.value })} />
                      <Input type="number" step="0.01" value={computed ? t.rate : ''} disabled={!computed}
                        placeholder={computed ? '' : '—'} onChange={(e) => setTransporter(i, { rate: e.target.value })} />
                      {computed ? (
                        <Input type="text" value={fmtMoney(lineCharge(t))} disabled className="text-right font-medium" />
                      ) : (
                        <Input type="number" step="0.01" value={t.charge} onChange={(e) => setTransporter(i, { charge: e.target.value })} />
                      )}
                      <Button variant="ghost" size="icon" onClick={() => delTransporter(i)}><X size={15} className="text-destructive" /></Button>
                    </div>
                  )
                })}
              </div>
              <Button variant="outline" size="sm" className="mt-2" disabled={!transporters.length} onClick={addTransporter}>
                <Plus size={14} /> Add Transporter
              </Button>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {transporters.length
                  ? "Your transport cost — posts to the transporter's ledger and the plant. (To charge the customer for delivery, use Transport Charges below.)"
                  : 'Add transporters under Transporters first.'}
              </p>
            </Section>

            {/* Machine cost lines */}
            <Section title="Machines (optional) — posts to Equipment Rent">
              <div className="space-y-2">
                {mlines.length > 0 && (
                  <div className="grid grid-cols-[1fr_90px_80px_90px_1fr_32px] gap-2 px-1 text-[11px] font-semibold uppercase text-muted-foreground">
                    <div>Machine</div><div>Basis</div><div>Qty</div><div>Rate ₹</div><div>Vendor (opt)</div><div></div>
                  </div>
                )}
                {mlines.map((m: any, i: number) => (
                  <div key={i} className="grid grid-cols-[1fr_90px_80px_90px_1fr_32px] items-center gap-2">
                    <SearchSelect
                      value={m.asset_id || ''}
                      onChange={(v) => setMachine(i, { asset_id: Number(v) })}
                      options={assets.map((a) => ({ value: a.id, label: a.name }))}
                      placeholder="Machine…"
                    />
                    <SearchSelect
                      value={m.basis || 'hour'}
                      onChange={(v) => setMachine(i, { basis: v as MachineBasis })}
                      options={[{ value: 'hour', label: 'Per Hour' }, { value: 'cm', label: 'Per m³' }]}
                    />
                    <Input type="number" step="0.01" value={m.qty} onChange={(e) => setMachine(i, { qty: e.target.value })} />
                    <Input type="number" step="0.01" value={m.rate} onChange={(e) => setMachine(i, { rate: e.target.value })} />
                    <SearchSelect
                      value={m.outsource_id ?? ''}
                      onChange={(v) => setMachine(i, { outsource_id: v ? Number(v) : null })}
                      options={[{ value: '', label: '— None —' }, ...outsourceVendors.map((o) => ({ value: o.id, label: o.name }))]}
                      placeholder="— None —"
                    />
                    <Button variant="ghost" size="icon" onClick={() => delMachine(i)}><X size={15} className="text-destructive" /></Button>
                  </div>
                ))}
              </div>
              <Button variant="outline" size="sm" className="mt-2" disabled={!assets.length} onClick={addMachine}>
                <Plus size={14} /> Add Machine
              </Button>
              {!assets.length && <p className="mt-1 text-[11px] text-muted-foreground">Add machines under Machinery &amp; Vehicles first.</p>}
            </Section>

            {/* Charges & payment */}
            <Section title="Charges & Payment">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <ChargeField
                  label="Transport Charges"
                  amount={form.transport_charge}
                  billed={form.transport_billed}
                  onAmount={(v) => setForm({ ...form, transport_charge: v })}
                  onBilled={(v) => setForm({ ...form, transport_billed: v })}
                />
                <ChargeField
                  label="Other Charges"
                  amount={form.other_charge}
                  billed={form.other_billed}
                  onAmount={(v) => setForm({ ...form, other_charge: v })}
                  onBilled={(v) => setForm({ ...form, other_billed: v })}
                />
                <Field label="Amount Received" hint="Sets payment status automatically">
                  <Input type="number" step="0.01" value={form.paid_amount} onChange={(e) => setForm({ ...form, paid_amount: e.target.value })} />
                </Field>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="Payment Status">
                  <div className="flex h-9 items-center">
                    <Badge variant={payBadge[derivePaymentStatus(invoiceTotal, Number(form.paid_amount) || 0)]}>
                      {derivePaymentStatus(invoiceTotal, Number(form.paid_amount) || 0)}
                    </Badge>
                  </div>
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Remarks">
                    <Input value={form.remarks || ''} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
                  </Field>
                </div>
              </div>
            </Section>

            {/* Summary */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border bg-muted/40 px-4 py-3 text-sm">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Stock</div>
                {form.outsourced && !interPlant ? (
                  <div className="mt-1 font-medium text-primary">Outsourced — no plant stock used</div>
                ) : (
                  <div className="mt-1">
                    Available <b>{fmtQty(available)} m³</b>
                    {qtyCm > available && <span className="ml-2 font-semibold text-destructive">— exceeds stock!</span>}
                  </div>
                )}
                {interPlant && form.to_plant_id && (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Adds <b>{fmtQty(qtyCm)} m³</b> to {plants.find((p) => p.id === Number(form.to_plant_id))?.name}
                  </div>
                )}
              </div>
              <div className="rounded-xl border bg-muted/40 px-4 py-3 text-sm">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Invoice {saleQty != null ? '(on sale qty)' : '(on actual qty)'}
                </div>
                <div className="mt-1">
                  Goods <b>{fmtMoney(goods)}</b>
                  {billedExtra > 0 && <> + charges <b>{fmtMoney(billedExtra)}</b></>}
                  {' = '}
                  <b className="text-primary">{fmtMoney(invoiceTotal)}</b>
                </div>
              </div>
              <div className="rounded-xl border bg-muted/40 px-4 py-3 text-sm">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Your costs</div>
                <div className="mt-1">Transport <b>{fmtMoney(transportCost)}</b> · Machines <b>{fmtMoney(machineCost)}</b></div>
              </div>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={!canSave}>
              Save Sale
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground/80">{title}</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      {children}
    </section>
  )
}

function ChargeField({
  label,
  amount,
  billed,
  onAmount,
  onBilled
}: {
  label: string
  amount: string
  billed: boolean
  onAmount: (v: string) => void
  onBilled: (v: boolean) => void
}): React.JSX.Element {
  return (
    <Field label={label} hint="Tick to add to the customer's bill">
      <div className="flex items-center gap-2">
        <Input type="number" step="0.01" value={amount} onChange={(e) => onAmount(e.target.value)} placeholder="0" />
        <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <input type="checkbox" checked={billed} onChange={(e) => onBilled(e.target.checked)} className="h-4 w-4" />
          Bill
        </label>
      </div>
    </Field>
  )
}

function cleanFilter(f: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(f)) if (v != null && v !== '') out[k] = v
  return out
}
