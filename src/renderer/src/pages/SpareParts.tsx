import * as React from 'react'
import { usePersistentState } from '@/lib/persistentState'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownToLine, ArrowUpFromLine, FileSpreadsheet, PackagePlus, Pencil, Plus, Trash2 } from 'lucide-react'
import type { SparePart, SparePartType } from '@shared/types'
import { api } from '@/lib/api'
import { Badge, Button, EmptyState, Field, Input, Modal, SearchSelect, Table, TBody, TD, TH, THead, TR } from '@/components/ui'
import { usePlant } from '@/lib/plant'
import { useToast } from '@/components/toast'
import { confirmDialog } from '@/components/confirm'
import { downloadExcel, fmtDate, fmtMoney, fmtQty, today } from '@/lib/utils'

const TYPES: { value: SparePartType; label: string }[] = [
  { value: 'new', label: 'New Part' },
  { value: 'repairable', label: 'Repairable Part' },
  { value: 'scrap', label: 'Scrap Part' }
]
const UNITS = ['PCS', 'SET', 'PAIR', 'BOX', 'KG', 'LTR', 'MTR']
const tone: Record<SparePartType, 'success' | 'warning' | 'muted'> = {
  new: 'success',
  repairable: 'warning',
  scrap: 'muted'
}

/** Spare-parts stock panel (rendered as a tab inside the Maintenance & Parts page). */
export function PartsStockPanel(): React.JSX.Element {
  const { plantId } = usePlant()
  const qc = useQueryClient()
  const toast = useToast()
  const [type, setType] = React.useState<SparePartType | ''>('')
  const [q, setQ] = usePersistentState('q', '')
  const [form, setForm] = React.useState<any>(null)
  const [stockMove, setStockMove] = React.useState<any>(null)
  const [selected, setSelected] = React.useState<number | undefined>()

  const { data: parts = [] } = useQuery({
    queryKey: ['spareParts', plantId, type],
    queryFn: () => api.parts.list({ plant_id: plantId, part_type: type || undefined })
  })
  const { data: allParts = [] } = useQuery({
    queryKey: ['spareParts', plantId, 'all'],
    queryFn: () => api.parts.list({ plant_id: plantId })
  })
  const { data: movements = [] } = useQuery({
    queryKey: ['partMovements', selected],
    queryFn: () => api.parts.movements({ part_id: selected }),
    enabled: !!selected
  })
  const { data: plants = [] } = useQuery({ queryKey: ['plants'], queryFn: api.plants.list })
  const { data: assets = [] } = useQuery({ queryKey: ['assets', plantId], queryFn: () => api.assets.list(plantId) })

  // Live FIFO cost of the part being issued (stock-out), so the user sees the cost attached.
  const outQty = stockMove?.mode === 'out' ? Number(stockMove.quantity) || 0 : 0
  const { data: outQuote } = useQuery({
    queryKey: ['partFifo', stockMove?.part_id, outQty],
    queryFn: () => api.parts.fifoQuote({ part_id: Number(stockMove.part_id), quantity: outQty }),
    enabled: stockMove?.mode === 'out' && !!stockMove?.part_id && outQty > 0
  })
  const issueCost = outQuote?.amount ?? 0
  const labour = stockMove?.mode === 'out' ? Number(stockMove.labour) || 0 : 0
  const serviceTotal = issueCost + labour

  const filtered = React.useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return parts
    return parts.filter((p) =>
      `${p.name} ${p.remarks ?? ''} ${p.unit ?? ''} ${p.part_type ?? ''} ${(p as { part_no?: string }).part_no ?? ''}`
        .toLowerCase()
        .includes(term)
    )
  }, [parts, q])

  const refresh = (): void => {
    qc.invalidateQueries({ queryKey: ['spareParts'] })
    qc.invalidateQueries({ queryKey: ['partMovements'] })
    qc.invalidateQueries({ queryKey: ['machine-expenses'] })
    qc.invalidateQueries({ queryKey: ['plantExpenses'] })
    qc.invalidateQueries({ queryKey: ['plantExpenseBook'] })
    qc.invalidateQueries({ queryKey: ['ledger'] })
    qc.invalidateQueries({ queryKey: ['machineSheet'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }
  const save = useMutation({
    mutationFn: (p: any) => (p.id ? api.parts.update(p) : api.parts.create(p)),
    onSuccess: () => { refresh(); setForm(null); toast.success('Spare part saved.') },
    onError: (e: Error) => toast.error(e.message)
  })
  const moveStock = useMutation({
    mutationFn: async (p: any) => {
      const rate = p.rate === '' || p.rate == null ? null : Number(p.rate)
      if (p.mode === 'out') {
        // A service issue posts ONE maintenance Plant Expense: parts (FIFO) + labour, tied to the
        // machine — so the cost flows to Plant Expenses and the machine ledger. A plain issue just
        // moves stock with no expense.
        if (p.service) {
          const part = allParts.find((x) => x.id === Number(p.part_id))
          const planted = part?.plant_id ?? plantId ?? plants[0]?.id
          return api.plantExpenses.create({
            category: 'maintenance',
            plant_id: Number(planted),
            asset_id: Number(p.asset_id),
            title: p.note || `Service — ${part?.name ?? 'part'}`,
            amount: Number(p.labour) || 0,
            parts_used: [{ part_id: Number(p.part_id), quantity: Number(p.quantity) }],
            paid_amount: 0,
            payment_status: 'unpaid',
            date: p.date,
            remarks: ''
          } as any)
        }
        return api.parts.stockOut({
          part_id: p.part_id,
          asset_id: Number(p.asset_id),
          quantity: Number(p.quantity),
          date: p.date,
          note: p.note
        })
      }
      if (p.part_id === '__new__') {
        await api.parts.create({
          name: p.new_name,
          part_no: p.part_no,
          part_type: p.part_type,
          unit: p.unit,
          plant_id: p.plant_id ?? null,
          rate,
          min_qty: Number(p.min_qty) || 0,
          remarks: p.remarks || '',
          opening_qty: Number(p.quantity),
          opening_date: p.date,
          opening_note: p.note || 'Stock received'
        })
        return { ok: true }
      }
      const existing = allParts.find((x) => x.id === Number(p.part_id))
      if (existing && existing.unit !== p.unit) {
        await api.parts.update({ ...existing, unit: p.unit })
      }
      return api.parts.stockIn({ part_id: p.part_id, quantity: Number(p.quantity), rate, date: p.date, note: p.note })
    },
    onSuccess: (_res, p) => {
      refresh()
      setStockMove(null)
      toast.success(p.mode === 'out' ? (p.service ? 'Part issued — service posted to Plant Expenses.' : 'Part issued to machine / vehicle.') : 'Part stock added.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  async function remove(p: SparePart): Promise<void> {
    if (!(await confirmDialog({ title: 'Delete spare part', message: `Delete "${p.name}" (${p.part_type})?` }))) return
    const res = await api.parts.delete(p.id)
    if (res.ok) { refresh(); toast.success('Deleted.') }
    else toast.error(res.error || 'Could not delete.')
  }

  function exportExcel(): void {
    downloadExcel(
      'spare-parts-stock',
      'Spare Parts',
      ['Part', 'Part No.', 'Type', 'Unit', 'Plant', 'Rate', 'Balance', 'Minimum', 'Status', 'Remarks'],
      parts.map((p) => [
        p.name, p.part_no ?? '', p.part_type, p.unit, p.plant_name ?? 'All plants',
        p.rate ?? '', p.balance_qty, p.min_qty, p.balance_qty <= p.min_qty ? 'LOW' : 'OK', p.remarks
      ])
    )
  }

  function openIssue(p: SparePart): void {
    setStockMove({ mode: 'out', part_id: p.id, name: p.name, unit: p.unit, quantity: '', date: today(), asset_id: '', note: '', service: true, labour: '' })
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input className="w-full sm:w-60" placeholder="Search part name, no., remarks…" value={q} onChange={(e) => setQ(e.target.value)} />
        <SearchSelect
          className="w-full sm:w-48"
          value={type}
          onChange={(v) => setType(v as SparePartType | '')}
          options={[{ value: '', label: 'All stock types' }, ...TYPES]}
        />
        {(q || type) && <Button variant="ghost" size="sm" onClick={() => { setQ(''); setType('') }}>Clear</Button>}
        <span className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={!parts.length}><FileSpreadsheet size={15} /> Excel</Button>
          <Button variant="outline" size="sm" onClick={() => setStockMove({ mode: 'in', part_id: '', unit: 'PCS', quantity: '', date: today(), note: '', part_type: 'new', plant_id: plantId ?? null, min_qty: 0, remarks: '' })}>
            <ArrowDownToLine size={15} /> Stock In
          </Button>
          <Button size="sm" onClick={() => setForm({ part_type: 'new', unit: 'PCS', plant_id: plantId ?? null, opening_qty: '', min_qty: 0, remarks: '' })}>
            <Plus size={15} /> New Part
          </Button>
        </span>
      </div>
      {parts.length === 0 ? <EmptyState message="No spare parts recorded." /> : filtered.length === 0 ? <EmptyState message="No parts match your search." /> : (
        <Table>
          <THead><TR><TH>Part Name</TH><TH>Type</TH><TH>Plant</TH><TH className="text-right">Rate</TH><TH className="text-right">Balance</TH><TH>Status</TH><TH className="text-right">Actions</TH></TR></THead>
          <TBody>
            {filtered.map((p) => (
              <TR key={p.id} className="cursor-pointer" onClick={() => setSelected(p.id)}>
                <TD><div className="font-medium">{p.name}</div><div className="text-[11px] text-muted-foreground">{[p.part_no, p.remarks || p.unit].filter(Boolean).join(' · ')}</div></TD>
                <TD><Badge variant={tone[p.part_type]}>{TYPES.find((x) => x.value === p.part_type)?.label}</Badge></TD>
                <TD>{p.plant_name || 'All plants'}</TD>
                <TD className="tnum text-right text-muted-foreground">{p.rate != null ? `₹${fmtMoney(p.rate)}` : '-'}</TD>
                <TD className="tnum text-right text-base font-bold">{fmtQty(p.balance_qty)} <span className="text-xs font-normal text-muted-foreground">{p.unit}</span></TD>
                <TD>{p.balance_qty <= p.min_qty ? <Badge variant="destructive">Low stock</Badge> : <Badge variant="success">In stock</Badge>}</TD>
                <TD className="text-right" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" title="Stock In" onClick={() => setStockMove({ mode: 'in', part_id: p.id, name: p.name, unit: p.unit, quantity: '', date: today(), note: '' })}><ArrowDownToLine size={15} className="text-success" /></Button>
                  <Button variant="ghost" size="icon" title="Issue / Service (to a machine)" onClick={() => openIssue(p)}><ArrowUpFromLine size={15} className="text-warning" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => setForm({ ...p })}><Pencil size={15} /></Button>
                  <Button variant="ghost" size="icon" onClick={() => remove(p)}><Trash2 size={15} className="text-destructive" /></Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {selected && (
        <div className="mt-7">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><PackagePlus size={16} /> Stock History</div>
          {movements.length === 0 ? <EmptyState message="No stock activity for this part." /> : (
            <Table>
              <THead><TR><TH>Date</TH><TH>Activity</TH><TH>Used For</TH><TH className="text-right">Quantity</TH><TH className="text-right">Rate</TH><TH className="text-right">Value</TH><TH>Note</TH></TR></THead>
              <TBody>{movements.map((m) => (
                <TR key={m.id}>
                  <TD>{fmtDate(m.date)}</TD>
                  <TD className="capitalize">{m.movement_type.replace('_', ' ')}</TD>
                  <TD>{m.asset_name || '-'}</TD>
                  <TD className={`tnum text-right font-semibold ${m.quantity < 0 ? 'text-destructive' : 'text-success'}`}>{m.quantity > 0 ? '+' : ''}{fmtQty(m.quantity)} {m.unit}</TD>
                  <TD className="tnum text-right text-muted-foreground">{m.rate != null ? `₹${fmtMoney(m.rate)}` : '-'}</TD>
                  <TD className="tnum text-right">{m.amount != null ? `₹${fmtMoney(m.amount)}` : '-'}</TD>
                  <TD className="text-muted-foreground">{m.note || '-'}</TD>
                </TR>
              ))}</TBody>
            </Table>
          )}
        </div>
      )}

      {form && (
        <Modal open onClose={() => setForm(null)} title={form.id ? 'Edit Spare Part' : 'New Spare Part'} width="max-w-xl">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Part Name" required><Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Bearing 22220, fan belt..." /></Field>
            <Field label="Part No." hint="Manufacturer / catalogue number"><Input value={form.part_no || ''} onChange={(e) => setForm({ ...form, part_no: e.target.value })} placeholder="BRG-22220, FB-1750..." /></Field>
            <Field label="Stock Type" required><SearchSelect value={form.part_type} onChange={(v) => setForm({ ...form, part_type: v })} options={TYPES} /></Field>
            <Field label="UOM"><SearchSelect value={form.unit || 'PCS'} onChange={(v) => setForm({ ...form, unit: v })} options={UNITS.map((u) => ({ value: u, label: u }))} /></Field>
            <Field label="Rate per Unit (₹)" hint="Default rate; updated by the latest Stock In"><Input type="number" min="0" step="0.01" value={form.rate ?? ''} onChange={(e) => setForm({ ...form, rate: e.target.value })} placeholder="0.00" /></Field>
            {!form.id && <Field label="Opening Stock"><Input type="number" step="0.001" value={form.opening_qty} onChange={(e) => setForm({ ...form, opening_qty: e.target.value })} /></Field>}
            <Field label="Low-stock Level"><Input type="number" step="0.001" value={form.min_qty} onChange={(e) => setForm({ ...form, min_qty: e.target.value })} /></Field>
            <Field label="Plant"><SearchSelect value={form.plant_id ?? ''} onChange={(v) => setForm({ ...form, plant_id: v ? Number(v) : null })} options={[{ value: '', label: 'All plants' }, ...plants.map((p) => ({ value: p.id, label: p.name }))]} /></Field>
            <div className="sm:col-span-2"><Field label="Remarks"><Input value={form.remarks || ''} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></Field></div>
          </div>
          <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setForm(null)}>Cancel</Button><Button onClick={() => save.mutate(form)} disabled={!form.name?.trim()}>Save</Button></div>
        </Modal>
      )}

      {stockMove && (
        <Modal open onClose={() => setStockMove(null)} title={`${stockMove.mode === 'out' ? 'Issue Part' : 'Stock In'}${stockMove.name ? ` — ${stockMove.name}` : ''}`} width="max-w-md">
          <div className="space-y-4">
            {stockMove.mode === 'in' && (
              <>
                <Field label="Part" required hint="Select an existing part, or choose Add New Part to type a new name.">
                  <SearchSelect
                    value={stockMove.part_id}
                    onChange={(v) => {
                      const existing = allParts.find((p) => p.id === Number(v))
                      setStockMove({ ...stockMove, part_id: v, name: existing?.name || '', unit: existing?.unit || stockMove.unit || 'PCS', rate: existing?.rate ?? stockMove.rate ?? '' })
                    }}
                    options={[{ value: '__new__', label: '+ Add New Part' }, ...allParts.map((p) => ({ value: p.id, label: `${p.name} — ${p.part_type} (${fmtQty(p.balance_qty)} ${p.unit})` }))]}
                    placeholder="Select part…"
                  />
                </Field>
                {stockMove.part_id === '__new__' && (
                  <>
                    <Field label="New Part Name" required><Input value={stockMove.new_name || ''} onChange={(e) => setStockMove({ ...stockMove, new_name: e.target.value })} placeholder="Type the new part name" /></Field>
                    <Field label="Part No."><Input value={stockMove.part_no || ''} onChange={(e) => setStockMove({ ...stockMove, part_no: e.target.value })} placeholder="BRG-22220, FB-1750..." /></Field>
                    <Field label="Stock Type" required><SearchSelect value={stockMove.part_type || 'new'} onChange={(v) => setStockMove({ ...stockMove, part_type: v })} options={TYPES} /></Field>
                    <Field label="Plant"><SearchSelect value={stockMove.plant_id ?? ''} onChange={(v) => setStockMove({ ...stockMove, plant_id: v ? Number(v) : null })} options={[{ value: '', label: 'All plants' }, ...plants.map((p) => ({ value: p.id, label: p.name }))]} /></Field>
                  </>
                )}
                <Field label="UOM" required hint="Switch the unit used for this part.">
                  <SearchSelect value={stockMove.unit || 'PCS'} onChange={(v) => setStockMove({ ...stockMove, unit: v })} options={UNITS.map((u) => ({ value: u, label: u }))} />
                </Field>
              </>
            )}
            {stockMove.mode === 'in' ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Quantity" hint="Quantity received into stock"><Input autoFocus type="number" min="0" step="0.001" value={stockMove.quantity} onChange={(e) => setStockMove({ ...stockMove, quantity: e.target.value })} /></Field>
                <Field label="Rate per Unit (₹)" hint={Number(stockMove.quantity) > 0 && Number(stockMove.rate) > 0 ? `= ₹${(Number(stockMove.quantity) * Number(stockMove.rate)).toFixed(2)}` : 'Purchase rate (optional)'}>
                  <Input type="number" min="0" step="0.01" value={stockMove.rate ?? ''} onChange={(e) => setStockMove({ ...stockMove, rate: e.target.value })} placeholder="0.00" />
                </Field>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Quantity" hint="Quantity issued for use"><Input autoFocus type="number" min="0" step="0.001" value={stockMove.quantity} onChange={(e) => setStockMove({ ...stockMove, quantity: e.target.value })} /></Field>
                  <Field label="Used For Machine / Vehicle" required>
                    <SearchSelect value={stockMove.asset_id ?? ''} onChange={(v) => setStockMove({ ...stockMove, asset_id: Number(v) })} options={assets.map((a) => ({ value: a.id, label: a.name }))} placeholder="Select machine…" />
                  </Field>
                </div>
                <div className="rounded-lg bg-muted/60 px-3.5 py-2.5 text-sm">
                  {outQty > 0 ? (
                    outQuote?.hasCost ? (
                      <span>Parts cost (FIFO): <b>₹{fmtMoney(issueCost)}</b> <span className="text-muted-foreground">@ ₹{fmtMoney(outQuote.rate)}/unit</span>{outQuote.unpricedQty > 0 && <span className="text-warning"> · {fmtQty(outQuote.unpricedQty)} {stockMove.unit || ''} unpriced</span>}</span>
                    ) : (
                      <span className="text-muted-foreground">No parts cost — this stock was added without a rate.</span>
                    )
                  ) : (
                    <span className="text-muted-foreground">Enter a quantity to see the FIFO cost.</span>
                  )}
                  {outQuote && <span className="ml-2 text-muted-foreground">· In stock: {fmtQty(outQuote.available)}</span>}
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4" checked={!!stockMove.service} onChange={(e) => setStockMove({ ...stockMove, service: e.target.checked })} />
                  Record as a service / repair (posts the cost to <b>Plant Expenses</b> against this machine)
                </label>
                {stockMove.service && (
                  <Field label="Labour / Technician Cost (₹)" hint="Optional — added on top of the parts cost">
                    <Input type="number" min="0" step="0.01" value={stockMove.labour ?? ''} onChange={(e) => setStockMove({ ...stockMove, labour: e.target.value })} placeholder="0.00" />
                  </Field>
                )}
              </>
            )}
            <Field label="Date"><Input type="date" value={stockMove.date} onChange={(e) => setStockMove({ ...stockMove, date: e.target.value })} /></Field>
            <Field label={stockMove.mode === 'out' && stockMove.service ? 'Work done / Note' : 'Reason / Note'}>
              <Input value={stockMove.note} onChange={(e) => setStockMove({ ...stockMove, note: e.target.value })} placeholder={stockMove.mode === 'out' ? 'Engine service, tyre change…' : 'Supplier, invoice, opening stock…'} />
            </Field>
            {stockMove.mode === 'out' && stockMove.service && (
              <div className="flex items-center justify-between rounded-lg bg-muted/60 px-4 py-2.5 text-sm">
                <span>Parts <b>{fmtMoney(issueCost)}</b> + Labour <b>{fmtMoney(labour)}</b></span>
                <span>Plant Expense: <b>{fmtMoney(serviceTotal)}</b></span>
              </div>
            )}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setStockMove(null)}>Cancel</Button>
            <Button
              onClick={() => moveStock.mutate(stockMove)}
              disabled={
                !(Number(stockMove.quantity) > 0) ||
                !stockMove.date ||
                (stockMove.mode === 'out' && !stockMove.asset_id) ||
                (stockMove.mode === 'in' && !stockMove.part_id) ||
                (stockMove.part_id === '__new__' && !stockMove.new_name?.trim())
              }
            >
              {stockMove.mode === 'out' ? (stockMove.service ? 'Issue + Post Expense' : 'Issue Part') : 'Add Stock'}
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}
