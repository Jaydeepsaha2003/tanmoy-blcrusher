import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, FileSpreadsheet } from 'lucide-react'
import { api } from '@/lib/api'
import type { Transporter } from '@shared/types'
import { PageHeader, Page } from '@/components/layout'
import {
  Button,
  Input,
  Select,
  Textarea,
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
import { fmtQty, fmtMoney, downloadExcel } from '@/lib/utils'

export function Transporters(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const { plantId } = usePlant()
  const { data = [] } = useQuery({ queryKey: ['transporters', plantId], queryFn: () => api.transporters.list(plantId) })
  const { data: companies = [] } = useQuery({ queryKey: ['companies'], queryFn: api.companies.list })
  const { data: plants = [] } = useQuery({ queryKey: ['plants'], queryFn: api.plants.list })
  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState<Partial<Transporter>>({})

  function exportExcel(): void {
    downloadExcel(
      'transporters',
      'Transporters',
      ['Name', 'Company', 'Plant', 'Contact', 'Trips', 'Carried (m³)', 'Bill Amount', 'Diesel', 'Paid', 'Balance'],
      data.map((t) => [
        t.name, t.company_name ?? '', t.plant_name ?? 'Common', t.contact, t.total_trips ?? 0, t.total_cm ?? 0,
        t.total_amount ?? 0, t.diesel_amount ?? 0, t.paid_amount ?? 0, t.balance_amount ?? 0
      ])
    )
  }

  const save = useMutation({
    mutationFn: (p: Partial<Transporter>) =>
      p.id ? api.transporters.update(p) : api.transporters.create(p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transporters'] })
      setOpen(false)
      toast.success('Transporter saved.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  async function remove(t: Transporter): Promise<void> {
    const ok = await confirmDialog({
      title: 'Delete transporter',
      message: `Delete "${t.name}"?`
    })
    if (!ok) return
    const res = await api.transporters.delete(t.id)
    if (res.ok) {
      qc.invalidateQueries({ queryKey: ['transporters'] })
      toast.success('Transporter deleted.')
    } else toast.error(res.error || 'Could not delete transporter.')
  }

  return (
    <>
      <PageHeader
        title="Transporters"
        description="Vehicles carrying finished goods from plant to the railway yard"
        actions={
          <>
            <Button variant="outline" onClick={exportExcel} disabled={!data.length}>
              <FileSpreadsheet size={16} /> Excel
            </Button>
            <Button onClick={() => { setForm({ plant_id: plantId ?? null }); setOpen(true) }}>
              <Plus size={16} /> New Transporter
            </Button>
          </>
        }
      />
      <Page>
        {data.length === 0 ? (
          <EmptyState message="No transporters yet." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Company</TH>
                <TH>Plant</TH>
                <TH className="text-right">Trips</TH>
                <TH className="text-right">Carried (m³)</TH>
                <TH className="text-right">Bill Amt</TH>
                <TH className="text-right">Diesel</TH>
                <TH className="text-right">Paid</TH>
                <TH className="text-right">Balance</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {data.map((t) => (
                <TR key={t.id}>
                  <TD className="font-medium">{t.name}</TD>
                  <TD className="text-muted-foreground">{t.company_name || '-'}</TD>
                  <TD className="text-muted-foreground">{t.plant_name || 'Common'}</TD>
                  <TD className="text-right">{fmtQty(t.total_trips)}</TD>
                  <TD className="text-right">{fmtQty(t.total_cm)}</TD>
                  <TD className="text-right">{fmtMoney(t.total_amount)}</TD>
                  <TD className="text-right">{fmtMoney(t.diesel_amount)}</TD>
                  <TD className="text-right">{fmtMoney(t.paid_amount)}</TD>
                  <TD className="text-right font-semibold text-destructive">
                    {fmtMoney(t.balance_amount)}
                  </TD>
                  <TD className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => { setForm(t); setOpen(true) }}>
                      <Pencil size={15} />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(t)}>
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
        title={form.id ? 'Edit Transporter' : 'New Transporter'}
      >
        <div className="space-y-4">
          <Field label="Transporter Name">
            <Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Company / Group (optional)" hint="For a combined company ledger">
              <Select
                value={form.company_id ?? ''}
                onChange={(e) => setForm({ ...form, company_id: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">— None —</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Plant" hint="Common = available to all plants">
              <Select
                value={form.plant_id ?? ''}
                onChange={(e) => setForm({ ...form, plant_id: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">Common (all plants)</option>
                {plants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Contact Details">
            <Input
              value={form.contact || ''}
              onChange={(e) => setForm({ ...form, contact: e.target.value })}
              placeholder="Phone / email"
            />
          </Field>
          <Field label="Address">
            <Textarea
              value={form.address || ''}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </Field>
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
            <Button onClick={() => save.mutate(form)} disabled={!form.name?.trim()}>
              Save
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
