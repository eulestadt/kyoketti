import type { DriveFile, VaultNode } from '../types'

const DRIVE_API = 'https://www.googleapis.com/drive/v3'

export class DriveError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function driveFetch<T>(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${DRIVE_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new DriveError(text || res.statusText, res.status)
  }

  if (res.status === 204) return undefined as T
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return (await res.json()) as T
  }
  return (await res.text()) as T
}

export async function listFolderChildren(
  accessToken: string,
  folderId: string,
): Promise<DriveFile[]> {
  const q = `'${folderId}' in parents and trashed = false`
  const fields = 'nextPageToken,files(id,name,mimeType,parents,modifiedTime,size)'
  const files: DriveFile[] = []
  let pageToken: string | undefined

  do {
    const params = new URLSearchParams({
      q,
      fields,
      pageSize: '1000',
      spaces: 'drive',
      orderBy: 'folder,name_natural',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    })
    if (pageToken) params.set('pageToken', pageToken)
    const data = await driveFetch<{ files?: DriveFile[]; nextPageToken?: string }>(
      accessToken,
      `/files?${params}`,
    )
    files.push(...(data.files ?? []))
    pageToken = data.nextPageToken
  } while (pageToken)

  return files
}

export async function listVaultTree(
  accessToken: string,
  rootFolderId: string,
  rootName = 'Vault',
): Promise<{ root: VaultNode; files: DriveFile[] }> {
  const allFiles: DriveFile[] = []
  const queue: Array<{ id: string; path: string }> = [{ id: rootFolderId, path: '' }]
  const childrenByParent = new Map<string, DriveFile[]>()

  while (queue.length) {
    const current = queue.shift()!
    const children = await listFolderChildren(accessToken, current.id)
    childrenByParent.set(current.id, children)
    for (const child of children) {
      allFiles.push(child)
      if (child.mimeType === 'application/vnd.google-apps.folder') {
        const childPath = current.path ? `${current.path}/${child.name}` : child.name
        queue.push({ id: child.id, path: childPath })
      }
    }
  }

  function buildNode(id: string, name: string, path: string, mimeType: string, parentId?: string): VaultNode {
    const isFolder = mimeType === 'application/vnd.google-apps.folder' || id === rootFolderId
    const children = (childrenByParent.get(id) ?? [])
      .map((file) => {
        const childPath = path ? `${path}/${file.name}` : file.name
        return buildNode(file.id, file.name, childPath, file.mimeType, id)
      })
      .sort((a, b) => {
        if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      })

    return {
      id,
      name,
      path,
      mimeType,
      isFolder,
      parentId,
      children: isFolder ? children : undefined,
    }
  }

  return {
    root: buildNode(rootFolderId, rootName, '', 'application/vnd.google-apps.folder'),
    files: allFiles,
  }
}

export async function getFileMetadata(accessToken: string, fileId: string): Promise<DriveFile> {
  return driveFetch<DriveFile>(
    accessToken,
    `/files/${fileId}?fields=id,name,mimeType,parents,modifiedTime,size&supportsAllDrives=true`,
  )
}

export async function downloadTextFile(accessToken: string, fileId: string): Promise<string> {
  const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    throw new DriveError(await res.text(), res.status)
  }
  return res.text()
}

export async function updateTextFile(
  accessToken: string,
  fileId: string,
  content: string,
): Promise<DriveFile> {
  const res = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&supportsAllDrives=true&fields=id,name,mimeType,parents,modifiedTime,size`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'text/markdown; charset=UTF-8',
      },
      body: content,
    },
  )
  if (!res.ok) throw new DriveError(await res.text(), res.status)
  return res.json() as Promise<DriveFile>
}

export async function createMarkdownFile(
  accessToken: string,
  parentId: string,
  name: string,
  content = '',
): Promise<DriveFile> {
  const boundary = 'kyoketti_boundary'
  const meta = JSON.stringify({
    name: name.endsWith('.md') ? name : `${name}.md`,
    mimeType: 'text/markdown',
    parents: [parentId],
  })
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    meta,
    `--${boundary}`,
    'Content-Type: text/markdown; charset=UTF-8',
    '',
    content,
    `--${boundary}--`,
    '',
  ].join('\r\n')

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,parents,modifiedTime,size',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  )
  if (!res.ok) throw new DriveError(await res.text(), res.status)
  return res.json() as Promise<DriveFile>
}

export async function createFolder(
  accessToken: string,
  parentId: string,
  name: string,
): Promise<DriveFile> {
  return driveFetch<DriveFile>(accessToken, '/files?supportsAllDrives=true&fields=id,name,mimeType,parents,modifiedTime', {
    method: 'POST',
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    }),
  })
}

export async function renameFile(
  accessToken: string,
  fileId: string,
  name: string,
): Promise<DriveFile> {
  return driveFetch<DriveFile>(
    accessToken,
    `/files/${fileId}?supportsAllDrives=true&fields=id,name,mimeType,parents,modifiedTime,size`,
    {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    },
  )
}

export async function trashFile(accessToken: string, fileId: string): Promise<void> {
  await driveFetch(accessToken, `/files/${fileId}?supportsAllDrives=true`, {
    method: 'PATCH',
    body: JSON.stringify({ trashed: true }),
  })
}

export async function searchFolders(accessToken: string, query: string): Promise<DriveFile[]> {
  const escaped = query.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  const q = `mimeType = 'application/vnd.google-apps.folder' and name contains '${escaped}' and trashed = false`
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,mimeType,parents,modifiedTime)',
    pageSize: '25',
    spaces: 'drive',
  })
  const data = await driveFetch<{ files?: DriveFile[] }>(accessToken, `/files?${params}`)
  return data.files ?? []
}

export function isMarkdownFile(file: Pick<DriveFile, 'name' | 'mimeType'>): boolean {
  return (
    file.name.toLowerCase().endsWith('.md') ||
    file.name.toLowerCase().endsWith('.markdown') ||
    file.mimeType === 'text/markdown' ||
    file.mimeType === 'text/x-markdown'
  )
}

export function isBaseFile(file: Pick<DriveFile, 'name' | 'mimeType'>): boolean {
  return (
    file.name.toLowerCase().endsWith('.base') ||
    file.mimeType === 'application/x-obsidian-base'
  )
}

export function isCanvasFile(file: Pick<DriveFile, 'name' | 'mimeType'>): boolean {
  return (
    file.name.toLowerCase().endsWith('.canvas') ||
    file.mimeType === 'application/x-obsidian-canvas'
  )
}

/** Markdown notes + Bases + Canvas configs indexed as vault text. */
export function isVaultTextFile(file: Pick<DriveFile, 'name' | 'mimeType'>): boolean {
  return isMarkdownFile(file) || isBaseFile(file) || isCanvasFile(file)
}

export async function createTextFile(
  accessToken: string,
  parentId: string,
  name: string,
  content = '',
  mimeType = 'text/plain',
): Promise<DriveFile> {
  const boundary = 'kyoketti_boundary'
  const meta = JSON.stringify({
    name,
    mimeType,
    parents: [parentId],
  })
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    meta,
    `--${boundary}`,
    `Content-Type: ${mimeType}; charset=UTF-8`,
    '',
    content,
    `--${boundary}--`,
    '',
  ].join('\r\n')

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,parents,modifiedTime,size',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  )
  if (!res.ok) throw new DriveError(await res.text(), res.status)
  return res.json() as Promise<DriveFile>
}
