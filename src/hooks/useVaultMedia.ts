import { useEffect, useState } from 'react'
import { useApp } from './useApp'
import { isImageUrl } from '../lib/media'
import { findVaultNodeByPath } from '../lib/vaultTree'

export function useVaultMediaSrc(ref: string | undefined): string | null {
  const { tree, readFileBlob } = useApp()
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    if (!ref?.trim()) {
      setSrc(null)
      return
    }
    const value = ref.trim()
    if (isImageUrl(value) || /^(https?:|data:|blob:)/i.test(value)) {
      setSrc(value)
      return
    }

    const node = findVaultNodeByPath(tree, value)
    if (!node || node.isFolder) {
      setSrc(null)
      return
    }

    let objectUrl: string | null = null
    let cancelled = false
    void readFileBlob(node.id)
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
      })
      .catch(() => {
        if (!cancelled) setSrc(null)
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [ref, tree, readFileBlob])

  return src
}
