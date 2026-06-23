import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, FileSpreadsheet } from 'lucide-react'
import { api } from '@/lib/api'
import type { Supplier } from '@shared/types'
import { PageHeader, Page } from '@/components/layout'
import {
  Button,
  Input,
  Select,
  SearchSelect,
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

export function Suppliers(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const { plantId } = usePlant()
  const { data = [] } = useQuery({ queryKey: ['suppliers', plantId], queryFn: () => api.suppliers.list(plantId) })
  const { data: companies = [] } = useQuery({ queryKey: ['companies'], queryFn: api.companies.list })
  const { data: plants = [] } = useQuery({ queryKey: ['plants'], queryFn: api.plants.list })
  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState<Partial<Supplier>>({})
  const [q, setQ] = React.useState('')
  const [companyFilter, setCompanyFilter] = React.useState('')
  const [dues, setDues] = React.useState('')

  const filtered = React.useMemo(() => {
    const term = q.trim().toLowerCase()
    return data.filter((s) => {
      if (term && !`${s.name} ${s.contact ?? ''} ${s.address ?? ''}`.toLowerCase().includes(term)) return false
      if (companyFilter === 'none' && s.company_id) return false
      if (companyFilter && companyFilter !== 'none' && String(s.company_id ?? '') !== companyFilter) return false
      if (dues === 'due' && !((s.unpaid_amount ?? 0) > 0.005)) return false
      if (dues === 'clear' && (s.unpaid_amount ?? 0) > 0.005) return false
      return true
    })
  }, [data, q, companyFilter, dues])

  function exportExcel(): void {
    downloadExcel(
      'suppliers',
      'Suppliers',
      ['Name', 'Company', 'Plant', 'Contact', 'Address', 'Purchased (m³)', 'Total Amount', 'Paid', 'Unpaid'],
      data.map((s) => [
        s.name, s.company_name ?? '', s.plant_name ?? 'Common', s.contact, s.address,
        s.total_purchased ?? 0, s.total_amount ?? 0, s.paid_amount ?? 0, s.unpaid_amount ?? 0
      ])
    )
  }

  const save = useMutation({
    mutationFn: (p: Partial<Supplier>) =>
      p.id ? api.suppliers.update(p) : api.suppliers.create(p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] })
      setOpen(false)
      toast.success('Supplier saved.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  async function remove(s: Supplier): Promise<void> {
    const ok = await confirmDialog({
      title: 'Delete supplier',
      message: `Delete "${s.name}"?`
    })
    if (!ok) return
    const res = await api.suppliers.delete(s.id)
    if (res.ok) {
      qc.invalidateQueries({ queryKey: ['suppliers'] })
      toast.success('Supplier deleted.')
    } else toast.error(res.error || 'Could not delete supplier.')
  }

  return (
    <>
      <PageHeader
        title="Suppliers"
        description="Raw material suppliers and their purchase summary"
        actions={
          <>
            <Button variant="outline" onClick={exportExcel} disabled={!data.length}>
              <FileSpreadsheet size={16} /> Excel
            </Button>
            <Button onClick={() => { setForm({ plant_id: plantId ?? null }); setOpen(true) }}>
              <Plus size={16} /> New Supplier
            </Button>
          </>
        }
      />
      <Page>
        {data.length === 0 ? (
          <EmptyState message="No suppliers yet." />
        ) : (
          <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Input className="w-full sm:w-60" placeholder="Search name, contact, address…" value={q} onChange={(e) => setQ(e.target.value)} />
            <SearchSelect
              className="w-full sm:w-48"
              value={companyFilter}
              onChange={setCompanyFilter}
              options={[{ value: '', label: 'All companies' }, { value: 'none', label: 'No company' }, ...companies.map((c) => ({ value: String(c.id), label: c.name }))]}
            />
            <SearchSelect
              className="w-full sm:w-40"
              value={dues}
              onChange={setDues}
              options={[{ value: '', label: 'All payments' }, { value: 'due', label: 'Has dues' }, { value: 'clear', label: 'Cleared' }]}
            />
            {(q || companyFilter || dues) && <Button variant="ghost" size="sm" onClick={() => { setQ(''); setCompanyFilter(''); setDues('') }}>Clear</Button>}
            <span className="ml-auto text-sm text-muted-foreground">{filtered.length} of {data.length}</span>
          </div>
          {filtered.length === 0 ? (
            <EmptyState message="No suppliers match your search." />
          ) : (
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Company</TH>
                <TH>Plant</TH>
                <TH className="text-right">Purchased (m³)</TH>
                <TH className="text-right">Total Amt</TH>
                <TH className="text-right">Unpaid</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {filtered.map((s) => (
                <TR key={s.id}>
                  <TD className="font-medium">{s.name}</TD>
                  <TD className="text-muted-foreground">{s.company_name || '-'}</TD>
                  <TD className="text-muted-foreground">{s.plant_name || 'Common'}</TD>
                  <TD className="text-right">{fmtQty(s.total_purchased)}</TD>
                  <TD className="text-right">{fmtMoney(s.total_amount)}</TD>
                  <TD className="text-right font-semibold text-destructive">
                    {fmtMoney(s.unpaid_amount)}
                  </TD>
                  <TD className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => { setForm(s); setOpen(true) }}>
                      <Pencil size={15} />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(s)}>
                      <Trash2 size={15} className="text-destructive" />
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          )}
          </>
        )}
      </Page>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={form.id ? 'Edit Supplier' : 'New Supplier'}
      >
        <div className="space-y-4">
          <Field label="Supplier Name">
            <Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Company / Group (optional)" hint="For a combined company ledger">
              <SearchSelect
                value={form.company_id ?? ''}
                onChange={(v) => setForm({ ...form, company_id: v ? Number(v) : null })}
                options={[{ value: '', label: '— None —' }, ...companies.map((c) => ({ value: c.id, label: c.name }))]}
              />
            </Field>
            <Field label="Plant" hint="Common = available to all plants">
              <SearchSelect
                value={form.plant_id ?? ''}
                onChange={(v) => setForm({ ...form, plant_id: v ? Number(v) : null })}
                options={[{ value: '', label: 'Common (all plants)' }, ...plants.map((p) => ({ value: p.id, label: p.name }))]}
              />
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
