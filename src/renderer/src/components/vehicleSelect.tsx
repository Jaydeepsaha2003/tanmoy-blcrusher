import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { SearchSelect } from '@/components/ui'

/**
 * Vehicle/JCB picker sourced from a transporter's registered fleet. Once a
 * transporter is chosen, its vehicles and JCBs are offered here; it stays
 * creatable so a one-off vehicle number can still be typed in.
 */
export function TransporterVehicleSelect({
  transporterId,
  value,
  onChange,
  placeholder,
  className
}: {
  transporterId?: number | null
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}): React.JSX.Element {
  const { data: fleet = [] } = useQuery({
    queryKey: ['transporterFleet', transporterId],
    queryFn: () => api.transporterFleet.list(transporterId as number),
    enabled: !!transporterId
  })
  const options = [
    ...fleet.map((f) => ({ value: f.name, label: f.kind === 'jcb' ? `${f.name} (JCB)` : f.name })),
    // Keep an already-entered vehicle selectable even if it isn't in the fleet.
    ...(value && !fleet.some((f) => f.name === value) ? [{ value, label: value }] : [])
  ]
  return (
    <SearchSelect
      className={className}
      creatable
      value={value || ''}
      onChange={onChange}
      options={options}
      placeholder={placeholder ?? (transporterId ? 'Select / type vehicle…' : 'Vehicle no.')}
    />
  )
}
