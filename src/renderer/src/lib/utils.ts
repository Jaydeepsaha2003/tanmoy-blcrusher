import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import * as XLSX from 'xlsx'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function fmtQty(n: number | null | undefined): string {
  if (n == null) return '0'
  const r = Math.round((n + Number.EPSILON) * 1000) / 1000
  return r.toLocaleString('en-IN', { maximumFractionDigits: 3 })
}

export function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '-'
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function fmtDate(s: string | null | undefined): string {
  if (!s) return '-'
  const d = s.slice(0, 10)
  const parts = d.split('-')
  if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`
  return d
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined): string => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n')
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// A column holds money when its header reads like a money figure and not like a
// quantity. Used to give every amount the same 2-decimal format across all exports.
const MONEY_HEADER =
  /amount|amt|paid|rate|charge|cost|debit|credit|balance|receivable|payable|earned|deduction|\bnet\b|premium|goods|invoice|transport|machine|salary|wage|profit|expense|sales|diesel|\bother\b|\bbill\b|₹/i
const QTY_HEADER =
  /m³|m3|\bqty\b|quantity|cft|\bton\b|litre|liter|\bhrs\b|hours?|\bdays?\b|trips?|meter|\bkm\b|\bunits?\b|carried|loaded|unloaded|\bsold\b|change|stock|opening|closing/i

function isMoneyHeader(h: string): boolean {
  return MONEY_HEADER.test(h) && !QTY_HEADER.test(h)
}

/**
 * Download a proper .xlsx workbook. Pass raw numbers (not formatted strings) for
 * numeric columns so Excel treats them as numbers. Column widths auto-fit, and
 * money columns (Amount, Rate, Paid, Debit, …) are shown with 2 decimals so every
 * exported file uses the same amount format.
 */
export function downloadExcel(
  filename: string,
  sheetName: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
  titleRows?: (string | number)[][]
): void {
  const body = rows.map((r) => r.map((c) => (c == null ? '' : c)))
  const title = titleRows ?? []
  // Title block (if any) → blank spacer → column headers → data rows.
  const aoa: (string | number)[][] = title.length
    ? [...title, [], headers, ...body]
    : [headers, ...body]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = headers.map((h, i) => {
    const widest = Math.max(
      String(h).length,
      ...body.map((r) => (r[i] == null ? 0 : String(r[i]).length))
    )
    return { wch: Math.min(Math.max(widest + 2, 10), 42) }
  })
  // Apply a 2-decimal number format to numeric cells in money columns. Text and
  // quantity cells are left untouched (only cells Excel parsed as numbers change).
  const headerRow = title.length ? title.length + 1 : 0
  headers.forEach((h, c) => {
    if (!isMoneyHeader(h)) return
    for (let r = headerRow + 1; r <= headerRow + body.length; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })] as { t?: string; z?: string } | undefined
      if (cell && cell.t === 'n') cell.z = '#,##0.00'
    }
  })
  ws['!freeze'] = { xSplit: 0, ySplit: title.length ? title.length + 2 : 1 } as never
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, (sheetName || 'Sheet1').slice(0, 31))
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`)
}
