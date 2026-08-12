import type { DriveFile, VaultNode } from '../types'

const DEMO_KEY = 'kyoketti.demo.files.v3'

export type DemoFile = {
  id: string
  name: string
  mimeType: string
  parentId: string
  content?: string
  modifiedTime: string
}

const STARTER: DemoFile[] = [
  {
    id: 'demo-root',
    name: 'Demo Vault',
    mimeType: 'application/vnd.google-apps.folder',
    parentId: 'root',
    modifiedTime: new Date().toISOString(),
  },
  {
    id: 'demo-welcome',
    name: 'Welcome.md',
    mimeType: 'text/markdown',
    parentId: 'demo-root',
    modifiedTime: new Date().toISOString(),
    content: `---
tags: [welcome, kyoketti]
---

# Welcome to Kyoketti

This is a local demo vault. Link Google Drive from settings when you're ready to sync real notes.

## Try these

- Open [[Daily Note]]
- Follow a tag like #welcome
- Switch to graph view from the left ribbon
- Press Ctrl/Cmd+O for the quick switcher
- Open [[Vault Overview]] for an Obsidian Bases table of your notes
- Open [[Ideas Canvas]] for a visual Canvas board

> Markdown with [[wiki links]] keeps related notes connected.
`,
  },
  {
    id: 'demo-daily',
    name: 'Daily Note.md',
    mimeType: 'text/markdown',
    parentId: 'demo-root',
    modifiedTime: new Date().toISOString(),
    content: `# Daily Note

Linked from [[Welcome]].

- Capture ideas
- Link notes with [[Projects]]
- Use #daily tags

`,
  },
  {
    id: 'demo-projects',
    name: 'Projects.md',
    mimeType: 'text/markdown',
    parentId: 'demo-root',
    modifiedTime: new Date().toISOString(),
    content: `---
status: active
area: product
---

# Projects

- Build Kyoketti
- Keep notes in Drive
- See also [[Welcome]]
- Open [[Vault Overview.base]] for a Bases table of notes
`,
  },
  {
    id: 'demo-base',
    name: 'Vault Overview.base',
    mimeType: 'application/x-obsidian-base',
    parentId: 'demo-root',
    modifiedTime: new Date().toISOString(),
    content: `filters:
  and:
    - 'file.ext == "md"'
formulas:
  updated: 'file.mtime.relative()'
properties:
  file.name:
    displayName: Name
  file.mtime:
    displayName: Modified
  formula.updated:
    displayName: Updated
  status:
    displayName: Status
views:
  - type: table
    name: Table
    order:
      - file.name
      - status
      - formula.updated
      - file.size
  - type: list
    name: List
    order:
      - file.name
      - status
  - type: cards
    name: Cards
    order:
      - file.name
      - status
      - formula.updated
`,
  },
  {
    id: 'demo-canvas',
    name: 'Ideas Canvas.canvas',
    mimeType: 'application/x-obsidian-canvas',
    parentId: 'demo-root',
    modifiedTime: new Date().toISOString(),
    content: `{
  "nodes": [
    {
      "id": "welcome",
      "type": "text",
      "x": -120,
      "y": -80,
      "width": 320,
      "height": 180,
      "color": "5",
      "text": "## Ideas Canvas\\n\\nConnect notes visually.\\nDrag from card edges to link cards."
    },
    {
      "id": "note-welcome",
      "type": "file",
      "x": 280,
      "y": -40,
      "width": 280,
      "height": 200,
      "file": "Welcome.md"
    },
    {
      "id": "note-projects",
      "type": "file",
      "x": 280,
      "y": 220,
      "width": 280,
      "height": 180,
      "file": "Projects.md",
      "color": "4"
    },
    {
      "id": "group-1",
      "type": "group",
      "x": 240,
      "y": -80,
      "width": 360,
      "height": 520,
      "label": "Vault notes"
    }
  ],
  "edges": [
    {
      "id": "e1",
      "fromNode": "welcome",
      "fromSide": "right",
      "toNode": "note-welcome",
      "toSide": "left",
      "toEnd": "arrow",
      "label": "start here"
    },
    {
      "id": "e2",
      "fromNode": "note-welcome",
      "fromSide": "bottom",
      "toNode": "note-projects",
      "toSide": "top",
      "toEnd": "arrow"
    }
  ]
}
`,
  },
]

function loadFiles(): DemoFile[] {
  try {
    const raw = localStorage.getItem(DEMO_KEY)
    if (raw) return JSON.parse(raw) as DemoFile[]
  } catch {
    /* ignore */
  }
  localStorage.setItem(DEMO_KEY, JSON.stringify(STARTER))
  return STARTER
}

function saveFiles(files: DemoFile[]) {
  localStorage.setItem(DEMO_KEY, JSON.stringify(files))
}

export function isDemoMode(): boolean {
  return localStorage.getItem('kyoketti.demo') === '1'
}

export function enableDemoMode() {
  localStorage.setItem('kyoketti.demo', '1')
  if (!localStorage.getItem(DEMO_KEY)) saveFiles(STARTER)
}

export function disableDemoMode() {
  localStorage.removeItem('kyoketti.demo')
}

export function demoListVault(): { root: VaultNode; files: DriveFile[] } {
  const files = loadFiles().filter((f) => f.id !== 'demo-root')
  const all = loadFiles()
  const childrenByParent = new Map<string, DemoFile[]>()
  for (const file of all) {
    if (file.id === 'demo-root') continue
    const list = childrenByParent.get(file.parentId) ?? []
    list.push(file)
    childrenByParent.set(file.parentId, list)
  }

  function build(id: string, name: string, path: string, mimeType: string): VaultNode {
    const isFolder = mimeType === 'application/vnd.google-apps.folder'
    const children = (childrenByParent.get(id) ?? [])
      .map((f) => build(f.id, f.name, path ? `${path}/${f.name}` : f.name, f.mimeType))
      .sort((a, b) => Number(b.isFolder) - Number(a.isFolder) || a.name.localeCompare(b.name))
    return { id, name, path, mimeType, isFolder, children: isFolder ? children : undefined }
  }

  const driveFiles: DriveFile[] = files.map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    parents: [f.parentId],
    modifiedTime: f.modifiedTime,
  }))

  return {
    root: build('demo-root', 'Demo Vault', '', 'application/vnd.google-apps.folder'),
    files: driveFiles,
  }
}

export function demoRead(id: string): string {
  return loadFiles().find((f) => f.id === id)?.content ?? ''
}

export function demoWrite(id: string, content: string) {
  const files = loadFiles()
  const next = files.map((f) =>
    f.id === id ? { ...f, content, modifiedTime: new Date().toISOString() } : f,
  )
  saveFiles(next)
}

export function demoCreateNote(parentId: string, name: string, content: string): DriveFile {
  const id = `demo-${crypto.randomUUID()}`
  const fileName = /\.base$/i.test(name) || /\.canvas$/i.test(name)
    ? name
    : name.endsWith('.md')
      ? name
      : `${name}.md`
  const mimeType = /\.base$/i.test(fileName)
    ? 'application/x-obsidian-base'
    : /\.canvas$/i.test(fileName)
      ? 'application/x-obsidian-canvas'
      : 'text/markdown'
  const files = loadFiles()
  files.push({
    id,
    name: fileName,
    mimeType,
    parentId,
    content,
    modifiedTime: new Date().toISOString(),
  })
  saveFiles(files)
  return { id, name: fileName, mimeType, parents: [parentId] }
}

export function demoCreateFolder(parentId: string, name: string): DriveFile {
  const id = `demo-${crypto.randomUUID()}`
  const files = loadFiles()
  files.push({
    id,
    name,
    mimeType: 'application/vnd.google-apps.folder',
    parentId,
    modifiedTime: new Date().toISOString(),
  })
  saveFiles(files)
  return { id, name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }
}

export function demoRename(id: string, name: string) {
  saveFiles(loadFiles().map((f) => (f.id === id ? { ...f, name } : f)))
}

export function demoTrash(id: string) {
  const files = loadFiles()
  const remove = new Set<string>([id])
  let changed = true
  while (changed) {
    changed = false
    for (const f of files) {
      if (remove.has(f.parentId) && !remove.has(f.id)) {
        remove.add(f.id)
        changed = true
      }
    }
  }
  saveFiles(files.filter((f) => !remove.has(f.id)))
}
