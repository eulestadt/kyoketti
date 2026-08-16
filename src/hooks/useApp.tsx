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
  createTextFile,
  downloadTextFile,
  listVaultTree,
  renameFile,
  trashFile,
  updateTextFile,
} from '../lib/googleDrive'
import {
  clearVaultServer,
  fetchDriveToken,
  fetchGithubToken,
  fetchMe,
  logoutServer,
  saveVaultServer,
  startGithubLogin,
  startGoogleLogin,
} from '../lib/serverAuth'
import {
  githubCreateFolder,
  githubCreateNote,
  githubDelete,
  githubRead,
  githubRename,
  githubWrite,
  listGithubVaultTree,
  pathId as githubPathId,
} from '../lib/githubVault'
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
  ensureLocalPathId,
  hydrateLocalMapsFromTree,
  isLocalMode,
  localCreateFolder,
  localCreateNote,
  localListVault,
  localRead,
  localRename,
  localTrash,
  localWrite,
  pickLocalVaultFolder,
  requestLocalVaultPermission,
  restoreLocalVault,
} from '../lib/localVault'
import {
  buildPaths,
  createEmptyIndex,
  noteFromFile,
  removeNote,
  resolveNoteRef,
  rewriteLinksForRename,
  upsertNote,
  vaultTextFiles,
  type VaultIndex,
} from '../lib/vaultIndex'
import {
  ensureMarkdownFileName,
  noteTitleFromFileName,
  seedNoteContent,
} from '../lib/noteNames'
import { defaultBaseContent, ensureBaseFileName, isBaseFileName } from '../lib/bases'
import { defaultCanvasContent, ensureCanvasFileName, isCanvasFileName } from '../lib/canvas'
import { childNames, findVaultNode, uniqueCopyName } from '../lib/vaultTree'
import { insertVaultChild, remapVaultId, removeVaultNode, renameVaultNode } from '../lib/vaultMutate'
import {
  browserOffline,
  OfflineError,
  shouldQueueOffline,
} from '../lib/offline'
import {
  clearOfflineData,
  enqueueMutation,
  getQueue,
  loadSnapshot,
  newPendingId,
  peekOfflineResume,
  remapMutationIds,
  saveSnapshot,
  setQueue,
  type MutationOp,
  type OfflineResumeInfo,
} from '../lib/offlineCache'
import {
  buildSnapshot,
  identityFromSession,
  indexFromSnapshotFiles,
  mimeForVaultName,
  pathForNewChild,
  seedContentCache,
  sessionFromIdentity,
} from '../lib/offlineApply'
import type {
  AuthProvider,
  AuthSession,
  CreateFileOptions,
  CreatedFile,
  DriveFile,
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
  saveStatus: 'saved' | 'saving' | 'unsaved' | 'error' | 'pending'
  error: string | null
  statusMessage: string
  searchQuery: string
  localGraph: boolean
  revealRequest: { id: string; n: number } | null
  treeExpandRequest: { mode: 'expand' | 'collapse'; n: number } | null
  offline: boolean
  pendingCount: number
  offlineResume: OfflineResumeInfo | null
  localPermissionNeeded: boolean
}

type AppActions = {
  connect: () => Promise<void>
  connectGithub: () => Promise<void>
  connectLocal: () => Promise<void>
  startDemo: () => void
  disconnect: () => void
  setVault: (vault: VaultConfig) => Promise<void>
  clearVault: () => void
  refreshVault: () => Promise<void>
  openFile: (fileId: string, hint?: { name?: string; path?: string; fromHistory?: boolean }) => Promise<void>
  closeTab: (fileId: string) => void
  closeOtherTabs: (fileId: string) => void
  closeAllTabs: () => void
  closeTabsToTheRight: (fileId: string) => void
  goBack: () => void
  goForward: () => void
  undoCloseTab: () => void
  setEditorContent: (content: string) => void
  saveActiveFile: () => Promise<void>
  createNote: (parentId: string, name: string, options?: CreateFileOptions) => Promise<CreatedFile>
  createBase: (parentId: string, name: string, options?: CreateFileOptions) => Promise<CreatedFile>
  createCanvas: (parentId: string, name: string, options?: CreateFileOptions) => Promise<CreatedFile>
  createDirectory: (parentId: string, name: string) => Promise<void>
  duplicateFile: (fileId: string) => Promise<void>
  renameNode: (id: string, name: string) => Promise<void>
  deleteNode: (id: string) => Promise<void>
  writeFileContent: (fileId: string, content: string) => Promise<void>
  setViewMode: (mode: ViewMode) => void
  setLeftPanel: (panel: LeftPanel) => void
  setRightPanel: (panel: RightPanel) => void
  setSearchQuery: (query: string) => void
  setLocalGraph: (value: boolean) => void
  revealInNavigation: (fileId: string) => void
  expandAllFolders: () => void
  collapseAllFolders: () => void
  openNoteByTitle: (title: string, fromPath?: string) => Promise<boolean>
  setError: (error: string | null) => void
  resumeOffline: () => Promise<void>
  syncPending: () => Promise<void>
  grantLocalAccess: () => Promise<void>
  authProvider: AuthProvider | null
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
  const [searchQuery, setSearchQuery] = useState('')
  const [localGraph, setLocalGraph] = useState(false)
  const [revealRequest, setRevealRequest] = useState<{ id: string; n: number } | null>(null)
  const [treeExpandRequest, setTreeExpandRequest] = useState<{ mode: 'expand' | 'collapse'; n: number } | null>(null)
  const [offline, setOffline] = useState(() => browserOffline())
  const [pendingCount, setPendingCount] = useState(0)
  const [offlineResume, setOfflineResume] = useState<OfflineResumeInfo | null>(null)
  const [localPermissionNeeded, setLocalPermissionNeeded] = useState(false)
  const contentCache = useRef(new Map<string, string>())
  const saveTimer = useRef<number | null>(null)
  const persistTimer = useRef<number | null>(null)
  const editorContentRef = useRef(editorContent)
  const activeFileIdRef = useRef(activeFileId)
  const demoRef = useRef(demo)
  const localRef = useRef(local)
  const sessionRef = useRef(session)
  const indexRef = useRef(index)
  const treeRef = useRef(tree)
  const vaultRef = useRef(vault)
  const offlineRef = useRef(offline)
  const navRef = useRef<{ stack: string[]; index: number }>({ stack: [], index: -1 })
  const closedTabsRef = useRef<OpenTab[]>([])
  const tabsRef = useRef<OpenTab[]>([])
  const syncingRef = useRef(false)

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
  useEffect(() => {
    vaultRef.current = vault
  }, [vault])
  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])
  useEffect(() => {
    offlineRef.current = offline
  }, [offline])

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

  const currentKind = useCallback((): 'google' | 'github' | 'local' | 'demo' => {
    if (demoRef.current) return 'demo'
    if (localRef.current) return 'local'
    return sessionRef.current?.provider === 'github' ? 'github' : 'google'
  }, [])

  const persistNow = useCallback(async () => {
    const liveVault = vaultRef.current
    const liveTree = treeRef.current
    if (!liveVault || !liveTree) return
    if (demoRef.current) return
    try {
      await saveSnapshot(
        buildSnapshot({
          identity: identityFromSession(currentKind(), sessionRef.current),
          vault: liveVault,
          tree: liveTree,
          index: indexRef.current,
        }),
      )
    } catch {
      /* quota / private mode */
    }
  }, [currentKind])

  const schedulePersist = useCallback(() => {
    if (persistTimer.current) window.clearTimeout(persistTimer.current)
    persistTimer.current = window.setTimeout(() => {
      void persistNow()
    }, 400)
  }, [persistNow])

  const applySnapshot = useCallback(
    (snapshot: ReturnType<typeof buildSnapshot>) => {
      setVaultState(snapshot.vault)
      vaultRef.current = snapshot.vault
      setTree(snapshot.tree)
      treeRef.current = snapshot.tree
      const nextIndex = indexFromSnapshotFiles(snapshot.files)
      setIndex(nextIndex)
      indexRef.current = nextIndex
      seedContentCache(contentCache.current, snapshot.files)
      if (snapshot.identity.kind === 'local') {
        setLocal(true)
        setDemo(false)
        hydrateLocalMapsFromTree(snapshot.tree)
      } else if (snapshot.identity.kind === 'demo') {
        setDemo(true)
        setLocal(false)
      } else {
        setDemo(false)
        setLocal(false)
      }
      const nextSession = sessionFromIdentity(snapshot.identity)
      setSession(nextSession)
      sessionRef.current = nextSession
      try {
        localStorage.setItem(VAULT_KEY, JSON.stringify(snapshot.vault))
      } catch {
        /* ignore */
      }
    },
    [],
  )

  const remapLocalId = useCallback((from: string, to: string) => {
    if (from === to) return
    const cache = contentCache.current.get(from)
    if (cache != null) {
      contentCache.current.set(to, cache)
      contentCache.current.delete(from)
    }
    if (treeRef.current) {
      const nextTree = remapVaultId(treeRef.current, from, to)
      treeRef.current = nextTree
      setTree(nextTree)
    }
    const existing = indexRef.current.notesById.get(from)
    if (existing) {
      const nextIndex = upsertNote(removeNote(indexRef.current, from), { ...existing, id: to })
      indexRef.current = nextIndex
      setIndex(nextIndex)
    }
    if (activeFileIdRef.current === from) {
      activeFileIdRef.current = to
      setActiveFileId(to)
    }
    setTabs((prev) => prev.map((tab) => (tab.id === from ? { ...tab, id: to } : tab)))
  }, [])

  const ensureDriveToken = useCallback(async (): Promise<string> => {
    if (demoRef.current) return 'demo'
    if (localRef.current) return 'local'
    if (browserOffline()) {
      throw new OfflineError()
    }
    const current = sessionRef.current
    if (current?.accessToken && current.expiresAt > Date.now() + 60_000) {
      return current.accessToken
    }
    const provider = current?.provider ?? 'google'
    let accessToken: string
    let expiresIn: number
    let githubScopes = current?.githubScopes
    if (provider === 'github') {
      const tokens = await fetchGithubToken()
      accessToken = tokens.accessToken
      expiresIn = tokens.expiresIn
      githubScopes = tokens.scopes
    } else {
      const tokens = await fetchDriveToken()
      accessToken = tokens.accessToken
      expiresIn = tokens.expiresIn
    }
    const next: AuthSession = {
      accessToken,
      expiresAt: Date.now() + expiresIn * 1000,
      email: current?.email,
      name: current?.name,
      picture: current?.picture,
      provider,
      githubScopes,
    }
    setSession(next)
    sessionRef.current = next
    setOffline(false)
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

      const queued = await getQueue()
      const resume = await peekOfflineResume()
      if (!cancelled) {
        setPendingCount(queued.length)
        setOfflineResume(resume)
        if (browserOffline()) setOffline(true)
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
            const snapshot = await loadSnapshot()
            if (snapshot?.identity.kind === 'local') {
              applySnapshot(snapshot)
              setOffline(true)
              setLocalPermissionNeeded(true)
              setStatusMessage(`Offline — ${snapshot.vault.folderName}`)
              setBootstrapping(false)
              return
            }
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
            const snapshot = await loadSnapshot()
            if (snapshot?.identity.kind === 'local') {
              applySnapshot(snapshot)
              setOffline(true)
              setLocalPermissionNeeded(true)
              setStatusMessage(`Offline — ${snapshot.vault.folderName}`)
            } else {
              setError(err instanceof Error ? err.message : 'Failed to restore local vault')
              setLocal(false)
              setSession(null)
              setVaultState(null)
            }
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
          if (browserOffline() && resume) {
            const snapshot = await loadSnapshot()
            if (snapshot) {
              applySnapshot(snapshot)
              setOffline(true)
              setStatusMessage(`Offline — ${snapshot.vault.folderName}`)
              setBootstrapping(false)
              return
            }
          }
          clearSession()
          setSession(null)
          setVaultState(null)
          setBootstrapping(false)
          return
        }

        setDemo(false)
        setLocal(false)
        disableDemoMode()
        const provider: AuthProvider = me.user.provider === 'github' ? 'github' : 'google'
        let accessToken: string
        let expiresIn: number
        let githubScopes: string | undefined
        if (provider === 'github') {
          const tokens = await fetchGithubToken()
          accessToken = tokens.accessToken
          expiresIn = tokens.expiresIn
          githubScopes = tokens.scopes
        } else {
          const tokens = await fetchDriveToken()
          accessToken = tokens.accessToken
          expiresIn = tokens.expiresIn
        }
        if (cancelled) return
        setSession({
          accessToken,
          expiresAt: Date.now() + expiresIn * 1000,
          email: me.user.email ?? undefined,
          name: me.user.name ?? undefined,
          picture: me.user.picture ?? undefined,
          provider,
          githubScopes,
        })
        setOffline(false)
        if (me.vault) {
          localStorage.setItem(VAULT_KEY, JSON.stringify(me.vault))
          setVaultState({ folderId: me.vault.folderId, folderName: me.vault.folderName })
          setStatusMessage(`Signed in as ${me.user.email ?? me.user.name ?? 'user'}`)
        } else {
          localStorage.removeItem(VAULT_KEY)
          setVaultState(null)
          setStatusMessage(`Signed in as ${me.user.email ?? me.user.name ?? 'user'}`)
        }
      } catch (err) {
        if (cancelled) return
        const snapshot = await loadSnapshot()
        if (snapshot && (shouldQueueOffline(err) || browserOffline())) {
          applySnapshot(snapshot)
          setOffline(true)
          setStatusMessage(`Offline — ${snapshot.vault.folderName}`)
        } else if (!cancelled) {
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
  }, [applySnapshot])

  const connect = useCallback(async () => {
    setConnecting(true)
    setError(null)
    disableDemoMode()
    await clearLocalVault()
    setDemo(false)
    setLocal(false)
    startGoogleLogin(false)
  }, [])

  const connectGithub = useCallback(async () => {
    setConnecting(true)
    setError(null)
    disableDemoMode()
    await clearLocalVault()
    setDemo(false)
    setLocal(false)
    startGithubLogin()
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
      await clearOfflineData()
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
      setOfflineResume(null)
      setPendingCount(0)
      setLocalPermissionNeeded(false)
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
      if (!demo && browserOffline()) {
        const snapshot = await loadSnapshot()
        if (snapshot) {
          applySnapshot(snapshot)
          setOffline(true)
          setStatusMessage('Offline — showing last synced vault')
          return
        }
      }
      const accessToken = demo || local ? (demo ? 'demo' : 'local') : await ensureDriveToken()
      const github = !demo && !local && session?.provider === 'github'
      const { root, files } = demo
        ? demoListVault()
        : local
          ? await localListVault(vault.folderName)
          : github
            ? await listGithubVaultTree(accessToken, vault.folderId, vault.folderName)
            : await listVaultTree(accessToken, vault.folderId, vault.folderName)
      setTree(root)
      treeRef.current = root
      const paths = buildPaths(files, vault.folderId)
      const textFiles = vaultTextFiles(files)
      let nextIndex = createEmptyIndex()
      const batchSize = 8
      for (let i = 0; i < textFiles.length; i += batchSize) {
        const batch = textFiles.slice(i, i + batchSize)
        const contents = await Promise.all(
          batch.map(async (file) => {
            if (contentCache.current.has(file.id)) {
              return { file, content: contentCache.current.get(file.id)! }
            }
            const content = demo
              ? demoRead(file.id)
              : local
                ? await localRead(file.id)
                : github
                  ? await githubRead(accessToken, vault.folderId, file.id)
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
      indexRef.current = nextIndex
      if (local) setLocalPermissionNeeded(false)
      const noteCount = textFiles.filter(
        (f) => !/\.base$/i.test(f.name) && !/\.canvas$/i.test(f.name),
      ).length
      const baseCount = textFiles.filter((f) => /\.base$/i.test(f.name)).length
      const canvasCount = textFiles.filter((f) => /\.canvas$/i.test(f.name)).length
      const parts = [`${noteCount} notes`]
      if (baseCount) parts.push(`${baseCount} bases`)
      if (canvasCount) parts.push(`${canvasCount} canvases`)
      setStatusMessage(`${parts.join(' · ')} indexed`)
      setOffline(false)
      await persistNow()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load vault'
      const permissionNeeded =
        local && /permission/i.test(message)
      if (permissionNeeded) setLocalPermissionNeeded(true)
      if (shouldQueueOffline(err) || permissionNeeded) {
        const snapshot = await loadSnapshot()
        if (snapshot) {
          applySnapshot(snapshot)
          setOffline(true)
          setError(null)
          setStatusMessage(
            permissionNeeded
              ? 'Folder access needed — showing last snapshot'
              : 'Offline — showing last synced vault',
          )
          return
        }
        if (treeRef.current) {
          setOffline(true)
          setError(null)
          setStatusMessage('Offline — using cached vault')
          return
        }
      }
      setError(message)
      setStatusMessage('Vault load failed')
    } finally {
      setLoadingVault(false)
    }
  }, [session, vault, demo, local, ensureDriveToken, persistNow, applySnapshot])

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
        await clearOfflineData()
        setOfflineResume(null)
        setPendingCount(0)
        setLocalPermissionNeeded(false)
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
        void clearOfflineData()
        setOfflineResume(null)
        setPendingCount(0)
      }
    })()
  }, [])

  useEffect(() => {
    if (bootstrapping) return
    if ((session || demo || local) && vault) void refreshVault()
  }, [session, vault, demo, local, refreshVault, bootstrapping])

  const openFile = useCallback(
    async (fileId: string, hint?: { name?: string; path?: string; fromHistory?: boolean }) => {
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
          const github = !demo && !local && session?.provider === 'github'
          content = demo
            ? demoRead(fileId)
            : local
              ? await localRead(fileId)
              : github
                ? await githubRead(accessToken, vault?.folderId ?? '', fileId)
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
        if (!hint?.fromHistory) {
          const nav = navRef.current
          const next = nav.stack.slice(0, nav.index + 1)
          if (next[next.length - 1] !== fileId) next.push(fileId)
          navRef.current = { stack: next.slice(-80), index: next.length - 1 }
        }
      } catch (err) {
        if (shouldQueueOffline(err)) {
          setError('This file is not available offline')
        } else {
          setError(err instanceof Error ? err.message : 'Failed to open file')
        }
      }
    },
    [session, demo, local, vault, ensureDriveToken],
  )

  const goBack = useCallback(() => {
    const nav = navRef.current
    if (nav.index <= 0) return
    nav.index -= 1
    const id = nav.stack[nav.index]
    if (id) void openFile(id, { fromHistory: true })
  }, [openFile])

  const goForward = useCallback(() => {
    const nav = navRef.current
    if (nav.index >= nav.stack.length - 1) return
    nav.index += 1
    const id = nav.stack[nav.index]
    if (id) void openFile(id, { fromHistory: true })
  }, [openFile])

  const closeTab = useCallback(
    (fileId: string) => {
      const tab = tabsRef.current.find((t) => t.id === fileId)
      if (tab) closedTabsRef.current = [...closedTabsRef.current, { ...tab, dirty: false }].slice(-40)
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== fileId)
        if (activeFileIdRef.current === fileId) {
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
    [openFile],
  )

  const undoCloseTab = useCallback(() => {
    const tab = closedTabsRef.current.pop()
    if (!tab) return
    void openFile(tab.id, { name: tab.name, path: tab.path })
  }, [openFile])

  const closeOtherTabs = useCallback(
    (fileId: string) => {
      setTabs((prev) => {
        const dropped = prev.filter((t) => t.id !== fileId)
        if (dropped.length) {
          closedTabsRef.current = [...closedTabsRef.current, ...dropped.map((t) => ({ ...t, dirty: false }))].slice(-40)
        }
        const keep = prev.filter((t) => t.id === fileId)
        if (!keep.length) return prev
        if (activeFileIdRef.current !== fileId) void openFile(fileId)
        return keep
      })
    },
    [openFile],
  )

  const closeAllTabs = useCallback(() => {
    closedTabsRef.current = [...closedTabsRef.current, ...tabsRef.current.map((t) => ({ ...t, dirty: false }))].slice(-40)
    setTabs([])
    setActiveFileId(null)
    setEditorContentState('')
  }, [])

  const closeTabsToTheRight = useCallback(
    (fileId: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === fileId)
        if (idx < 0) return prev
        const dropped = prev.slice(idx + 1)
        if (dropped.length) {
          closedTabsRef.current = [...closedTabsRef.current, ...dropped.map((t) => ({ ...t, dirty: false }))].slice(-40)
        }
        const next = prev.slice(0, idx + 1)
        if (activeFileIdRef.current && !next.some((t) => t.id === activeFileIdRef.current)) {
          void openFile(fileId)
        }
        return next
      })
    },
    [openFile],
  )

  const revealInNavigation = useCallback((fileId: string) => {
    setLeftPanel('files')
    setRevealRequest((prev) => ({ id: fileId, n: (prev?.n ?? 0) + 1 }))
  }, [])

  const expandAllFolders = useCallback(() => {
    setTreeExpandRequest((prev) => ({ mode: 'expand', n: (prev?.n ?? 0) + 1 }))
  }, [])

  const collapseAllFolders = useCallback(() => {
    setTreeExpandRequest((prev) => ({ mode: 'collapse', n: (prev?.n ?? 0) + 1 }))
  }, [])

  const queueOp = useCallback(async (op: MutationOp) => {
    const next = await enqueueMutation(op)
    setPendingCount(next.length)
    setOffline(true)
    schedulePersist()
    return next.length
  }, [schedulePersist])

  const applyLocalTextFile = useCallback(
    (id: string, parentId: string, fileName: string, content: string): CreatedFile => {
      const vaultId = vaultRef.current?.folderId ?? parentId
      const path = pathForNewChild(treeRef.current, vaultId, parentId, fileName)
      const mimeType = mimeForVaultName(fileName)
      if (treeRef.current) {
        const node: VaultNode = {
          id,
          name: fileName,
          path,
          mimeType,
          isFolder: false,
          parentId,
        }
        const nextTree = insertVaultChild(treeRef.current, parentId, node)
        treeRef.current = nextTree
        setTree(nextTree)
      }
      contentCache.current.set(id, content)
      const note = noteFromFile(
        { id, name: fileName, mimeType, modifiedTime: new Date().toISOString() },
        path,
        content,
      )
      const nextIndex = upsertNote(indexRef.current, note)
      indexRef.current = nextIndex
      setIndex(nextIndex)
      if (localRef.current) ensureLocalPathId(path)
      return { id, name: fileName, path }
    },
    [],
  )

  const rememberSaved = useCallback((fileId: string, content: string) => {
    contentCache.current.set(fileId, content)
    const existing = indexRef.current.notesById.get(fileId)
    const note = noteFromFile(
      {
        id: fileId,
        name: existing?.name ?? 'Untitled.md',
        mimeType: mimeForVaultName(existing?.name ?? 'Untitled.md'),
        modifiedTime: new Date().toISOString(),
      },
      existing?.path ?? 'Untitled.md',
      content,
    )
    const nextIndex = upsertNote(indexRef.current, note)
    indexRef.current = nextIndex
    setIndex(nextIndex)
    setTabs((prev) => prev.map((t) => (t.id === fileId ? { ...t, dirty: false } : t)))
    return note
  }, [])

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
        if (sessionRef.current?.provider === 'github') {
          const repoId = vaultRef.current?.folderId
          if (!repoId) throw new Error('No GitHub vault selected')
          await githubWrite(accessToken, repoId, fileId, content)
        } else {
          await updateTextFile(accessToken, fileId, content)
        }
      }
      const note = rememberSaved(fileId, content)
      setSaveStatus('saved')
      setStatusMessage(`Saved ${note.path}`)
      schedulePersist()
    } catch (err) {
      if (shouldQueueOffline(err)) {
        const note = rememberSaved(fileId, content)
        await queueOp({ type: 'write', fileId, content })
        setSaveStatus('pending')
        setError(null)
        setStatusMessage(`Saved on this device — ${note.path}`)
      } else {
        setSaveStatus('error')
        setError(err instanceof Error ? err.message : 'Save failed')
      }
    }
  }, [ensureDriveToken, queueOp, rememberSaved, schedulePersist])

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

  const createVaultTextFile = useCallback(
    async (
      parentId: string,
      fileName: string,
      content: string,
      kind: 'note' | 'base' | 'canvas',
      options?: CreateFileOptions,
    ): Promise<CreatedFile> => {
      const github = !demoRef.current && !localRef.current && sessionRef.current?.provider === 'github'
      const mimeType =
        kind === 'base'
          ? 'application/x-obsidian-base'
          : kind === 'canvas'
            ? 'application/x-obsidian-canvas'
            : 'text/markdown'
      let file: DriveFile
      try {
        file = demoRef.current
          ? demoCreateNote(parentId, fileName, content)
          : localRef.current
            ? await localCreateNote(parentId, fileName, content)
            : github
              ? await githubCreateNote(
                  await ensureDriveToken(),
                  vaultRef.current!.folderId,
                  parentId,
                  fileName,
                  content,
                )
              : kind === 'note'
                ? await createMarkdownFile(await ensureDriveToken(), parentId, fileName, content)
                : await createTextFile(await ensureDriveToken(), parentId, fileName, content, mimeType)
      } catch (err) {
        if (!shouldQueueOffline(err)) throw err
        const vaultId = vaultRef.current?.folderId ?? parentId
        const path = pathForNewChild(treeRef.current, vaultId, parentId, fileName)
        const id = github
          ? githubPathId(vaultId, path)
          : localRef.current
            ? ensureLocalPathId(path)
            : newPendingId()
        await queueOp({ type: 'create', tempId: id, parentId, name: fileName, content, kind })
        const created = applyLocalTextFile(id, parentId, fileName, content)
        if (options?.open !== false) await openFile(created.id, { name: created.name, path: created.path })
        return created
      }
      const resolvedName = file.name || fileName
      const pathHint =
        github && file.id.includes(':')
          ? file.id.slice(file.id.indexOf(':') + 1)
          : pathForNewChild(treeRef.current, vaultRef.current?.folderId ?? parentId, parentId, resolvedName)
      contentCache.current.set(file.id, content)
      const nextIndex = upsertNote(
        indexRef.current,
        noteFromFile({ ...file, name: resolvedName }, pathHint, content),
      )
      indexRef.current = nextIndex
      setIndex(nextIndex)
      schedulePersist()
      if (options?.open !== false) await openFile(file.id, { name: resolvedName, path: pathHint })
      if (!offlineRef.current) void refreshVault()
      return { id: file.id, name: resolvedName, path: pathHint }
    },
    [applyLocalTextFile, ensureDriveToken, openFile, queueOp, refreshVault, schedulePersist],
  )

  const createNote = useCallback(
    async (parentId: string, name: string, options?: CreateFileOptions): Promise<CreatedFile> => {
      const fileName = ensureMarkdownFileName(name)
      const content = options?.content ?? seedNoteContent(fileName)
      return createVaultTextFile(parentId, fileName, content, 'note', options)
    },
    [createVaultTextFile],
  )

  const createBase = useCallback(
    async (parentId: string, name: string, options?: CreateFileOptions): Promise<CreatedFile> => {
      const fileName = ensureBaseFileName(name)
      const content = options?.content ?? defaultBaseContent()
      return createVaultTextFile(parentId, fileName, content, 'base', options)
    },
    [createVaultTextFile],
  )

  const createCanvas = useCallback(
    async (parentId: string, name: string, options?: CreateFileOptions): Promise<CreatedFile> => {
      const fileName = ensureCanvasFileName(name)
      const content = options?.content ?? defaultCanvasContent()
      return createVaultTextFile(parentId, fileName, content, 'canvas', options)
    },
    [createVaultTextFile],
  )

  const duplicateFile = useCallback(
    async (fileId: string) => {
      const node = findVaultNode(treeRef.current, fileId)
      if (!node || node.isFolder) return
      const parentId = node.parentId ?? vaultRef.current?.folderId
      if (!parentId) return
      const parent = findVaultNode(treeRef.current, parentId) ?? treeRef.current
      const copyName = uniqueCopyName(node.name, childNames(parent))
      let content =
        contentCache.current.get(fileId) ?? indexRef.current.notesById.get(fileId)?.content
      if (content == null) {
        if (demoRef.current) content = demoRead(fileId)
        else if (localRef.current) content = await localRead(fileId)
        else {
          const accessToken = await ensureDriveToken()
          content =
            sessionRef.current?.provider === 'github'
              ? await githubRead(accessToken, vaultRef.current?.folderId ?? '', fileId)
              : await downloadTextFile(accessToken, fileId)
        }
      }
      const options: CreateFileOptions = { content, open: true }
      if (isBaseFileName(node.name)) await createBase(parentId, copyName, options)
      else if (isCanvasFileName(node.name)) await createCanvas(parentId, copyName, options)
      else await createNote(parentId, copyName, options)
    },
    [createBase, createCanvas, createNote, ensureDriveToken],
  )

  const writeFileContent = useCallback(
    async (fileId: string, content: string) => {
      if (!demoRef.current && !localRef.current && !sessionRef.current) return
      contentCache.current.set(fileId, content)
      try {
        if (demoRef.current) demoWrite(fileId, content)
        else if (localRef.current) await localWrite(fileId, content)
        else {
          const accessToken = await ensureDriveToken()
          if (sessionRef.current?.provider === 'github') {
            const repoId = vaultRef.current?.folderId
            if (!repoId) throw new Error('No GitHub vault selected')
            await githubWrite(accessToken, repoId, fileId, content)
          } else {
            await updateTextFile(accessToken, fileId, content)
          }
        }
      } catch (err) {
        if (!shouldQueueOffline(err)) throw err
        await queueOp({ type: 'write', fileId, content })
      }
      const existing = indexRef.current.notesById.get(fileId)
      if (existing) {
        const note = noteFromFile(
          {
            id: fileId,
            name: existing.name,
            mimeType: mimeForVaultName(existing.name),
            modifiedTime: new Date().toISOString(),
          },
          existing.path,
          content,
        )
        const nextIndex = upsertNote(indexRef.current, note)
        indexRef.current = nextIndex
        setIndex(nextIndex)
      }
      if (activeFileIdRef.current === fileId) {
        setEditorContentState(content)
        setTabs((prev) => prev.map((t) => (t.id === fileId ? { ...t, dirty: false } : t)))
        setSaveStatus(offlineRef.current ? 'pending' : 'saved')
      }
      schedulePersist()
    },
    [ensureDriveToken, queueOp, schedulePersist],
  )

  const createDirectory = useCallback(
    async (parentId: string, name: string) => {
      const github = !demoRef.current && !localRef.current && sessionRef.current?.provider === 'github'
      const vaultId = vaultRef.current?.folderId ?? parentId
      const path = pathForNewChild(treeRef.current, vaultId, parentId, name)
      try {
        if (demoRef.current) demoCreateFolder(parentId, name)
        else if (localRef.current) await localCreateFolder(parentId, name)
        else if (github) {
          await githubCreateFolder(await ensureDriveToken(), vaultId, parentId, name)
        } else await createFolder(await ensureDriveToken(), parentId, name)
        if (!offlineRef.current) await refreshVault()
      } catch (err) {
        if (!shouldQueueOffline(err)) throw err
        const id = github
          ? githubPathId(vaultId, path)
          : localRef.current
            ? ensureLocalPathId(path)
            : newPendingId()
        await queueOp({ type: 'mkdir', tempId: id, parentId, name })
        if (treeRef.current) {
          const node: VaultNode = {
            id,
            name,
            path,
            mimeType: 'application/vnd.google-apps.folder',
            isFolder: true,
            parentId,
            children: [],
          }
          const nextTree = insertVaultChild(treeRef.current, parentId, node)
          treeRef.current = nextTree
          setTree(nextTree)
        }
        setStatusMessage(`Folder created on this device — ${name}`)
      }
    },
    [ensureDriveToken, queueOp, refreshVault],
  )

  const openNoteByTitle = useCallback(
    async (title: string, fromPath?: string) => {
      const note = resolveNoteRef(indexRef.current, title, { fromPath })
      if (!note) return false
      await openFile(note.id)
      return true
    },
    [openFile],
  )

  const renameNode = useCallback(
    async (id: string, name: string) => {
      const existing = indexRef.current.notesById.get(id)
      const oldRef = existing
        ? { title: existing.title, path: existing.path, name: existing.name }
        : null
      const nextPath = existing
        ? existing.path.includes('/')
          ? `${existing.path.slice(0, existing.path.lastIndexOf('/') + 1)}${name}`
          : name
        : name
      const newRef = {
        title: noteTitleFromFileName(name),
        path: nextPath,
        name,
      }

      try {
        if (demoRef.current) demoRename(id, name)
        else if (localRef.current) await localRename(id, name)
        else if (sessionRef.current?.provider === 'github') {
          await githubRename(await ensureDriveToken(), vaultRef.current!.folderId, id, name)
        } else await renameFile(await ensureDriveToken(), id, name)
      } catch (err) {
        if (!shouldQueueOffline(err)) throw err
        await queueOp({ type: 'rename', fileId: id, name })
      }

      // Obsidian-style: rewrite wikilinks across the vault that pointed at the old name
      if (oldRef && (oldRef.title !== newRef.title || oldRef.path !== newRef.path)) {
        for (const note of indexRef.current.notesById.values()) {
          if (note.id === id) continue
          const nextContent = rewriteLinksForRename(note.content, oldRef, newRef)
          if (nextContent === note.content) continue
          try {
            await writeFileContent(note.id, nextContent)
          } catch {
            /* keep going — best-effort link updates */
          }
        }
      }

      if (treeRef.current) {
        const nextTree = renameVaultNode(treeRef.current, id, name)
        treeRef.current = nextTree
        setTree(nextTree)
      }

      let liveId = id
      if (sessionRef.current?.provider === 'github' && vaultRef.current) {
        const nextId = githubPathId(vaultRef.current.folderId, nextPath)
        if (nextId !== id) {
          remapLocalId(id, nextId)
          liveId = nextId
        }
      }

      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== liveId && t.id !== id) return t
          return { ...t, id: liveId, name, path: nextPath }
        }),
      )
      setIndex((prev) => {
        const current = prev.notesById.get(liveId) ?? prev.notesById.get(id)
        if (!current) return prev
        return upsertNote(removeNote(prev, id), {
          ...current,
          id: liveId,
          name,
          title: newRef.title,
          path: nextPath,
          content:
            oldRef && current.content
              ? rewriteLinksForRename(current.content, oldRef, newRef)
              : current.content,
        })
      })
      if ((activeFileIdRef.current === id || activeFileIdRef.current === liveId) && oldRef) {
        setEditorContentState((prev) => rewriteLinksForRename(prev, oldRef, newRef))
      }
      schedulePersist()
      if (!offlineRef.current) await refreshVault()
    },
    [refreshVault, ensureDriveToken, writeFileContent, queueOp, remapLocalId, schedulePersist],
  )

  const deleteNode = useCallback(
    async (id: string) => {
      try {
        if (demoRef.current) demoTrash(id)
        else if (localRef.current) await localTrash(id)
        else if (sessionRef.current?.provider === 'github') {
          await githubDelete(await ensureDriveToken(), vaultRef.current!.folderId, id)
        } else await trashFile(await ensureDriveToken(), id)
      } catch (err) {
        if (!shouldQueueOffline(err)) throw err
        await queueOp({ type: 'delete', fileId: id })
      }
      contentCache.current.delete(id)
      if (treeRef.current) {
        const nextTree = removeVaultNode(treeRef.current, id)
        treeRef.current = nextTree
        setTree(nextTree)
      }
      const nextIndex = removeNote(indexRef.current, id)
      indexRef.current = nextIndex
      setIndex(nextIndex)
      setTabs((prev) => prev.filter((t) => t.id !== id))
      if (activeFileIdRef.current === id) {
        setActiveFileId(null)
        setEditorContentState('')
      }
      schedulePersist()
      if (!offlineRef.current) await refreshVault()
    },
    [refreshVault, ensureDriveToken, queueOp, schedulePersist],
  )

  const flushQueue = useCallback(async () => {
    if (syncingRef.current || demoRef.current) return
    if (browserOffline()) return
    const queue = await getQueue()
    if (!queue.length) {
      setPendingCount(0)
      return
    }
    syncingRef.current = true
    setStatusMessage('Syncing local changes…')
    try {
      const accessToken = localRef.current ? 'local' : await ensureDriveToken()
      const github = !localRef.current && sessionRef.current?.provider === 'github'
      const vaultId = vaultRef.current?.folderId ?? ''
      let remaining = [...queue]
      while (remaining.length) {
        const item = remaining[0]!
        const op = item.op
        let remapFrom: string | null = null
        let remapTo: string | null = null
        if (op.type === 'write') {
          if (localRef.current) await localWrite(op.fileId, op.content)
          else if (github) await githubWrite(accessToken, vaultId, op.fileId, op.content)
          else await updateTextFile(accessToken, op.fileId, op.content)
        } else if (op.type === 'create') {
          const mimeType =
            op.kind === 'base'
              ? 'application/x-obsidian-base'
              : op.kind === 'canvas'
                ? 'application/x-obsidian-canvas'
                : 'text/markdown'
          const file = localRef.current
            ? await localCreateNote(op.parentId, op.name, op.content)
            : github
              ? await githubCreateNote(accessToken, vaultId, op.parentId, op.name, op.content)
              : op.kind === 'note'
                ? await createMarkdownFile(accessToken, op.parentId, op.name, op.content)
                : await createTextFile(accessToken, op.parentId, op.name, op.content, mimeType)
          if (file.id !== op.tempId) {
            remapLocalId(op.tempId, file.id)
            remapFrom = op.tempId
            remapTo = file.id
          }
        } else if (op.type === 'mkdir') {
          const file = localRef.current
            ? await localCreateFolder(op.parentId, op.name)
            : github
              ? await githubCreateFolder(accessToken, vaultId, op.parentId, op.name)
              : await createFolder(accessToken, op.parentId, op.name)
          if (file.id !== op.tempId) {
            remapLocalId(op.tempId, file.id)
            remapFrom = op.tempId
            remapTo = file.id
          }
        } else if (op.type === 'rename') {
          if (localRef.current) await localRename(op.fileId, op.name)
          else if (github) await githubRename(accessToken, vaultId, op.fileId, op.name)
          else await renameFile(accessToken, op.fileId, op.name)
        } else if (op.type === 'delete') {
          if (localRef.current) await localTrash(op.fileId)
          else if (github) await githubDelete(accessToken, vaultId, op.fileId)
          else await trashFile(accessToken, op.fileId)
        }
        remaining = remaining.slice(1)
        if (remapFrom && remapTo) remaining = remapMutationIds(remaining, remapFrom, remapTo)
        await setQueue(remaining)
        setPendingCount(remaining.length)
      }
      setOffline(false)
      setSaveStatus('saved')
      setStatusMessage('Synced')
      await persistNow()
    } catch (err) {
      if (shouldQueueOffline(err)) {
        setOffline(true)
        setStatusMessage('Still offline — changes kept on this device')
      } else {
        setError(err instanceof Error ? err.message : 'Failed to sync local changes')
      }
    } finally {
      syncingRef.current = false
    }
  }, [ensureDriveToken, persistNow, remapLocalId])

  const syncPending = useCallback(async () => {
    await flushQueue()
    if (!offlineRef.current) await refreshVault()
  }, [flushQueue, refreshVault])

  const resumeOffline = useCallback(async () => {
    const snapshot = await loadSnapshot()
    if (!snapshot) {
      setError('No offline vault is stored on this device')
      return
    }
    applySnapshot(snapshot)
    setOffline(true)
    setPendingCount((await getQueue()).length)
    setStatusMessage(`Offline — ${snapshot.vault.folderName}`)
  }, [applySnapshot])

  const grantLocalAccess = useCallback(async () => {
    const granted = await requestLocalVaultPermission()
    if (!granted) {
      setError('Folder access was not granted')
      setLocalPermissionNeeded(true)
      return
    }
    setLocalPermissionNeeded(false)
    setError(null)
    await flushQueue()
    await refreshVault()
  }, [flushQueue, refreshVault])

  useEffect(() => {
    function onOnline() {
      setOffline(false)
      void (async () => {
        await flushQueue()
        if (vaultRef.current) await refreshVault()
      })()
    }
    function onOffline() {
      setOffline(true)
      setStatusMessage('Offline — edits saved on this device')
    }
    function onVisible() {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        void flushQueue()
      }
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [flushQueue, refreshVault])

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
      searchQuery,
      localGraph,
      revealRequest,
      treeExpandRequest,
      offline,
      pendingCount,
      offlineResume,
      localPermissionNeeded,
      connect,
      connectGithub,
      connectLocal,
      startDemo,
      disconnect,
      setVault,
      clearVault,
      refreshVault,
      openFile,
      closeTab,
      closeOtherTabs,
      closeAllTabs,
      closeTabsToTheRight,
      goBack,
      goForward,
      undoCloseTab,
      setEditorContent,
      saveActiveFile,
      createNote,
      createBase,
      createCanvas,
      createDirectory,
      duplicateFile,
      renameNode,
      deleteNode,
      writeFileContent,
      setViewMode,
      setLeftPanel,
      setRightPanel,
      setSearchQuery,
      setLocalGraph,
      revealInNavigation,
      expandAllFolders,
      collapseAllFolders,
      openNoteByTitle,
      setError,
      resumeOffline,
      syncPending,
      grantLocalAccess,
      authProvider: demo || local ? null : session?.provider ?? null,
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
      searchQuery,
      localGraph,
      revealRequest,
      treeExpandRequest,
      offline,
      pendingCount,
      offlineResume,
      localPermissionNeeded,
      connect,
      connectGithub,
      connectLocal,
      startDemo,
      disconnect,
      setVault,
      clearVault,
      refreshVault,
      openFile,
      closeTab,
      closeOtherTabs,
      closeAllTabs,
      closeTabsToTheRight,
      goBack,
      goForward,
      undoCloseTab,
      setEditorContent,
      saveActiveFile,
      createNote,
      createBase,
      createCanvas,
      createDirectory,
      duplicateFile,
      renameNode,
      deleteNode,
      writeFileContent,
      setViewMode,
      setLeftPanel,
      setRightPanel,
      setSearchQuery,
      setLocalGraph,
      revealInNavigation,
      expandAllFolders,
      collapseAllFolders,
      openNoteByTitle,
      resumeOffline,
      syncPending,
      grantLocalAccess,
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
