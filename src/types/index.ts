export type DriveFile = {
  id: string
  name: string
  mimeType: string
  parents?: string[]
  modifiedTime?: string
  size?: string
}

export type VaultNode = {
  id: string
  name: string
  path: string
  mimeType: string
  isFolder: boolean
  children?: VaultNode[]
  parentId?: string
}

export type NoteMeta = {
  id: string
  name: string
  path: string
  title: string
  content: string
  frontmatter: Record<string, unknown>
  aliases?: string[]
  tags: string[]
  links: string[]
  modifiedTime?: string
}

export type OpenTab = {
  id: string
  path: string
  name: string
  dirty: boolean
}

export type CreatedFile = {
  id: string
  name: string
  path: string
}

export type CreateFileOptions = {
  content?: string
  open?: boolean
}

export type ViewMode = 'source' | 'wysiwyg' | 'live' | 'reading'
export type RightPanel = 'backlinks' | 'outline' | 'tags' | null
export type LeftPanel = 'files' | 'search' | 'graph'

export type AuthProvider = 'google' | 'github'

export type AuthSession = {
  accessToken: string
  expiresAt: number
  email?: string
  name?: string
  picture?: string
  provider?: AuthProvider
}

export type VaultConfig = {
  folderId: string
  folderName: string
  folderPath?: string
}
