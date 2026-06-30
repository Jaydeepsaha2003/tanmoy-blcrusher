import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import type { StockLocation } from '@shared/types'
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
import { confirmDialog } from '@/components/confirm'
import { usePlant } from '@/lib/plant'
import { fmtMoney, fmtQty } from '@/lib/utils'

export function StockLocations(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const { plantId } = usePlant()
  const { data: plants = [] } = useQuery({ queryKey: ['plants'], queryFn: api.plants.list })
  const { data = [] } = useQuery({
    queryKey: ['locations', plantId ?? 0],
    queryFn: () => api.locations.list(plantId)
  })
  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState<Partial<StockLocation>>({})

  const save = useMutation({
    mutationFn: (p: Partial<StockLocation>) =>
      p.id ? api.locations.update(p) : api.locations.create(p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['locations'] })
      setOpen(false)
      toast.success('Stock location saved.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  async function remove(l: StockLocation): Promise<void> {
    const ok = await confirmDialog({
      title: 'Delete location',
      message: `Delete "${l.name}"? This cannot be undone.`
    })
    if (!ok) return
    const res = await api.locations.delete(l.id)
    if (res.ok) {
      qc.invalidateQueries({ queryKey: ['locations'] })
      toast.success('Location deleted.')
    } else toast.error(res.error || 'Could not delete location.')
  }

  function openNew(): void {
    setForm({ plant_id: plantId ?? plants[0]?.id, opening_qty: 0, name: '', remarks: '' })
    setOpen(true)
  }

  // Opening value: rate (₹/m³) and amount derive each other from the quantity.
  function setQty(v: string): void {
    const qty = Number(v) || 0
    const rate = Number(form.opening_rate) || 0
    setForm({ ...form, opening_qty: qty, ...(rate > 0 ? { opening_amount: round2(rate * qty) } : {}) })
  }
  function setRate(v: string): void {
    const rate = Number(v) || 0
    const qty = Number(form.opening_qty) || 0
    setForm({ ...form, opening_rate: rate, opening_amount: round2(rate * qty) })
  }
  function setAmount(v: string): void {
    const amount = Number(v) || 0
    const qty = Number(form.opening_qty) || 0
    setForm({ ...form, opening_amount: amount, opening_rate: qty > 0 ? round2(amount / qty) : 0 })
  }

  return (
    <>
      <PageHeader
        title="Stock Locations"
        description="Raw material stock rooms inside each plant"
        actions={
          <Button onClick={openNew} disabled={plants.length === 0}>
            <Plus size={16} /> New Location
          </Button>
        }
      />
      <Page>
        {plants.length === 0 ? (
          <EmptyState message="Create a plant first, then add stock locations." />
        ) : data.length === 0 ? (
          <EmptyState message="No stock locations yet." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Location</TH>
                <TH>Plant</TH>
                <TH className="text-right">Opening</TH>
                <TH className="text-right">Opening ₹</TH>
                <TH className="text-right">Purchased</TH>
                <TH className="text-right">To Production</TH>
                <TH className="text-right">Balance (m³)</TH>
                <TH>Remarks</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {data.map((l) => (
                <TR key={l.id}>
                  <TD className="font-medium">{l.name}</TD>
                  <TD className="text-muted-foreground">{l.plant_name}</TD>
                  <TD className="text-right">{fmtQty(l.opening_qty)}</TD>
                  <TD className="tnum text-right text-muted-foreground">{l.opening_amount ? fmtMoney(l.opening_amount) : '-'}</TD>
                  <TD className="text-right text-success">{fmtQty(l.purchased_qty)}</TD>
                  <TD className="text-right text-destructive">{fmtQty(l.consumed_qty)}</TD>
                  <TD className="text-right font-semibold">{fmtQty(l.balance_qty)}</TD>
                  <TD className="text-muted-foreground">{l.remarks || '-'}</TD>
                  <TD className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => { setForm(l); setOpen(true) }}>
                      <Pencil size={15} />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(l)}>
                      <Trash2 size={15} className="text-destructive" />
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Page>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={form.id ? 'Edit Location' : 'New Stock Location'}
      >
        <div className="space-y-4">
          <Field label="Plant" hint={plantId && !form.id ? 'Locked to active plant' : undefined}>
            <SearchSelect
              value={form.plant_id || ''}
              disabled={!!form.id || !!plantId}
              onChange={(v) => setForm({ ...form, plant_id: Number(v) })}
              options={plants.map((p) => ({ value: p.id, label: p.name }))}
            />
          </Field>
          <Field label="Location Name">
            <Input
              value={form.name || ''}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Yard A"
            />
          </Field>
          <Field label="Opening Quantity (m³)">
            <Input
              type="number"
              step="0.001"
              value={form.opening_qty ?? 0}
              onChange={(e) => setQty(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Rate (₹ / m³)" hint="Optional — to value the opening stock">
              <Input type="number" step="0.01" value={form.opening_rate ?? ''} onChange={(e) => setRate(e.target.value)} placeholder="0.00" />
            </Field>
            <Field label="Amount (₹)" hint="Rate × quantity — editable">
              <Input type="number" step="0.01" value={form.opening_amount ?? ''} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </Field>
          </div>
          <Field label="Remarks">
            <Input
              value={form.remarks || ''}
              onChange={(e) => setForm({ ...form, remarks: e.target.value })}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => save.mutate(form)} disabled={!form.name?.trim() || !form.plant_id}>
              Save
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
