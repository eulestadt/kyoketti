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

export function collectFolderIds(root: VaultNode | null | undefined): string[] {
  if (!root) return []
  const ids: string[] = []
  function walk(node: VaultNode) {
    if (node.isFolder) ids.push(node.id)
    for (const child of node.children ?? []) walk(child)
  }
  walk(root)
  return ids
}

export function ancestorIds(root: VaultNode | null | undefined, id: string): string[] {
  if (!root) return []
  function walk(node: VaultNode, trail: string[]): string[] | null {
    if (node.id === id) return trail
    for (const child of node.children ?? []) {
      const hit = walk(child, [...trail, node.id])
      if (hit) return hit
    }
    return null
  }
  return walk(root, []) ?? []
}

export function isInsideVaultNode(
  root: VaultNode | null | undefined,
  ancestorId: string,
  nodeId: string,
): boolean {
  if (!root || ancestorId === nodeId) return true
  return ancestorIds(root, nodeId).includes(ancestorId)
}

export function uniqueAvailableName(name: string, existing: string[]): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()))
  if (!taken.has(name.toLowerCase())) return name
  const match = name.match(/^(.*?)(\.(md|markdown|base|canvas|png|jpe?g|gif|webp|svg|bmp|ico|avif))?$/i)
  const stem = match?.[1] || name
  const ext = match?.[2] ?? ''
  let n = 2
  let candidate = `${stem} ${n}${ext}`
  while (taken.has(candidate.toLowerCase())) {
    n += 1
    candidate = `${stem} ${n}${ext}`
  }
  return candidate
}

export function uniqueCopyName(name: string, existing: string[]): string {
  const match = name.match(/^(.*?)(\.(md|markdown|base|canvas|png|jpe?g|gif|webp|svg|bmp|ico|avif))?$/i)
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

export function collectVaultNodes(
  root: VaultNode | null | undefined,
  pred: (node: VaultNode) => boolean,
): VaultNode[] {
  if (!root) return []
  const out: VaultNode[] = []
  function walk(node: VaultNode) {
    if (pred(node)) out.push(node)
    for (const child of node.children ?? []) walk(child)
  }
  walk(root)
  return out
}

export function findVaultNodeByPath(root: VaultNode | null | undefined, path: string): VaultNode | null {
  if (!root) return null
  const want = path.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
  function walk(node: VaultNode): VaultNode | null {
    const full = (node.path || node.name).replace(/\\/g, '/').toLowerCase()
    if (full === want || node.name.toLowerCase() === want) return node
    for (const child of node.children ?? []) {
      const hit = walk(child)
      if (hit) return hit
    }
    return null
  }
  return walk(root)
}
