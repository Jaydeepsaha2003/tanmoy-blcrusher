import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileSpreadsheet, ArrowLeftRight, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import type { MovementType, StockMovement } from '@shared/types'
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
import { fmtQty, fmtDate, today, downloadExcel } from '@/lib/utils'
import { usePlant } from '@/lib/plant'

const typeLabel: Record<MovementType, string> = {
  opening: 'Opening',
  purchase: 'Purchase',
  production_consume: 'Consumed',
  production_output: 'Produced',
  dispatch: 'Direct Sale',
  rack_load: 'To Rack',
  transfer: 'Transfer'
}
const typeBadge: Record<MovementType, 'success' | 'warning' | 'destructive' | 'default' | 'muted'> = {
  opening: 'muted',
  purchase: 'success',
  production_consume: 'destructive',
  production_output: 'default',
  dispatch: 'warning',
  rack_load: 'warning',
  transfer: 'default'
}

export function Movements(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const { plantId } = usePlant()
  const { data: locations = [] } = useQuery({ queryKey: ['locations', 0], queryFn: () => api.locations.list() })
  const [filter, setFilter] = React.useState<Record<string, unknown>>({})
  const { data = [] } = useQuery({
    queryKey: ['movements', filter, plantId],
    queryFn: () => api.movements.list({ ...filter, plant_id: plantId })
  })
  const formLocations = plantId ? locations.filter((l) => l.plant_id === plantId) : locations

  const [xfer, setXfer] = React.useState<any>(null)
  const fromBalance = xfer?.from_location_id
    ? locations.find((l) => l.id === Number(xfer.from_location_id))?.balance_qty ?? 0
    : 0

  function refresh(): void {
    qc.invalidateQueries({ queryKey: ['movements'] })
    qc.invalidateQueries({ queryKey: ['locations'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const saveTransfer = useMutation({
    mutationFn: (p: any) => api.movements.transfer(p),
    onSuccess: () => {
      refresh()
      setXfer(null)
      toast.success('Stock transferred.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  async function removeTransfer(m: StockMovement): Promise<void> {
    const ok = await confirmDialog({
      title: 'Delete transfer',
      message: `Delete transfer ${m.ref_no}? Both locations will be adjusted back.`
    })
    if (!ok) return
    await api.movements.deleteTransfer(m.ref_no)
    refresh()
    toast.success('Transfer deleted.')
  }

  function set(k: string, v: unknown): void {
    setFilter((f) => {
      const next = { ...f }
      if (v == null || v === '') delete next[k]
      else next[k] = v
      return next
    })
  }

  function exportExcel(): void {
    downloadExcel(
      'stock-movements',
      'Stock Movements',
      ['Date', 'Type', 'Material', 'Ref No', 'Plant', 'Location', 'Product', 'Change (m³)', 'Note'],
      data.map((m) => [
        fmtDate(m.date), typeLabel[m.type], m.material_type, m.ref_no, m.plant_name,
        m.stock_location_name ?? '', m.product_name ?? '', m.change_qty, m.note
      ])
    )
  }

  return (
    <>
      <PageHeader
        title="Stock Movement History"
        description="Every stock change is traceable here"
        actions={
          <>
            <Button variant="outline" onClick={exportExcel} disabled={!data.length}>
              <FileSpreadsheet size={16} /> Excel
            </Button>
            <Button onClick={() => setXfer({ from_location_id: '', to_location_id: '', quantity: '', date: today(), note: '' })} disabled={locations.length < 2}>
              <ArrowLeftRight size={16} /> Transfer Stock
            </Button>
          </>
        }
      />
      <Page>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Select className="w-full sm:w-44" value={(filter.stock_location_id as number) ?? ''} onChange={(e) => set('stock_location_id', e.target.value ? Number(e.target.value) : '')}>
            <option value="">All locations</option>
            {formLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
          <Select className="w-full sm:w-40" value={(filter.material_type as string) ?? ''} onChange={(e) => set('material_type', e.target.value)}>
            <option value="">All material</option>
            <option value="raw">Raw</option>
            <option value="finished">Finished</option>
          </Select>
          <Select className="w-full sm:w-40" value={(filter.type as string) ?? ''} onChange={(e) => set('type', e.target.value)}>
            <option value="">All types</option>
            <option value="opening">Opening</option>
            <option value="purchase">Purchase</option>
            <option value="production_consume">Consumed</option>
            <option value="production_output">Produced</option>
            <option value="dispatch">Dispatch</option>
            <option value="rack_load">To Rack</option>
            <option value="transfer">Transfer</option>
          </Select>
          <Input type="date" className="w-full sm:w-36" value={(filter.from as string) ?? ''} onChange={(e) => set('from', e.target.value)} />
          <span className="text-muted-foreground">to</span>
          <Input type="date" className="w-full sm:w-36" value={(filter.to as string) ?? ''} onChange={(e) => set('to', e.target.value)} />
        </div>

        {data.length === 0 ? (
          <EmptyState message="No stock movements found." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Date</TH>
                <TH>Type</TH>
                <TH>Ref No</TH>
                <TH>Plant</TH>
                <TH>Location / Product</TH>
                <TH className="text-right">Change (m³)</TH>
                <TH>Note</TH>
                <TH className="text-right"></TH>
              </TR>
            </THead>
            <TBody>
              {data.map((m) => (
                <TR key={m.id}>
                  <TD>{fmtDate(m.date)}</TD>
                  <TD><Badge variant={typeBadge[m.type]}>{typeLabel[m.type]}</Badge></TD>
                  <TD className="font-mono text-xs">{m.ref_no || '-'}</TD>
                  <TD className="text-muted-foreground">{m.plant_name}</TD>
                  <TD className="text-muted-foreground">{m.stock_location_name || m.product_name || '-'}</TD>
                  <TD className={`text-right font-semibold ${m.change_qty < 0 ? 'text-destructive' : 'text-success'}`}>
                    {m.change_qty > 0 ? '+' : ''}{fmtQty(m.change_qty)}
                  </TD>
                  <TD className="text-muted-foreground">{m.note}</TD>
                  <TD className="text-right">
                    {m.type === 'transfer' && (
                      <Button variant="ghost" size="icon" onClick={() => removeTransfer(m)}>
                        <Trash2 size={15} className="text-destructive" />
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Page>

      {xfer && (
        <Modal open onClose={() => setXfer(null)} title="Transfer Raw Stock" width="max-w-lg">
          <div className="space-y-4">
            <Field label="From Location" required hint={`Available: ${fmtQty(fromBalance)} m³`}>
              <Select value={xfer.from_location_id} onChange={(e) => setXfer({ ...xfer, from_location_id: e.target.value ? Number(e.target.value) : '' })}>
                <option value="">Select source…</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.plant_name} — {l.name} ({fmtQty(l.balance_qty)} m³)</option>)}
              </Select>
            </Field>
            <Field label="To Location" required>
              <Select value={xfer.to_location_id} onChange={(e) => setXfer({ ...xfer, to_location_id: e.target.value ? Number(e.target.value) : '' })}>
                <option value="">Select destination…</option>
                {locations.filter((l) => l.id !== Number(xfer.from_location_id)).map((l) => <option key={l.id} value={l.id}>{l.plant_name} — {l.name}</option>)}
              </Select>
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Quantity (m³)" required>
                <Input type="number" step="0.001" value={xfer.quantity} onChange={(e) => setXfer({ ...xfer, quantity: e.target.value })} />
              </Field>
              <Field label="Date" required>
                <Input type="date" value={xfer.date} onChange={(e) => setXfer({ ...xfer, date: e.target.value })} />
              </Field>
            </div>
            <Field label="Note">
              <Input value={xfer.note} onChange={(e) => setXfer({ ...xfer, note: e.target.value })} placeholder="Optional" />
            </Field>
            {Number(xfer.quantity) > fromBalance && xfer.from_location_id && (
              <p className="text-sm font-medium text-destructive">Quantity exceeds available stock at source.</p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setXfer(null)}>Cancel</Button>
              <Button
                onClick={() => saveTransfer.mutate({ ...xfer, quantity: Number(xfer.quantity) })}
                disabled={!xfer.from_location_id || !xfer.to_location_id || !(Number(xfer.quantity) > 0) || Number(xfer.quantity) > fromBalance}
              >
                Transfer
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
