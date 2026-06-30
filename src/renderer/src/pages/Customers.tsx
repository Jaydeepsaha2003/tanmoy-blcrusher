import * as React from 'react'
import { usePersistentState } from '@/lib/persistentState'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, FileSpreadsheet, Tags, Link2, Copy, ExternalLink, XCircle, Save } from 'lucide-react'
import { api } from '@/lib/api'
import type { Customer, Product, Uom } from '@shared/types'
import { UOMS } from '@shared/types'
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
  EmptyState,
  PlantCheckboxes
} from '@/components/ui'
import { useToast } from '@/components/toast'
import { confirmDialog } from '@/components/confirm'
import { usePlant } from '@/lib/plant'
import { fmtQty, downloadExcel } from '@/lib/utils'

function shareOrigin(): string {
  return typeof window !== 'undefined' && window.location.origin.startsWith('http')
    ? window.location.origin
    : ''
}

export function Customers(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const { plantId } = usePlant()
  const { data = [] } = useQuery({ queryKey: ['customers', plantId], queryFn: () => api.customers.list(plantId) })
  const { data: companies = [] } = useQuery({ queryKey: ['companies'], queryFn: api.companies.list })
  const { data: plants = [] } = useQuery({ queryKey: ['plants'], queryFn: api.plants.list })
  // Rate-list product picker shows only the active plant's products (plus common).
  const { data: products = [] } = useQuery({ queryKey: ['products', plantId], queryFn: () => api.products.list(plantId) })
  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState<Partial<Customer>>({})
  const [ratesFor, setRatesFor] = React.useState<Customer | null>(null)
  const [q, setQ] = usePersistentState('q', '')
  const [companyFilter, setCompanyFilter] = usePersistentState('companyFilter', '')

  const filtered = React.useMemo(() => {
    const term = q.trim().toLowerCase()
    return data.filter((c) => {
      if (term && !`${c.name} ${c.contact ?? ''} ${c.address ?? ''}`.toLowerCase().includes(term)) return false
      if (companyFilter === 'none' && c.company_id) return false
      if (companyFilter && companyFilter !== 'none' && String(c.company_id ?? '') !== companyFilter) return false
      return true
    })
  }, [data, q, companyFilter])

  function exportExcel(): void {
    downloadExcel(
      'customers',
      'Customers',
      ['Name', 'Company', 'Plant', 'Contact', 'Address', 'Total Sold (m³)'],
      data.map((c) => [c.name, c.company_name ?? '', (c.plant_names ?? []).length ? (c.plant_names ?? []).join(', ') : 'Common', c.contact, c.address, c.total_dispatched ?? 0])
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

  function togglePlant(id: number): void {
    const cur = form.plant_ids ?? []
    setForm({ ...form, plant_ids: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] })
  }

  async function remove(c: Customer): Promise<void> {
    const ok = await confirmDialog({ title: 'Delete customer', message: `Delete "${c.name}"?` })
    if (!ok) return
    const res = await api.customers.delete(c.id)
    if (res.ok) {
      qc.invalidateQueries({ queryKey: ['customers'] })
      toast.success('Customer deleted.')
    } else toast.error(res.error || 'Could not delete customer.')
  }

  async function copyShareUrl(c: Customer): Promise<void> {
    try {
      const res = await api.rates.shareLink(c.id)
      const url = `${shareOrigin()}${res.path}`
      try {
        await navigator.clipboard.writeText(url || res.path)
        toast.success(`Rate-list link for ${c.name} copied to clipboard.`)
      } catch {
        toast.success('Rate-list link ready.')
      }
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <>
      <PageHeader
        title="Customers / Parties"
        description="Customers you sell finished goods to — set their rate list and share a live price link."
        actions={
          <>
            <Button variant="outline" onClick={exportExcel} disabled={!data.length}>
              <FileSpreadsheet size={16} /> Excel
            </Button>
            <Button onClick={() => { setForm({ plant_ids: plantId ? [plantId] : [] }); setOpen(true) }}>
              <Plus size={16} /> New Customer
            </Button>
          </>
        }
      />
      <Page>
        {data.length === 0 ? (
          <EmptyState message="No customers yet." />
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
            {(q || companyFilter) && <Button variant="ghost" size="sm" onClick={() => { setQ(''); setCompanyFilter('') }}>Clear</Button>}
            <span className="ml-auto text-sm text-muted-foreground">{filtered.length} of {data.length}</span>
          </div>
          {filtered.length === 0 ? (
            <EmptyState message="No customers match your search." />
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
              {filtered.map((c) => (
                <TR key={c.id}>
                  <TD className="font-medium">{c.name}</TD>
                  <TD className="text-muted-foreground">{c.company_name || '-'}</TD>
                  <TD className="text-muted-foreground">{(c.plant_names ?? []).length ? (c.plant_names ?? []).join(', ') : 'Common'}</TD>
                  <TD className="text-muted-foreground">{c.contact || '-'}</TD>
                  <TD className="text-right">{fmtQty(c.total_dispatched)}</TD>
                  <TD className="text-right">
                    <Button variant="ghost" size="icon" title="Rate list" onClick={() => setRatesFor(c)}>
                      <Tags size={15} />
                    </Button>
                    <Button variant="ghost" size="icon" title="Copy shareable rate link" onClick={() => copyShareUrl(c)}>
                      <Link2 size={15} />
                    </Button>
                    <Button variant="ghost" size="icon" title="Edit" onClick={() => { setForm(c); setOpen(true) }}>
                      <Pencil size={15} />
                    </Button>
                    <Button variant="ghost" size="icon" title="Delete" onClick={() => remove(c)}>
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
        title={form.id ? 'Edit Customer' : 'New Customer'}
      >
        <div className="space-y-4">
          <Field label="Customer / Party Name">
            <Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Company / Group (optional)" hint="For a combined company ledger">
            <SearchSelect
              value={form.company_id ?? ''}
              onChange={(v) => setForm({ ...form, company_id: v ? Number(v) : null })}
              options={[{ value: '', label: '— None —' }, ...companies.map((c) => ({ value: c.id, label: c.name }))]}
            />
          </Field>
          <Field label="Plants" hint="Tick the plants this customer works with — leave all unticked for common (all plants)">
            <PlantCheckboxes plants={plants} selected={form.plant_ids ?? []} onToggle={togglePlant} />
          </Field>
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

      {ratesFor && (
        <RatesModal customer={ratesFor} products={products} onClose={() => setRatesFor(null)} />
      )}
    </>
  )
}

interface RateRow {
  product_name: string
  uom: Uom
  rate: number | string
}

/** Per-customer rate list editor + shareable public link. */
function RatesModal({
  customer,
  products,
  onClose
}: {
  customer: Customer
  products: Product[]
  onClose: () => void
}): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const { data: rates = [] } = useQuery({
    queryKey: ['rates', customer.id],
    queryFn: () => api.rates.list(customer.id)
  })

  const [rows, setRows] = React.useState<RateRow[]>([])
  React.useEffect(() => {
    setRows(rates.map((r) => ({ product_name: r.product_name, uom: r.uom, rate: r.rate })))
  }, [rates])

  const [share, setShare] = React.useState<{ path: string } | null>(null)
  const origin = shareOrigin()
  const fullUrl = share ? `${origin}${share.path}` : ''

  const save = useMutation({
    mutationFn: () =>
      api.rates.save(
        customer.id,
        rows
          .filter((r) => r.product_name)
          .map((r) => ({ product_name: r.product_name, uom: r.uom, rate: Number(r.rate) || 0 }))
      ),
    onSuccess: (res) => {
      if (res.ok) {
        qc.invalidateQueries({ queryKey: ['rates', customer.id] })
        toast.success('Rate list saved.')
        onClose()
      } else toast.error(res.error || 'Could not save.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  function update(i: number, patch: Partial<RateRow>): void {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  async function makeLink(): Promise<void> {
    try {
      const res = await api.rates.shareLink(customer.id)
      setShare({ path: res.path })
      try {
        await navigator.clipboard.writeText(`${origin}${res.path}` || res.path)
        toast.success('Share link copied.')
      } catch {
        toast.success('Share link ready.')
      }
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  async function revoke(): Promise<void> {
    await api.rates.removeShareLink(customer.id)
    setShare(null)
    toast.success('Share link revoked.')
  }

  return (
    <Modal open onClose={onClose} title={`Rate List — ${customer.name}`} width="max-w-2xl">
      <div className="space-y-5">
        {/* Share link */}
        <div className="rounded-lg border bg-muted/30 p-3.5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Link2 size={15} /> Shareable rate link (no login)
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Send this customer a private link. It always shows your current saved rates — edits here
            update their page automatically.
          </p>
          {share ? (
            <div className="mt-2.5 space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input readOnly value={fullUrl || share.path} className="font-mono text-xs" />
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { navigator.clipboard?.writeText(fullUrl || share.path); toast.success('Copied.') }}
                  >
                    <Copy size={14} /> Copy
                  </Button>
                  {origin && (
                    <a href={fullUrl} target="_blank" rel="noreferrer">
                      <Button variant="outline" size="sm"><ExternalLink size={14} /> Open</Button>
                    </a>
                  )}
                  <Button variant="ghost" size="sm" onClick={revoke}>
                    <XCircle size={14} className="text-destructive" /> Revoke
                  </Button>
                </div>
              </div>
              {!origin && (
                <p className="text-xs text-muted-foreground">
                  On the web app this becomes a full link like
                  <span className="font-mono"> https://yourdomain{share.path}</span>.
                </p>
              )}
            </div>
          ) : (
            <Button variant="outline" size="sm" className="mt-2.5" onClick={makeLink}>
              <Link2 size={14} /> Generate &amp; copy link
            </Button>
          )}
        </div>

        {/* Rates grid */}
        {products.length === 0 ? (
          <EmptyState message="Add products first (Products menu) — rates are set per product." />
        ) : (
          <div>
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_96px_120px_36px] gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <div>Product</div>
                <div>Unit</div>
                <div>Rate (₹/unit)</div>
                <div></div>
              </div>
              {rows.map((r, i) => (
                <div key={i} className="grid grid-cols-[1fr_96px_120px_36px] gap-2">
                  <SearchSelect
                    value={r.product_name}
                    onChange={(v) => update(i, { product_name: v })}
                    placeholder="Select product…"
                    options={[
                      // keep a stale value selectable
                      ...(r.product_name && !products.some((p) => p.name === r.product_name)
                        ? [{ value: r.product_name, label: r.product_name }]
                        : []),
                      ...products.map((p) => ({ value: p.name, label: p.name }))
                    ]}
                  />
                  <SearchSelect
                    value={r.uom}
                    onChange={(v) => update(i, { uom: v as Uom })}
                    options={UOMS.map((u) => ({ value: u, label: u }))}
                  />
                  <Input
                    type="number"
                    step="0.01"
                    value={r.rate}
                    onChange={(e) => update(i, { rate: e.target.value })}
                  />
                  <Button variant="ghost" size="icon" onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}>
                    <Trash2 size={15} className="text-destructive" />
                  </Button>
                </div>
              ))}
              {rows.length === 0 && (
                <p className="px-1 py-1.5 text-sm text-muted-foreground">No rates yet. Add a product rate below.</p>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => setRows((rs) => [...rs, { product_name: '', uom: 'CM', rate: '' }])}
            >
              <Plus size={15} /> Add Product Rate
            </Button>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t pt-4">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={products.length === 0}>
            <Save size={16} /> Save Rate List
          </Button>
        </div>
      </div>
    </Modal>
  )
}
