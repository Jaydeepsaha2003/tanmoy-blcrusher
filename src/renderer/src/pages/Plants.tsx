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
              {data.map((p) => (
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
            <Select
              value={form.status || 'active'}
              onChange={(e) => setForm({ ...form, status: e.target.value as Plant['status'] })}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
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
