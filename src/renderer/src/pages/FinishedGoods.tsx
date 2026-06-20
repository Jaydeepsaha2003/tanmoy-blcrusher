import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileSpreadsheet, PencilLine } from 'lucide-react'
import { api } from '@/lib/api'
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
import { fmtQty, downloadExcel } from '@/lib/utils'

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
  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState<{ plant_id?: number; product_name: string; opening_qty: number }>({ product_name: '', opening_qty: 0 })

  const save = useMutation({
    mutationFn: () => api.finished.setOpening(form.plant_id!, form.product_name, Number(form.opening_qty) || 0),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['finished'] })
      setOpen(false)
      toast.success('Opening stock saved.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  function exportExcel(): void {
    downloadExcel(
      'finished-goods',
      'Finished Goods',
      ['Plant', 'Product', 'Opening', 'Produced', 'Purchased', 'Dispatched', 'To Rack', 'Balance (m³)'],
      data.map((f) => [f.plant_name, f.product_name, f.opening_qty, f.produced_qty, f.purchased_qty, f.dispatched_qty, f.loaded_qty, f.balance_qty])
    )
  }

  return (
    <>
      <PageHeader
        title="Finished Goods Stock"
        description="Plant-wise and product-wise finished stock"
        actions={
          <>
            <Button variant="outline" onClick={exportExcel} disabled={!data.length}>
              <FileSpreadsheet size={16} /> Excel
            </Button>
            <Button onClick={() => { setForm({ plant_id: plantId ?? plants[0]?.id, product_name: '', opening_qty: 0 }); setOpen(true) }} disabled={!plants.length}>
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
                <TH className="text-right">Balance (m³)</TH>
              </TR>
            </THead>
            <TBody>
              {data.map((f) => (
                <TR key={`${f.plant_id}-${f.product_name}`}>
                  <TD className="font-medium">{f.plant_name}</TD>
                  <TD>{f.product_name}</TD>
                  <TD className="text-right">{fmtQty(f.opening_qty)}</TD>
                  <TD className="text-right text-success">{fmtQty(f.produced_qty)}</TD>
                  <TD className="text-right text-success">{fmtQty(f.purchased_qty)}</TD>
                  <TD className="text-right text-destructive">{fmtQty(f.dispatched_qty)}</TD>
                  <TD className="text-right text-warning">{fmtQty(f.loaded_qty)}</TD>
                  <TD className="text-right font-semibold">{fmtQty(f.balance_qty)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Page>

      <Modal open={open} onClose={() => setOpen(false)} title="Set Opening Finished Goods">
        <div className="space-y-4">
          <Field label="Plant" hint={plantId ? 'Locked to active plant' : undefined}>
            <SearchSelect
              value={form.plant_id || ''}
              disabled={!!plantId}
              onChange={(v) => setForm({ ...form, plant_id: Number(v) })}
              options={plants.map((p) => ({ value: p.id, label: p.name }))}
            />
          </Field>
          <Field label="Product Name">
            <Input value={form.product_name} onChange={(e) => setForm({ ...form, product_name: e.target.value })} placeholder="e.g. 30/40" />
          </Field>
          <Field label="Opening Quantity (m³)">
            <Input type="number" step="0.001" value={form.opening_qty} onChange={(e) => setForm({ ...form, opening_qty: Number(e.target.value) })} />
          </Field>
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
