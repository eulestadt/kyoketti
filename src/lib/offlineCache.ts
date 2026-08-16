import type { VaultConfig, VaultNode } from '../types'

const DB_NAME = 'kyoketti-offline'
const DB_VERSION = 1
const META = 'meta'
const QUEUE = 'queue'

export type OfflineKind = 'google' | 'github' | 'local' | 'demo'

export type OfflineIdentity = {
  kind: OfflineKind
  email?: string
  name?: string
  picture?: string
  githubScopes?: string
}

export type OfflineFileRecord = {
  id: string
  name: string
  path: string
  mimeType: string
  content: string
  modifiedTime?: string
}

export type OfflineSnapshot = {
  identity: OfflineIdentity
  vault: VaultConfig
  tree: VaultNode
  files: OfflineFileRecord[]
  savedAt: number
}

export type MutationOp =
  | { type: 'write'; fileId: string; content: string }
  | {
      type: 'create'
      tempId: string
      parentId: string
      name: string
      content: string
      kind: 'note' | 'base' | 'canvas'
    }
  | { type: 'mkdir'; tempId: string; parentId: string; name: string }
  | { type: 'rename'; fileId: string; name: string }
  | { type: 'delete'; fileId: string }

export type QueuedMutation = {
  id: string
  createdAt: number
  op: MutationOp
}

export type OfflineResumeInfo = {
  folderName: string
  kind: OfflineKind
  email?: string
  name?: string
}

const SNAPSHOT_KEY = 'snapshot'

export function newPendingId(): string {
  return `pending:${crypto.randomUUID()}`
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META)
      if (!db.objectStoreNames.contains(QUEUE)) db.createObjectStore(QUEUE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Failed to open offline database'))
  })
}

function reqAs<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

export async function saveSnapshot(snapshot: OfflineSnapshot): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(META, 'readwrite')
  tx.objectStore(META).put(snapshot, SNAPSHOT_KEY)
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to save offline snapshot'))
  })
}

export async function loadSnapshot(): Promise<OfflineSnapshot | null> {
  try {
    const db = await openDb()
    const tx = db.transaction(META, 'readonly')
    const value = await reqAs<OfflineSnapshot | undefined>(tx.objectStore(META).get(SNAPSHOT_KEY))
    if (!value?.vault || !value.tree || !Array.isArray(value.files)) return null
    return value
  } catch {
    return null
  }
}

export async function peekOfflineResume(): Promise<OfflineResumeInfo | null> {
  const snapshot = await loadSnapshot()
  if (!snapshot) return null
  return {
    folderName: snapshot.vault.folderName,
    kind: snapshot.identity.kind,
    email: snapshot.identity.email,
    name: snapshot.identity.name,
  }
}

export async function getQueue(): Promise<QueuedMutation[]> {
  try {
    const db = await openDb()
    const tx = db.transaction(QUEUE, 'readonly')
    const rows = await reqAs<QueuedMutation[]>(tx.objectStore(QUEUE).getAll())
    return rows.sort((a, b) => a.createdAt - b.createdAt)
  } catch {
    return []
  }
}

export async function setQueue(queue: QueuedMutation[]): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(QUEUE, 'readwrite')
  const store = tx.objectStore(QUEUE)
  store.clear()
  for (const item of queue) store.put(item)
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to save offline queue'))
  })
}

function newQueueItem(op: MutationOp): QueuedMutation {
  return {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    op,
  }
}

export function coalesceQueue(queue: QueuedMutation[], op: MutationOp): QueuedMutation[] {
  if (op.type === 'write') {
    for (let i = queue.length - 1; i >= 0; i--) {
      const cur = queue[i]!.op
      if (cur.type === 'create' && cur.tempId === op.fileId) {
        const next = [...queue]
        next[i] = { ...queue[i]!, op: { ...cur, content: op.content } }
        return next
      }
    }
    const writeAt = queue.findIndex((q) => q.op.type === 'write' && q.op.fileId === op.fileId)
    if (writeAt >= 0) {
      const next = [...queue]
      next[writeAt] = { ...queue[writeAt]!, op }
      return next
    }
  }

  if (op.type === 'rename') {
    const createAt = queue.findIndex((q) => q.op.type === 'create' && q.op.tempId === op.fileId)
    if (createAt >= 0) {
      const cur = queue[createAt]!.op
      if (cur.type === 'create') {
        const next = [...queue]
        next[createAt] = { ...queue[createAt]!, op: { ...cur, name: op.name } }
        return next
      }
    }
    const mkdirAt = queue.findIndex((q) => q.op.type === 'mkdir' && q.op.tempId === op.fileId)
    if (mkdirAt >= 0) {
      const cur = queue[mkdirAt]!.op
      if (cur.type === 'mkdir') {
        const next = [...queue]
        next[mkdirAt] = { ...queue[mkdirAt]!, op: { ...cur, name: op.name } }
        return next
      }
    }
  }

  if (op.type === 'delete') {
    const createdLocally = queue.some(
      (q) =>
        (q.op.type === 'create' && q.op.tempId === op.fileId) ||
        (q.op.type === 'mkdir' && q.op.tempId === op.fileId),
    )
    const filtered = queue.filter((q) => {
      if (q.op.type === 'create' && q.op.tempId === op.fileId) return false
      if (q.op.type === 'mkdir' && q.op.tempId === op.fileId) return false
      if (q.op.type === 'write' && q.op.fileId === op.fileId) return false
      if (q.op.type === 'rename' && q.op.fileId === op.fileId) return false
      return true
    })
    if (createdLocally) return filtered
    return [...filtered, newQueueItem(op)]
  }

  return [...queue, newQueueItem(op)]
}

export async function enqueueMutation(op: MutationOp): Promise<QueuedMutation[]> {
  const next = coalesceQueue(await getQueue(), op)
  await setQueue(next)
  return next
}

export function remapMutationIds(queue: QueuedMutation[], from: string, to: string): QueuedMutation[] {
  return queue.map((item) => {
    const op = item.op
    switch (op.type) {
      case 'write':
        return op.fileId === from ? { ...item, op: { ...op, fileId: to } } : item
      case 'create':
        return {
          ...item,
          op: {
            ...op,
            tempId: op.tempId === from ? to : op.tempId,
            parentId: op.parentId === from ? to : op.parentId,
          },
        }
      case 'mkdir':
        return {
          ...item,
          op: {
            ...op,
            tempId: op.tempId === from ? to : op.tempId,
            parentId: op.parentId === from ? to : op.parentId,
          },
        }
      case 'rename':
        return op.fileId === from ? { ...item, op: { ...op, fileId: to } } : item
      case 'delete':
        return op.fileId === from ? { ...item, op: { ...op, fileId: to } } : item
    }
  })
}

export async function clearOfflineData(): Promise<void> {
  try {
    const db = await openDb()
    const tx = db.transaction([META, QUEUE], 'readwrite')
    tx.objectStore(META).clear()
    tx.objectStore(QUEUE).clear()
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('Failed to clear offline data'))
    })
  } catch {
    /* ignore */
  }
}
