import type { AuthSession, VaultConfig, VaultNode } from '../types'
import { noteFromFile, indexFromNotes, type VaultIndex } from './vaultIndex'
import type { OfflineFileRecord, OfflineIdentity, OfflineSnapshot } from './offlineCache'

export function mimeForVaultName(name: string): string {
  if (/\.base$/i.test(name)) return 'application/x-obsidian-base'
  if (/\.canvas$/i.test(name)) return 'application/x-obsidian-canvas'
  return 'text/markdown'
}

export function filesFromIndex(index: VaultIndex): OfflineFileRecord[] {
  return [...index.notesById.values()].map((note) => ({
    id: note.id,
    name: note.name,
    path: note.path,
    mimeType: mimeForVaultName(note.name),
    content: note.content,
    modifiedTime: note.modifiedTime,
  }))
}

export function indexFromSnapshotFiles(files: OfflineFileRecord[]): VaultIndex {
  return indexFromNotes(
    files.map((file) =>
      noteFromFile(
        {
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          modifiedTime: file.modifiedTime,
        },
        file.path,
        file.content,
      ),
    ),
  )
}

export function identityFromSession(
  kind: OfflineIdentity['kind'],
  session: AuthSession | null,
): OfflineIdentity {
  return {
    kind,
    email: session?.email,
    name: session?.name,
    picture: session?.picture,
    githubScopes: session?.githubScopes,
  }
}

export function sessionFromIdentity(identity: OfflineIdentity): AuthSession {
  const year = Date.now() + 1000 * 60 * 60 * 24 * 365
  if (identity.kind === 'demo') {
    return {
      accessToken: 'demo',
      expiresAt: year,
      email: identity.email ?? 'demo@local',
      name: identity.name ?? 'Demo User',
    }
  }
  if (identity.kind === 'local') {
    return {
      accessToken: 'local',
      expiresAt: year,
      email: 'local@device',
      name: 'Local vault',
    }
  }
  return {
    accessToken: '',
    expiresAt: 0,
    email: identity.email,
    name: identity.name,
    picture: identity.picture,
    provider: identity.kind,
    githubScopes: identity.githubScopes,
  }
}

export function pathForNewChild(
  tree: VaultNode | null,
  vaultFolderId: string,
  parentId: string,
  fileName: string,
): string {
  if (parentId === vaultFolderId) return fileName
  function find(node: VaultNode | null): string | null {
    if (!node) return null
    if (node.id === parentId) return node.path
    for (const child of node.children ?? []) {
      const hit = find(child)
      if (hit != null) return hit
    }
    return null
  }
  const parentPath = find(tree) ?? ''
  return parentPath ? `${parentPath}/${fileName}` : fileName
}

export function buildSnapshot(args: {
  identity: OfflineIdentity
  vault: VaultConfig
  tree: VaultNode
  index: VaultIndex
}): OfflineSnapshot {
  return {
    identity: args.identity,
    vault: args.vault,
    tree: args.tree,
    files: filesFromIndex(args.index),
    savedAt: Date.now(),
  }
}

export function seedContentCache(
  cache: Map<string, string>,
  files: OfflineFileRecord[],
): void {
  cache.clear()
  for (const file of files) cache.set(file.id, file.content)
}
