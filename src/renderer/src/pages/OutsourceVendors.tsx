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
              {data.map((o) => (
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
      </Page>

      <Modal open={open} onClose={() => setOpen(false)} title={form.id ? 'Edit Vendor' : 'New Outsource Vendor'}>
        <div className="space-y-4">
          <Field label="Vendor Name">
            <Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. XYZ Labour Contractor" />
          </Field>
          <Field label="Head / Type">
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
            <Button onClick={() => save.mutate(form)} disabled={!form.name?.trim()}>Save</Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
