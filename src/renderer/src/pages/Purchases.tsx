import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, FileSpreadsheet } from 'lucide-react'
import { api } from '@/lib/api'
import type { Purchase, PaymentStatus } from '@shared/types'
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
import { derivePaymentStatus, toCm, UOMS } from '@shared/types'
import { fmtQty, fmtMoney, fmtDate, today, downloadExcel } from '@/lib/utils'

const payBadge: Record<PaymentStatus, 'success' | 'warning' | 'destructive'> = {
  paid: 'success',
  partial: 'warning',
  unpaid: 'destructive'
}

export function Purchases(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const { plantId } = usePlant()
  const { data: plants = [] } = useQuery({ queryKey: ['plants'], queryFn: api.plants.list })
  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers', plantId], queryFn: () => api.suppliers.list(plantId) })
  const [filter, setFilter] = React.useState<{ supplier_id?: number; payment_status?: string }>({})
  const { data: locations = [] } = useQuery({ queryKey: ['locations', 0], queryFn: () => api.locations.list() })

  const { data = [] } = useQuery({
    queryKey: ['purchases', filter, plantId],
    queryFn: () => api.purchases.list(cleanFilter({ ...filter, plant_id: plantId }))
  })

  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState<any>(null)

  const formLocations = locations.filter((l) => l.plant_id === form?.plant_id)

  const save = useMutation({
    mutationFn: (p: any) => (p.id ? api.purchases.update(p) : api.purchases.create(p)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchases'] })
      qc.invalidateQueries({ queryKey: ['locations'] })
      qc.invalidateQueries({ queryKey: ['suppliers'] })
      setOpen(false)
      toast.success('Purchase saved. Raw material stock updated.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  function openNew(): void {
    setForm({
      supplier_id: suppliers[0]?.id,
      plant_id: plantId ?? plants[0]?.id,
      stock_location_id: undefined,
      uom: 'CM',
      quantity: '',
      rate: '',
      paid_amount: 0,
      payment_status: 'unpaid',
      date: today(),
      remarks: ''
    })
    setOpen(true)
  }

  async function remove(p: Purchase): Promise<void> {
    const ok = await confirmDialog({
      title: 'Delete purchase',
      message: `Delete ${p.purchase_no}? Stock will be reversed.`
    })
    if (!ok) return
    const res = await api.purchases.delete(p.id)
    if (res.ok) {
      qc.invalidateQueries({ queryKey: ['purchases'] })
      qc.invalidateQueries({ queryKey: ['locations'] })
      toast.success('Purchase deleted.')
    } else toast.error(res.error || 'Could not delete.')
  }

  function submit(): void {
    const p = {
      ...form,
      quantity: Number(form.quantity),
      rate: form.rate === '' || form.rate == null ? null : Number(form.rate),
      paid_amount: Number(form.paid_amount) || 0
    }
    save.mutate(p)
  }

  function exportExcel(): void {
    downloadExcel(
      'purchases',
      'Purchases',
      ['Purchase No', 'Date', 'Supplier', 'Plant', 'Location', 'UOM', 'Quantity', 'Qty (m³)', 'Rate', 'Amount', 'Paid', 'Status'],
      data.map((p) => [
        p.purchase_no, fmtDate(p.date), p.supplier_name, p.plant_name, p.stock_location_name,
        p.uom, p.quantity, p.qty_cm, p.rate ?? '', p.amount ?? '', p.paid_amount, p.payment_status
      ])
    )
  }

  return (
    <>
      <PageHeader
        title="Raw Material Purchase / Inward"
        description="Record raw material received from suppliers"
        actions={
          <>
            <Button variant="outline" onClick={exportExcel} disabled={!data.length}>
              <FileSpreadsheet size={16} /> Excel
            </Button>
            <Button onClick={openNew} disabled={!suppliers.length || !plants.length}>
              <Plus size={16} /> New Purchase
            </Button>
          </>
        }
      />
      <Page>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Select className="w-full sm:w-48" value={filter.supplier_id ?? ''} onChange={(e) => setFilter({ ...filter, supplier_id: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">All suppliers</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Select className="w-full sm:w-44" value={filter.payment_status ?? ''} onChange={(e) => setFilter({ ...filter, payment_status: e.target.value || undefined })}>
            <option value="">All payments</option>
            <option value="paid">Paid</option>
            <option value="partial">Partial</option>
            <option value="unpaid">Unpaid</option>
          </Select>
        </div>

        {data.length === 0 ? (
          <EmptyState message="No purchases found." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Purchase No</TH>
                <TH>Date</TH>
                <TH>Supplier</TH>
                <TH>Plant / Location</TH>
                <TH className="text-right">Quantity</TH>
                <TH className="text-right">Rate</TH>
                <TH className="text-right">Amount</TH>
                <TH>Payment</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {data.map((p) => (
                <TR key={p.id}>
                  <TD className="font-mono text-xs font-medium">{p.purchase_no}</TD>
                  <TD>{fmtDate(p.date)}</TD>
                  <TD className="font-medium">{p.supplier_name}</TD>
                  <TD className="text-muted-foreground">{p.plant_name} / {p.stock_location_name}</TD>
                  <TD className="text-right">
                    {fmtQty(p.quantity)} {p.uom}
                    {p.uom !== 'CM' && (
                      <span className="ml-1 text-[11px] text-muted-foreground">({fmtQty(p.qty_cm)} m³)</span>
                    )}
                  </TD>
                  <TD className="text-right">{p.rate == null ? '-' : fmtMoney(p.rate)}</TD>
                  <TD className="text-right">{fmtMoney(p.amount)}</TD>
                  <TD><Badge variant={payBadge[p.payment_status]}>{p.payment_status}</Badge></TD>
                  <TD className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => { setForm({ ...p, rate: p.rate ?? '' }); setOpen(true) }}>
                      <Pencil size={15} />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(p)}>
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
        <Modal open={open} onClose={() => setOpen(false)} title={form.id ? `Edit ${form.purchase_no}` : 'New Purchase'} width="max-w-2xl">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Supplier" required>
              <Select value={form.supplier_id || ''} onChange={(e) => setForm({ ...form, supplier_id: Number(e.target.value) })}>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Purchase Date" required>
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
            <Field label="Plant" required hint={plantId ? 'Locked to active plant' : undefined}>
              <Select value={form.plant_id || ''} disabled={!!plantId} onChange={(e) => setForm({ ...form, plant_id: Number(e.target.value), stock_location_id: undefined })}>
                {plants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field
              label="Stock Location"
              hint="Leave blank to use the plant itself as the default location"
            >
              <Select
                value={form.stock_location_id || ''}
                onChange={(e) =>
                  setForm({ ...form, stock_location_id: e.target.value ? Number(e.target.value) : undefined })
                }
              >
                <option value="">Plant default (auto)</option>
                {formLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </Field>
            <Field label="Unit (UOM)" required>
              <Select value={form.uom || 'CM'} onChange={(e) => setForm({ ...form, uom: e.target.value })}>
                {UOMS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={`Quantity (${form.uom || 'CM'})`}
              required
              hint={
                form.uom && form.uom !== 'CM'
                  ? `= ${fmtQty(toCm(Number(form.quantity) || 0, form.uom))} m³ added to stock`
                  : 'Added to stock in m³'
              }
            >
              <Input type="number" step="0.001" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
            </Field>
            <Field label={`Rate per ${form.uom || 'CM'}`} required>
              <Input type="number" step="0.01" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} placeholder="Enter rate" />
            </Field>
            <Field label="Amount" required hint="Auto-calculated: rate × quantity">
              <Input value={fmtMoney((Number(form.quantity) || 0) * (Number(form.rate) || 0))} disabled />
            </Field>
            <Field label="Paid Amount" hint="Sets payment status automatically">
              <Input type="number" step="0.01" value={form.paid_amount} onChange={(e) => setForm({ ...form, paid_amount: e.target.value })} />
            </Field>
            <Field label="Payment Status">
              <div className="flex h-9 items-center">
                <Badge variant={payBadge[derivePaymentStatus((Number(form.quantity) || 0) * (Number(form.rate) || 0), Number(form.paid_amount) || 0)]}>
                  {derivePaymentStatus((Number(form.quantity) || 0) * (Number(form.rate) || 0), Number(form.paid_amount) || 0)}
                </Badge>
              </div>
            </Field>
            <div className="col-span-2">
              <Field label="Remarks">
                <Input value={form.remarks || ''} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
              </Field>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={!form.supplier_id || !(Number(form.quantity) > 0) || !(Number(form.rate) > 0)}>
              Save Purchase
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}

function cleanFilter(f: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(f)) if (v != null && v !== '') out[k] = v
  return out
}
