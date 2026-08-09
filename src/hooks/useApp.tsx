import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  clearSession,
  connectGoogleDrive,
  disconnectGoogleDrive,
  loadSession,
} from '../lib/googleAuth'
import {
  createFolder,
  createMarkdownFile,
  downloadTextFile,
  listVaultTree,
  renameFile,
  trashFile,
  updateTextFile,
} from '../lib/googleDrive'
import {
  demoCreateFolder,
  demoCreateNote,
  demoListVault,
  demoRead,
  demoRename,
  demoTrash,
  demoWrite,
  disableDemoMode,
  enableDemoMode,
  isDemoMode,
} from '../lib/demoVault'
import {
  buildPaths,
  createEmptyIndex,
  markdownFiles,
  noteFromFile,
  removeNote,
  upsertNote,
  type VaultIndex,
} from '../lib/vaultIndex'
import type {
  AuthSession,
  LeftPanel,
  OpenTab,
  RightPanel,
  VaultConfig,
  VaultNode,
  ViewMode,
} from '../types'

const VAULT_KEY = 'kyoketti.vault'

type AppState = {
  session: AuthSession | null
  demo: boolean
  connecting: boolean
  vault: VaultConfig | null
  tree: VaultNode | null
  index: VaultIndex
  loadingVault: boolean
  activeFileId: string | null
  tabs: OpenTab[]
  editorContent: string
  viewMode: ViewMode
  leftPanel: LeftPanel
  rightPanel: RightPanel
  saveStatus: 'saved' | 'saving' | 'unsaved' | 'error'
  error: string | null
  statusMessage: string
}

type AppActions = {
  connect: () => Promise<void>
  startDemo: () => void
  disconnect: () => void
  setVault: (vault: VaultConfig) => Promise<void>
  clearVault: () => void
  refreshVault: () => Promise<void>
  openFile: (fileId: string) => Promise<void>
  closeTab: (fileId: string) => void
  setEditorContent: (content: string) => void
  saveActiveFile: () => Promise<void>
  createNote: (parentId: string, name: string) => Promise<void>
  createDirectory: (parentId: string, name: string) => Promise<void>
  renameNode: (id: string, name: string) => Promise<void>
  deleteNode: (id: string) => Promise<void>
  setViewMode: (mode: ViewMode) => void
  setLeftPanel: (panel: LeftPanel) => void
  setRightPanel: (panel: RightPanel) => void
  openNoteByTitle: (title: string) => Promise<boolean>
  setError: (error: string | null) => void
}

const AppContext = createContext<(AppState & AppActions) | null>(null)

function loadVaultConfig(): VaultConfig | null {
  try {
    const raw = localStorage.getItem(VAULT_KEY)
    return raw ? (JSON.parse(raw) as VaultConfig) : null
  } catch {
    return null
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [demo, setDemo] = useState(() => isDemoMode())
  const [session, setSession] = useState<AuthSession | null>(() => {
    if (isDemoMode()) {
      return {
        accessToken: 'demo',
        expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 365,
        email: 'demo@local',
        name: 'Demo User',
      }
    }
    return loadSession()
  })
  const [connecting, setConnecting] = useState(false)
  const [vault, setVaultState] = useState<VaultConfig | null>(() => loadVaultConfig())
  const [tree, setTree] = useState<VaultNode | null>(null)
  const [index, setIndex] = useState<VaultIndex>(() => createEmptyIndex())
  const [loadingVault, setLoadingVault] = useState(false)
  const [activeFileId, setActiveFileId] = useState<string | null>(null)
  const [tabs, setTabs] = useState<OpenTab[]>([])
  const [editorContent, setEditorContentState] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('live')
  const [leftPanel, setLeftPanel] = useState<LeftPanel>('files')
  const [rightPanel, setRightPanel] = useState<RightPanel>('backlinks')
  const [saveStatus, setSaveStatus] = useState<AppState['saveStatus']>('saved')
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState('Ready')
  const contentCache = useRef(new Map<string, string>())
  const saveTimer = useRef<number | null>(null)
  const editorContentRef = useRef(editorContent)
  const activeFileIdRef = useRef(activeFileId)
  const demoRef = useRef(demo)
  const sessionRef = useRef(session)

  useEffect(() => {
    editorContentRef.current = editorContent
  }, [editorContent])
  useEffect(() => {
    activeFileIdRef.current = activeFileId
  }, [activeFileId])
  useEffect(() => {
    demoRef.current = demo
  }, [demo])
  useEffect(() => {
    sessionRef.current = session
  }, [session])

  const connect = useCallback(async () => {
    setConnecting(true)
    setError(null)
    try {
      disableDemoMode()
      setDemo(false)
      const next = await connectGoogleDrive()
      setSession(next)
      setStatusMessage(`Connected as ${next.email ?? 'Google user'}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect Google Drive')
    } finally {
      setConnecting(false)
    }
  }, [])

  const startDemo = useCallback(() => {
    enableDemoMode()
    setDemo(true)
    setSession({
      accessToken: 'demo',
      expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 365,
      email: 'demo@local',
      name: 'Demo User',
    })
    const vaultConfig = { folderId: 'demo-root', folderName: 'Demo Vault' }
    localStorage.setItem(VAULT_KEY, JSON.stringify(vaultConfig))
    setVaultState(vaultConfig)
    setStatusMessage('Demo vault ready')
  }, [])

  const disconnect = useCallback(() => {
    if (!demo) disconnectGoogleDrive(session)
    disableDemoMode()
    clearSession()
    localStorage.removeItem(VAULT_KEY)
    setDemo(false)
    setSession(null)
    setVaultState(null)
    setTree(null)
    setIndex(createEmptyIndex())
    setTabs([])
    setActiveFileId(null)
    setEditorContentState('')
    setStatusMessage('Disconnected')
  }, [session, demo])

  const refreshVault = useCallback(async () => {
    if (!vault) return
    if (!demo && !session) return
    setLoadingVault(true)
    setError(null)
    setStatusMessage('Indexing vault…')
    try {
      const { root, files } = demo
        ? demoListVault()
        : await listVaultTree(session!.accessToken, vault.folderId, vault.folderName)
      setTree(root)
      const paths = buildPaths(files, vault.folderId)
      const mdFiles = markdownFiles(files)
      let nextIndex = createEmptyIndex()
      const batchSize = 8
      for (let i = 0; i < mdFiles.length; i += batchSize) {
        const batch = mdFiles.slice(i, i + batchSize)
        const contents = await Promise.all(
          batch.map(async (file) => {
            if (contentCache.current.has(file.id)) {
              return { file, content: contentCache.current.get(file.id)! }
            }
            const content = demo
              ? demoRead(file.id)
              : await downloadTextFile(session!.accessToken, file.id)
            contentCache.current.set(file.id, content)
            return { file, content }
          }),
        )
        for (const { file, content } of contents) {
          nextIndex = upsertNote(nextIndex, noteFromFile(file, paths.get(file.id) ?? file.name, content))
        }
      }
      setIndex(nextIndex)
      setStatusMessage(`${mdFiles.length} notes indexed`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load vault'
      setError(message)
      setStatusMessage('Vault load failed')
      if (!demo && (message.includes('401') || message.toLowerCase().includes('invalid credentials'))) {
        clearSession()
        setSession(null)
      }
    } finally {
      setLoadingVault(false)
    }
  }, [session, vault, demo])

  const setVault = useCallback(async (next: VaultConfig) => {
    localStorage.setItem(VAULT_KEY, JSON.stringify(next))
    setVaultState(next)
    setTabs([])
    setActiveFileId(null)
    setEditorContentState('')
    contentCache.current.clear()
  }, [])

  const clearVault = useCallback(() => {
    localStorage.removeItem(VAULT_KEY)
    setVaultState(null)
    setTree(null)
    setIndex(createEmptyIndex())
    setTabs([])
    setActiveFileId(null)
    setEditorContentState('')
    contentCache.current.clear()
  }, [])

  useEffect(() => {
    if ((session || demo) && vault) void refreshVault()
  }, [session, vault, demo, refreshVault])

  const openFile = useCallback(
    async (fileId: string) => {
      if (!demo && !session) return
      setError(null)
      try {
        let content = contentCache.current.get(fileId)
        let note = index.notesById.get(fileId)
        if (content == null) {
          content = demo ? demoRead(fileId) : await downloadTextFile(session!.accessToken, fileId)
          contentCache.current.set(fileId, content)
        }
        if (!note) {
          note = {
            id: fileId,
            name: treeFindName(tree, fileId) ?? 'Untitled.md',
            path: treeFindPath(tree, fileId) ?? 'Untitled.md',
            title: (treeFindName(tree, fileId) ?? 'Untitled').replace(/\.md$/i, ''),
            content,
            frontmatter: {},
            tags: [],
            links: [],
          }
        }
        setActiveFileId(fileId)
        setEditorContentState(content)
        setSaveStatus('saved')
        setTabs((prev) => {
          if (prev.some((t) => t.id === fileId)) return prev
          return [...prev, { id: fileId, path: note!.path, name: note!.name, dirty: false }]
        })
        setStatusMessage(note.path)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to open file')
      }
    },
    [session, demo, index.notesById, tree],
  )

  const closeTab = useCallback(
    (fileId: string) => {
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== fileId)
        if (activeFileId === fileId) {
          const fallback = next[next.length - 1]
          if (fallback) void openFile(fallback.id)
          else {
            setActiveFileId(null)
            setEditorContentState('')
          }
        }
        return next
      })
    },
    [activeFileId, openFile],
  )

  const saveActiveFile = useCallback(async () => {
    const fileId = activeFileIdRef.current
    const content = editorContentRef.current
    if (!fileId) return
    if (!demoRef.current && !sessionRef.current) return
    setSaveStatus('saving')
    try {
      if (demoRef.current) demoWrite(fileId, content)
      else await updateTextFile(sessionRef.current!.accessToken, fileId, content)
      contentCache.current.set(fileId, content)
      const existing = index.notesById.get(fileId)
      const note = noteFromFile(
        {
          id: fileId,
          name: existing?.name ?? 'Untitled.md',
          mimeType: 'text/markdown',
          modifiedTime: new Date().toISOString(),
        },
        existing?.path ?? 'Untitled.md',
        content,
      )
      setIndex((prev) => upsertNote(prev, note))
      setTabs((prev) => prev.map((t) => (t.id === fileId ? { ...t, dirty: false } : t)))
      setSaveStatus('saved')
      setStatusMessage(`Saved ${note.path}`)
    } catch (err) {
      setSaveStatus('error')
      setError(err instanceof Error ? err.message : 'Save failed')
    }
  }, [index.notesById])

  const setEditorContent = useCallback(
    (content: string) => {
      setEditorContentState(content)
      setSaveStatus('unsaved')
      setTabs((prev) =>
        prev.map((t) => (t.id === activeFileIdRef.current ? { ...t, dirty: true } : t)),
      )
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => {
        void saveActiveFile()
      }, 900)
    },
    [saveActiveFile],
  )

  const createNote = useCallback(
    async (parentId: string, name: string) => {
      const content = `# ${name.replace(/\.md$/i, '')}\n\n`
      const file = demo
        ? demoCreateNote(parentId, name, content)
        : await createMarkdownFile(session!.accessToken, parentId, name, content)
      contentCache.current.set(file.id, content)
      await refreshVault()
      await openFile(file.id)
    },
    [session, demo, refreshVault, openFile],
  )

  const createDirectory = useCallback(
    async (parentId: string, name: string) => {
      if (demo) demoCreateFolder(parentId, name)
      else await createFolder(session!.accessToken, parentId, name)
      await refreshVault()
    },
    [session, demo, refreshVault],
  )

  const renameNode = useCallback(
    async (id: string, name: string) => {
      if (demo) demoRename(id, name)
      else await renameFile(session!.accessToken, id, name)
      await refreshVault()
    },
    [session, demo, refreshVault],
  )

  const deleteNode = useCallback(
    async (id: string) => {
      if (demo) demoTrash(id)
      else await trashFile(session!.accessToken, id)
      contentCache.current.delete(id)
      setIndex((prev) => removeNote(prev, id))
      setTabs((prev) => prev.filter((t) => t.id !== id))
      if (activeFileId === id) {
        setActiveFileId(null)
        setEditorContentState('')
      }
      await refreshVault()
    },
    [session, demo, activeFileId, refreshVault],
  )

  const openNoteByTitle = useCallback(
    async (title: string) => {
      const note = index.notesByTitle.get(title.toLowerCase())
      if (!note) return false
      await openFile(note.id)
      return true
    },
    [index.notesByTitle, openFile],
  )

  const value = useMemo(
    () => ({
      session,
      demo,
      connecting,
      vault,
      tree,
      index,
      loadingVault,
      activeFileId,
      tabs,
      editorContent,
      viewMode,
      leftPanel,
      rightPanel,
      saveStatus,
      error,
      statusMessage,
      connect,
      startDemo,
      disconnect,
      setVault,
      clearVault,
      refreshVault,
      openFile,
      closeTab,
      setEditorContent,
      saveActiveFile,
      createNote,
      createDirectory,
      renameNode,
      deleteNode,
      setViewMode,
      setLeftPanel,
      setRightPanel,
      openNoteByTitle,
      setError,
    }),
    [
      session,
      demo,
      connecting,
      vault,
      tree,
      index,
      loadingVault,
      activeFileId,
      tabs,
      editorContent,
      viewMode,
      leftPanel,
      rightPanel,
      saveStatus,
      error,
      statusMessage,
      connect,
      startDemo,
      disconnect,
      setVault,
      clearVault,
      refreshVault,
      openFile,
      closeTab,
      setEditorContent,
      saveActiveFile,
      createNote,
      createDirectory,
      renameNode,
      deleteNode,
      openNoteByTitle,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppState & AppActions {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}

function treeFindName(node: VaultNode | null, id: string): string | null {
  if (!node) return null
  if (node.id === id) return node.name
  for (const child of node.children ?? []) {
    const found = treeFindName(child, id)
    if (found) return found
  }
  return null
}

function treeFindPath(node: VaultNode | null, id: string): string | null {
  if (!node) return null
  if (node.id === id) return node.path || node.name
  for (const child of node.children ?? []) {
    const found = treeFindPath(child, id)
    if (found) return found
  }
  return null
}
