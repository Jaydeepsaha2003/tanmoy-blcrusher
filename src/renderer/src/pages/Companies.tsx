import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, FileSpreadsheet, BookOpen } from 'lucide-react'
import { api } from '@/lib/api'
import type { Company } from '@shared/types'
import { PageHeader, Page } from '@/components/layout'
import {
  Button,
  Input,
  SearchSelect,
  Textarea,
  Field,
  Badge,
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
import { downloadExcel } from '@/lib/utils'

export function Companies(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const nav = useNavigate()
  const { plantId } = usePlant()
  const { data = [] } = useQuery({ queryKey: ['companies'], queryFn: api.companies.list })
  const { data: plants = [] } = useQuery({ queryKey: ['plants'], queryFn: api.plants.list })
  const [open, setOpen] = React.useState(false)
  type CompanyForm = Partial<Company> & { as_supplier?: boolean; as_customer?: boolean; as_transporter?: boolean }
  const [form, setForm] = React.useState<CompanyForm>({})

  function togglePlant(id: number): void {
    const cur = form.plant_ids ?? []
    setForm({ ...form, plant_ids: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] })
  }
  const [q, setQ] = React.useState('')
  const [role, setRole] = React.useState('')

  const filtered = React.useMemo(() => {
    const term = q.trim().toLowerCase()
    return data.filter((c) => {
      if (term && !`${c.name} ${c.contact ?? ''} ${c.address ?? ''}`.toLowerCase().includes(term)) return false
      if (role === 'none' && (c.roles ?? []).length > 0) return false
      if (role && role !== 'none' && !(c.roles ?? []).includes(role)) return false
      return true
    })
  }, [data, q, role])

  const save = useMutation({
    mutationFn: (p: CompanyForm) => (p.id ? api.companies.update(p) : api.companies.create(p)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['companies'] })
      qc.invalidateQueries({ queryKey: ['suppliers'] })
      qc.invalidateQueries({ queryKey: ['customers'] })
      qc.invalidateQueries({ queryKey: ['transporters'] })
      setOpen(false)
      toast.success('Company saved.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  async function remove(c: Company): Promise<void> {
    const ok = await confirmDialog({
      title: 'Delete company',
      message: `Delete "${c.name}"? Linked suppliers, customers and transporters are kept but unlinked from this company.`
    })
    if (!ok) return
    const res = await api.companies.delete(c.id)
    if (res.ok) {
      qc.invalidateQueries({ queryKey: ['companies'] })
      qc.invalidateQueries({ queryKey: ['suppliers'] })
      qc.invalidateQueries({ queryKey: ['customers'] })
      qc.invalidateQueries({ queryKey: ['transporters'] })
      toast.success('Company deleted.')
    } else toast.error(res.error || 'Could not delete company.')
  }

  function exportExcel(): void {
    downloadExcel(
      'companies',
      'Companies',
      ['Name', 'Roles', 'Plants', 'Contact', 'Address', 'Remarks'],
      data.map((c) => [c.name, (c.roles ?? []).join(', '), (c.plant_names ?? []).length ? (c.plant_names ?? []).join(', ') : 'All plants', c.contact, c.address, c.remarks])
    )
  }

  return (
    <>
      <PageHeader
        title="Companies / Groups"
        description="Link one company as supplier, customer and transporter for a combined ledger"
        actions={
          <>
            <Button variant="outline" onClick={exportExcel} disabled={!data.length}>
              <FileSpreadsheet size={16} /> Excel
            </Button>
            <Button onClick={() => { setForm({ as_supplier: true, as_customer: true, as_transporter: true, plant_ids: plantId ? [plantId] : [] }); setOpen(true) }}>
              <Plus size={16} /> New Company
            </Button>
          </>
        }
      />
      <Page>
        <div className="mb-4 rounded-lg border border-primary/30 bg-accent/50 px-4 py-3 text-sm text-accent-foreground">
          Create a company here (e.g. <b>Brijesh Ltd.</b>), then open Suppliers, Customers or
          Transporters and set their <b>Company</b> field to it. The <b>Ledgers → Companies</b> view
          then shows one combined statement across all those roles.
        </div>
        {data.length === 0 ? (
          <EmptyState message="No companies yet." />
        ) : (
          <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Input className="w-full sm:w-60" placeholder="Search name, contact, address…" value={q} onChange={(e) => setQ(e.target.value)} />
            <SearchSelect
              className="w-full sm:w-44"
              value={role}
              onChange={setRole}
              options={[
                { value: '', label: 'All roles' },
                { value: 'Supplier', label: 'Supplier' },
                { value: 'Customer', label: 'Customer' },
                { value: 'Transporter', label: 'Transporter' },
                { value: 'none', label: 'Not linked' }
              ]}
            />
            {(q || role) && <Button variant="ghost" size="sm" onClick={() => { setQ(''); setRole('') }}>Clear</Button>}
            <span className="ml-auto text-sm text-muted-foreground">{filtered.length} of {data.length}</span>
          </div>
          {filtered.length === 0 ? (
            <EmptyState message="No companies match your search." />
          ) : (
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Roles</TH>
                <TH>Plants</TH>
                <TH>Contact</TH>
                <TH>Address</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {filtered.map((c) => (
                <TR key={c.id}>
                  <TD className="font-medium">{c.name}</TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {(c.roles ?? []).length === 0 ? (
                        <span className="text-xs text-muted-foreground">Not linked</span>
                      ) : (
                        (c.roles ?? []).map((r) => (
                          <Badge key={r} variant="muted">{r}</Badge>
                        ))
                      )}
                    </div>
                  </TD>
                  <TD className="text-muted-foreground">{(c.plant_names ?? []).length ? (c.plant_names ?? []).join(', ') : 'All plants'}</TD>
                  <TD className="text-muted-foreground">{c.contact || '-'}</TD>
                  <TD className="text-muted-foreground">{c.address || '-'}</TD>
                  <TD className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Combined ledger"
                      onClick={() => nav('/ledgers', { state: { type: 'company', id: c.id } })}
                    >
                      <BookOpen size={15} />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => { setForm({ ...c, plant_ids: c.plant_ids ?? [], as_supplier: (c.roles ?? []).includes('Supplier'), as_customer: (c.roles ?? []).includes('Customer'), as_transporter: (c.roles ?? []).includes('Transporter') }); setOpen(true) }}>
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
          </>
        )}
      </Page>

      <Modal open={open} onClose={() => setOpen(false)} title={form.id ? 'Edit Company' : 'New Company'}>
        <div className="space-y-4">
          <Field label="Company Name">
            <Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Brijesh Ltd." />
          </Field>
          {(
            <Field label="Roles" hint={form.id ? 'Tick to add a linked record for that role; untick to remove it (kept if it has transactions).' : "Auto-creates a linked record for each role so you can use this company straight away. Uncheck any you don't need."}>
              <div className="flex flex-wrap gap-2">
                {([
                  ['as_supplier', 'Supplier'],
                  ['as_customer', 'Customer'],
                  ['as_transporter', 'Transporter']
                ] as const).map(([key, label]) => {
                  const checked = form[key] !== false
                  return (
                    <label
                      key={key}
                      className={
                        'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ' +
                        (checked ? 'border-primary bg-primary/5 text-foreground' : 'border-input text-muted-foreground hover:bg-accent')
                      }
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={checked}
                        onChange={(e) => setForm({ ...form, [key]: e.target.checked })}
                      />
                      {label}
                    </label>
                  )
                })}
              </div>
            </Field>
          )}
          <Field label="Plants" hint={form.id ? 'Tick the plants this company works with — leave all unticked for all plants' : 'Tick the plants — new linked supplier/customer/transporter inherit these'}>
            <PlantCheckboxes plants={plants} selected={form.plant_ids ?? []} onToggle={togglePlant} />
          </Field>
          <Field label="Contact Details">
            <Input value={form.contact || ''} onChange={(e) => setForm({ ...form, contact: e.target.value })} placeholder="Phone / email" />
          </Field>
          <Field label="Address">
            <Textarea value={form.address || ''} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
          <Field label="Remarks">
            <Input value={form.remarks || ''} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate(form)} disabled={!form.name?.trim()}>Save</Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
