import * as React from 'react'

interface PlantCtx {
  /** undefined = All Plants */
  plantId: number | undefined
  setPlantId: (id: number | undefined) => void
}

const Ctx = React.createContext<PlantCtx | null>(null)
const KEY = 'bl_active_plant'

export function PlantProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [plantId, setState] = React.useState<number | undefined>(() => {
    const v = localStorage.getItem(KEY)
    return v ? Number(v) : undefined
  })
  const setPlantId = React.useCallback((id: number | undefined) => {
    setState(id)
    if (id) localStorage.setItem(KEY, String(id))
    else localStorage.removeItem(KEY)
  }, [])
  return <Ctx.Provider value={{ plantId, setPlantId }}>{children}</Ctx.Provider>
}

export function usePlant(): PlantCtx {
  const c = React.useContext(Ctx)
  if (!c) throw new Error('usePlant must be used within PlantProvider')
  return c
}
