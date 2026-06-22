// Registers the Inter font on a jsPDF document so generated PDFs use a clean,
// modern typeface instead of the built-in Helvetica. The TTFs are emitted by
// Vite as cacheable assets and fetched once, then reused across documents.
import type { jsPDF } from 'jspdf'
import interRegularUrl from '@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf'
import interBoldUrl from '@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf'

let cache: { regular: string; bold: string } | null = null

async function fetchBase64(url: string): Promise<string> {
  const res = await fetch(url)
  const bytes = new Uint8Array(await res.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/**
 * Register "Inter" (normal + bold) on the given jsPDF document.
 * Returns the font family to use — 'Inter' on success, 'helvetica' if the font
 * could not be loaded (so the PDF still renders rather than failing).
 */
export async function registerInter(doc: jsPDF): Promise<string> {
  try {
    if (!cache) {
      const [regular, bold] = await Promise.all([
        fetchBase64(interRegularUrl),
        fetchBase64(interBoldUrl)
      ])
      cache = { regular, bold }
    }
    doc.addFileToVFS('Inter-Regular.ttf', cache.regular)
    doc.addFont('Inter-Regular.ttf', 'Inter', 'normal')
    doc.addFileToVFS('Inter-Bold.ttf', cache.bold)
    doc.addFont('Inter-Bold.ttf', 'Inter', 'bold')
    return 'Inter'
  } catch {
    return 'helvetica'
  }
}
