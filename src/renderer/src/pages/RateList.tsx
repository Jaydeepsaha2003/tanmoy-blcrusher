import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Save, Link2, Copy, ExternalLink, XCircle } from 'lucide-react'
import { api } from '@/lib/api'
import type { Uom } from '@shared/types'
import { UOMS } from '@shared/types'
import { PageHeader, Page } from '@/components/layout'
import { Button, Input, Select, Card, CardContent, EmptyState } from '@/components/ui'
import { useToast } from '@/components/toast'

interface RateRow {
  product_id: number | ''
  plant_id: number
  product_name: string
  uom: Uom
  rate: number | string
}

export function RateList(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const { data: customers = [] } = useQuery({ queryKey: ['customers', 0], queryFn: () => api.customers.list() })
  const { data: products = [] } = useQuery({ queryKey: ['products', 0], queryFn: () => api.products.list() })

  const [customerId, setCustomerId] = React.useState<number | undefined>(undefined)
  React.useEffect(() => {
    if (!customerId && customers.length) setCustomerId(customers[0].id)
  }, [customers, customerId])

  const { data: rates = [] } = useQuery({
    queryKey: ['rates', customerId],
    queryFn: () => api.rates.list(customerId!),
    enabled: !!customerId
  })

  const [rows, setRows] = React.useState<RateRow[]>([])
  React.useEffect(() => {
    setRows(
      rates.map((r) => {
        const match = products.find(
          (p) => p.plant_id === r.plant_id && p.name.toLowerCase() === r.product_name.toLowerCase()
        )
        return {
          product_id: match?.id ?? '',
          plant_id: r.plant_id,
          product_name: r.product_name,
          uom: r.uom,
          rate: r.rate
        }
      })
    )
  }, [rates, products])

  const [share, setShare] = React.useState<{ path: string } | null>(null)
  React.useEffect(() => setShare(null), [customerId])

  const save = useMutation({
    mutationFn: () =>
      api.rates.save(
        customerId!,
        rows
          .filter((r) => r.product_id !== '' && r.product_name)
          .map((r) => ({
            plant_id: r.plant_id,
            product_name: r.product_name,
            uom: r.uom,
            rate: Number(r.rate) || 0
          }))
      ),
    onSuccess: (res) => {
      if (res.ok) {
        qc.invalidateQueries({ queryKey: ['rates'] })
        toast.success('Rate list saved.')
      } else toast.error(res.error || 'Could not save.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  function update(i: number, patch: Partial<RateRow>): void {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  function onPickProduct(i: number, productId: string): void {
    const prod = products.find((p) => p.id === Number(productId))
    if (!prod) {
      update(i, { product_id: '', product_name: '', plant_id: 0 })
      return
    }
    update(i, { product_id: prod.id, product_name: prod.name, plant_id: prod.plant_id })
  }

  const origin =
    typeof window !== 'undefined' && window.location.origin.startsWith('http')
      ? window.location.origin
      : ''
  const fullUrl = share ? `${origin}${share.path}` : ''

  async function makeLink(): Promise<void> {
    if (!customerId) return
    try {
      const res = await api.rates.shareLink(customerId)
      setShare({ path: res.path })
      const url = `${origin}${res.path}`
      try {
        await navigator.clipboard.writeText(url || res.path)
        toast.success('Share link copied to clipboard.')
      } catch {
        toast.success('Share link ready.')
      }
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  async function revoke(): Promise<void> {
    if (!customerId) return
    await api.rates.removeShareLink(customerId)
    setShare(null)
    toast.success('Share link revoked. The old URL no longer works.')
  }

  return (
    <>
      <PageHeader
        title="Rate List"
        description="Set per-customer rates by product and unit, and share a live, no-login link with each customer."
      />
      <Page>
        {customers.length === 0 ? (
          <EmptyState message="Add a customer first." />
        ) : (
          <div className="max-w-3xl space-y-4">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-muted-foreground">
                Customer
              </label>
              <Select
                className="w-full sm:w-80"
                value={customerId || ''}
                onChange={(e) => setCustomerId(Number(e.target.value))}
              >
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>

            {/* Share link */}
            <Card>
              <CardContent className="space-y-3 pt-5">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Link2 size={16} /> Shareable rate link (no login)
                </div>
                <p className="text-xs text-muted-foreground">
                  Generate a private link to send this customer. It always shows your current saved
                  rates — when you edit and save here, their page updates automatically.
                </p>
                {share ? (
                  <div className="space-y-2">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input readOnly value={fullUrl || share.path} className="font-mono text-xs" />
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            navigator.clipboard?.writeText(fullUrl || share.path)
                            toast.success('Copied.')
                          }}
                        >
                          <Copy size={14} /> Copy
                        </Button>
                        {origin && (
                          <a href={fullUrl} target="_blank" rel="noreferrer">
                            <Button variant="outline" size="sm">
                              <ExternalLink size={14} /> Open
                            </Button>
                          </a>
                        )}
                        <Button variant="ghost" size="sm" onClick={revoke}>
                          <XCircle size={14} className="text-destructive" /> Revoke
                        </Button>
                      </div>
                    </div>
                    {!origin && (
                      <p className="text-xs text-muted-foreground">
                        On the web app this becomes a full link like
                        <span className="font-mono"> https://yourdomain{share.path}</span>.
                      </p>
                    )}
                  </div>
                ) : (
                  <Button variant="outline" size="sm" onClick={makeLink}>
                    <Link2 size={14} /> Generate &amp; copy link
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Rates grid */}
            <Card>
              <CardContent className="pt-5">
                {products.length === 0 ? (
                  <EmptyState message="Add products first (Products menu) — rates are set per product." />
                ) : (
                  <>
                    <div className="space-y-2">
                      <div className="grid grid-cols-[1fr_110px_130px_40px] gap-2 px-1 text-xs font-semibold uppercase text-muted-foreground">
                        <div>Product</div>
                        <div>Unit</div>
                        <div>Rate (₹/unit)</div>
                        <div></div>
                      </div>
                      {rows.map((r, i) => (
                        <div key={i} className="grid grid-cols-[1fr_110px_130px_40px] gap-2">
                          <Select value={r.product_id} onChange={(e) => onPickProduct(i, e.target.value)}>
                            <option value="">Select product…</option>
                            {products.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} — {p.plant_name}
                              </option>
                            ))}
                          </Select>
                          <Select value={r.uom} onChange={(e) => update(i, { uom: e.target.value as Uom })}>
                            {UOMS.map((u) => <option key={u} value={u}>{u}</option>)}
                          </Select>
                          <Input
                            type="number"
                            step="0.01"
                            value={r.rate}
                            onChange={(e) => update(i, { rate: e.target.value })}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}
                          >
                            <Trash2 size={15} className="text-destructive" />
                          </Button>
                        </div>
                      ))}
                      {rows.length === 0 && (
                        <p className="px-1 py-2 text-sm text-muted-foreground">
                          No rates yet for this customer. Add a product rate below.
                        </p>
                      )}
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={() =>
                        setRows((rs) => [
                          ...rs,
                          { product_id: '', plant_id: 0, product_name: '', uom: 'CM', rate: '' }
                        ])
                      }
                    >
                      <Plus size={15} /> Add Product Rate
                    </Button>

                    <div className="mt-5 flex justify-end border-t pt-4">
                      <Button onClick={() => save.mutate()} disabled={!customerId}>
                        <Save size={16} /> Save Rate List
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </Page>
    </>
  )
}
