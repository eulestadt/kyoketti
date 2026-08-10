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
  clearVaultServer,
  fetchDriveToken,
  fetchMe,
  logoutServer,
  saveVaultServer,
  startGoogleLogin,
} from '../lib/serverAuth'
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
  clearLocalVault,
  isLocalMode,
  localCreateFolder,
  localCreateNote,
  localListVault,
  localRead,
  localRename,
  localTrash,
  localWrite,
  pickLocalVaultFolder,
  restoreLocalVault,
} from '../lib/localVault'
import {
  buildPaths,
  createEmptyIndex,
  markdownFiles,
  noteFromFile,
  removeNote,
  upsertNote,
  type VaultIndex,
} from '../lib/vaultIndex'
import {
  ensureMarkdownFileName,
  noteTitleFromFileName,
  seedNoteContent,
} from '../lib/noteNames'
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
const VIEW_MODE_KEY = 'kyoketti.viewMode'

function loadViewMode(): ViewMode {
  try {
    const raw = localStorage.getItem(VIEW_MODE_KEY)
    if (raw === 'source' || raw === 'live' || raw === 'wysiwyg' || raw === 'reading') return raw
  } catch {
    /* ignore */
  }
  return 'wysiwyg'
}

type AppState = {
  bootstrapping: boolean
  session: AuthSession | null
  demo: boolean
  local: boolean
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
  connectLocal: () => Promise<void>
  startDemo: () => void
  disconnect: () => void
  setVault: (vault: VaultConfig) => Promise<void>
  clearVault: () => void
  refreshVault: () => Promise<void>
  openFile: (fileId: string, hint?: { name?: string; path?: string }) => Promise<void>
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
  const [bootstrapping, setBootstrapping] = useState(true)
  const [demo, setDemo] = useState(() => isDemoMode())
  const [local, setLocal] = useState(() => isLocalMode())
  const [session, setSession] = useState<AuthSession | null>(() => {
    if (isDemoMode()) {
      return {
        accessToken: 'demo',
        expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 365,
        email: 'demo@local',
        name: 'Demo User',
      }
    }
    if (isLocalMode()) {
      return {
        accessToken: 'local',
        expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 365,
        email: 'local@device',
        name: 'Local vault',
      }
    }
    return loadSession()
  })
  const [connecting, setConnecting] = useState(false)
  const [vault, setVaultState] = useState<VaultConfig | null>(() =>
    isDemoMode() || isLocalMode() ? loadVaultConfig() : null,
  )
  const [tree, setTree] = useState<VaultNode | null>(null)
  const [index, setIndex] = useState<VaultIndex>(() => createEmptyIndex())
  const [loadingVault, setLoadingVault] = useState(false)
  const [activeFileId, setActiveFileId] = useState<string | null>(null)
  const [tabs, setTabs] = useState<OpenTab[]>([])
  const [editorContent, setEditorContentState] = useState('')
  const [viewMode, setViewModeState] = useState<ViewMode>(loadViewMode)
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
  const localRef = useRef(local)
  const sessionRef = useRef(session)
  const indexRef = useRef(index)
  const treeRef = useRef(tree)

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
    localRef.current = local
  }, [local])
  useEffect(() => {
    sessionRef.current = session
  }, [session])
  useEffect(() => {
    indexRef.current = index
  }, [index])
  useEffect(() => {
    treeRef.current = tree
  }, [tree])

  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode)
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode)
    } catch {
      /* ignore */
    }
  }, [])

  // Keep open tabs' labels in sync with the vault index (filename = title).
  useEffect(() => {
    setTabs((prev) => {
      let changed = false
      const next = prev.map((tab) => {
        const note = index.notesById.get(tab.id)
        if (!note) return tab
        if (note.name === tab.name && note.path === tab.path) return tab
        changed = true
        return { ...tab, name: note.name, path: note.path }
      })
      return changed ? next : prev
    })
  }, [index])

  const ensureDriveToken = useCallback(async (): Promise<string> => {
    if (demoRef.current) return 'demo'
    if (localRef.current) return 'local'
    const current = sessionRef.current
    if (current?.accessToken && current.expiresAt > Date.now() + 60_000) {
      return current.accessToken
    }
    const tokens = await fetchDriveToken()
    const next: AuthSession = {
      accessToken: tokens.accessToken,
      expiresAt: Date.now() + tokens.expiresIn * 1000,
      email: current?.email,
      name: current?.name,
      picture: current?.picture,
    }
    setSession(next)
    sessionRef.current = next
    return next.accessToken
  }, [])

  useEffect(() => {
    let cancelled = false
    async function bootstrap() {
      const params = new URLSearchParams(window.location.search)
      const authError = params.get('authError')
      if (authError) {
        setError(decodeURIComponent(authError))
        params.delete('authError')
        const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`
        window.history.replaceState({}, '', next)
      }

      if (isDemoMode()) {
        setBootstrapping(false)
        return
      }

      if (isLocalMode()) {
        try {
          const restored = await restoreLocalVault()
          if (cancelled) return
          if (!restored) {
            setLocal(false)
            setSession(null)
            setVaultState(null)
            setBootstrapping(false)
            return
          }
          setLocal(true)
          setDemo(false)
          disableDemoMode()
          setSession({
            accessToken: 'local',
            expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 365,
            email: 'local@device',
            name: 'Local vault',
          })
          localStorage.setItem(VAULT_KEY, JSON.stringify(restored))
          setVaultState(restored)
          setStatusMessage(`Local vault: ${restored.folderName}`)
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : 'Failed to restore local vault')
            setLocal(false)
            setSession(null)
            setVaultState(null)
          }
        } finally {
          if (!cancelled) setBootstrapping(false)
        }
        return
      }

      try {
        const me = await fetchMe()
        if (cancelled) return
        if (!me.user) {
          clearSession()
          setSession(null)
          setVaultState(null)
          setBootstrapping(false)
          return
        }

        setDemo(false)
        setLocal(false)
        disableDemoMode()
        const tokens = await fetchDriveToken()
        if (cancelled) return
        setSession({
          accessToken: tokens.accessToken,
          expiresAt: Date.now() + tokens.expiresIn * 1000,
          email: me.user.email ?? undefined,
          name: me.user.name ?? undefined,
          picture: me.user.picture ?? undefined,
        })
        if (me.vault) {
          localStorage.setItem(VAULT_KEY, JSON.stringify(me.vault))
          setVaultState({ folderId: me.vault.folderId, folderName: me.vault.folderName })
          setStatusMessage(`Signed in as ${me.user.email ?? me.user.name ?? 'Google user'}`)
        } else {
          localStorage.removeItem(VAULT_KEY)
          setVaultState(null)
          setStatusMessage(`Signed in as ${me.user.email ?? me.user.name ?? 'Google user'}`)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to restore session')
        }
      } finally {
        if (!cancelled) setBootstrapping(false)
      }
    }
    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [])

  const connect = useCallback(async () => {
    setConnecting(true)
    setError(null)
    disableDemoMode()
    await clearLocalVault()
    setDemo(false)
    setLocal(false)
    startGoogleLogin(false)
  }, [])

  const connectLocal = useCallback(async () => {
    setConnecting(true)
    setError(null)
    try {
      disableDemoMode()
      setDemo(false)
      const next = await pickLocalVaultFolder()
      setLocal(true)
      setSession({
        accessToken: 'local',
        expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 365,
        email: 'local@device',
        name: 'Local vault',
      })
      localStorage.setItem(VAULT_KEY, JSON.stringify(next))
      setVaultState(next)
      contentCache.current.clear()
      setTabs([])
      setActiveFileId(null)
      setEditorContentState('')
      setStatusMessage(`Local vault: ${next.folderName}`)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        /* user cancelled picker */
      } else {
        setError(err instanceof Error ? err.message : 'Failed to open local folder')
      }
    } finally {
      setConnecting(false)
    }
  }, [])

  const startDemo = useCallback(() => {
    void clearLocalVault()
    enableDemoMode()
    setDemo(true)
    setLocal(false)
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
    void (async () => {
      if (!demo && !local) {
        try {
          await logoutServer()
        } catch {
          /* ignore */
        }
      }
      disableDemoMode()
      await clearLocalVault()
      clearSession()
      localStorage.removeItem(VAULT_KEY)
      setDemo(false)
      setLocal(false)
      setSession(null)
      setVaultState(null)
      setTree(null)
      setIndex(createEmptyIndex())
      setTabs([])
      setActiveFileId(null)
      setEditorContentState('')
      setStatusMessage('Signed out')
    })()
  }, [demo, local])

  const refreshVault = useCallback(async () => {
    if (!vault) return
    if (!demo && !local && !session) return
    setLoadingVault(true)
    setError(null)
    setStatusMessage('Indexing vault…')
    try {
      const accessToken = demo || local ? (demo ? 'demo' : 'local') : await ensureDriveToken()
      const { root, files } = demo
        ? demoListVault()
        : local
          ? await localListVault(vault.folderName)
          : await listVaultTree(accessToken, vault.folderId, vault.folderName)
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
              : local
                ? await localRead(file.id)
                : await downloadTextFile(accessToken, file.id)
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
      if (!demo && !local && message.toLowerCase().includes('unauthorized')) {
        clearSession()
        setSession(null)
      }
    } finally {
      setLoadingVault(false)
    }
  }, [session, vault, demo, local, ensureDriveToken])

  const setVault = useCallback(async (next: VaultConfig) => {
    localStorage.setItem(VAULT_KEY, JSON.stringify(next))
    setVaultState(next)
    setTabs([])
    setActiveFileId(null)
    setEditorContentState('')
    contentCache.current.clear()
    if (!demoRef.current && !localRef.current) {
      try {
        await saveVaultServer(next.folderId, next.folderName)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save vault preference')
      }
    }
  }, [])

  const clearVault = useCallback(() => {
    void (async () => {
      if (localRef.current) {
        await clearLocalVault()
        localStorage.removeItem(VAULT_KEY)
        setLocal(false)
        setSession(null)
        setVaultState(null)
        setTree(null)
        setIndex(createEmptyIndex())
        setTabs([])
        setActiveFileId(null)
        setEditorContentState('')
        contentCache.current.clear()
        setStatusMessage('Choose a local folder again')
        return
      }
      localStorage.removeItem(VAULT_KEY)
      setVaultState(null)
      setTree(null)
      setIndex(createEmptyIndex())
      setTabs([])
      setActiveFileId(null)
      setEditorContentState('')
      contentCache.current.clear()
      if (!demoRef.current) {
        void clearVaultServer().catch(() => undefined)
      }
    })()
  }, [])

  useEffect(() => {
    if (bootstrapping) return
    if ((session || demo || local) && vault) void refreshVault()
  }, [session, vault, demo, local, refreshVault, bootstrapping])

  const openFile = useCallback(
    async (fileId: string, hint?: { name?: string; path?: string }) => {
      if (!demo && !local && !session) return
      setError(null)
      try {
        const currentId = activeFileIdRef.current
        if (currentId && currentId !== fileId) {
          contentCache.current.set(currentId, editorContentRef.current)
        }
        let content = contentCache.current.get(fileId)
        const liveIndex = indexRef.current
        const liveTree = treeRef.current
        let note = liveIndex.notesById.get(fileId)
        if (content == null) {
          const accessToken = demo || local ? (demo ? 'demo' : 'local') : await ensureDriveToken()
          content = demo
            ? demoRead(fileId)
            : local
              ? await localRead(fileId)
              : await downloadTextFile(accessToken, fileId)
          contentCache.current.set(fileId, content)
        }
        if (!note) {
          const fallbackName =
            hint?.name ?? treeFindName(liveTree, fileId) ?? 'Untitled.md'
          const fallbackPath =
            hint?.path ?? treeFindPath(liveTree, fileId) ?? fallbackName
          note = {
            id: fileId,
            name: fallbackName,
            path: fallbackPath,
            title: noteTitleFromFileName(fallbackName),
            content,
            frontmatter: {},
            tags: [],
            links: [],
          }
        } else if (hint?.name && hint.name !== note.name) {
          note = {
            ...note,
            name: hint.name,
            path: hint.path ?? note.path,
            title: noteTitleFromFileName(hint.name),
          }
        }
        setActiveFileId(fileId)
        setEditorContentState(content)
        setSaveStatus('saved')
        setTabs((prev) => {
          const existing = prev.find((t) => t.id === fileId)
          if (existing) {
            if (existing.name === note!.name && existing.path === note!.path) return prev
            return prev.map((t) =>
              t.id === fileId ? { ...t, name: note!.name, path: note!.path } : t,
            )
          }
          return [...prev, { id: fileId, path: note!.path, name: note!.name, dirty: false }]
        })
        setStatusMessage(note.path)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to open file')
      }
    },
    [session, demo, local, ensureDriveToken],
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
    if (!demoRef.current && !localRef.current && !sessionRef.current) return
    setSaveStatus('saving')
    try {
      if (demoRef.current) demoWrite(fileId, content)
      else if (localRef.current) await localWrite(fileId, content)
      else {
        const accessToken = await ensureDriveToken()
        await updateTextFile(accessToken, fileId, content)
      }
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
  }, [index.notesById, ensureDriveToken])

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
      const fileName = ensureMarkdownFileName(name)
      const content = seedNoteContent(fileName)
      const file = demo
        ? demoCreateNote(parentId, fileName, content)
        : local
          ? await localCreateNote(parentId, fileName, content)
          : await createMarkdownFile(await ensureDriveToken(), parentId, fileName, content)
      const resolvedName = file.name || fileName
      const pathHint = resolvedName
      contentCache.current.set(file.id, content)
      setIndex((prev) =>
        upsertNote(
          prev,
          noteFromFile(
            { ...file, name: resolvedName },
            pathHint,
            content,
          ),
        ),
      )
      await openFile(file.id, { name: resolvedName, path: pathHint })
      void refreshVault()
    },
    [demo, local, refreshVault, openFile, ensureDriveToken],
  )

  const createDirectory = useCallback(
    async (parentId: string, name: string) => {
      if (demo) demoCreateFolder(parentId, name)
      else if (local) await localCreateFolder(parentId, name)
      else await createFolder(await ensureDriveToken(), parentId, name)
      await refreshVault()
    },
    [demo, local, refreshVault, ensureDriveToken],
  )

  const renameNode = useCallback(
    async (id: string, name: string) => {
      if (demo) demoRename(id, name)
      else if (local) await localRename(id, name)
      else await renameFile(await ensureDriveToken(), id, name)
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== id) return t
          const nextPath = t.path.includes('/')
            ? `${t.path.slice(0, t.path.lastIndexOf('/') + 1)}${name}`
            : name
          return { ...t, name, path: nextPath }
        }),
      )
      setIndex((prev) => {
        const existing = prev.notesById.get(id)
        if (!existing) return prev
        return upsertNote(prev, {
          ...existing,
          name,
          title: noteTitleFromFileName(name),
          path: existing.path.includes('/')
            ? `${existing.path.slice(0, existing.path.lastIndexOf('/') + 1)}${name}`
            : name,
        })
      })
      await refreshVault()
    },
    [demo, local, refreshVault, ensureDriveToken],
  )

  const deleteNode = useCallback(
    async (id: string) => {
      if (demo) demoTrash(id)
      else if (local) await localTrash(id)
      else await trashFile(await ensureDriveToken(), id)
      contentCache.current.delete(id)
      setIndex((prev) => removeNote(prev, id))
      setTabs((prev) => prev.filter((t) => t.id !== id))
      if (activeFileId === id) {
        setActiveFileId(null)
        setEditorContentState('')
      }
      await refreshVault()
    },
    [demo, local, activeFileId, refreshVault, ensureDriveToken],
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
      bootstrapping,
      session,
      demo,
      local,
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
      connectLocal,
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
      bootstrapping,
      session,
      demo,
      local,
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
      connectLocal,
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
