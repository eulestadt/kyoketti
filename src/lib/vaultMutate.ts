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

export function renameVaultNode(root: VaultNode, id: string, name: string): VaultNode {
  function walk(node: VaultNode, parentPath: string, isRoot: boolean): VaultNode {
    const nextName = node.id === id ? name : node.name
    const path = isRoot ? '' : parentPath ? `${parentPath}/${nextName}` : nextName
    const children = node.children?.map((c) => walk(c, path, false))
    return { ...node, name: nextName, path, children }
  }
  return walk(root, '', true)
}
