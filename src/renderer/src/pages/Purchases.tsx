import * as React from 'react'
import { usePersistentState } from '@/lib/persistentState'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, FileSpreadsheet, Mountain, Boxes, Pickaxe, X } from 'lucide-react'
import { api } from '@/lib/api'
import { TransporterVehicleSelect } from '@/components/vehicleSelect'
import type { Purchase, PaymentStatus, MachineBasis, Uom } from '@shared/types'
import { PageHeader, Page } from '@/components/layout'
import {
  Button,
  Input,
  Select,
  SearchSelect,
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
import { usePlant } from '@/lib/plant'
import { derivePaymentStatus, toCm, fromCm, UOMS } from '@shared/types'
import { fmtQty, fmtMoney, fmtDate, today, downloadExcel } from '@/lib/utils'

const payBadge: Record<PaymentStatus, 'success' | 'warning' | 'destructive'> = {
  paid: 'success',
  partial: 'warning',
  unpaid: 'destructive'
}

const MODES = [
  { key: 'raw', label: 'Raw Purchase', icon: Mountain, material_type: 'raw', purchase_mode: 'purchase' },
  { key: 'finished', label: 'Products (Finished)', icon: Boxes, material_type: 'finished', purchase_mode: 'purchase' },
  { key: 'mining', label: 'Mining (Royalty)', icon: Pickaxe, material_type: 'raw', purchase_mode: 'mining' }
] as const

function modeKey(f: { material_type?: string; purchase_mode?: string }): 'raw' | 'finished' | 'mining' {
  if (f.material_type === 'finished') return 'finished'
  if (f.purchase_mode === 'mining') return 'mining'
  return 'raw'
}

export function Purchases(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const { plantId } = usePlant()
  const { data: plants = [] } = useQuery({ queryKey: ['plants'], queryFn: api.plants.list })
  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers', plantId], queryFn: () => api.suppliers.list(plantId) })
  const [filter, setFilter] = usePersistentState<{ supplier_id?: number; payment_status?: string }>('filter', {})
  const { data: locations = [] } = useQuery({ queryKey: ['locations', 0], queryFn: () => api.locations.list() })
  const { data: outsourceVendors = [] } = useQuery({ queryKey: ['outsource'], queryFn: () => api.outsource.list() })
  const { data: transporters = [] } = useQuery({ queryKey: ['transporters', plantId], queryFn: () => api.transporters.list(plantId) })
  const { data: assets = [] } = useQuery({ queryKey: ['assets', plantId], queryFn: () => api.assets.list(plantId) })

  const { data = [] } = useQuery({
    queryKey: ['purchases', filter, plantId],
    queryFn: () => api.purchases.list(cleanFilter({ ...filter, plant_id: plantId }))
  })

  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState<any>(null)
  // Finished-product picker shows only the destination plant's products (plus common).
  const { data: products = [] } = useQuery({ queryKey: ['products', form?.plant_id], queryFn: () => api.products.list(form?.plant_id) })
  // UOM the Excel export is expressed in: 'default' keeps each row's own purchase
  // unit; CM/TON/CFT converts every row to that single unit (via the plant factors).
  const [exportUom, setExportUom] = React.useState<'default' | Uom>('default')

  const formLocations = locations.filter((l) => l.plant_id === form?.plant_id)
  const formPlant = plants.find((pl) => pl.id === form?.plant_id)
  const mk = form ? modeKey(form) : 'raw'

  const save = useMutation({
    mutationFn: (p: any) => (p.id ? api.purchases.update(p) : api.purchases.create(p)),
    onSuccess: () => {
      qc.invalidateQueries()
      setOpen(false)
      toast.success('Purchase saved.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  function blankForm(): any {
    return {
      supplier_id: suppliers[0]?.id,
      plant_id: plantId ?? plants[0]?.id,
      stock_location_id: undefined,
      material_type: 'raw',
      purchase_mode: 'purchase',
      product_name: '',
      outsource_id: null,
      uom: 'CM',
      quantity: '',
      rate: '',
      paid_amount: 0,
      payment_status: 'unpaid',
      challan_no: '',
      date: today(),
      remarks: '',
      transporters: [],
      machines: []
    }
  }
  function openNew(): void {
    setForm(blankForm())
    setOpen(true)
  }
  async function openEdit(p: Purchase): Promise<void> {
    const d = await api.purchases.detail(p.id).catch(() => null)
    const src = d ?? p
    setForm({
      ...src,
      rate: src.rate ?? '',
      transporters: (src.transporters ?? []).map((t) => ({ transporter_id: t.transporter_id, vehicle_no: t.vehicle_no, basis: t.basis || 'flat', qty: t.qty || '', rate: t.rate || '', charge: t.charge })),
      machines: (src.machines ?? []).map((m) => ({ asset_id: m.asset_id, basis: m.basis, qty: m.qty, rate: m.rate, outsource_id: m.outsource_id }))
    })
    setOpen(true)
  }

  async function remove(p: Purchase): Promise<void> {
    const ok = await confirmDialog({ title: 'Delete purchase', message: `Delete ${p.purchase_no}? Stock will be reversed.` })
    if (!ok) return
    const res = await api.purchases.delete(p.id)
    if (res.ok) {
      qc.invalidateQueries()
      toast.success('Purchase deleted.')
    } else toast.error(res.error || 'Could not delete.')
  }

  function setMode(key: 'raw' | 'finished' | 'mining'): void {
    const m = MODES.find((x) => x.key === key)!
    setForm({ ...form, material_type: m.material_type, purchase_mode: m.purchase_mode, product_name: key === 'finished' ? form.product_name : '' })
  }

  // Transporter line helpers
  const lines = form?.transporters ?? []
  function addTransporter(): void { setForm({ ...form, transporters: [...lines, { transporter_id: 0, vehicle_no: '', basis: 'flat', qty: '', rate: '', charge: '' }] }) }
  function setTransporter(i: number, patch: any): void { setForm({ ...form, transporters: lines.map((t: any, idx: number) => (idx === i ? { ...t, ...patch } : t)) }) }
  function delTransporter(i: number): void { setForm({ ...form, transporters: lines.filter((_: any, idx: number) => idx !== i) }) }

  // Machine line helpers
  const mlines = form?.machines ?? []
  function addMachine(): void { setForm({ ...form, machines: [...mlines, { asset_id: 0, basis: 'hour', qty: '', rate: '', outsource_id: null }] }) }
  function setMachine(i: number, patch: any): void { setForm({ ...form, machines: mlines.map((m: any, idx: number) => (idx === i ? { ...m, ...patch } : m)) }) }
  function delMachine(i: number): void { setForm({ ...form, machines: mlines.filter((_: any, idx: number) => idx !== i) }) }

  function submit(): void {
    save.mutate({
      ...form,
      quantity: Number(form.quantity),
      rate: form.rate === '' || form.rate == null ? null : Number(form.rate),
      paid_amount: Number(form.paid_amount) || 0,
      transporters: (form.transporters ?? [])
        .filter((t: any) => t.transporter_id)
        .map((t: any) => ({
          transporter_id: Number(t.transporter_id),
          vehicle_no: t.vehicle_no || '',
          basis: t.basis || 'flat',
          qty: Number(t.qty) || 0,
          rate: Number(t.rate) || 0,
          charge: Number(t.charge) || 0
        })),
      machines: (form.machines ?? [])
        .filter((m: any) => m.asset_id)
        .map((m: any) => ({ asset_id: Number(m.asset_id), basis: m.basis || 'hour', qty: Number(m.qty) || 0, rate: Number(m.rate) || 0, outsource_id: m.outsource_id ? Number(m.outsource_id) : null }))
    })
  }

  // Quantity column for the export: 'default' shows the row's own purchase unit;
  // otherwise convert the base m³ to the chosen unit using that row's plant factors.
  function exportRowUom(p: Purchase): string {
    return exportUom === 'default' ? p.uom : exportUom
  }
  function exportRowQty(p: Purchase): number {
    if (exportUom === 'default') return p.quantity
    return fromCm(p.qty_cm, exportUom, plants.find((pl) => pl.id === p.plant_id))
  }

  function exportExcel(): void {
    downloadExcel(
      'purchases',
      'Purchases',
      ['Purchase No', 'Challan No', 'Date', 'Mode', 'Supplier', 'Plant', 'Item', 'UOM', 'Quantity', 'Qty (m³)', 'Rate', 'Amount', 'Transport', 'Machines', 'Paid', 'Status', 'Remarks'],
      data.map((p) => [
        p.purchase_no, p.challan_no ?? '', fmtDate(p.date), p.purchase_mode === 'mining' ? 'Mining' : p.material_type === 'finished' ? 'Finished' : 'Raw',
        p.supplier_name, p.plant_name, p.material_type === 'finished' ? p.product_name : p.stock_location_name,
        exportRowUom(p), exportRowQty(p), p.qty_cm, p.rate ?? '', p.amount ?? '', p.transport_total ?? 0, p.machine_total ?? 0, p.paid_amount, p.payment_status, p.remarks ?? ''
      ])
    )
  }

  const goods = (Number(form?.quantity) || 0) * (Number(form?.rate) || 0)
  const lineCharge = (t: any): number =>
    t.basis === 'trip' || t.basis === 'uom' ? (Number(t.qty) || 0) * (Number(t.rate) || 0) : Number(t.charge) || 0
  const transportTotal = (form?.transporters ?? []).reduce((s: number, t: any) => s + lineCharge(t), 0)
  const machineTotal = (form?.machines ?? []).reduce((s: number, m: any) => s + (Number(m.qty) || 0) * (Number(m.rate) || 0), 0)

  return (
    <>
      <PageHeader
        title="Purchases / Inward"
        description="Buy raw material, mine on a supplier's land, or buy finished products — with transport & machine costs"
        actions={
          <>
            <SearchSelect
              className="w-full sm:w-44"
              value={exportUom}
              onChange={(v) => setExportUom(v as 'default' | Uom)}
              options={[
                { value: 'default', label: 'Excel UOM: As purchased' },
                { value: 'CM', label: 'Excel UOM: m³' },
                { value: 'TON', label: 'Excel UOM: Ton' },
                { value: 'CFT', label: 'Excel UOM: CFT' }
              ]}
            />
            <Button variant="outline" onClick={exportExcel} disabled={!data.length}>
              <FileSpreadsheet size={16} /> Excel
            </Button>
            <Button onClick={openNew} disabled={!suppliers.length || !plants.length}>
              <Plus size={16} /> New Purchase
            </Button>
          </>
        }
      />
      <Page>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <SearchSelect
            className="w-full sm:w-48"
            value={filter.supplier_id ?? ''}
            onChange={(v) => setFilter({ ...filter, supplier_id: v ? Number(v) : undefined })}
            options={[{ value: '', label: 'All suppliers' }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]}
          />
          <SearchSelect
            className="w-full sm:w-44"
            value={filter.payment_status ?? ''}
            onChange={(v) => setFilter({ ...filter, payment_status: v || undefined })}
            options={[
              { value: '', label: 'All payments' },
              { value: 'paid', label: 'Paid' },
              { value: 'partial', label: 'Partial' },
              { value: 'unpaid', label: 'Unpaid' }
            ]}
          />
        </div>

        {data.length === 0 ? (
          <EmptyState message="No purchases found." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Purchase</TH>
                <TH>Supplier</TH>
                <TH>Item</TH>
                <TH className="text-right">Quantity</TH>
                <TH className="text-right">Rate</TH>
                <TH className="text-right">Amount</TH>
                <TH>Payment</TH>
                <TH className="text-right"></TH>
              </TR>
            </THead>
            <TBody>
              {data.map((p) => (
                <TR key={p.id}>
                  <TD className="whitespace-nowrap">
                    <div className="font-mono text-xs font-semibold">{p.purchase_no}</div>
                    <div className="text-[11px] text-muted-foreground">{fmtDate(p.date)}</div>
                  </TD>
                  <TD className="font-medium">{p.supplier_name}</TD>
                  <TD>
                    <div className="flex items-center gap-1.5">
                      {p.purchase_mode === 'mining' ? (
                        <Badge variant="warning">Mining</Badge>
                      ) : p.material_type === 'finished' ? (
                        <Badge variant="default">Finished</Badge>
                      ) : null}
                      <span className="text-muted-foreground">
                        {p.plant_name} · {p.material_type === 'finished' ? p.product_name : p.stock_location_name}
                      </span>
                    </div>
                    {(p.outsource_name || (p.transport_total ?? 0) > 0 || (p.machine_total ?? 0) > 0) && (
                      <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                        {p.outsource_name && <span>via {p.outsource_name}{p.outsource_head ? ` (${p.outsource_head})` : ''}</span>}
                        {(p.transport_total ?? 0) > 0 && <span>🚚 {fmtMoney(p.transport_total)}</span>}
                        {(p.machine_total ?? 0) > 0 && <span>⚙ {fmtMoney(p.machine_total)}</span>}
                      </div>
                    )}
                    {p.remarks && <div className="mt-0.5 text-[11px] italic text-muted-foreground">“{p.remarks}”</div>}
                  </TD>
                  <TD className="whitespace-nowrap text-right tnum">
                    {fmtQty(p.quantity)} <span className="text-[11px] text-muted-foreground">{p.uom}</span>
                    {p.uom !== 'CM' && <div className="text-[11px] text-muted-foreground">{fmtQty(p.qty_cm)} m³</div>}
                  </TD>
                  <TD className="text-right tnum">{p.rate == null ? '-' : fmtMoney(p.rate)}</TD>
                  <TD className="text-right tnum font-semibold">{fmtMoney(p.amount)}</TD>
                  <TD><Badge variant={payBadge[p.payment_status]}>{p.payment_status}</Badge></TD>
                  <TD className="whitespace-nowrap text-right">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(p)}>
                      <Pencil size={15} />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(p)}>
                      <Trash2 size={15} className="text-destructive" />
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Page>

      {form && (
        <Modal open={open} onClose={() => setOpen(false)} title={form.id ? `Edit ${form.purchase_no}` : 'New Purchase'} width="max-w-4xl">
          {/* Mode toggle */}
          <div className="mb-5 grid grid-cols-3 gap-2 rounded-xl border bg-muted/40 p-1">
            {MODES.map((opt) => {
              const active = mk === opt.key
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setMode(opt.key)}
                  className={
                    'flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ' +
                    (active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-foreground/70 hover:bg-accent')
                  }
                >
                  <opt.icon size={16} /> {opt.label}
                </button>
              )
            })}
          </div>

          <div className="space-y-5">
            <Section title={mk === 'mining' ? 'Supplier (land owner) & Item' : 'Supplier & Item'}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                <Field label={mk === 'mining' ? 'Land Owner / Supplier' : 'Supplier'} required className="sm:col-span-2">
                  <SearchSelect
                    value={form.supplier_id ?? ''}
                    onChange={(v) => setForm({ ...form, supplier_id: Number(v) })}
                    options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
                    placeholder="Select supplier…"
                  />
                </Field>
                <Field label="Purchase Date" required>
                  <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                </Field>
                <Field label="Challan No." hint={form.id ? 'Supplier challan / delivery note' : 'Blank = auto-generate'}>
                  <Input value={form.challan_no || ''} onChange={(e) => setForm({ ...form, challan_no: e.target.value })} placeholder="Auto-generate" />
                </Field>
                <Field label="Plant" required hint={plantId ? 'Active plant' : undefined}>
                  <SearchSelect
                    value={form.plant_id || ''}
                    disabled={!!plantId}
                    onChange={(v) => setForm({ ...form, plant_id: Number(v), stock_location_id: undefined })}
                    options={plants.map((p) => ({ value: p.id, label: p.name }))}
                  />
                </Field>
                {mk === 'finished' ? (
                  <Field label="Product" required className="sm:col-span-2" hint="Added to this product's finished-goods stock">
                    <SearchSelect
                      value={form.product_name || ''}
                      onChange={(v) => setForm({ ...form, product_name: v })}
                      options={[
                        /* Keep an already-chosen product selectable even if it isn't tagged to this plant. */
                        ...(form.product_name && !products.some((pr) => pr.name === form.product_name)
                          ? [{ value: form.product_name, label: form.product_name }]
                          : []),
                        ...products.map((pr) => ({ value: pr.name, label: pr.name }))
                      ]}
                      placeholder="Select product…"
                    />
                  </Field>
                ) : (
                  <Field label="Stock Location" className="sm:col-span-2" hint="Blank = plant default">
                    <SearchSelect
                      value={form.stock_location_id ?? ''}
                      onChange={(v) => setForm({ ...form, stock_location_id: v ? Number(v) : undefined })}
                      options={[{ value: '', label: 'Plant default (auto)' }, ...formLocations.map((l) => ({ value: l.id, label: l.name }))]}
                      placeholder="Plant default (auto)"
                    />
                  </Field>
                )}
                <Field label="Outsource Vendor" className="sm:col-span-2" hint="Optional — shows the vendor's head">
                  <SearchSelect
                    value={form.outsource_id ?? ''}
                    onChange={(v) => setForm({ ...form, outsource_id: v ? Number(v) : null })}
                    options={[{ value: '', label: '— None —' }, ...outsourceVendors.map((o) => ({ value: o.id, label: `${o.name}${o.head ? ` — ${o.head}` : ''}` }))]}
                    placeholder="— None —"
                  />
                </Field>
              </div>
            </Section>

            <Section title={mk === 'mining' ? 'Quantity & Royalty Rate' : 'Quantity & Rate'}>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Field label="Unit (UOM)" required>
                  <SearchSelect
                    value={form.uom || 'CM'}
                    onChange={(v) => setForm({ ...form, uom: v })}
                    options={UOMS.map((u) => ({ value: u, label: u }))}
                  />
                </Field>
                <Field label={`Quantity (${form.uom || 'CM'})`} required hint={form.uom !== 'CM' ? `= ${fmtQty(toCm(Number(form.quantity) || 0, form.uom, formPlant))} m³` : 'm³'}>
                  <Input type="number" step="0.001" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
                </Field>
                <Field label={`${mk === 'mining' ? 'Royalty' : 'Rate'} / ${form.uom || 'CM'}`} required>
                  <Input type="number" step="0.01" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} placeholder="Rate" />
                </Field>
                <Field label="Paid Amount" hint="Sets status">
                  <Input type="number" step="0.01" value={form.paid_amount} onChange={(e) => setForm({ ...form, paid_amount: e.target.value })} />
                </Field>
              </div>
            </Section>

            {mk !== 'finished' && (
              <>
                {/* Transporters */}
                <Section title="Transport (optional)">
                  <div className="space-y-2">
                    {lines.length > 0 && (
                      <div className="grid grid-cols-[1fr_92px_96px_64px_76px_90px_32px] gap-2 px-1 text-[11px] font-semibold uppercase text-muted-foreground">
                        <div>Transporter</div><div>Vehicle</div><div>Basis</div><div>Qty</div><div>Rate ₹</div><div>Charge ₹</div><div></div>
                      </div>
                    )}
                    {lines.map((t: any, i: number) => {
                      const computed = t.basis === 'trip' || t.basis === 'uom'
                      return (
                        <div key={i} className="grid grid-cols-[1fr_92px_96px_64px_76px_90px_32px] items-center gap-2">
                          <SearchSelect
                            value={t.transporter_id || ''}
                            onChange={(v) => setTransporter(i, { transporter_id: Number(v) })}
                            options={transporters.map((tr) => ({ value: tr.id, label: tr.name }))}
                            placeholder="Transporter…"
                          />
                          <TransporterVehicleSelect transporterId={t.transporter_id} value={t.vehicle_no} onChange={(v) => setTransporter(i, { vehicle_no: v })} />
                          <SearchSelect
                            value={t.basis || 'flat'}
                            onChange={(v) => setTransporter(i, { basis: v })}
                            options={[
                              { value: 'flat', label: 'Flat' },
                              { value: 'trip', label: 'Per Trip' },
                              { value: 'uom', label: `Per ${form.uom || 'UOM'}` }
                            ]}
                          />
                          <Input type="number" step="0.01" value={computed ? t.qty : ''} disabled={!computed}
                            placeholder={computed ? '' : '—'} onChange={(e) => setTransporter(i, { qty: e.target.value })} />
                          <Input type="number" step="0.01" value={computed ? t.rate : ''} disabled={!computed}
                            placeholder={computed ? '' : '—'} onChange={(e) => setTransporter(i, { rate: e.target.value })} />
                          {computed ? (
                            <Input type="text" value={fmtMoney(lineCharge(t))} disabled className="text-right font-medium" />
                          ) : (
                            <Input type="number" step="0.01" value={t.charge} onChange={(e) => setTransporter(i, { charge: e.target.value })} />
                          )}
                          <Button variant="ghost" size="icon" onClick={() => delTransporter(i)}><X size={15} className="text-destructive" /></Button>
                        </div>
                      )
                    })}
                  </div>
                  <Button variant="outline" size="sm" className="mt-2" disabled={!transporters.length} onClick={addTransporter}>
                    <Plus size={14} /> Add Transporter
                  </Button>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {transporters.length
                      ? 'Charge by flat amount, per trip (qty × rate), or per UOM unit. Posts to the transporter ledger.'
                      : 'Add transporters under Transporters first.'}
                  </p>
                </Section>

                {/* Machines */}
                <Section title="Machines (optional) — posts to Equipment Rent">
                  <div className="space-y-2">
                    {mlines.length > 0 && (
                      <div className="grid grid-cols-[1fr_90px_80px_90px_1fr_32px] gap-2 px-1 text-[11px] font-semibold uppercase text-muted-foreground">
                        <div>Machine</div><div>Basis</div><div>Qty</div><div>Rate ₹</div><div>Vendor (opt)</div><div></div>
                      </div>
                    )}
                    {mlines.map((m: any, i: number) => (
                      <div key={i} className="grid grid-cols-[1fr_90px_80px_90px_1fr_32px] items-center gap-2">
                        <SearchSelect
                          value={m.asset_id || ''}
                          onChange={(v) => setMachine(i, { asset_id: Number(v) })}
                          options={assets.map((a) => ({ value: a.id, label: a.name }))}
                          placeholder="Machine…"
                        />
                        <SearchSelect
                          value={m.basis || 'hour'}
                          onChange={(v) => setMachine(i, { basis: v as MachineBasis })}
                          options={[
                            { value: 'hour', label: 'Per Hour' },
                            { value: 'cm', label: 'Per m³' }
                          ]}
                        />
                        <Input type="number" step="0.01" value={m.qty} onChange={(e) => setMachine(i, { qty: e.target.value })} />
                        <Input type="number" step="0.01" value={m.rate} onChange={(e) => setMachine(i, { rate: e.target.value })} />
                        <SearchSelect
                          value={m.outsource_id ?? ''}
                          onChange={(v) => setMachine(i, { outsource_id: v ? Number(v) : null })}
                          options={[{ value: '', label: '— None —' }, ...outsourceVendors.map((o) => ({ value: o.id, label: o.name }))]}
                          placeholder="— None —"
                        />
                        <Button variant="ghost" size="icon" onClick={() => delMachine(i)}><X size={15} className="text-destructive" /></Button>
                      </div>
                    ))}
                  </div>
                  <Button variant="outline" size="sm" className="mt-2" disabled={!assets.length} onClick={addMachine}>
                    <Plus size={14} /> Add Machine
                  </Button>
                  {!assets.length && <p className="mt-1 text-[11px] text-muted-foreground">Add machines under Machinery &amp; Vehicles first.</p>}
                </Section>
              </>
            )}

            <Field label="Remarks">
              <Input value={form.remarks || ''} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
            </Field>

            {/* Summary */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <SummaryCard label={mk === 'finished' ? 'Adds to finished goods' : 'Adds to raw stock'}
                value={`${mk === 'finished' ? (form.product_name || '—') : (formLocations.find((l: any) => l.id === form.stock_location_id)?.name || 'Plant default')} · ${fmtQty(toCm(Number(form.quantity) || 0, form.uom || 'CM', formPlant))} m³`} />
              <SummaryCard label={mk === 'mining' ? 'Royalty to supplier' : 'Goods amount'} value={fmtMoney(goods)} accent />
              <SummaryCard label="Transport + Machines" value={`${fmtMoney(transportTotal)} + ${fmtMoney(machineTotal)}`} />
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              onClick={submit}
              disabled={!form.supplier_id || !(Number(form.quantity) > 0) || !(Number(form.rate) > 0) || (mk === 'finished' && !form.product_name)}
            >
              Save Purchase
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}

function SummaryCard({ label, value, accent }: { label: string; value: string; accent?: boolean }): React.JSX.Element {
  return (
    <div className="rounded-xl border bg-muted/40 px-4 py-3 text-sm">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={'mt-1 ' + (accent ? 'font-bold text-primary' : '')}>{value}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground/80">{title}</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      {children}
    </section>
  )
}

function cleanFilter(f: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(f)) if (v != null && v !== '') out[k] = v
  return out
}
