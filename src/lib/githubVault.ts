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
  permissions?: {
    admin?: boolean
    push?: boolean
    pull?: boolean
  }
}

export function githubTokenCanPush(scopes?: string): boolean {
  if (!scopes?.trim()) return true
  const parts = scopes.split(',').map((s) => s.trim())
  return parts.includes('repo') || parts.includes('public_repo')
}

export function canPushGithubRepo(repo: GithubRepo): boolean {
  if (repo.permissions && typeof repo.permissions.push === 'boolean') return repo.permissions.push
  return true
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
  const browser = typeof window !== 'undefined'
  const res = await fetch(`${API}${path}`, {
    cache: 'no-store',
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      // User-Agent and X-GitHub-Api-Version are not CORS-safelisted; sending them
      // from the browser can fail PUT preflights while GET still appears to work.
      ...(browser
        ? {}
        : {
            'User-Agent': 'Kyoketti',
            'X-GitHub-Api-Version': '2022-11-28',
          }),
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

export async function listGithubRepos(accessToken: string): Promise<GithubRepo[]> {
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
      description: 'Obsidian Vault (Kyoketti)',
      auto_init: false,
      has_issues: false,
      has_projects: false,
      has_wiki: false,
    }),
  })

  // Seed .gitignore + Welcome.md so the repo is immediately usable.
  await commitGithubFile(
    accessToken,
    repo.full_name,
    '.gitignore',
    DEFAULT_GITIGNORE,
    'chore: add vault .gitignore',
  )
  await commitGithubFile(
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
      mimeType: /\.(md|markdown)$/i.test(name)
        ? MD_MIME
        : /\.base$/i.test(name)
          ? 'application/x-obsidian-base'
          : /\.canvas$/i.test(name)
            ? 'application/x-obsidian-canvas'
            : 'application/octet-stream',
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

const branchCache = new Map<string, string>()
const repoWriteChains = new Map<string, Promise<unknown>>()

function withRepoWrite<T>(repoId: string, fn: () => Promise<T>): Promise<T> {
  const prev = repoWriteChains.get(repoId) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  repoWriteChains.set(
    repoId,
    next.then(
      () => undefined,
      () => undefined,
    ),
  )
  return next
}

async function getDefaultBranch(accessToken: string, repoId: string): Promise<string> {
  const cached = branchCache.get(repoId)
  if (cached) return cached
  const { owner, repo } = parseRepoId(repoId)
  const meta = await ghFetch<{ default_branch?: string }>(accessToken, `/repos/${owner}/${repo}`)
  const branch = meta.default_branch || 'main'
  branchCache.set(repoId, branch)
  return branch
}

function rethrowWrite(err: unknown): never {
  if (err instanceof GithubError) {
    const msg = err.message
    const noPush =
      err.status === 403 ||
      err.status === 401 ||
      /not accessible by integration/i.test(msg) ||
      /resource not accessible/i.test(msg) ||
      /must have push access/i.test(msg) ||
      /resource protected by organization sso/i.test(msg) ||
      /saml enforcement/i.test(msg)
    if (noPush) {
      throw new GithubError(
        `GitHub refused to save: ${msg} Viewing can still work on public or cached files. Sign out and sign in with GitHub again, accept repository (repo) access, and pick a repo you can push to. If Kyoketti is installed as a GitHub App, set Contents to Read and write.`,
        err.status,
      )
    }
    if (err.status === 409) {
      throw new GithubError(`GitHub save conflict: ${msg}. Wait a moment and try again.`, err.status)
    }
    if (err.status === 422 && /sha/i.test(msg)) {
      throw new GithubError(
        `GitHub needs the current file SHA to save: ${msg}`,
        err.status,
      )
    }
  }
  throw err
}

async function getContentMeta(
  accessToken: string,
  owner: string,
  repo: string,
  path: string,
  branch?: string,
): Promise<{ sha: string; content?: string; encoding?: string } | null> {
  const ref = branch ? `?ref=${encodeURIComponent(branch)}` : ''
  try {
    const data = await ghFetch<unknown>(
      accessToken,
      `/repos/${owner}/${repo}/contents/${contentsPath(path)}${ref}`,
    )
    if (Array.isArray(data)) {
      const name = path.split('/').pop()
      const entry = data.find(
        (row) =>
          row &&
          typeof row === 'object' &&
          'name' in row &&
          (row as { name?: string }).name === name &&
          (row as { type?: string }).type !== 'dir',
      ) as { sha?: string } | undefined
      return entry?.sha ? { sha: entry.sha } : null
    }
    if (!data || typeof data !== 'object') return null
    const obj = data as { sha?: string; type?: string; content?: string; encoding?: string }
    if (obj.type === 'dir' || !obj.sha) return null
    return { sha: obj.sha, content: obj.content, encoding: obj.encoding }
  } catch (err) {
    if (err instanceof GithubError && err.status === 404) return null
    throw err
  }
}

export async function githubRead(accessToken: string, repoId: string, fileId: string): Promise<string> {
  const { owner, repo } = parseRepoId(repoId)
  const path = parsePathId(fileId, repoId)
  if (!path) throw new GithubError('Cannot read repository root', 400)
  const branch = await getDefaultBranch(accessToken, repoId)
  const meta = await getContentMeta(accessToken, owner, repo, path, branch)
  if (!meta) throw new GithubError('File not found', 404)
  if (meta.content && meta.encoding === 'base64') return fromBase64(meta.content)
  const res = await fetch(
    `${API}/repos/${owner}/${repo}/contents/${contentsPath(path)}?ref=${encodeURIComponent(branch)}`,
    {
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.raw',
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
  branch?: string,
): Promise<DriveFile> {
  const { owner, repo } = parseRepoId(repoId)
  const body: Record<string, string> = {
    message,
    content: toBase64(content),
  }
  if (sha) body.sha = sha
  if (branch) body.branch = branch
  const result = await ghFetch<{
    content?: { path: string; sha: string; size?: number; name: string } | null
  }>(accessToken, `/repos/${owner}/${repo}/contents/${contentsPath(path)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
  const name = result.content?.name || path.split('/').pop() || path
  const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  return {
    id: pathId(repoId, path),
    name,
    mimeType: /\.(md|markdown)$/i.test(name)
      ? MD_MIME
      : /\.base$/i.test(name)
        ? 'application/x-obsidian-base'
        : /\.canvas$/i.test(name)
          ? 'application/x-obsidian-canvas'
          : 'application/octet-stream',
    parents: [parentPath ? pathId(repoId, parentPath) : repoId],
    size: result.content?.size != null ? String(result.content.size) : undefined,
  }
}

async function commitGithubFile(
  accessToken: string,
  repoId: string,
  path: string,
  content: string,
  message: string,
): Promise<DriveFile> {
  const { owner, repo } = parseRepoId(repoId)
  return withRepoWrite(repoId, async () => {
    const branch = await getDefaultBranch(accessToken, repoId)
    let sha = (await getContentMeta(accessToken, owner, repo, path, branch))?.sha
    let lastError: unknown
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await putGithubFile(accessToken, repoId, path, content, message, sha, branch)
      } catch (err) {
        lastError = err
        const retryable =
          err instanceof GithubError &&
          (err.status === 409 || (err.status === 422 && /sha/i.test(err.message)))
        if (!retryable || attempt === 3) rethrowWrite(err)
        sha = (await getContentMeta(accessToken, owner, repo, path, branch))?.sha
        await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)))
      }
    }
    rethrowWrite(lastError)
  })
}

export async function githubWrite(
  accessToken: string,
  repoId: string,
  fileId: string,
  content: string,
): Promise<DriveFile> {
  const path = parsePathId(fileId, repoId)
  if (!path) throw new GithubError('Cannot write repository root', 400)
  return commitGithubFile(accessToken, repoId, path, content, `docs: update ${path}`)
}

export async function githubCreateNote(
  accessToken: string,
  repoId: string,
  parentId: string,
  name: string,
  content: string,
): Promise<DriveFile> {
  const parentPath = parsePathId(parentId, repoId)
  const fileName = /\.base$/i.test(name) || /\.canvas$/i.test(name)
    ? name
    : name.endsWith('.md')
      ? name
      : `${name}.md`
  const path = parentPath ? `${parentPath}/${fileName}` : fileName
  return commitGithubFile(accessToken, repoId, path, content, `docs: create ${path}`)
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
  await commitGithubFile(accessToken, repoId, keepPath, '', `chore: create folder ${folderPath}`)
  return {
    id: pathId(repoId, folderPath),
    name,
    mimeType: FOLDER_MIME,
    parents: [parentPath ? pathId(repoId, parentPath) : repoId],
  }
}

async function deleteFileAtPath(
  accessToken: string,
  repoId: string,
  path: string,
  branch: string,
): Promise<boolean> {
  const { owner, repo } = parseRepoId(repoId)
  const meta = await getContentMeta(accessToken, owner, repo, path, branch)
  if (!meta) return false
  await ghFetch(accessToken, `/repos/${owner}/${repo}/contents/${contentsPath(path)}`, {
    method: 'DELETE',
    body: JSON.stringify({
      message: `chore: delete ${path}`,
      sha: meta.sha,
      branch,
    }),
  })
  return true
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

  return withRepoWrite(repoId, async () => {
    const branch = await getDefaultBranch(accessToken, repoId)
    const meta = await getContentMeta(accessToken, owner, repo, oldPath, branch)
    if (!meta) {
      const tree = await listGithubVaultTree(accessToken, repoId)
      const prefix = `${oldPath}/`
      const children = tree.files.filter(
        (f) => f.mimeType !== FOLDER_MIME && parsePathId(f.id, repoId).startsWith(prefix),
      )
      for (const child of children) {
        const childPath = parsePathId(child.id, repoId)
        const nextChildPath = `${newPath}/${childPath.slice(prefix.length)}`
        const text = await githubRead(accessToken, repoId, child.id)
        await putGithubFile(
          accessToken,
          repoId,
          nextChildPath,
          text,
          `chore: rename ${childPath} → ${nextChildPath}`,
          undefined,
          branch,
        )
        await deleteFileAtPath(accessToken, repoId, childPath, branch)
      }
      const keepPath = `${oldPath}/.gitkeep`
      await deleteFileAtPath(accessToken, repoId, keepPath, branch)
      return
    }

    const content =
      meta.content && meta.encoding === 'base64'
        ? fromBase64(meta.content)
        : await githubRead(accessToken, repoId, fileId)
    await putGithubFile(
      accessToken,
      repoId,
      newPath,
      content,
      `chore: rename ${oldPath} → ${newPath}`,
      undefined,
      branch,
    )
    await deleteFileAtPath(accessToken, repoId, oldPath, branch)
  })
}

export async function githubDelete(
  accessToken: string,
  repoId: string,
  fileId: string,
): Promise<void> {
  const path = parsePathId(fileId, repoId)
  if (!path) throw new GithubError('Cannot delete repository root', 400)
  return withRepoWrite(repoId, async () => {
    const branch = await getDefaultBranch(accessToken, repoId)
    if (await deleteFileAtPath(accessToken, repoId, path, branch)) return
    const tree = await listGithubVaultTree(accessToken, repoId)
    const prefix = `${path}/`
    const children = tree.files.filter(
      (f) => f.mimeType !== FOLDER_MIME && parsePathId(f.id, repoId).startsWith(prefix),
    )
    for (const child of children) {
      await deleteFileAtPath(accessToken, repoId, parsePathId(child.id, repoId), branch)
    }
  })
}
