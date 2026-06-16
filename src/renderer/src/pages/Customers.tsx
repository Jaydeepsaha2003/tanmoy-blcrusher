import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, FileSpreadsheet } from 'lucide-react'
import { api } from '@/lib/api'
import type { Customer } from '@shared/types'
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
import { fmtQty, downloadExcel } from '@/lib/utils'

export function Customers(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const { plantId } = usePlant()
  const { data = [] } = useQuery({ queryKey: ['customers', plantId], queryFn: () => api.customers.list(plantId) })
  const { data: companies = [] } = useQuery({ queryKey: ['companies'], queryFn: api.companies.list })
  const { data: plants = [] } = useQuery({ queryKey: ['plants'], queryFn: api.plants.list })
  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState<Partial<Customer>>({})

  function exportExcel(): void {
    downloadExcel(
      'customers',
      'Customers',
      ['Name', 'Company', 'Plant', 'Contact', 'Address', 'Total Sold (m³)'],
      data.map((c) => [c.name, c.company_name ?? '', c.plant_name ?? 'Common', c.contact, c.address, c.total_dispatched ?? 0])
    )
  }

  const save = useMutation({
    mutationFn: (p: Partial<Customer>) =>
      p.id ? api.customers.update(p) : api.customers.create(p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] })
      setOpen(false)
      toast.success('Customer saved.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  async function remove(c: Customer): Promise<void> {
    const ok = await confirmDialog({ title: 'Delete customer', message: `Delete "${c.name}"?` })
    if (!ok) return
    const res = await api.customers.delete(c.id)
    if (res.ok) {
      qc.invalidateQueries({ queryKey: ['customers'] })
      toast.success('Customer deleted.')
    } else toast.error(res.error || 'Could not delete customer.')
  }

  return (
    <>
      <PageHeader
        title="Customers / Parties"
        description="Customers you sell finished goods to"
        actions={
          <>
            <Button variant="outline" onClick={exportExcel} disabled={!data.length}>
              <FileSpreadsheet size={16} /> Excel
            </Button>
            <Button onClick={() => { setForm({ plant_id: plantId ?? null }); setOpen(true) }}>
              <Plus size={16} /> New Customer
            </Button>
          </>
        }
      />
      <Page>
        {data.length === 0 ? (
          <EmptyState message="No customers yet." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Company</TH>
                <TH>Plant</TH>
                <TH>Contact</TH>
                <TH className="text-right">Total Sold (m³)</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {data.map((c) => (
                <TR key={c.id}>
                  <TD className="font-medium">{c.name}</TD>
                  <TD className="text-muted-foreground">{c.company_name || '-'}</TD>
                  <TD className="text-muted-foreground">{c.plant_name || 'Common'}</TD>
                  <TD className="text-muted-foreground">{c.contact || '-'}</TD>
                  <TD className="text-right">{fmtQty(c.total_dispatched)}</TD>
                  <TD className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => { setForm(c); setOpen(true) }}>
                      <Pencil size={15} />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(c)}>
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
        title={form.id ? 'Edit Customer' : 'New Customer'}
      >
        <div className="space-y-4">
          <Field label="Customer / Party Name">
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
