import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import type { Plant } from '@shared/types'
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

const empty: Partial<Plant> = { name: '', code: '', location: '', status: 'active' }

export function Plants(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const { data = [] } = useQuery({ queryKey: ['plants'], queryFn: api.plants.list })
  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState<Partial<Plant>>(empty)
  const [q, setQ] = React.useState('')
  const [status, setStatus] = React.useState('')

  const filtered = React.useMemo(() => {
    const term = q.trim().toLowerCase()
    return data.filter((p) => {
      if (term && !`${p.name} ${p.code ?? ''} ${p.location ?? ''}`.toLowerCase().includes(term)) return false
      if (status && p.status !== status) return false
      return true
    })
  }, [data, q, status])

  const save = useMutation({
    mutationFn: (p: Partial<Plant>) => (p.id ? api.plants.update(p) : api.plants.create(p)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plants'] })
      setOpen(false)
      toast.success('Plant saved.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  async function remove(p: Plant): Promise<void> {
    const ok = await confirmDialog({
      title: 'Delete plant',
      message: `Delete "${p.name}"? This cannot be undone.`
    })
    if (!ok) return
    const res = await api.plants.delete(p.id)
    if (res.ok) {
      qc.invalidateQueries({ queryKey: ['plants'] })
      toast.success('Plant deleted.')
    } else toast.error(res.error || 'Could not delete plant.')
  }

  function openNew(): void {
    setForm(empty)
    setOpen(true)
  }
  function openEdit(p: Plant): void {
    setForm(p)
    setOpen(true)
  }

  return (
    <>
      <PageHeader
        title="Plants"
        description="Manage your crusher plants"
        actions={
          <Button onClick={openNew}>
            <Plus size={16} /> New Plant
          </Button>
        }
      />
      <Page>
        {data.length === 0 ? (
          <EmptyState message="No plants yet. Create your first plant to get started." />
        ) : (
          <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Input className="w-full sm:w-60" placeholder="Search name, code, location…" value={q} onChange={(e) => setQ(e.target.value)} />
            <SearchSelect
              className="w-full sm:w-40"
              value={status}
              onChange={setStatus}
              options={[{ value: '', label: 'All status' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]}
            />
            {(q || status) && <Button variant="ghost" size="sm" onClick={() => { setQ(''); setStatus('') }}>Clear</Button>}
            <span className="ml-auto text-sm text-muted-foreground">{filtered.length} of {data.length}</span>
          </div>
          {filtered.length === 0 ? (
            <EmptyState message="No plants match your search." />
          ) : (
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Code</TH>
                <TH>Location</TH>
                <TH>Status</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {filtered.map((p) => (
                <TR key={p.id}>
                  <TD className="font-medium">{p.name}</TD>
                  <TD>{p.code}</TD>
                  <TD className="text-muted-foreground">{p.location || '-'}</TD>
                  <TD>
                    <Badge variant={p.status === 'active' ? 'success' : 'muted'}>
                      {p.status}
                    </Badge>
                  </TD>
                  <TD className="text-right">
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
          </>
        )}
      </Page>

      <Modal open={open} onClose={() => setOpen(false)} title={form.id ? 'Edit Plant' : 'New Plant'}>
        <div className="space-y-4">
          <Field label="Plant Name">
            <Input
              value={form.name || ''}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Ditokcherra"
            />
          </Field>
          <Field label="Plant Code">
            <Input
              value={form.code || ''}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="e.g. PLT-01"
            />
          </Field>
          <Field label="Location / Address">
            <Input
              value={form.location || ''}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
            />
          </Field>
          <Field label="Status">
            <SearchSelect
              value={form.status || 'active'}
              onChange={(v) => setForm({ ...form, status: v as Plant['status'] })}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' }
              ]}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => save.mutate(form)}
              disabled={!form.name?.trim() || !form.code?.trim()}
            >
              Save
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
