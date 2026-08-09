import { AppProvider, useApp } from './hooks/useApp'
import { ThemeProvider } from './hooks/useTheme'
import { ConnectDrive } from './components/ConnectDrive'
import { VaultPicker } from './components/VaultPicker'
import { Workspace } from './components/Workspace'
import './index.css'

function Root() {
  const { session, vault, demo, local, bootstrapping } = useApp()

  if (bootstrapping) {
    return (
      <div className="boot-screen">
        <p>Restoring your session…</p>
      </div>
    )
  }

  if (!session && !demo && !local) return <ConnectDrive />
  if (!vault) return <VaultPicker />
  return <Workspace />
}

export default function App() {
  return (
    <ThemeProvider>
      <AppProvider>
        <Root />
      </AppProvider>
    </ThemeProvider>
  )
}
