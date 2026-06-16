import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, BookOpen } from 'lucide-react'
import { api } from '@/lib/api'
import type { Business } from '@shared/types'
import { PageHeader, Page } from '@/components/layout'
import {
  Button,
  Input,
  Textarea,
  Field,
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

export function Businesses(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const nav = useNavigate()
  const { data = [] } = useQuery({ queryKey: ['businesses'], queryFn: api.businesses.list })
  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState<Partial<Business>>({})

  const save = useMutation({
    mutationFn: (p: Partial<Business>) => (p.id ? api.businesses.update(p) : api.businesses.create(p)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['businesses'] })
      setOpen(false)
      toast.success('Business saved.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  async function remove(b: Business): Promise<void> {
    const ok = await confirmDialog({
      title: 'Delete business',
      message: `Delete "${b.name}"? Machines stay but are unlinked from this firm.`
    })
    if (!ok) return
    const res = await api.businesses.delete(b.id)
    if (res.ok) {
      qc.invalidateQueries({ queryKey: ['businesses'] })
      qc.invalidateQueries({ queryKey: ['assets'] })
      toast.success('Business deleted.')
    } else toast.error(res.error || 'Could not delete business.')
  }

  return (
    <>
      <PageHeader
        title="Businesses / Firms"
        description="Your own firms (e.g. G Group Crusher, G Group Mechanical) that own machines and earn rent"
        actions={
          <Button onClick={() => { setForm({}); setOpen(true) }}>
            <Plus size={16} /> New Business
          </Button>
        }
      />
      <Page>
        <div className="mb-4 rounded-lg border border-primary/30 bg-accent/50 px-4 py-3 text-sm text-accent-foreground">
          Add your firms here, then assign machines/vehicles to a firm under <b>Machinery & Vehicles</b>.
          Rent earned by those machines becomes <b>income</b> and their diesel, maintenance & operator
          wages become <b>costs</b> — all rolled up in the firm's <b>Business ledger</b> (Accounts → Ledgers → Business).
        </div>
        {data.length === 0 ? (
          <EmptyState message="No businesses yet." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Contact</TH>
                <TH>Remarks</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {data.map((b) => (
                <TR key={b.id}>
                  <TD className="font-medium">{b.name}</TD>
                  <TD className="text-muted-foreground">{b.contact || '-'}</TD>
                  <TD className="text-muted-foreground">{b.remarks || '-'}</TD>
                  <TD className="text-right">
                    <Button variant="ghost" size="icon" title="Business ledger" onClick={() => nav('/ledgers', { state: { type: 'business', id: b.id } })}>
                      <BookOpen size={15} />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => { setForm(b); setOpen(true) }}>
                      <Pencil size={15} />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(b)}>
                      <Trash2 size={15} className="text-destructive" />
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Page>

      <Modal open={open} onClose={() => setOpen(false)} title={form.id ? 'Edit Business' : 'New Business'}>
        <div className="space-y-4">
          <Field label="Business / Firm Name">
            <Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. G Group Mechanical" />
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
