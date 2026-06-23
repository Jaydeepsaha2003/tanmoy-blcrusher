import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, BookOpen } from 'lucide-react'
import { api } from '@/lib/api'
import type { Outsource } from '@shared/types'
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
  EmptyState
} from '@/components/ui'
import { useToast } from '@/components/toast'
import { confirmDialog } from '@/components/confirm'

const HEADS = ['Labour', 'Transport', 'Machinery', 'Loading', 'Material', 'Other']

export function OutsourceVendors(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const nav = useNavigate()
  const { data = [] } = useQuery({ queryKey: ['outsource'], queryFn: api.outsource.list })
  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState<Partial<Outsource>>({})
  const [q, setQ] = React.useState('')
  const [head, setHead] = React.useState('')

  const heads = React.useMemo(() => [...new Set(data.map((o) => o.head).filter(Boolean))], [data])
  const filtered = React.useMemo(() => {
    const term = q.trim().toLowerCase()
    return data.filter((o) => {
      if (term && !`${o.name} ${o.contact ?? ''}`.toLowerCase().includes(term)) return false
      if (head && o.head !== head) return false
      return true
    })
  }, [data, q, head])

  const save = useMutation({
    mutationFn: (p: Partial<Outsource>) => (p.id ? api.outsource.update(p) : api.outsource.create(p)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['outsource'] })
      setOpen(false)
      toast.success('Outsource vendor saved.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  async function remove(o: Outsource): Promise<void> {
    const ok = await confirmDialog({ title: 'Delete vendor', message: `Delete "${o.name}"?` })
    if (!ok) return
    const res = await api.outsource.delete(o.id)
    if (res.ok) {
      qc.invalidateQueries({ queryKey: ['outsource'] })
      toast.success('Deleted.')
    } else toast.error(res.error || 'Could not delete.')
  }

  return (
    <>
      <PageHeader
        title="Outsource Vendors"
        description="Parties you outsource from (e.g. labour from XYZ Co.) — expenses post to their ledger"
        actions={
          <Button onClick={() => { setForm({ head: 'Labour' }); setOpen(true) }}>
            <Plus size={16} /> New Vendor
          </Button>
        }
      />
      <Page>
        <div className="mb-4 rounded-lg border border-primary/30 bg-accent/50 px-4 py-3 text-sm text-accent-foreground">
          Add an outsource source and a <b>head</b> (Labour, Transport, Machinery…). When you record a
          plant expense, tag it to a vendor and it lands in that vendor's <b>ledger</b> and in <b>Payment Status</b> as a payable.
        </div>
        {data.length === 0 ? (
          <EmptyState message="No outsource vendors yet." />
        ) : (
          <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Input className="w-full sm:w-60" placeholder="Search name, contact…" value={q} onChange={(e) => setQ(e.target.value)} />
            <SearchSelect
              className="w-full sm:w-44"
              value={head}
              onChange={setHead}
              options={[{ value: '', label: 'All heads' }, ...heads.map((h) => ({ value: h as string, label: h as string }))]}
            />
            {(q || head) && <Button variant="ghost" size="sm" onClick={() => { setQ(''); setHead('') }}>Clear</Button>}
            <span className="ml-auto text-sm text-muted-foreground">{filtered.length} of {data.length}</span>
          </div>
          {filtered.length === 0 ? (
            <EmptyState message="No vendors match your search." />
          ) : (
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Head</TH>
                <TH>Contact</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {filtered.map((o) => (
                <TR key={o.id}>
                  <TD className="font-medium">{o.name}</TD>
                  <TD>{o.head ? <Badge variant="muted">{o.head}</Badge> : '-'}</TD>
                  <TD className="text-muted-foreground">{o.contact || '-'}</TD>
                  <TD className="text-right">
                    <Button variant="ghost" size="icon" title="Ledger" onClick={() => nav('/ledgers', { state: { type: 'outsource', id: o.id } })}>
                      <BookOpen size={15} />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => { setForm(o); setOpen(true) }}>
                      <Pencil size={15} />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(o)}>
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

      <Modal open={open} onClose={() => setOpen(false)} title={form.id ? 'Edit Vendor' : 'New Outsource Vendor'}>
        <div className="space-y-4">
          <Field label="Vendor Name">
            <Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. XYZ Labour Contractor" />
          </Field>
          <Field label="Head / Type" required hint="Required — e.g. Labour, Transport, Machinery">
            <Input list="outsource-heads" value={form.head || ''} onChange={(e) => setForm({ ...form, head: e.target.value })} placeholder="Labour, Transport…" />
            <datalist id="outsource-heads">{HEADS.map((h) => <option key={h} value={h} />)}</datalist>
          </Field>
          <Field label="Contact">
            <Input value={form.contact || ''} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
          </Field>
          <Field label="Remarks">
            <Textarea value={form.remarks || ''} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate(form)} disabled={!form.name?.trim() || !form.head?.trim()}>Save</Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
