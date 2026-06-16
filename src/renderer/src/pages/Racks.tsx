import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, ArrowRight, FileSpreadsheet } from 'lucide-react'
import { api } from '@/lib/api'
import type { Rack, RackStatus } from '@shared/types'
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
import { fmtQty, fmtMoney, fmtDate, today, downloadExcel } from '@/lib/utils'

export const statusLabel: Record<RackStatus, string> = {
  loading: 'Loading',
  in_transit: 'In Transit',
  reached: 'Reached',
  closed: 'Closed'
}
export const statusBadge: Record<RackStatus, 'warning' | 'default' | 'success' | 'muted'> = {
  loading: 'warning',
  in_transit: 'default',
  reached: 'success',
  closed: 'muted'
}

export function Racks(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const nav = useNavigate()
  const [filter, setFilter] = React.useState<{ status?: string }>({})
  const { data = [] } = useQuery({
    queryKey: ['racks', filter],
    queryFn: () => api.racks.list(filter.status ? { status: filter.status } : {})
  })

  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState<Partial<Rack>>({})

  const save = useMutation({
    mutationFn: (p: Partial<Rack>) => (p.id ? api.racks.update(p) : api.racks.create(p)),
    onSuccess: (r, p) => {
      qc.invalidateQueries({ queryKey: ['racks'] })
      setOpen(false)
      toast.success(`Rack ${r.rack_no} saved.`)
      if (!p.id) nav(`/racks/${r.id}`)
    },
    onError: (e: Error) => toast.error(e.message)
  })

  async function remove(r: Rack): Promise<void> {
    const ok = await confirmDialog({
      title: 'Delete rack',
      message: `Delete rack "${r.rack_no}"?`
    })
    if (!ok) return
    const res = await api.racks.delete(r.id)
    if (res.ok) {
      qc.invalidateQueries({ queryKey: ['racks'] })
      toast.success('Rack deleted.')
    } else toast.error(res.error || 'Could not delete rack.')
  }

  function exportExcel(): void {
    downloadExcel(
      'racks',
      'Racks',
      ['Rack No', 'Date', 'Destination', 'Status', 'Loaded (m³)', 'Unloaded (m³)', 'Sold (m³)',
        'Balance/Shortage (m³)', 'Transport Cost', 'Expenses', 'Sales Amount', 'Profit'],
      data.map((r) => [
        r.rack_no, fmtDate(r.date), r.destination, statusLabel[r.status],
        r.loaded_cm ?? 0, r.unloaded_cm ?? 0, r.sold_cm ?? 0, r.balance_cm ?? 0,
        r.transport_cost ?? 0, r.expense_total ?? 0, r.sales_amount ?? 0, r.profit ?? 0
      ])
    )
  }

  return (
    <>
      <PageHeader
        title="Railway Racks"
        description="Create a rack, load it from the plant, track its costs and sell at destination"
        actions={
          <>
            <Button variant="outline" onClick={exportExcel} disabled={!data.length}>
              <FileSpreadsheet size={16} /> Excel
            </Button>
            <Button onClick={() => { setForm({ date: today() }); setOpen(true) }}>
              <Plus size={16} /> New Rack
            </Button>
          </>
        }
      />
      <Page>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Select
            className="w-full sm:w-44"
            value={filter.status ?? ''}
            onChange={(e) => setFilter({ status: e.target.value || undefined })}
          >
            <option value="">All statuses</option>
            <option value="loading">Loading</option>
            <option value="in_transit">In Transit</option>
            <option value="reached">Reached</option>
            <option value="closed">Closed</option>
          </Select>
        </div>

        {data.length === 0 ? (
          <EmptyState message="No racks yet. Create a rack to start loading finished goods to the railway yard." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Rack No</TH>
                <TH>Date</TH>
                <TH>Destination</TH>
                <TH>Status</TH>
                <TH className="text-right">Loaded (m³)</TH>
                <TH className="text-right">Sold (m³)</TH>
                <TH className="text-right">Balance (m³)</TH>
                <TH className="text-right">Costs</TH>
                <TH className="text-right">Sales</TH>
                <TH className="text-right">Profit</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {data.map((r) => (
                <TR key={r.id} className="cursor-pointer" onClick={() => nav(`/racks/${r.id}`)}>
                  <TD className="font-mono text-xs font-semibold">{r.rack_no}</TD>
                  <TD>{fmtDate(r.date)}</TD>
                  <TD className="text-muted-foreground">{r.destination || '-'}</TD>
                  <TD><Badge variant={statusBadge[r.status]}>{statusLabel[r.status]}</Badge></TD>
                  <TD className="text-right">{fmtQty(r.loaded_cm)}</TD>
                  <TD className="text-right">{fmtQty(r.sold_cm)}</TD>
                  <TD className="text-right font-medium">{fmtQty(r.balance_cm)}</TD>
                  <TD className="text-right text-destructive">
                    {fmtMoney((r.transport_cost ?? 0) + (r.expense_total ?? 0))}
                  </TD>
                  <TD className="text-right">{fmtMoney(r.sales_amount)}</TD>
                  <TD className={`text-right font-semibold ${(r.profit ?? 0) < 0 ? 'text-destructive' : 'text-success'}`}>
                    {fmtMoney(r.profit)}
                  </TD>
                  <TD className="text-right" onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" onClick={() => nav(`/racks/${r.id}`)}>
                      <ArrowRight size={15} />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => { setForm(r); setOpen(true) }}>
                      <Pencil size={15} />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(r)}>
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
        title={form.id ? `Edit Rack ${form.rack_no}` : 'New Railway Rack'}
      >
        <div className="space-y-4">
          <Field label="Railway Rack No." hint="The rake/rack number allotted by the railway">
            <Input
              value={form.rack_no || ''}
              onChange={(e) => setForm({ ...form, rack_no: e.target.value })}
              placeholder="e.g. RK-2026-001"
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Date">
              <Input
                type="date"
                value={form.date || ''}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </Field>
            <Field label="Destination">
              <Input
                value={form.destination || ''}
                onChange={(e) => setForm({ ...form, destination: e.target.value })}
                placeholder="Delivery location"
              />
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
            <Button onClick={() => save.mutate(form)} disabled={!form.rack_no?.trim() || !form.date}>
              Save Rack
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
