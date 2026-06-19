import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, FileSpreadsheet } from 'lucide-react'
import { api } from '@/lib/api'
import type { Dispatch as DispatchT, PaymentStatus, Uom, VehicleType } from '@shared/types'
import { toCm, fromCm, UOMS, derivePaymentStatus } from '@shared/types'
import { PageHeader, Page } from '@/components/layout'
import {
  Button,
  Input,
  Select,
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

  function openNew(): void {
    setForm({
      customer_id: customers[0]?.id,
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
      remarks: ''
    })
    setOpen(true)
  }

  async function remove(d: DispatchT): Promise<void> {
    const ok = await confirmDialog({ title: 'Delete sale', message: `Delete ${d.dispatch_no}? Stock will be restored.` })
    if (!ok) return
    const res = await api.dispatches.delete(d.id)
    if (res.ok) {
      qc.invalidateQueries()
      toast.success('Sale deleted.')
    } else toast.error(res.error || 'Could not delete.')
  }

  function submit(): void {
    save.mutate({
      ...form,
      quantity: Number(form.quantity),
      sale_quantity: form.sale_quantity === '' || form.sale_quantity == null ? null : Number(form.sale_quantity),
      rate: form.rate === '' || form.rate == null ? null : Number(form.rate),
      transport_charge: Number(form.transport_charge) || 0,
      other_charge: Number(form.other_charge) || 0,
      paid_amount: Number(form.paid_amount) || 0,
      transport_billed: !!form.transport_billed,
      other_billed: !!form.other_billed
    })
  }

  function exportExcel(): void {
    downloadExcel(
      'direct-sales',
      'Direct Sales',
      ['Sale No', 'Date', 'Customer', 'Plant', 'Product', 'Qty', 'UOM', 'Rate', 'Goods Amt',
        'Transport', 'Other', 'Invoice Total', 'Paid', 'Vehicle', 'Vehicle Type', 'Challan', 'Delivery', 'Payment'],
      data.map((d) => [
        d.dispatch_no, fmtDate(d.date), d.customer_name, d.plant_name, d.product_name,
        d.quantity, d.uom, d.rate ?? '', d.amount ?? '', d.transport_charge, d.other_charge,
        d.billed_total ?? '', d.paid_amount, d.vehicle_no, vehicleLabel[d.vehicle_type], d.challan_no,
        d.delivery_status, d.payment_status
      ])
    )
  }

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

  return (
    <>
      <PageHeader
        title="Direct Sale"
        description="Load from the plant and sell straight to the customer at the unloading point"
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
          <Select className="w-full sm:w-48" value={filter.customer_id ?? ''} onChange={(e) => setFilter({ ...filter, customer_id: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">All customers</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select className="w-full sm:w-44" value={filter.delivery_status ?? ''} onChange={(e) => setFilter({ ...filter, delivery_status: e.target.value || undefined })}>
            <option value="">All deliveries</option>
            <option value="pending">Pending</option>
            <option value="delivered">Delivered</option>
          </Select>
          <Select className="w-full sm:w-44" value={filter.payment_status ?? ''} onChange={(e) => setFilter({ ...filter, payment_status: e.target.value || undefined })}>
            <option value="">All payments</option>
            <option value="unpaid">Unpaid</option>
            <option value="partial">Partial</option>
            <option value="paid">Paid</option>
          </Select>
        </div>

        {data.length === 0 ? (
          <EmptyState message="No direct sales found." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Sale No</TH>
                <TH>Date</TH>
                <TH>Customer</TH>
                <TH>Plant / Product</TH>
                <TH className="text-right">Qty</TH>
                <TH className="text-right">Rate</TH>
                <TH className="text-right">Invoice</TH>
                <TH>Vehicle</TH>
                <TH>Challan</TH>
                <TH>Delivery</TH>
                <TH>Payment</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {data.map((d) => (
                <TR key={d.id}>
                  <TD className="font-mono text-xs font-medium">{d.dispatch_no}</TD>
                  <TD>{fmtDate(d.date)}</TD>
                  <TD className="font-medium">{d.customer_name}</TD>
                  <TD className="text-muted-foreground">
                    {d.plant_name} / {d.product_name}
                    {d.outsourced ? (
                      <span className="block text-[11px]">
                        Outsourced{d.outsource_name ? ` · ${d.outsource_name}${d.outsource_head ? ` (${d.outsource_head})` : ''}` : ''}
                      </span>
                    ) : null}
                  </TD>
                  <TD className="text-right">
                    {fmtQty(d.quantity)} <span className="text-xs text-muted-foreground">{d.uom}</span>
                    {d.sale_quantity != null && (
                      <span className="block text-[11px] text-muted-foreground">
                        sold {fmtQty(d.sale_quantity)}
                        {d.quantity - d.sale_quantity !== 0 && (
                          <span className={d.quantity - d.sale_quantity > 0 ? 'text-warning' : 'text-destructive'}>
                            {' · '}±{fmtQty(Math.abs(d.quantity - d.sale_quantity))}
                          </span>
                        )}
                      </span>
                    )}
                  </TD>
                  <TD className="text-right">{d.rate == null ? <Badge variant="warning">No rate</Badge> : fmtMoney(d.rate)}</TD>
                  <TD className="text-right font-semibold">{fmtMoney(d.billed_total)}</TD>
                  <TD className="text-muted-foreground">
                    {d.vehicle_no || '-'}
                    <span className="block text-[11px]">
                      {vehicleLabel[d.vehicle_type]}{d.transporter_name ? ` · ${d.transporter_name}` : ''}
                    </span>
                  </TD>
                  <TD className="font-mono text-xs">{d.challan_no || '-'}</TD>
                  <TD><Badge variant={d.delivery_status === 'delivered' ? 'success' : 'muted'}>{d.delivery_status}</Badge></TD>
                  <TD><Badge variant={payBadge[d.payment_status]}>{d.payment_status}</Badge></TD>
                  <TD className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => { setForm({ ...d, rate: d.rate ?? '', sale_quantity: d.sale_quantity ?? '', transport_billed: !!d.transport_billed, other_billed: !!d.other_billed }); setOpen(true) }}>
                      <Pencil size={15} />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(d)}>
                      <Trash2 size={15} className="text-destructive" />
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Page>

      {form && (
        <Modal open={open} onClose={() => setOpen(false)} title={form.id ? `Edit ${form.dispatch_no}` : 'New Direct Sale'} width="max-w-3xl">
          <div className="space-y-5">
            {/* Customer & product */}
            <Section title="Customer & Product">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="Customer / Party" required>
                  <Select value={form.customer_id || ''} onChange={(e) => setForm({ ...form, customer_id: Number(e.target.value) })}>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                </Field>
                <Field label="Plant" required hint={plantId ? 'Locked to active plant' : undefined}>
                  <Select value={form.plant_id || ''} disabled={!!plantId} onChange={(e) => setForm({ ...form, plant_id: Number(e.target.value), product_name: '' })}>
                    {plants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
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
                      <Select value={form.product_name} onChange={(e) => setForm({ ...form, product_name: e.target.value })}>
                        <option value="">Select product…</option>
                        {avail.map((a) => <option key={a.product_name} value={a.product_name}>{a.product_name} ({fmtQty(a.balance_qty)} m³)</option>)}
                        {form.id && form.product_name && !avail.some((a) => a.product_name === form.product_name) && (
                          <option value={form.product_name}>{form.product_name}</option>
                        )}
                      </Select>
                    )}
                  </Field>
                </div>
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
              </div>
              {form.outsourced && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Outsource Vendor" hint="Who the outsourced material came from">
                    <Select
                      value={form.outsource_id ?? ''}
                      onChange={(e) => setForm({ ...form, outsource_id: e.target.value ? Number(e.target.value) : null })}
                    >
                      <option value="">— Select vendor —</option>
                      {outsourceVendors.map((o) => (
                        <option key={o.id} value={o.id}>{o.name}{o.head ? ` — ${o.head}` : ''}</option>
                      ))}
                    </Select>
                  </Field>
                </div>
              )}
            </Section>

            {/* Quantity & rate */}
            <Section title="Quantity & Rate">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Field label="Unit (UOM)" required hint="1 m³ = 1.6 ton = 35.31 cft">
                  <Select value={form.uom} onChange={(e) => setForm({ ...form, uom: e.target.value as Uom })}>
                    {UOMS.map((u) => <option key={u} value={u}>{u === 'CM' ? 'm³' : u === 'TON' ? 'Ton' : 'CFT'}</option>)}
                  </Select>
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
                <Field label={`Rate per ${form.uom}`}>
                  <Input type="number" step="0.01" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} placeholder="Optional" />
                </Field>
              </div>
            </Section>

            {/* Vehicle & delivery */}
            <Section title="Vehicle & Delivery">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Field label="Vehicle Type" required>
                  <Select value={form.vehicle_type} onChange={(e) => setForm({ ...form, vehicle_type: e.target.value as VehicleType })}>
                    <option value="own">Own Vehicle</option>
                    <option value="rented">Rented</option>
                    <option value="party">From Party</option>
                  </Select>
                </Field>
                <Field label="Transporter" hint="Transport charge posts to this transporter's ledger">
                  <Select
                    value={form.transporter_id ?? ''}
                    onChange={(e) => setForm({ ...form, transporter_id: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">— None —</option>
                    {transporters.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </Select>
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
                  <Select value={form.delivery_status} onChange={(e) => setForm({ ...form, delivery_status: e.target.value })}>
                    <option value="pending">Pending</option>
                    <option value="delivered">Delivered</option>
                  </Select>
                </Field>
              </div>
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl border bg-muted/40 px-4 py-3 text-sm">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Stock</div>
                {form.outsourced ? (
                  <div className="mt-1 font-medium text-primary">Outsourced — no plant stock used</div>
                ) : (
                  <div className="mt-1">
                    Available <b>{fmtQty(available)} m³</b>
                    {qtyCm > available && <span className="ml-2 font-semibold text-destructive">— exceeds stock!</span>}
                  </div>
                )}
                {saleQty != null && shortageQty !== 0 && (
                  <div className="mt-0.5 text-xs">
                    Sold <b>{fmtQty(billableQty)} {form.uom}</b> ·{' '}
                    <span className={shortageQty > 0 ? 'text-warning' : 'text-destructive'}>
                      {shortageQty > 0 ? 'shortage' : 'excess'} {fmtQty(Math.abs(shortageQty))} {form.uom}
                    </span>
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
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={!form.customer_id || !form.product_name || !(Number(form.quantity) > 0) || (!form.outsourced && qtyCm > available)}>
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
