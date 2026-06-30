import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { Boxes, Wrench } from 'lucide-react'
import { PageHeader, Page } from '@/components/layout'
import { PartsStockPanel } from './SpareParts'
import { CostsPanel } from './Maintenance'

type Top = 'parts' | 'costs'

/**
 * One page combining Spare Parts Stock and Maintenance & Costs. Parts issued for a repair
 * become a service Plant Expense (parts FIFO + labour) against the machine — see PartsStockPanel.
 */
export function MaintenanceParts(): React.JSX.Element {
  const [params, setParams] = useSearchParams()
  const top = (params.get('view') as Top) || 'parts'
  const setTop = (v: Top): void => setParams((p) => { p.set('view', v); return p }, { replace: true })

  const TABS: { key: Top; label: string; icon: typeof Wrench }[] = [
    { key: 'parts', label: 'Spare Parts Stock', icon: Boxes },
    { key: 'costs', label: 'Maintenance & Costs', icon: Wrench }
  ]

  return (
    <>
      <PageHeader
        title="Maintenance & Parts"
        description="Spare-parts stock and machine costs in one place — issuing parts for a repair posts the parts (FIFO) plus labour to Plant Expenses against that machine"
      />
      <Page>
        <div className="mb-5 flex flex-wrap gap-2 border-b pb-3">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTop(key)}
              className={
                'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ' +
                (top === key ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent')
              }
            >
              <Icon size={16} /> {label}
            </button>
          ))}
        </div>
        {top === 'parts' ? <PartsStockPanel /> : <CostsPanel />}
      </Page>
    </>
  )
}
