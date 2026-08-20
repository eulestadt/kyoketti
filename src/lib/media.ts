const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i

export function isImageFileName(name: string): boolean {
  return IMAGE_EXT.test(name.trim())
}

export function isImageUrl(value: string): boolean {
  const trimmed = value.trim()
  if (/^(data:image\/|blob:)/i.test(trimmed)) return true
  if (!/^https?:\/\//i.test(trimmed)) return false
  try {
    const url = new URL(trimmed)
    if (IMAGE_EXT.test(url.pathname)) return true
    return /[?&](format|fm)=(png|jpe?g|gif|webp|svg)/i.test(url.search)
  } catch {
    return false
  }
}

/** Vault path, data URL, or http(s) image used as a canvas file/link card. */
export function isCanvasImageRef(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (isImageFileName(trimmed) || isImageUrl(trimmed)) return true
  return /^(https?:\/\/|data:image\/|blob:)/i.test(trimmed)
}

export function blobFromBytes(bytes: Uint8Array, type = 'application/octet-stream'): Blob {
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return new Blob([copy], { type })
}

export function mimeForImageName(name: string): string {
  const ext = name.trim().toLowerCase().split('.').pop()
  switch (ext) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'svg':
      return 'image/svg+xml'
    case 'bmp':
      return 'image/bmp'
    case 'ico':
      return 'image/x-icon'
    case 'avif':
      return 'image/avif'
    default:
      return 'application/octet-stream'
  }
}

export function extensionForImageMime(mime: string): string {
  const type = mime.toLowerCase().split(';')[0]?.trim() ?? ''
  switch (type) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/svg+xml':
      return 'svg'
    case 'image/x-icon':
    case 'image/vnd.microsoft.icon':
      return 'ico'
    default:
      if (type.startsWith('image/')) return type.slice('image/'.length)
      return 'png'
  }
}

export function attachmentFileName(original?: string, mime?: string): string {
  const raw = original?.trim() || ''
  if (raw && isImageFileName(raw)) return raw.replace(/[\\/]/g, '-')
  const ext = extensionForImageMime(mime || 'image/png')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `Pasted image ${stamp}.${ext}`
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'))
    reader.readAsDataURL(blob)
  })
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl)
  return res.blob()
}
