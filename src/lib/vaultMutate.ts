import type { VaultNode } from '../types'

function folderThenName(a: VaultNode, b: VaultNode): number {
  if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}

export function insertVaultChild(root: VaultNode, parentId: string, child: VaultNode): VaultNode {
  if (root.id === parentId) {
    const children = [...(root.children ?? []), child].sort(folderThenName)
    return { ...root, children }
  }
  if (!root.children) return root
  return { ...root, children: root.children.map((c) => insertVaultChild(c, parentId, child)) }
}

export function removeVaultNode(root: VaultNode, id: string): VaultNode {
  if (!root.children) return root
  return {
    ...root,
    children: root.children.filter((c) => c.id !== id).map((c) => removeVaultNode(c, id)),
  }
}

export function remapVaultId(root: VaultNode, from: string, to: string): VaultNode {
  const children = root.children?.map((c) => remapVaultId(c, from, to))
  return {
    ...root,
    id: root.id === from ? to : root.id,
    parentId: root.parentId === from ? to : root.parentId,
    children,
  }
}

function rebaseVaultPaths(node: VaultNode, parentPath: string, parentId: string | undefined): VaultNode {
  const path = parentPath ? `${parentPath}/${node.name}` : node.name
  return {
    ...node,
    path,
    parentId,
    children: node.children?.map((child) => rebaseVaultPaths(child, path, node.id)),
  }
}

export function moveVaultNode(root: VaultNode, id: string, newParentId: string): VaultNode {
  let extracted: VaultNode | null = null
  function strip(node: VaultNode): VaultNode {
    if (!node.children) return node
    const nextChildren: VaultNode[] = []
    for (const child of node.children) {
      if (child.id === id) extracted = child
      else nextChildren.push(strip(child))
    }
    return { ...node, children: nextChildren }
  }
  const stripped = strip(root)
  if (!extracted) return root
  function insert(node: VaultNode): VaultNode {
    if (node.id === newParentId) {
      const moved = rebaseVaultPaths(extracted!, node.path, node.id)
      const children = [...(node.children ?? []), moved].sort(folderThenName)
      return { ...node, children }
    }
    if (!node.children) return node
    return { ...node, children: node.children.map(insert) }
  }
  return insert(stripped)
}

export function renameVaultNode(root: VaultNode, id: string, name: string): VaultNode {
  function walk(node: VaultNode, parentPath: string, isRoot: boolean): VaultNode {
    const nextName = node.id === id ? name : node.name
    const path = isRoot ? '' : parentPath ? `${parentPath}/${nextName}` : nextName
    const children = node.children?.map((c) => walk(c, path, false))
    return { ...node, name: nextName, path, children }
  }
  return walk(root, '', true)
}
