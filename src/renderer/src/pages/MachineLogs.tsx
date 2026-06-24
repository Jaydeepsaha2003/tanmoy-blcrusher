import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Gauge, BarChart3, AlertTriangle } from 'lucide-react'
import { api } from '@/lib/api'
import type { MachineLog } from '@shared/types'
import { PageHeader, Page } from '@/components/layout'
import { Button, Input, SearchSelect, Field, Badge, Modal, Table, THead, TBody, TR, TH, TD, EmptyState } from '@/components/ui'
import { useToast } from '@/components/toast'
import { confirmDialog } from '@/components/confirm'
import { usePlant } from '@/lib/plant'
import { fmtQty, fmtMoney, fmtDate, today } from '@/lib/utils'

export function MachineLogs(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const { plantId } = usePlant()
  const [tab, setTab] = React.useState<'logbook' | 'mileage'>('logbook')
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')
  const [assetId, setAssetId] = React.useState<number | ''>('')
  const [mileType, setMileType] = React.useState<'all' | 'machine' | 'vehicle'>('all')

  const { data: assets = [] } = useQuery({ queryKey: ['assets', plantId], queryFn: () => api.assets.list(plantId) })
  const { data: logs = [] } = useQuery({
    queryKey: ['allLogs', from, to, assetId],
    queryFn: () => api.machinery.allLogs({ from: from || undefined, to: to || undefined, asset_id: assetId ? Number(assetId) : undefined })
  })
  const { data: mileage = [] } = useQuery({
    queryKey: ['mileage', from, to, mileType],
    queryFn: () => api.machinery.mileage({ from: from || undefined, to: to || undefined, asset_type: mileType === 'all' ? undefined : mileType }),
    enabled: tab === 'mileage'
  })

  const assetMeter = (id: number): string => ((assets.find((a) => a.id === id)?.meter_type ?? 'hour') === 'km' ? 'km' : 'hr')

  const [form, setForm] = React.useState<any>(null)
  const save = useMutation({
    mutationFn: (p: any) => (p.id ? api.machinery.updateLog(p) : api.machinery.addLog(p)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['allLogs'] })
      qc.invalidateQueries({ queryKey: ['mileage'] })
      qc.invalidateQueries({ queryKey: ['machineSheet'] })
      setForm(null)
      toast.success('Logbook entry saved.')
    },
    onError: (e: Error) => toast.error(e.message)
  })
  async function remove(l: MachineLog): Promise<void> {
    if (!(await confirmDialog({ title: 'Delete entry', message: `Delete the ${fmtDate(l.date)} log for ${l.asset_name}?` }))) return
    await api.machinery.deleteLog(l.id)
    qc.invalidateQueries({ queryKey: ['allLogs'] })
    qc.invalidateQueries({ queryKey: ['mileage'] })
    toast.success('Deleted.')
  }

  // For a new entry, the opening meter continues from this machine's last closing reading.
  async function prefillOpening(asset_id: number): Promise<void> {
    if (!asset_id) return
    const r = await api.machinery.lastMeter(asset_id).catch(() => ({ closing_meter: null }))
    setForm((f: any) => (f && !f.id && Number(f.asset_id) === asset_id ? { ...f, opening_meter: r.closing_meter ?? '' } : f))
  }
  function openNew(): void {
    const asset_id = assets[0]?.id
    setForm({ asset_id, date: today(), work_type: '', opening_meter: '', closing_meter: '', rate: '', fuel_litres: '', remarks: '' })
    if (asset_id) void prefillOpening(asset_id)
  }
  const fUsage = form ? (Number(form.closing_meter) || 0) - (Number(form.opening_meter) || 0) : 0
  const fIncome = form && form.rate !== '' && form.rate != null ? fUsage * Number(form.rate) : 0
  const fUnit = form?.asset_id ? assetMeter(Number(form.asset_id)) : 'hr'

  return (
    <>
      <PageHeader
        title="Logbook & Mileage"
        description="Daily meter readings (with earning rates) across all machines, and standard-vs-actual fuel mileage"
        actions={
          <Button onClick={openNew} disabled={!assets.length}>
            <Plus size={16} /> Add Entry
          </Button>
        }
      />
      <Page>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {([['logbook', 'Logbook', Gauge], ['mileage', 'Standard vs Actual', BarChart3]] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={
                'inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors ' +
                (tab === key ? 'border-primary bg-primary/5 text-foreground' : 'border-input text-muted-foreground hover:bg-accent')
              }
            >
              <Icon size={15} /> {label}
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-border" />
          {tab === 'logbook' ? (
            <SearchSelect
              className="w-full sm:w-52"
              value={assetId}
              onChange={(v) => setAssetId(v ? Number(v) : '')}
              options={[{ value: '', label: 'All machines' }, ...assets.map((a) => ({ value: a.id, label: a.name }))]}
              placeholder="All machines"
            />
          ) : (
            <SearchSelect
              className="w-full sm:w-44"
              value={mileType}
              onChange={(v) => setMileType(v as 'all' | 'machine' | 'vehicle')}
              options={[{ value: 'all', label: 'All types' }, { value: 'machine', label: 'Machines' }, { value: 'vehicle', label: 'Vehicles' }]}
            />
          )}
          <Input type="date" className="w-full sm:w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="text-muted-foreground">to</span>
          <Input type="date" className="w-full sm:w-40" value={to} onChange={(e) => setTo(e.target.value)} />
          {(from || to) && <Button variant="ghost" size="sm" onClick={() => { setFrom(''); setTo('') }}>All time</Button>}
        </div>

        {tab === 'logbook' ? (
          logs.length === 0 ? (
            <EmptyState message="No logbook entries for this filter." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Date</TH>
                  <TH>Machine</TH>
                  <TH>Work Type</TH>
                  <TH className="text-right">Opening</TH>
                  <TH className="text-right">Closing</TH>
                  <TH className="text-right">Used</TH>
                  <TH className="text-right">Rate</TH>
                  <TH className="text-right">Income</TH>
                  <TH className="text-right">Fuel (L)</TH>
                  <TH className="text-right"></TH>
                </TR>
              </THead>
              <TBody>
                {logs.map((l) => (
                  <TR key={l.id}>
                    <TD className="whitespace-nowrap">{fmtDate(l.date)}</TD>
                    <TD className="font-medium">{l.asset_name}</TD>
                    <TD>{l.work_type || '-'}</TD>
                    <TD className="tnum text-right">{fmtQty(l.opening_meter)}</TD>
                    <TD className="tnum text-right">{fmtQty(l.closing_meter)}</TD>
                    <TD className="tnum text-right font-semibold">{fmtQty(l.usage_qty)}</TD>
                    <TD className="tnum text-right">{l.rate == null ? '-' : fmtMoney(l.rate)}</TD>
                    <TD className="tnum text-right text-success">{l.amount == null ? '-' : fmtMoney(l.amount)}</TD>
                    <TD className="tnum text-right">{l.fuel_litres == null ? '—' : fmtQty(l.fuel_litres)}</TD>
                    <TD className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => setForm({ ...l, rate: l.rate ?? '', fuel_litres: l.fuel_litres ?? '' })}><Pencil size={15} /></Button>
                      <Button variant="ghost" size="icon" onClick={() => remove(l)}><Trash2 size={15} className="text-destructive" /></Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )
        ) : mileage.length === 0 ? (
          <EmptyState message="No usage in this period." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Machine</TH>
                <TH>Type</TH>
                <TH className="text-right">Usage</TH>
                <TH className="text-right">Fuel (L)</TH>
                <TH className="text-right">Actual fuel</TH>
                <TH className="text-right">Standard fuel</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {mileage.map((m) => {
                const unit = m.meter_type === 'km' ? 'km' : 'hr'
                return (
                  <TR key={m.asset_id} className={m.over ? 'bg-destructive/5' : ''}>
                    <TD className="font-medium">{m.asset_name}</TD>
                    <TD className="capitalize text-muted-foreground">{m.asset_type}</TD>
                    <TD className="tnum text-right">{fmtQty(m.usage_qty)} <span className="text-xs text-muted-foreground">{unit}</span></TD>
                    <TD className="tnum text-right">{fmtQty(m.fuel_litres)}</TD>
                    <TD className="tnum text-right">{m.actual_consumption == null ? '-' : `${fmtQty(m.actual_consumption)} L/${unit}`}</TD>
                    <TD className="tnum text-right text-muted-foreground">{m.standard_consumption == null ? '-' : `${fmtQty(m.standard_consumption)} L/${unit}`}</TD>
                    <TD>
                      {m.standard_consumption == null || m.actual_consumption == null ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : m.over ? (
                        <Badge variant="destructive"><AlertTriangle size={11} className="mr-0.5 inline" />Over</Badge>
                      ) : (
                        <Badge variant="success">OK</Badge>
                      )}
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
      </Page>

      {form && (
        <Modal open onClose={() => setForm(null)} title={form.id ? 'Edit Logbook Entry' : 'New Logbook Entry'} width="max-w-xl">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Machine / Vehicle" required>
              <SearchSelect
                value={form.asset_id || ''}
                onChange={(v) => {
                  const id = Number(v)
                  setForm({ ...form, asset_id: id })
                  if (!form.id) void prefillOpening(id)
                }}
                options={assets.map((a) => ({ value: a.id, label: a.name }))}
                placeholder="Select…"
              />
            </Field>
            <Field label="Date" required>
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
            <Field label="Work Type">
              <Input value={form.work_type} onChange={(e) => setForm({ ...form, work_type: e.target.value })} placeholder="Loading, Transport…" />
            </Field>
            <Field label={`Rate per ${fUnit}`} hint="Earning rate — usage × rate = income">
              <Input type="number" step="0.01" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} placeholder="Optional" />
            </Field>
            <Field label={`Opening meter (${fUnit})`} hint={form.id ? undefined : 'Continues from the last closing reading'}>
              <Input type="number" step="0.001" value={form.opening_meter} onChange={(e) => setForm({ ...form, opening_meter: e.target.value })} />
            </Field>
            <Field label={`Closing meter (${fUnit})`} hint={fUsage > 0 ? `Used ${fmtQty(fUsage)} ${fUnit}${fIncome > 0 ? ` · income ${fmtMoney(fIncome)}` : ''}` : undefined}>
              <Input type="number" step="0.001" value={form.closing_meter} onChange={(e) => setForm({ ...form, closing_meter: e.target.value })} />
            </Field>
            <Field label="Fuel used (L)" hint="Blank → use diesel issued">
              <Input type="number" step="0.01" value={form.fuel_litres} onChange={(e) => setForm({ ...form, fuel_litres: e.target.value })} placeholder="Optional" />
            </Field>
            <Field label="Remarks">
              <Input value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
            </Field>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
            <Button
              onClick={() => save.mutate({
                ...form,
                opening_meter: Number(form.opening_meter) || 0,
                closing_meter: Number(form.closing_meter) || 0,
                rate: form.rate === '' || form.rate == null ? null : Number(form.rate),
                fuel_litres: form.fuel_litres === '' || form.fuel_litres == null ? null : Number(form.fuel_litres)
              })}
              disabled={!form.asset_id || !form.date}
            >
              Save
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}
