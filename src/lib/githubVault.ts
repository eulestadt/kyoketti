import type { DriveFile, VaultNode } from '../types'

const API = 'https://api.github.com'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const MD_MIME = 'text/markdown'

export class GithubError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export type GithubRepo = {
  id: number
  full_name: string
  name: string
  private: boolean
  description: string | null
  default_branch: string
  html_url: string
  updated_at: string
}

function parseRepoId(folderId: string): { owner: string; repo: string } {
  const [owner, repo, ...rest] = folderId.split('/')
  if (!owner || !repo || rest.length) {
    throw new GithubError(`Invalid GitHub vault id: ${folderId}`, 400)
  }
  return { owner, repo }
}

function pathId(repoId: string, path: string): string {
  return path ? `${repoId}:${path}` : repoId
}

function parsePathId(fileId: string, repoId: string): string {
  if (fileId === repoId) return ''
  const prefix = `${repoId}:`
  if (fileId.startsWith(prefix)) return fileId.slice(prefix.length)
  return fileId
}

function contentsPath(path: string): string {
  return path
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
}

async function ghFetch<T>(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Kyoketti',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const text = await res.text()
    let message = text || res.statusText
    try {
      const json = JSON.parse(text) as { message?: string }
      if (json.message) message = json.message
    } catch {
      /* ignore */
    }
    throw new GithubError(message, res.status)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function fromBase64(content: string): string {
  const normalized = content.replace(/\n/g, '')
  const binary = atob(normalized)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

export async function listGithubRepos(
  accessToken: string,
  query = '',
): Promise<GithubRepo[]> {
  const q = query.trim()
  if (q) {
    const params = new URLSearchParams({
      q: `${q} in:name fork:true`,
      per_page: '30',
      sort: 'updated',
    })
    const data = await ghFetch<{ items?: GithubRepo[] }>(
      accessToken,
      `/search/repositories?${params}`,
    )
    return data.items ?? []
  }

  const repos: GithubRepo[] = []
  let page = 1
  while (page <= 5) {
    const batch = await ghFetch<GithubRepo[]>(
      accessToken,
      `/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
    )
    repos.push(...batch)
    if (batch.length < 100) break
    page += 1
  }
  return repos
}

const DEFAULT_GITIGNORE = `# App state (keep notes; skip local workspace noise)
.obsidian/workspace.json
.obsidian/workspace-mobile.json
.obsidian/graph.json
.trash/
.DS_Store
`

const WELCOME_NOTE = `# Welcome

This is a GitHub-backed vault in Kyoketti.

- Notes are markdown files in this private repository
- Each save creates a Git commit
- You can clone the same repo in any markdown editor

Happy writing.
`

export async function createGithubVaultRepo(
  accessToken: string,
  name: string,
): Promise<GithubRepo> {
  const repo = await ghFetch<GithubRepo>(accessToken, '/user/repos', {
    method: 'POST',
    body: JSON.stringify({
      name,
      private: true,
      description: 'Markdown vault (Kyoketti)',
      auto_init: false,
      has_issues: false,
      has_projects: false,
      has_wiki: false,
    }),
  })

  // Seed .gitignore + Welcome.md so the repo is immediately usable.
  await putGithubFile(
    accessToken,
    repo.full_name,
    '.gitignore',
    DEFAULT_GITIGNORE,
    'chore: add vault .gitignore',
  )
  await putGithubFile(
    accessToken,
    repo.full_name,
    'Welcome.md',
    WELCOME_NOTE,
    'docs: add welcome note',
  )
  return repo
}

type TreeEntry = {
  path: string
  mode: string
  type: 'blob' | 'tree'
  sha: string
  size?: number
  url?: string
}

export async function listGithubVaultTree(
  accessToken: string,
  repoId: string,
  rootName?: string,
): Promise<{ root: VaultNode; files: DriveFile[] }> {
  const { owner, repo } = parseRepoId(repoId)
  const meta = await ghFetch<{ default_branch: string; full_name: string }>(
    accessToken,
    `/repos/${owner}/${repo}`,
  )
  let tree: TreeEntry[] = []
  try {
    const data = await ghFetch<{ tree?: TreeEntry[]; truncated?: boolean }>(
      accessToken,
      `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(meta.default_branch)}?recursive=1`,
    )
    tree = data.tree ?? []
    if (data.truncated) {
      throw new GithubError('Repository tree is too large to index in one request', 413)
    }
  } catch (err) {
    // Empty repo (no commits yet)
    if (err instanceof GithubError && (err.status === 404 || err.status === 409)) {
      tree = []
    } else {
      throw err
    }
  }

  const files: DriveFile[] = []
  const folderPaths = new Set<string>()

  for (const entry of tree) {
    if (entry.type === 'tree') {
      folderPaths.add(entry.path)
      continue
    }
    if (entry.type !== 'blob') continue
    const name = entry.path.split('/').pop() ?? entry.path
    const parentPath = entry.path.includes('/')
      ? entry.path.slice(0, entry.path.lastIndexOf('/'))
      : ''
    const parentId = pathId(repoId, parentPath)
    files.push({
      id: pathId(repoId, entry.path),
      name,
      mimeType: /\.(md|markdown)$/i.test(name) ? MD_MIME : 'application/octet-stream',
      parents: [parentId || repoId],
      modifiedTime: undefined,
      size: entry.size != null ? String(entry.size) : undefined,
    })
    if (parentPath) {
      const parts = parentPath.split('/')
      let acc = ''
      for (const part of parts) {
        acc = acc ? `${acc}/${part}` : part
        folderPaths.add(acc)
      }
    }
  }

  for (const folderPath of folderPaths) {
    const name = folderPath.split('/').pop() ?? folderPath
    const parentPath = folderPath.includes('/')
      ? folderPath.slice(0, folderPath.lastIndexOf('/'))
      : ''
    files.push({
      id: pathId(repoId, folderPath),
      name,
      mimeType: FOLDER_MIME,
      parents: [parentPath ? pathId(repoId, parentPath) : repoId],
    })
  }

  const byParent = new Map<string, DriveFile[]>()
  for (const file of files) {
    const parent = file.parents?.[0] ?? repoId
    const list = byParent.get(parent) ?? []
    list.push(file)
    byParent.set(parent, list)
  }

  function buildNode(id: string, name: string, path: string, mimeType: string, parentId?: string): VaultNode {
    const isFolder = mimeType === FOLDER_MIME || id === repoId
    const children = (byParent.get(id) ?? [])
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
    root: buildNode(repoId, rootName || meta.full_name || repo, '', FOLDER_MIME),
    files,
  }
}

async function getContentMeta(
  accessToken: string,
  owner: string,
  repo: string,
  path: string,
): Promise<{ sha: string; content?: string; encoding?: string } | null> {
  try {
    return await ghFetch<{ sha: string; content?: string; encoding?: string }>(
      accessToken,
      `/repos/${owner}/${repo}/contents/${contentsPath(path)}`,
    )
  } catch (err) {
    if (err instanceof GithubError && err.status === 404) return null
    throw err
  }
}

export async function githubRead(accessToken: string, repoId: string, fileId: string): Promise<string> {
  const { owner, repo } = parseRepoId(repoId)
  const path = parsePathId(fileId, repoId)
  if (!path) throw new GithubError('Cannot read repository root', 400)
  const meta = await getContentMeta(accessToken, owner, repo, path)
  if (!meta) throw new GithubError('File not found', 404)
  if (meta.content && meta.encoding === 'base64') return fromBase64(meta.content)
  // Fallback: raw download for large files
  const res = await fetch(
    `${API}/repos/${owner}/${repo}/contents/${contentsPath(path)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.raw',
        'User-Agent': 'Kyoketti',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  )
  if (!res.ok) throw new GithubError(await res.text(), res.status)
  return res.text()
}

async function putGithubFile(
  accessToken: string,
  repoId: string,
  path: string,
  content: string,
  message: string,
  sha?: string,
): Promise<DriveFile> {
  const { owner, repo } = parseRepoId(repoId)
  const body: Record<string, string> = {
    message,
    content: toBase64(content),
  }
  if (sha) body.sha = sha
  const result = await ghFetch<{
    content: { path: string; sha: string; size?: number; name: string }
  }>(accessToken, `/repos/${owner}/${repo}/contents/${contentsPath(path)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
  const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  return {
    id: pathId(repoId, path),
    name: result.content.name,
    mimeType: /\.(md|markdown)$/i.test(result.content.name) ? MD_MIME : 'application/octet-stream',
    parents: [parentPath ? pathId(repoId, parentPath) : repoId],
    size: result.content.size != null ? String(result.content.size) : undefined,
  }
}

export async function githubWrite(
  accessToken: string,
  repoId: string,
  fileId: string,
  content: string,
): Promise<DriveFile> {
  const path = parsePathId(fileId, repoId)
  if (!path) throw new GithubError('Cannot write repository root', 400)
  const { owner, repo } = parseRepoId(repoId)
  const existing = await getContentMeta(accessToken, owner, repo, path)
  return putGithubFile(
    accessToken,
    repoId,
    path,
    content,
    `docs: update ${path}`,
    existing?.sha,
  )
}

export async function githubCreateNote(
  accessToken: string,
  repoId: string,
  parentId: string,
  name: string,
  content: string,
): Promise<DriveFile> {
  const parentPath = parsePathId(parentId, repoId)
  const fileName = name.endsWith('.md') ? name : `${name}.md`
  const path = parentPath ? `${parentPath}/${fileName}` : fileName
  return putGithubFile(accessToken, repoId, path, content, `docs: create ${path}`)
}

export async function githubCreateFolder(
  accessToken: string,
  repoId: string,
  parentId: string,
  name: string,
): Promise<DriveFile> {
  const parentPath = parsePathId(parentId, repoId)
  const folderPath = parentPath ? `${parentPath}/${name}` : name
  const keepPath = `${folderPath}/.gitkeep`
  await putGithubFile(accessToken, repoId, keepPath, '', `chore: create folder ${folderPath}`)
  return {
    id: pathId(repoId, folderPath),
    name,
    mimeType: FOLDER_MIME,
    parents: [parentPath ? pathId(repoId, parentPath) : repoId],
  }
}

export async function githubRename(
  accessToken: string,
  repoId: string,
  fileId: string,
  newName: string,
): Promise<void> {
  const { owner, repo } = parseRepoId(repoId)
  const oldPath = parsePathId(fileId, repoId)
  if (!oldPath) throw new GithubError('Cannot rename repository root', 400)
  const parent = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/')) : ''
  const newPath = parent ? `${parent}/${newName}` : newName
  if (newPath === oldPath) return

  // Folder rename: move all blobs under the prefix via the Git Data API would be ideal;
  // for notes we support file rename (Contents delete + create).
  const meta = await getContentMeta(accessToken, owner, repo, oldPath)
  if (!meta) {
    // Treat as folder: move children
    const tree = await listGithubVaultTree(accessToken, repoId)
    const prefix = `${oldPath}/`
    const children = tree.files.filter(
      (f) => f.mimeType !== FOLDER_MIME && parsePathId(f.id, repoId).startsWith(prefix),
    )
    for (const child of children) {
      const childPath = parsePathId(child.id, repoId)
      const nextChildPath = `${newPath}/${childPath.slice(prefix.length)}`
      const text = await githubRead(accessToken, repoId, child.id)
      await putGithubFile(accessToken, repoId, nextChildPath, text, `chore: rename ${childPath} → ${nextChildPath}`)
      await githubDelete(accessToken, repoId, child.id)
    }
    // Remove .gitkeep if present
    const keep = tree.files.find((f) => parsePathId(f.id, repoId) === `${oldPath}/.gitkeep`)
    if (keep) await githubDelete(accessToken, repoId, keep.id)
    return
  }

  const content =
    meta.content && meta.encoding === 'base64'
      ? fromBase64(meta.content)
      : await githubRead(accessToken, repoId, fileId)
  await putGithubFile(accessToken, repoId, newPath, content, `chore: rename ${oldPath} → ${newPath}`)
  await githubDelete(accessToken, repoId, fileId)
}

export async function githubDelete(
  accessToken: string,
  repoId: string,
  fileId: string,
): Promise<void> {
  const { owner, repo } = parseRepoId(repoId)
  const path = parsePathId(fileId, repoId)
  if (!path) throw new GithubError('Cannot delete repository root', 400)
  const meta = await getContentMeta(accessToken, owner, repo, path)
  if (!meta) {
    // Folder delete: remove all files under it
    const tree = await listGithubVaultTree(accessToken, repoId)
    const prefix = `${path}/`
    const children = tree.files.filter(
      (f) => f.mimeType !== FOLDER_MIME && parsePathId(f.id, repoId).startsWith(prefix),
    )
    for (const child of children) {
      await githubDelete(accessToken, repoId, child.id)
    }
    return
  }
  await ghFetch(accessToken, `/repos/${owner}/${repo}/contents/${contentsPath(path)}`, {
    method: 'DELETE',
    body: JSON.stringify({
      message: `chore: delete ${path}`,
      sha: meta.sha,
    }),
  })
}
