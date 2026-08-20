import { displayNoteName } from './noteNames'
import type { VaultIndex } from './vaultIndex'

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
}

/** Wikilink using the shortest unique path, matching Obsidian. */
export function wikilinkFor(name: string, path?: string, index?: VaultIndex): string {
  const title = displayNoteName(name)
  if (path && index) {
    const matches = [...index.notesById.values()].filter(
      (n) => n.title.toLowerCase() === title.toLowerCase(),
    )
    if (matches.length > 1) return `[[${displayNoteName(path)}]]`
  }
  return `[[${title}]]`
}

export async function copyWikilink(name: string, path?: string, index?: VaultIndex): Promise<void> {
  await copyText(wikilinkFor(name, path, index))
}

export async function copyPath(path: string): Promise<void> {
  await copyText(path)
}

export async function copyImageElement(img: HTMLImageElement): Promise<void> {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth || img.width
    canvas.height = img.naturalHeight || img.height
    const ctx = canvas.getContext('2d')
    if (!ctx || !canvas.width || !canvas.height) throw new Error('empty image')
    ctx.drawImage(img, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('toBlob failed')
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  } catch {
    await copyText(img.currentSrc || img.src)
  }
}
