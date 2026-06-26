import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, FileSpreadsheet } from 'lucide-react'
import { api } from '@/lib/api'
import type { Transporter } from '@shared/types'
import { PageHeader, Page } from '@/components/layout'
import {
  Button,
  Input,
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
  EmptyState,
  PlantCheckboxes
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
  const [q, setQ] = React.useState('')
  const [companyFilter, setCompanyFilter] = React.useState('')
  const [bal, setBal] = React.useState('')

  const filtered = React.useMemo(() => {
    const term = q.trim().toLowerCase()
    return data.filter((t) => {
      if (term && !`${t.name} ${t.contact ?? ''} ${t.address ?? ''}`.toLowerCase().includes(term)) return false
      if (companyFilter === 'none' && t.company_id) return false
      if (companyFilter && companyFilter !== 'none' && String(t.company_id ?? '') !== companyFilter) return false
      if (bal === 'due' && !((t.balance_amount ?? 0) > 0.005)) return false
      if (bal === 'clear' && (t.balance_amount ?? 0) > 0.005) return false
      return true
    })
  }, [data, q, companyFilter, bal])

  function exportExcel(): void {
    downloadExcel(
      'transporters',
      'Transporters',
      ['Name', 'Company', 'Plant', 'Contact', 'Trips', 'Carried (m³)', 'Bill Amount', 'Diesel', 'Paid', 'Balance'],
      data.map((t) => [
        t.name, t.company_name ?? '', (t.plant_names ?? []).length ? (t.plant_names ?? []).join(', ') : 'Common', t.contact, t.total_trips ?? 0, t.total_cm ?? 0,
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

  function togglePlant(id: number): void {
    const cur = form.plant_ids ?? []
    setForm({ ...form, plant_ids: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] })
  }

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
            <Button onClick={() => { setForm({ plant_ids: plantId ? [plantId] : [] }); setOpen(true) }}>
              <Plus size={16} /> New Transporter
            </Button>
          </>
        }
      />
      <Page>
        {data.length === 0 ? (
          <EmptyState message="No transporters yet." />
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
              value={bal}
              onChange={setBal}
              options={[{ value: '', label: 'All balances' }, { value: 'due', label: 'Has balance' }, { value: 'clear', label: 'Settled' }]}
            />
            {(q || companyFilter || bal) && <Button variant="ghost" size="sm" onClick={() => { setQ(''); setCompanyFilter(''); setBal('') }}>Clear</Button>}
            <span className="ml-auto text-sm text-muted-foreground">{filtered.length} of {data.length}</span>
          </div>
          {filtered.length === 0 ? (
            <EmptyState message="No transporters match your search." />
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
              {filtered.map((t) => (
                <TR key={t.id}>
                  <TD className="font-medium">{t.name}</TD>
                  <TD className="text-muted-foreground">{t.company_name || '-'}</TD>
                  <TD className="text-muted-foreground">{(t.plant_names ?? []).length ? (t.plant_names ?? []).join(', ') : 'Common'}</TD>
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
          </>
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
          <Field label="Company / Group (optional)" hint="For a combined company ledger">
            <SearchSelect
              value={form.company_id ?? ''}
              onChange={(v) => setForm({ ...form, company_id: v ? Number(v) : null })}
              options={[{ value: '', label: '— None —' }, ...companies.map((c) => ({ value: c.id, label: c.name }))]}
            />
          </Field>
          <Field label="Plants" hint="Tick the plants this transporter works with — leave all unticked for common (all plants)">
            <PlantCheckboxes plants={plants} selected={form.plant_ids ?? []} onToggle={togglePlant} />
          </Field>
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
