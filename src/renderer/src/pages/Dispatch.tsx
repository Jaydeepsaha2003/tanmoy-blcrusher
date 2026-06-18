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
import { fmtQty, fmtMoney, fmtDate, today, downloadExcel } from '@/lib/utils'

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
      uom: 'CM' as Uom,
      quantity: '',
      rate: '',
      transport_charge: '',
      transport_billed: false,
      other_charge: '',
      other_billed: false,
      vehicle_no: '',
      vehicle_type: 'own' as VehicleType,
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
  const qtyCm = form ? toCm(Number(form.quantity) || 0, form.uom, formPlant) : 0
  const goods = form && form.rate !== '' ? (Number(form.quantity) || 0) * Number(form.rate) : 0
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
                  <TD className="text-muted-foreground">{d.plant_name} / {d.product_name}</TD>
                  <TD className="text-right">{fmtQty(d.quantity)} <span className="text-xs text-muted-foreground">{d.uom}</span></TD>
                  <TD className="text-right">{d.rate == null ? <Badge variant="warning">No rate</Badge> : fmtMoney(d.rate)}</TD>
                  <TD className="text-right font-semibold">{fmtMoney(d.billed_total)}</TD>
                  <TD className="text-muted-foreground">
                    {d.vehicle_no || '-'}
                    <span className="block text-[11px]">{vehicleLabel[d.vehicle_type]}</span>
                  </TD>
                  <TD className="font-mono text-xs">{d.challan_no || '-'}</TD>
                  <TD><Badge variant={d.delivery_status === 'delivered' ? 'success' : 'muted'}>{d.delivery_status}</Badge></TD>
                  <TD><Badge variant={payBadge[d.payment_status]}>{d.payment_status}</Badge></TD>
                  <TD className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => { setForm({ ...d, rate: d.rate ?? '', transport_billed: !!d.transport_billed, other_billed: !!d.other_billed }); setOpen(true) }}>
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
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
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
            <div className="col-span-2 -mt-1 md:col-span-3">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" className="h-4 w-4" checked={!!form.outsourced} onChange={(e) => setForm({ ...form, outsourced: e.target.checked, product_name: '' })} />
                Outsourced material — sold directly without holding plant stock
              </label>
            </div>
            <Field label="Unit of Measure" required hint="1 m³ = 1.6 ton = 35.31 cft">
              <Select value={form.uom} onChange={(e) => setForm({ ...form, uom: e.target.value as Uom })}>
                {UOMS.map((u) => <option key={u} value={u}>{u === 'CM' ? 'Cubic Meter (m³)' : u === 'TON' ? 'Ton' : 'Cubic Feet (CFT)'}</option>)}
              </Select>
            </Field>
            <Field label={`Quantity (${form.uom})`} required hint={qtyCm > 0 ? `= ${fmtQty(qtyCm)} m³` : undefined}>
              <Input type="number" step="0.001" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
            </Field>
            <Field label={`Rate per ${form.uom}`}>
              <Input type="number" step="0.01" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} placeholder="Optional" />
            </Field>
            <Field label="Vehicle Type" required>
              <Select value={form.vehicle_type} onChange={(e) => setForm({ ...form, vehicle_type: e.target.value as VehicleType })}>
                <option value="own">Own Vehicle</option>
                <option value="rented">Rented</option>
                <option value="party">From Party</option>
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
            <div />

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
            <div />

            <Field label="Delivery Status" required>
              <Select value={form.delivery_status} onChange={(e) => setForm({ ...form, delivery_status: e.target.value })}>
                <option value="pending">Pending</option>
                <option value="delivered">Delivered</option>
              </Select>
            </Field>
            <Field label="Amount Received" hint="Sets payment status automatically">
              <Input type="number" step="0.01" value={form.paid_amount} onChange={(e) => setForm({ ...form, paid_amount: e.target.value })} />
            </Field>
            <Field label="Payment Status">
              <div className="flex h-9 items-center">
                <Badge variant={payBadge[derivePaymentStatus(invoiceTotal, Number(form.paid_amount) || 0)]}>
                  {derivePaymentStatus(invoiceTotal, Number(form.paid_amount) || 0)}
                </Badge>
              </div>
            </Field>
            <div className="col-span-2 md:col-span-3">
              <Field label="Remarks">
                <Input value={form.remarks || ''} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
              </Field>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/60 px-4 py-2.5 text-sm">
            <span>
              {form.outsourced ? (
                <span className="font-medium text-primary">Outsourced — no plant stock used</span>
              ) : (
                <>
                  Available: <b>{fmtQty(available)} m³</b>
                  {qtyCm > available && <span className="ml-2 font-medium text-destructive">— exceeds stock!</span>}
                </>
              )}
            </span>
            <span>
              Goods <b>{fmtMoney(goods)}</b>
              {billedExtra > 0 && <> + charges <b>{fmtMoney(billedExtra)}</b></>}
              {' = Invoice '}<b>{fmtMoney(invoiceTotal)}</b>
            </span>
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
