import type { DriveFile, VaultNode } from '../types'

const MODE_KEY = 'kyoketti.local'
const DB_NAME = 'kyoketti-local'
const STORE = 'handles'
const HANDLE_KEY = 'vault-root'

const FOLDER_MIME = 'application/vnd.google-apps.folder'
export const LOCAL_ROOT_ID = 'local-root'

type FileSystemPermissionMode = 'read' | 'readwrite'

type FileSystemHandlePermissionDescriptor = {
  mode?: FileSystemPermissionMode
}

type LocalDirectoryHandle = FileSystemDirectoryHandle & {
  entries?: () => AsyncIterableIterator<[string, FileSystemHandle]>
  keys?: () => AsyncIterableIterator<string>
  values?: () => AsyncIterableIterator<FileSystemHandle>
  getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<FileSystemDirectoryHandle>
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<FileSystemFileHandle>
  removeEntry: (name: string, options?: { recursive?: boolean }) => Promise<void>
  queryPermission?: (descriptor?: FileSystemHandlePermissionDescriptor) => Promise<PermissionState>
  requestPermission?: (descriptor?: FileSystemHandlePermissionDescriptor) => Promise<PermissionState>
}

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      id?: string
      mode?: FileSystemPermissionMode
      startIn?: FileSystemHandle | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos'
    }) => Promise<LocalDirectoryHandle>
  }
}

let rootHandle: LocalDirectoryHandle | null = null
/** Maps local ids to relative paths from vault root ('' for root). */
const idToPath = new Map<string, string>([[LOCAL_ROOT_ID, '']])
/** Maps relative paths to ids. */
const pathToId = new Map<string, string>([['', LOCAL_ROOT_ID]])

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'))
  })
}

async function idbGet(key: string): Promise<LocalDirectoryHandle | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(key)
    req.onsuccess = () => resolve((req.result as LocalDirectoryHandle | undefined) ?? null)
    req.onerror = () => reject(req.error ?? new Error('Failed to read local vault handle'))
  })
}

async function idbSet(key: string, value: LocalDirectoryHandle): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to store local vault handle'))
  })
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to clear local vault handle'))
  })
}

export function isLocalFolderSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

export function isLocalMode(): boolean {
  return localStorage.getItem(MODE_KEY) === '1'
}

export function enableLocalMode() {
  localStorage.setItem(MODE_KEY, '1')
}

export function disableLocalMode() {
  localStorage.removeItem(MODE_KEY)
}

export function getLocalRootHandle(): LocalDirectoryHandle | null {
  return rootHandle
}

function resetMaps(rootName = 'Local Vault') {
  idToPath.clear()
  pathToId.clear()
  idToPath.set(LOCAL_ROOT_ID, '')
  pathToId.set('', LOCAL_ROOT_ID)
  void rootName
}

function ensureIdForPath(relPath: string): string {
  const existing = pathToId.get(relPath)
  if (existing) return existing
  const id = relPath === '' ? LOCAL_ROOT_ID : `local:${relPath}`
  pathToId.set(relPath, id)
  idToPath.set(id, relPath)
  return id
}

function pathOf(id: string): string {
  const path = idToPath.get(id)
  if (path == null) throw new Error('Unknown local file')
  return path
}

async function ensurePermission(handle: LocalDirectoryHandle, request = false): Promise<boolean> {
  const opts: FileSystemHandlePermissionDescriptor = { mode: 'readwrite' }
  if (handle.queryPermission) {
    const state = await handle.queryPermission(opts)
    if (state === 'granted') return true
  }
  if (request && handle.requestPermission) {
    const next = await handle.requestPermission(opts)
    return next === 'granted'
  }
  return false
}

async function resolveDirectory(relPath: string): Promise<LocalDirectoryHandle> {
  if (!rootHandle) throw new Error('No local vault open')
  if (!relPath) return rootHandle
  const parts = relPath.split('/').filter(Boolean)
  let current: LocalDirectoryHandle = rootHandle
  for (const part of parts) {
    current = (await current.getDirectoryHandle(part)) as LocalDirectoryHandle
  }
  return current
}

async function resolveParent(relPath: string): Promise<{ parent: LocalDirectoryHandle; name: string }> {
  if (!relPath) throw new Error('Cannot resolve parent of vault root')
  const parts = relPath.split('/').filter(Boolean)
  const name = parts.pop()!
  const parentPath = parts.join('/')
  const parent = await resolveDirectory(parentPath)
  return { parent, name }
}

export async function pickLocalVaultFolder(): Promise<{ folderId: string; folderName: string }> {
  if (!isLocalFolderSupported()) {
    throw new Error('Local folders need Chrome or Edge on desktop. Safari and Firefox do not support folder access yet.')
  }
  const handle = await window.showDirectoryPicker!({
    id: 'kyoketti-vault',
    mode: 'readwrite',
  })
  const granted = await ensurePermission(handle, true)
  if (!granted) throw new Error('Permission to the folder was denied')
  rootHandle = handle
  resetMaps(handle.name)
  await idbSet(HANDLE_KEY, handle)
  enableLocalMode()
  return { folderId: LOCAL_ROOT_ID, folderName: handle.name || 'Local Vault' }
}

export async function restoreLocalVault(): Promise<{ folderId: string; folderName: string } | null> {
  if (!isLocalMode()) return null
  const handle = await idbGet(HANDLE_KEY)
  if (!handle) {
    disableLocalMode()
    return null
  }
  const granted = await ensurePermission(handle, false)
  if (!granted) {
    // Permission may need a user gesture; keep mode so UI can prompt reconnect.
    rootHandle = handle
    resetMaps(handle.name)
    return { folderId: LOCAL_ROOT_ID, folderName: handle.name || 'Local Vault' }
  }
  rootHandle = handle
  resetMaps(handle.name)
  return { folderId: LOCAL_ROOT_ID, folderName: handle.name || 'Local Vault' }
}

export async function requestLocalVaultPermission(): Promise<boolean> {
  if (!rootHandle) {
    const handle = await idbGet(HANDLE_KEY)
    if (!handle) return false
    rootHandle = handle
  }
  return ensurePermission(rootHandle, true)
}

export async function clearLocalVault(): Promise<void> {
  rootHandle = null
  resetMaps()
  disableLocalMode()
  await idbDelete(HANDLE_KEY)
}

function isMarkdownName(name: string): boolean {
  return /\.(md|markdown)$/i.test(name)
}

function isVaultTextName(name: string): boolean {
  return isMarkdownName(name) || /\.base$/i.test(name) || /\.canvas$/i.test(name)
}

function mimeForVaultFile(name: string): string {
  if (/\.base$/i.test(name)) return 'application/x-obsidian-base'
  if (/\.canvas$/i.test(name)) return 'application/x-obsidian-canvas'
  return 'text/markdown'
}

function shouldSkipDir(name: string): boolean {
  return name === '.obsidian' || name === '.git' || name === 'node_modules' || name.startsWith('.')
}

async function listChildren(dir: LocalDirectoryHandle): Promise<Array<[string, FileSystemHandle]>> {
  const out: Array<[string, FileSystemHandle]> = []
  if (typeof dir.entries === 'function') {
    for await (const entry of dir.entries()) out.push(entry)
    return out
  }
  for await (const [name, handle] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
    out.push([name, handle])
  }
  return out
}

export async function localListVault(folderName: string): Promise<{ root: VaultNode; files: DriveFile[] }> {
  if (!rootHandle) throw new Error('No local vault open')
  const granted = await ensurePermission(rootHandle, false)
  if (!granted) throw new Error('Local vault permission needed — click Continue with Local again to re-authorize')

  resetMaps(folderName)
  const files: DriveFile[] = []

  async function walk(
    dir: LocalDirectoryHandle,
    parentId: string,
    parentPath: string,
  ): Promise<VaultNode[]> {
    const children: VaultNode[] = []
    const entries = await listChildren(dir)
    entries.sort(([a], [b]) => a.localeCompare(b))

    for (const [name, handle] of entries) {
      if (handle.kind === 'directory') {
        if (shouldSkipDir(name)) continue
        const relPath = parentPath ? `${parentPath}/${name}` : name
        const id = ensureIdForPath(relPath)
        const childDir = handle as LocalDirectoryHandle
        const nested = await walk(childDir, id, relPath)
        children.push({
          id,
          name,
          path: relPath,
          mimeType: FOLDER_MIME,
          isFolder: true,
          parentId,
          children: nested,
        })
        files.push({
          id,
          name,
          mimeType: FOLDER_MIME,
          parents: [parentId],
          modifiedTime: new Date().toISOString(),
        })
      } else if (handle.kind === 'file' && isVaultTextName(name)) {
        const relPath = parentPath ? `${parentPath}/${name}` : name
        const id = ensureIdForPath(relPath)
        let modifiedTime = new Date().toISOString()
        let size: string | undefined
        try {
          const file = await (handle as FileSystemFileHandle).getFile()
          modifiedTime = new Date(file.lastModified).toISOString()
          size = String(file.size)
        } catch {
          /* ignore */
        }
        const mimeType = mimeForVaultFile(name)
        children.push({
          id,
          name,
          path: relPath,
          mimeType,
          isFolder: false,
          parentId,
        })
        files.push({
          id,
          name,
          mimeType,
          parents: [parentId],
          modifiedTime,
          size,
        })
      }
    }

    return children.sort((a, b) => Number(b.isFolder) - Number(a.isFolder) || a.name.localeCompare(b.name))
  }

  const rootChildren = await walk(rootHandle, LOCAL_ROOT_ID, '')
  const root: VaultNode = {
    id: LOCAL_ROOT_ID,
    name: folderName,
    path: '',
    mimeType: FOLDER_MIME,
    isFolder: true,
    children: rootChildren,
  }

  return { root, files }
}

export async function localRead(id: string): Promise<string> {
  const relPath = pathOf(id)
  if (!relPath) throw new Error('Cannot read vault root')
  const { parent, name } = await resolveParent(relPath)
  const fileHandle = await parent.getFileHandle(name)
  const file = await fileHandle.getFile()
  return file.text()
}

export async function localWrite(id: string, content: string): Promise<void> {
  const relPath = pathOf(id)
  const { parent, name } = await resolveParent(relPath)
  const fileHandle = await parent.getFileHandle(name, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(content)
  await writable.close()
}

export async function localCreateNote(parentId: string, name: string, content: string): Promise<DriveFile> {
  const parentPath = pathOf(parentId)
  const parent = await resolveDirectory(parentPath)
  const fileName = /\.base$/i.test(name) || /\.canvas$/i.test(name)
    ? name
    : name.endsWith('.md')
      ? name
      : `${name}.md`
  const fileHandle = await parent.getFileHandle(fileName, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(content)
  await writable.close()
  const relPath = parentPath ? `${parentPath}/${fileName}` : fileName
  const id = ensureIdForPath(relPath)
  return { id, name: fileName, mimeType: mimeForVaultFile(fileName), parents: [parentId] }
}

export async function localCreateFolder(parentId: string, name: string): Promise<DriveFile> {
  const parentPath = pathOf(parentId)
  const parent = await resolveDirectory(parentPath)
  await parent.getDirectoryHandle(name, { create: true })
  const relPath = parentPath ? `${parentPath}/${name}` : name
  const id = ensureIdForPath(relPath)
  return { id, name, mimeType: FOLDER_MIME, parents: [parentId] }
}

export async function localRename(id: string, name: string): Promise<void> {
  const relPath = pathOf(id)
  if (!relPath) throw new Error('Cannot rename vault root')
  const { parent, name: oldName } = await resolveParent(relPath)
  const parts = relPath.split('/')
  parts[parts.length - 1] = name
  const nextPath = parts.join('/')

  // Prefer native move when available.
  const anyParent = parent as LocalDirectoryHandle & {
    getFileHandle: LocalDirectoryHandle['getFileHandle']
    getDirectoryHandle: LocalDirectoryHandle['getDirectoryHandle']
  }

  try {
    const fileHandle = await anyParent.getFileHandle(oldName)
    // @ts-expect-error move() is available in Chromium File System Access
    if (typeof fileHandle.move === 'function') {
      // @ts-expect-error Chromium FileSystemFileHandle.move
      await fileHandle.move(name)
      pathToId.delete(relPath)
      idToPath.set(id, nextPath)
      pathToId.set(nextPath, id)
      return
    }
  } catch {
    /* maybe directory */
  }

  try {
    const dirHandle = await anyParent.getDirectoryHandle(oldName)
    // @ts-expect-error move() is available in Chromium File System Access
    if (typeof dirHandle.move === 'function') {
      // @ts-expect-error Chromium FileSystemDirectoryHandle.move
      await dirHandle.move(name)
      pathToId.delete(relPath)
      idToPath.set(id, nextPath)
      pathToId.set(nextPath, id)
      return
    }
  } catch {
    /* fall through */
  }

  // Fallback for files: copy + delete
  try {
    const fileHandle = await parent.getFileHandle(oldName)
    const file = await fileHandle.getFile()
    const text = await file.text()
    const next = await parent.getFileHandle(name, { create: true })
    const writable = await next.createWritable()
    await writable.write(text)
    await writable.close()
    await parent.removeEntry(oldName)
    pathToId.delete(relPath)
    idToPath.set(id, nextPath)
    pathToId.set(nextPath, id)
    return
  } catch {
    throw new Error('Rename is not supported for this folder in your browser')
  }
}

export async function localTrash(id: string): Promise<void> {
  const relPath = pathOf(id)
  if (!relPath) throw new Error('Cannot delete vault root')
  const { parent, name } = await resolveParent(relPath)
  let recursive = false
  try {
    await parent.getDirectoryHandle(name)
    recursive = true
  } catch {
    recursive = false
  }
  await parent.removeEntry(name, recursive ? { recursive: true } : undefined)
  // Drop path maps for this node and descendants
  for (const [path, mappedId] of [...pathToId.entries()]) {
    if (path === relPath || path.startsWith(`${relPath}/`)) {
      pathToId.delete(path)
      idToPath.delete(mappedId)
    }
  }
}
