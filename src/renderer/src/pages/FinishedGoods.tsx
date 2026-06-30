import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileSpreadsheet, PencilLine, Pencil } from 'lucide-react'
import { api } from '@/lib/api'
import type { Uom } from '@shared/types'
import { toCm, fromCm, UOMS } from '@shared/types'
import { PageHeader, Page } from '@/components/layout'
import {
  Button,
  Input,
  Select,
  SearchSelect,
  Field,
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
import { usePlant } from '@/lib/plant'
import { fmtMoney, fmtQty, downloadExcel } from '@/lib/utils'

type OpeningForm = {
  plant_id?: number
  product_name: string
  opening_qty: number | string
  uom: Uom
  rate: number | string
  amount: number | string
  editing?: boolean
}

export function FinishedGoods(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const { plantId } = usePlant()
  const { data: plants = [] } = useQuery({ queryKey: ['plants'], queryFn: api.plants.list })
  const [filter, setFilter] = React.useState<{ product_name?: string; from?: string; to?: string }>({})
  const { data = [] } = useQuery({
    queryKey: ['finished', filter, plantId],
    queryFn: () => api.finished.list(cleanFilter({ ...filter, plant_id: plantId }))
  })

  const products = Array.from(new Set(data.map((d) => d.product_name)))
  // The stock is stored in m³; this lets the user view every figure in Ton/CFT too,
  // converted with each row's own plant density factors.
  const [viewUom, setViewUom] = React.useState<Uom>('CM')
  const uomLabel = viewUom === 'CM' ? 'm³' : viewUom === 'TON' ? 'Ton' : 'CFT'
  const conv = (cm: number | null | undefined, plantId: number): number =>
    fromCm(Number(cm) || 0, viewUom, plants.find((p) => p.id === plantId))
  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState<OpeningForm>({ product_name: '', opening_qty: 0, uom: 'CM', rate: '', amount: '' })

  const formPlant = plants.find((p) => p.id === form.plant_id)
  const openingCm = toCm(Number(form.opening_qty) || 0, form.uom, formPlant)
  // The opening can be valued: a rate (per entered unit) and a total amount that
  // derive each other from the quantity. Stored as a per-m³ rate + total amount.
  const amountTotal = Number(form.amount) || 0
  const ratePerCm = openingCm > 0 ? round2(amountTotal / openingCm) : 0

  // Keep rate ↔ amount in sync as the user types (amount = rate × qty).
  function updateQty(v: string): void {
    const qty = Number(v) || 0
    const rate = Number(form.rate) || 0
    setForm({ ...form, opening_qty: v, amount: rate > 0 ? round2(rate * qty) : form.amount })
  }
  function updateRate(v: string): void {
    const rate = Number(v) || 0
    const qty = Number(form.opening_qty) || 0
    setForm({ ...form, rate: v, amount: round2(rate * qty) })
  }
  function updateAmount(v: string): void {
    const amount = Number(v) || 0
    const qty = Number(form.opening_qty) || 0
    setForm({ ...form, amount: v, rate: qty > 0 ? round2(amount / qty) : 0 })
  }

  const save = useMutation({
    // Opening can be entered in any UOM; it's stored as m³ (the base unit). Saving
    // the same plant + product overwrites the previous opening, so wrong entries
    // are corrected by editing the row.
    mutationFn: () => api.finished.setOpening(form.plant_id!, form.product_name, openingCm, ratePerCm, amountTotal),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['finished'] })
      setOpen(false)
      toast.success('Opening stock saved.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  function openEdit(f: { plant_id: number; product_name: string; opening_qty: number; opening_rate?: number; opening_amount?: number }): void {
    const amount = Number(f.opening_amount) || 0
    // On edit the UOM resets to m³, so the rate shown is per-m³ (amount ÷ opening m³).
    const rate = f.opening_qty > 0 ? round2(amount / f.opening_qty) : Number(f.opening_rate) || 0
    setForm({ plant_id: f.plant_id, product_name: f.product_name, opening_qty: f.opening_qty, uom: 'CM', editing: true, rate: rate || '', amount: amount || '' })
    setOpen(true)
  }

  function exportExcel(): void {
    downloadExcel(
      'finished-goods',
      'Finished Goods',
      ['Plant', 'Product', `Opening (${uomLabel})`, `Produced (${uomLabel})`, `Purchased (${uomLabel})`, `Dispatched (${uomLabel})`, `To Rack (${uomLabel})`, `Balance (${uomLabel})`, 'Opening Value (₹)'],
      data.map((f) => [
        f.plant_name, f.product_name,
        conv(f.opening_qty, f.plant_id), conv(f.produced_qty, f.plant_id), conv(f.purchased_qty, f.plant_id),
        conv(f.dispatched_qty, f.plant_id), conv(f.loaded_qty, f.plant_id), conv(f.balance_qty, f.plant_id),
        f.opening_amount || 0
      ])
    )
  }

  return (
    <>
      <PageHeader
        title="Finished Goods Stock"
        description="Plant-wise and product-wise finished stock"
        actions={
          <>
            <div className="flex items-center gap-1.5">
              <span className="hidden text-xs font-medium text-muted-foreground sm:inline">View in</span>
              <SearchSelect
                className="w-28"
                value={viewUom}
                onChange={(v) => setViewUom(v as Uom)}
                options={UOMS.map((u) => ({ value: u, label: u === 'CM' ? 'm³' : u === 'TON' ? 'Ton' : 'CFT' }))}
              />
            </div>
            <Button variant="outline" onClick={exportExcel} disabled={!data.length}>
              <FileSpreadsheet size={16} /> Excel
            </Button>
            <Button onClick={() => { setForm({ plant_id: plantId ?? plants[0]?.id, product_name: '', opening_qty: 0, uom: 'CM', rate: '', amount: '' }); setOpen(true) }} disabled={!plants.length}>
              <PencilLine size={16} /> Set Opening
            </Button>
          </>
        }
      />
      <Page>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <SearchSelect
            className="w-full sm:w-44"
            value={filter.product_name ?? ''}
            onChange={(v) => setFilter({ ...filter, product_name: v || undefined })}
            options={[{ value: '', label: 'All products' }, ...products.map((p) => ({ value: p, label: p }))]}
          />
          <Input type="date" className="w-full sm:w-40" value={filter.from ?? ''} onChange={(e) => setFilter({ ...filter, from: e.target.value || undefined })} />
          <span className="text-muted-foreground">to</span>
          <Input type="date" className="w-full sm:w-40" value={filter.to ?? ''} onChange={(e) => setFilter({ ...filter, to: e.target.value || undefined })} />
        </div>

        {data.length === 0 ? (
          <EmptyState message="No finished goods yet. Record a production to generate stock." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Plant</TH>
                <TH>Product</TH>
                <TH className="text-right">Opening</TH>
                <TH className="text-right">Produced</TH>
                <TH className="text-right">Purchased</TH>
                <TH className="text-right">Dispatched</TH>
                <TH className="text-right">To Rack</TH>
                <TH className="text-right">Balance ({uomLabel})</TH>
                <TH className="text-right">Opening ₹</TH>
                <TH className="text-right">Edit</TH>
              </TR>
            </THead>
            <TBody>
              {data.map((f) => (
                <TR key={`${f.plant_id}-${f.product_name}`}>
                  <TD className="font-medium">{f.plant_name}</TD>
                  <TD>{f.product_name}</TD>
                  <TD className="text-right">{fmtQty(conv(f.opening_qty, f.plant_id))}</TD>
                  <TD className="text-right text-success">{fmtQty(conv(f.produced_qty, f.plant_id))}</TD>
                  <TD className="text-right text-success">{fmtQty(conv(f.purchased_qty, f.plant_id))}</TD>
                  <TD className="text-right text-destructive">{fmtQty(conv(f.dispatched_qty, f.plant_id))}</TD>
                  <TD className="text-right text-warning">{fmtQty(conv(f.loaded_qty, f.plant_id))}</TD>
                  <TD className="text-right font-semibold">{fmtQty(conv(f.balance_qty, f.plant_id))}</TD>
                  <TD className="tnum text-right text-muted-foreground">{f.opening_amount ? fmtMoney(f.opening_amount) : '-'}</TD>
                  <TD className="text-right">
                    <Button variant="ghost" size="icon" title="Edit opening stock" onClick={() => openEdit({ plant_id: f.plant_id, product_name: f.product_name, opening_qty: f.opening_qty, opening_rate: f.opening_rate, opening_amount: f.opening_amount })}>
                      <Pencil size={15} />
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Page>

      <Modal open={open} onClose={() => setOpen(false)} title={form.editing ? `Edit Opening — ${form.product_name}` : 'Set Opening Finished Goods'}>
        <div className="space-y-4">
          <Field label="Plant" hint={form.editing ? 'Locked for this opening' : plantId ? 'Locked to active plant' : undefined}>
            <SearchSelect
              value={form.plant_id || ''}
              disabled={form.editing || !!plantId}
              onChange={(v) => setForm({ ...form, plant_id: Number(v) })}
              options={plants.map((p) => ({ value: p.id, label: p.name }))}
            />
          </Field>
          <Field label="Product Name">
            <Input value={form.product_name} disabled={form.editing} onChange={(e) => setForm({ ...form, product_name: e.target.value })} placeholder="e.g. 30/40" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Unit (UOM)">
              <SearchSelect
                value={form.uom}
                onChange={(v) => setForm({ ...form, uom: v as Uom })}
                options={UOMS.map((u) => ({ value: u, label: u === 'CM' ? 'm³' : u === 'TON' ? 'Ton' : 'CFT' }))}
              />
            </Field>
            <Field label={`Opening Quantity (${form.uom === 'CM' ? 'm³' : form.uom})`} hint={form.uom !== 'CM' && openingCm > 0 ? `= ${fmtQty(openingCm)} m³` : 'Stored as m³'}>
              <Input type="number" step="0.001" value={form.opening_qty} onChange={(e) => updateQty(e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label={`Rate (₹ / ${form.uom === 'CM' ? 'm³' : form.uom})`} hint="Optional — values the opening stock">
              <Input type="number" step="0.01" value={form.rate} onChange={(e) => updateRate(e.target.value)} placeholder="0.00" />
            </Field>
            <Field label="Amount (₹)" hint="Rate × quantity — editable">
              <Input type="number" step="0.01" value={form.amount} onChange={(e) => updateAmount(e.target.value)} placeholder="0.00" />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={!form.plant_id || !form.product_name.trim()}>Save</Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

function cleanFilter(f: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(f)) if (v != null && v !== '') out[k] = v
  return out
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
