import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, FileSpreadsheet, Truck, ArrowLeft } from 'lucide-react'
import { api } from '@/lib/api'
import type { Transporter, TransporterFleetItem, Uom, Plant } from '@shared/types'
import { toCm, fromCm, UOMS } from '@shared/types'
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
  const [fleetFor, setFleetFor] = React.useState<Transporter | null>(null)
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
                    <Button variant="ghost" size="icon" title="Vehicles & JCBs" onClick={() => setFleetFor(t)}>
                      <Truck size={15} />
                    </Button>
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

      {fleetFor && (
        <FleetModal transporter={fleetFor} plants={plants} plantId={plantId} onClose={() => setFleetFor(null)} />
      )}
    </>
  )
}

const uomLabel = (u: Uom): string => (u === 'CM' ? 'm³' : u === 'TON' ? 'Ton' : 'CFT')
const round3 = (n: number): number => Math.round((n + Number.EPSILON) * 1000) / 1000

/** Per-transporter Vehicles & JCBs: capacity in all UOMs (auto-converted) + per-trip / per-unit rates. */
function FleetModal({
  transporter,
  plants,
  plantId,
  onClose
}: {
  transporter: Transporter
  plants: Plant[]
  plantId?: number
  onClose: () => void
}): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const [kind, setKind] = React.useState<'vehicle' | 'jcb'>('vehicle')
  const [form, setForm] = React.useState<any>(null)
  const { data: items = [] } = useQuery({
    queryKey: ['transporterFleet', transporter.id],
    queryFn: () => api.transporterFleet.list(transporter.id)
  })
  const list = items.filter((i) => i.kind === kind)
  // Density factors for the capacity auto-conversion: active plant, else first plant, else app defaults.
  const factor = plants.find((p) => p.id === plantId) ?? plants[0]
  const noun = kind === 'vehicle' ? 'Vehicle' : 'JCB'

  const save = useMutation({
    mutationFn: (p: any) =>
      p.id
        ? api.transporterFleet.update(p)
        : api.transporterFleet.create({ ...p, transporter_id: transporter.id, kind }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transporterFleet', transporter.id] })
      setForm(null)
      toast.success(`${noun} saved.`)
    },
    onError: (e: Error) => toast.error(e.message)
  })

  async function remove(it: TransporterFleetItem): Promise<void> {
    if (!(await confirmDialog({ title: `Delete ${it.kind}`, message: `Delete "${it.name}"?` }))) return
    await api.transporterFleet.delete(it.id)
    qc.invalidateQueries({ queryKey: ['transporterFleet', transporter.id] })
    toast.success('Deleted.')
  }

  function newItem(): void {
    setForm({ name: '', driver_name: '', driver_mobile: '', cap_cm: '', cap_ton: '', cap_cft: '', rate_per_trip: '', rate_per_unit: '', rate_unit_uom: 'CM', remarks: '' })
  }
  function editItem(it: TransporterFleetItem): void {
    setForm({
      ...it,
      cap_cm: it.cap_cm ?? '', cap_ton: it.cap_ton ?? '', cap_cft: it.cap_cft ?? '',
      rate_per_trip: it.rate_per_trip ?? '', rate_per_unit: it.rate_per_unit ?? ''
    })
  }

  // Enter capacity in one UOM; the other two are auto-filled with this plant's density.
  function setCap(uom: Uom, value: string): void {
    if (!form) return
    if (value === '') {
      setForm({ ...form, cap_cm: '', cap_ton: '', cap_cft: '' })
      return
    }
    const cm = toCm(Number(value) || 0, uom, factor)
    setForm({
      ...form,
      cap_cm: uom === 'CM' ? value : round3(cm),
      cap_ton: uom === 'TON' ? value : round3(fromCm(cm, 'TON', factor)),
      cap_cft: uom === 'CFT' ? value : round3(fromCm(cm, 'CFT', factor))
    })
  }

  const rateText = (it: TransporterFleetItem): string => {
    const bits: string[] = []
    if (it.rate_per_trip != null) bits.push(`${fmtMoney(it.rate_per_trip)}/trip`)
    if (it.rate_per_unit != null) bits.push(`${fmtMoney(it.rate_per_unit)}/${uomLabel(it.rate_unit_uom)}`)
    return bits.length ? bits.join(' · ') : '-'
  }

  return (
    <Modal open onClose={onClose} title={`Fleet — ${transporter.name}`} width="max-w-3xl">
      <div className="mb-4 flex gap-2 border-b pb-3">
        {(['vehicle', 'jcb'] as const).map((k) => (
          <Button key={k} variant={kind === k ? 'default' : 'outline'} size="sm" onClick={() => { setKind(k); setForm(null) }}>
            {k === 'vehicle' ? 'Vehicles' : 'JCBs'}
          </Button>
        ))}
      </div>

      {form ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={kind === 'vehicle' ? 'Vehicle No.' : 'JCB Name / No.'} required>
              <Input value={String(form.name ?? '')} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={kind === 'vehicle' ? 'e.g. JH-01-AB-1234' : 'e.g. JCB-01'} />
            </Field>
            <Field label="Driver Name"><Input value={String(form.driver_name ?? '')} onChange={(e) => setForm({ ...form, driver_name: e.target.value })} /></Field>
            <Field label="Driver Mobile"><Input value={String(form.driver_mobile ?? '')} onChange={(e) => setForm({ ...form, driver_mobile: e.target.value })} /></Field>
          </div>

          <div>
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground/80">Capacity (per trip)</div>
            <div className="grid grid-cols-3 gap-4">
              <Field label="m³"><Input type="number" step="0.001" value={String(form.cap_cm ?? '')} onChange={(e) => setCap('CM', e.target.value)} /></Field>
              <Field label="Ton"><Input type="number" step="0.001" value={String(form.cap_ton ?? '')} onChange={(e) => setCap('TON', e.target.value)} /></Field>
              <Field label="CFT"><Input type="number" step="0.001" value={String(form.cap_cft ?? '')} onChange={(e) => setCap('CFT', e.target.value)} /></Field>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Enter any one — the other two auto-fill using {factor ? `${factor.name}'s` : 'default'} density (1 m³ ≈ {round3(fromCm(1, 'TON', factor))} Ton, {round3(fromCm(1, 'CFT', factor))} CFT).
            </p>
          </div>

          <div>
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground/80">Rates</div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Rate per Trip (₹)"><Input type="number" step="0.01" value={String(form.rate_per_trip ?? '')} onChange={(e) => setForm({ ...form, rate_per_trip: e.target.value })} placeholder="Optional" /></Field>
              <Field label="Rate per Unit (₹)"><Input type="number" step="0.01" value={String(form.rate_per_unit ?? '')} onChange={(e) => setForm({ ...form, rate_per_unit: e.target.value })} placeholder="Optional" /></Field>
              <Field label="Per Unit">
                <SearchSelect value={form.rate_unit_uom ?? 'CM'} onChange={(v) => setForm({ ...form, rate_unit_uom: v as Uom })} options={UOMS.map((u) => ({ value: u, label: uomLabel(u) }))} />
              </Field>
            </div>
          </div>

          <Field label="Remarks"><Input value={String(form.remarks ?? '')} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></Field>

          <div className="flex justify-between gap-2 pt-2">
            <Button variant="ghost" onClick={() => setForm(null)}><ArrowLeft size={15} /> Back</Button>
            <Button onClick={() => save.mutate(form)} disabled={!String(form.name ?? '').trim()}>Save {noun}</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-3 flex justify-end">
            <Button size="sm" onClick={newItem}><Plus size={15} /> Add {noun}</Button>
          </div>
          {list.length === 0 ? (
            <EmptyState message={`No ${kind === 'vehicle' ? 'vehicles' : 'JCBs'} added for this transporter yet.`} />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>{kind === 'vehicle' ? 'Vehicle No' : 'JCB'}</TH>
                  <TH>Driver</TH>
                  <TH className="text-right">Capacity (m³ / Ton / CFT)</TH>
                  <TH className="text-right">Rate</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {list.map((it) => (
                  <TR key={it.id}>
                    <TD className="font-medium">{it.name}</TD>
                    <TD className="text-muted-foreground">{[it.driver_name, it.driver_mobile].filter(Boolean).join(' · ') || '-'}</TD>
                    <TD className="tnum text-right">{[it.cap_cm, it.cap_ton, it.cap_cft].map((c) => (c == null ? '–' : fmtQty(c))).join(' / ')}</TD>
                    <TD className="tnum text-right">{rateText(it)}</TD>
                    <TD className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => editItem(it)}><Pencil size={15} /></Button>
                      <Button variant="ghost" size="icon" onClick={() => remove(it)}><Trash2 size={15} className="text-destructive" /></Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </>
      )}
    </Modal>
  )
}
