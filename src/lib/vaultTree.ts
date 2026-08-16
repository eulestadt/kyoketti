import type { VaultNode } from '../types'

export function findVaultNode(root: VaultNode | null | undefined, id: string): VaultNode | null {
  if (!root) return null
  if (root.id === id) return root
  for (const child of root.children ?? []) {
    const found = findVaultNode(child, id)
    if (found) return found
  }
  return null
}

export function childNames(folder: VaultNode | null | undefined): string[] {
  return (folder?.children ?? []).map((c) => c.name)
}

export function uniqueCopyName(name: string, existing: string[]): string {
  const match = name.match(/^(.*?)(\.(md|markdown|base|canvas))?$/i)
  const stem = match?.[1] || name
  const ext = match?.[2] ?? ''
  const taken = new Set(existing.map((n) => n.toLowerCase()))
  let n = 1
  let candidate = `${stem} ${n}${ext}`
  while (taken.has(candidate.toLowerCase())) {
    n += 1
    candidate = `${stem} ${n}${ext}`
  }
  return candidate
}
