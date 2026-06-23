import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, FileSpreadsheet } from 'lucide-react'
import { api } from '@/lib/api'
import type { Employee } from '@shared/types'
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
import { fmtMoney, downloadExcel } from '@/lib/utils'

const DESIGNATIONS = ['Operator', 'Helper', 'Driver', 'Fitter', 'Electrician', 'Supervisor', 'Manager', 'Labour']

export function Employees(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const { plantId } = usePlant()
  const { data = [] } = useQuery({ queryKey: ['employees', plantId], queryFn: () => api.employees.list(plantId) })
  const { data: plants = [] } = useQuery({ queryKey: ['plants'], queryFn: api.plants.list })
  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState<any>(null)
  const [q, setQ] = React.useState('')
  const [desig, setDesig] = React.useState('')
  const [status, setStatus] = React.useState('')

  const desigs = React.useMemo(() => [...new Set(data.map((e) => e.designation).filter(Boolean))], [data])
  const filtered = React.useMemo(() => {
    const term = q.trim().toLowerCase()
    return data.filter((e) => {
      if (term && !`${e.name} ${e.designation ?? ''} ${e.contact ?? ''}`.toLowerCase().includes(term)) return false
      if (desig && e.designation !== desig) return false
      if (status && e.status !== status) return false
      return true
    })
  }, [data, q, desig, status])

  const save = useMutation({
    mutationFn: (p: any) => (p.id ? api.employees.update(p) : api.employees.create(p)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] })
      setOpen(false)
      toast.success('Employee saved.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  async function remove(x: Employee): Promise<void> {
    const ok = await confirmDialog({ title: 'Delete employee', message: `Delete "${x.name}"?` })
    if (!ok) return
    const res = await api.employees.delete(x.id)
    if (res.ok) {
      qc.invalidateQueries({ queryKey: ['employees'] })
      toast.success('Deleted.')
    } else toast.error(res.error || 'Could not delete.')
  }

  function openNew(): void {
    setForm({ name: '', designation: '', wage_type: 'monthly', monthly_salary: '', daily_wage: '', ot_rate: '', plant_id: plantId ?? null, contact: '', status: 'active', remarks: '' })
    setOpen(true)
  }

  function exportExcel(): void {
    downloadExcel(
      'employees',
      'Employees',
      ['Name', 'Designation', 'Wage Type', 'Monthly Salary', 'Daily Wage', 'OT Rate/hr', 'Plant', 'Contact', 'Status'],
      data.map((e) => [
        e.name, e.designation, e.wage_type, e.monthly_salary, e.daily_wage, e.ot_rate,
        e.plant_name ?? 'Common', e.contact, e.status
      ])
    )
  }

  return (
    <>
      <PageHeader
        title="Employees / Crusher Team"
        description="Workers and staff — monthly salary or daily wage"
        actions={
          <>
            <Button variant="outline" onClick={exportExcel} disabled={!data.length}>
              <FileSpreadsheet size={16} /> Excel
            </Button>
            <Button onClick={openNew}>
              <Plus size={16} /> New Employee
            </Button>
          </>
        }
      />
      <Page>
        {data.length === 0 ? (
          <EmptyState message="No employees added yet." />
        ) : (
          <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Input className="w-full sm:w-60" placeholder="Search name, designation, contact…" value={q} onChange={(e) => setQ(e.target.value)} />
            <SearchSelect
              className="w-full sm:w-44"
              value={desig}
              onChange={setDesig}
              options={[{ value: '', label: 'All designations' }, ...desigs.map((dz) => ({ value: dz as string, label: dz as string }))]}
            />
            <SearchSelect
              className="w-full sm:w-36"
              value={status}
              onChange={setStatus}
              options={[{ value: '', label: 'All status' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]}
            />
            {(q || desig || status) && <Button variant="ghost" size="sm" onClick={() => { setQ(''); setDesig(''); setStatus('') }}>Clear</Button>}
            <span className="ml-auto text-sm text-muted-foreground">{filtered.length} of {data.length}</span>
          </div>
          {filtered.length === 0 ? (
            <EmptyState message="No employees match your search." />
          ) : (
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Designation</TH>
                <TH>Wage Type</TH>
                <TH className="text-right">Rate</TH>
                <TH className="text-right">OT / hr</TH>
                <TH>Plant</TH>
                <TH>Status</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {filtered.map((e) => (
                <TR key={e.id}>
                  <TD className="font-medium">{e.name}</TD>
                  <TD className="text-muted-foreground">{e.designation || '-'}</TD>
                  <TD><Badge variant={e.wage_type === 'monthly' ? 'default' : 'muted'}>{e.wage_type}</Badge></TD>
                  <TD className="tnum text-right">{e.wage_type === 'monthly' ? `${fmtMoney(e.monthly_salary)}/mo` : `${fmtMoney(e.daily_wage)}/day`}</TD>
                  <TD className="tnum text-right">{e.ot_rate ? fmtMoney(e.ot_rate) : '-'}</TD>
                  <TD className="text-muted-foreground">{e.plant_name || 'Common'}</TD>
                  <TD className="capitalize text-muted-foreground">{e.status}</TD>
                  <TD className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => { setForm({ ...e, monthly_salary: e.monthly_salary || '', daily_wage: e.daily_wage || '', ot_rate: e.ot_rate || '' }); setOpen(true) }}>
                      <Pencil size={15} />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(e)}>
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

      {form && (
        <Modal open={open} onClose={() => setOpen(false)} title={form.id ? 'Edit Employee' : 'New Employee'} width="max-w-2xl">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name" required>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Designation">
              <Input list="desigs" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} placeholder="Operator, Helper…" />
              <datalist id="desigs">{DESIGNATIONS.map((x) => <option key={x} value={x} />)}</datalist>
            </Field>
            <Field label="Wage Type" required>
              <SearchSelect
                value={form.wage_type}
                onChange={(v) => setForm({ ...form, wage_type: v })}
                options={[
                  { value: 'monthly', label: 'Monthly Salary' },
                  { value: 'daily', label: 'Daily Wage' }
                ]}
              />
            </Field>
            {form.wage_type === 'monthly' ? (
              <Field label="Monthly Salary" required>
                <Input type="number" step="0.01" value={form.monthly_salary} onChange={(e) => setForm({ ...form, monthly_salary: e.target.value })} />
              </Field>
            ) : (
              <Field label="Daily Wage" required>
                <Input type="number" step="0.01" value={form.daily_wage} onChange={(e) => setForm({ ...form, daily_wage: e.target.value })} />
              </Field>
            )}
            <Field label="Overtime Rate / hour">
              <Input type="number" step="0.01" value={form.ot_rate} onChange={(e) => setForm({ ...form, ot_rate: e.target.value })} placeholder="Optional" />
            </Field>
            <Field label="Plant" hint="Common = shared by all plants">
              <SearchSelect
                value={form.plant_id ?? ''}
                onChange={(v) => setForm({ ...form, plant_id: v ? Number(v) : null })}
                options={[{ value: '', label: 'Common (all plants)' }, ...plants.map((p) => ({ value: p.id, label: p.name }))]}
              />
            </Field>
            <Field label="Contact">
              <Input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
            </Field>
            <Field label="Status">
              <SearchSelect
                value={form.status}
                onChange={(v) => setForm({ ...form, status: v })}
                options={[
                  { value: 'active', label: 'Active' },
                  { value: 'inactive', label: 'Inactive' }
                ]}
              />
            </Field>
            <div className="col-span-2">
              <Field label="Remarks">
                <Input value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
              </Field>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              onClick={() => save.mutate({ ...form, monthly_salary: Number(form.monthly_salary) || 0, daily_wage: Number(form.daily_wage) || 0, ot_rate: Number(form.ot_rate) || 0 })}
              disabled={!form.name?.trim() || (form.wage_type === 'monthly' ? !(Number(form.monthly_salary) > 0) : !(Number(form.daily_wage) > 0))}
            >
              Save
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}
