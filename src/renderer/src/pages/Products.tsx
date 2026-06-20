import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import type { Product } from '@shared/types'
import { PageHeader, Page } from '@/components/layout'
import {
  Button,
  Input,
  Select,
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

export function Products(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const { data = [] } = useQuery({ queryKey: ['products'], queryFn: () => api.products.list() })
  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState<Partial<Product>>({ status: 'active' })

  const save = useMutation({
    mutationFn: (p: Partial<Product>) => (p.id ? api.products.update(p) : api.products.create(p)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] })
      setOpen(false)
      toast.success('Product saved.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  async function remove(p: Product): Promise<void> {
    const ok = await confirmDialog({ title: 'Delete product', message: `Delete "${p.name}"?` })
    if (!ok) return
    const res = await api.products.delete(p.id)
    if (res.ok) {
      qc.invalidateQueries({ queryKey: ['products'] })
      toast.success('Product deleted.')
    } else toast.error(res.error || 'Could not delete product.')
  }

  return (
    <>
      <PageHeader
        title="Products"
        description="Your finished-goods products, shared across all plants. They feed the Production Settings and Rate List dropdowns."
        actions={
          <Button onClick={() => { setForm({ status: 'active', description: '' }); setOpen(true) }}>
            <Plus size={16} /> New Product
          </Button>
        }
      />
      <Page>
        {data.length === 0 ? (
          <EmptyState message="No products yet. Add your products (e.g. 30/40, 10mm, Stone Dust)." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Product</TH>
                <TH>Description</TH>
                <TH>Status</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {data.map((p) => (
                <TR key={p.id}>
                  <TD className="font-medium">{p.name}</TD>
                  <TD className="text-muted-foreground">{p.description || '-'}</TD>
                  <TD>
                    <Badge variant={p.status === 'active' ? 'success' : 'muted'}>{p.status}</Badge>
                  </TD>
                  <TD className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => { setForm(p); setOpen(true) }}>
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

      <Modal open={open} onClose={() => setOpen(false)} title={form.id ? 'Edit Product' : 'New Product'}>
        <div className="space-y-4">
          <Field label="Product Name">
            <Input
              value={form.name || ''}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. 30/40, 10mm, Stone Dust"
            />
          </Field>
          <Field label="Description" hint="Optional">
            <Textarea
              value={form.description || ''}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>
          <Field label="Status">
            <SearchSelect
              value={form.status || 'active'}
              onChange={(v) => setForm({ ...form, status: v as Product['status'] })}
              options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate(form)} disabled={!form.name?.trim()}>
              Save
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
