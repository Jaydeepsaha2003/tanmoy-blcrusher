import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { X, ChevronDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

/* ---------------- Button ---------------- */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm',
        outline: 'border border-input bg-card hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        success: 'bg-success text-success-foreground hover:bg-success/90 shadow-sm'
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-6',
        icon: 'h-9 w-9'
      }
    },
    defaultVariants: { variant: 'default', size: 'default' }
  }
)
export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
  )
)
Button.displayName = 'Button'

/* ---------------- Input ---------------- */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'flex h-9 w-full rounded-lg border border-input bg-card px-3 py-1 text-sm shadow-sm transition-all placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
)
Input.displayName = 'Input'

/* ---------------- Textarea ---------------- */
export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'flex min-h-[68px] w-full rounded-lg border border-input bg-card px-3 py-2 text-sm shadow-sm transition-all placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50',
      className
    )}
    {...props}
  />
))
Textarea.displayName = 'Textarea'

/* ---------------- Select (native) ---------------- */
export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'flex h-9 w-full cursor-pointer rounded-lg border border-input bg-card px-3 py-1 text-sm shadow-sm transition-all focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50',
      className
    )}
    {...props}
  >
    {children}
  </select>
))
Select.displayName = 'Select'

/* ---------------- SearchSelect (searchable dropdown) ---------------- */
export interface SearchOption {
  value: number | string
  label: string
}
export function SearchSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  disabled,
  className,
  alwaysSearch
}: {
  value: number | string | '' | null | undefined
  onChange: (value: string) => void
  options: SearchOption[]
  placeholder?: string
  disabled?: boolean
  className?: string
  /** Force the search box to show even for short lists. */
  alwaysSearch?: boolean
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  const [q, setQ] = React.useState('')
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    function onDoc(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  const sel = options.find((o) => String(o.value) === String(value ?? ''))
  const ql = q.trim().toLowerCase()
  const filtered = ql ? options.filter((o) => o.label.toLowerCase().includes(ql)) : options
  // Short lists don't need a search box — keep them as a clean dropdown (unless forced).
  const showSearch = alwaysSearch || options.length > 7
  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => { setQ(''); setOpen((v) => !v) }}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-input bg-card px-3 text-left text-sm shadow-sm transition-all focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50"
      >
        <span className={cn('truncate', !sel && 'text-muted-foreground')}>{sel ? sel.label : placeholder}</span>
        <ChevronDown size={15} className="shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute z-[60] mt-1 w-full overflow-hidden rounded-lg border bg-card shadow-xl">
          {showSearch && (
            <div className="flex items-center gap-2 border-b px-2.5 py-1.5">
              <Search size={14} className="text-muted-foreground" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search…"
                className="w-full bg-transparent text-sm outline-none"
              />
            </div>
          )}
          <div className="max-h-56 overflow-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">No matches</div>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => { onChange(String(o.value)); setOpen(false); setQ('') }}
                  className={cn(
                    'block w-full truncate px-3 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
                    String(o.value) === String(value ?? '') && 'bg-accent/60 font-medium'
                  )}
                >
                  {o.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------------- Label ---------------- */
export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>): React.JSX.Element {
  return (
    <label
      className={cn('mb-1.5 block text-[13px] font-semibold text-foreground/75', className)}
      {...props}
    />
  )
}

export function Field({
  label,
  children,
  hint,
  required,
  className
}: {
  label: string
  children: React.ReactNode
  hint?: string
  required?: boolean
  className?: string
}): React.JSX.Element {
  return (
    <div className={className}>
      <Label>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  )
}

/* ---------------- Card ---------------- */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      className={cn('rounded-xl border bg-card text-card-foreground shadow-sm', className)}
      {...props}
    />
  )
}
export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn('flex flex-col space-y-1.5 p-5', className)} {...props} />
}
export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>): React.JSX.Element {
  return <h3 className={cn('font-semibold leading-none tracking-tight', className)} {...props} />
}
export function CardContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn('p-5 pt-0', className)} {...props} />
}

/* ---------------- Badge ---------------- */
const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary/10 text-primary',
        success: 'border-transparent bg-success/10 text-success',
        warning: 'border-transparent bg-warning/15 text-warning',
        destructive: 'border-transparent bg-destructive/10 text-destructive',
        muted: 'border-transparent bg-muted text-muted-foreground'
      }
    },
    defaultVariants: { variant: 'default' }
  }
)
export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>): React.JSX.Element {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

/* ---------------- Table ---------------- */
export function Table({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableElement>): React.JSX.Element {
  return (
    <div className="relative w-full overflow-auto rounded-lg border bg-card">
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  )
}
export function THead(props: React.HTMLAttributes<HTMLTableSectionElement>): React.JSX.Element {
  return <thead className="bg-muted/60 [&_tr]:border-b" {...props} />
}
export function TBody(props: React.HTMLAttributes<HTMLTableSectionElement>): React.JSX.Element {
  return <tbody className="[&_tr:last-child]:border-0" {...props} />
}
export function TR({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>): React.JSX.Element {
  return <tr className={cn('border-b transition-colors hover:bg-muted/40', className)} {...props} />
}
export function TH({
  className,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>): React.JSX.Element {
  return (
    <th
      className={cn(
        'h-10 px-3 text-left align-middle text-xs font-semibold uppercase tracking-wide text-muted-foreground',
        className
      )}
      {...props}
    />
  )
}
export function TD({
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>): React.JSX.Element {
  return <td className={cn('px-3 py-2.5 align-middle', className)} {...props} />
}

/* ---------------- Modal / Dialog ---------------- */
export function Modal({
  open,
  onClose,
  title,
  children,
  width = 'max-w-lg'
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  width?: string
}): React.JSX.Element | null {
  React.useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    if (open) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-3 pt-8 backdrop-blur-sm sm:p-4 sm:pt-16">
      <div
        className={cn(
          'animate-in relative w-full rounded-2xl border bg-card shadow-2xl ring-1 ring-black/5',
          width
        )}
      >
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

export function EmptyState({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-14 text-sm text-muted-foreground">
      {message}
    </div>
  )
}
