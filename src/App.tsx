import { AppProvider, useApp } from './hooks/useApp'
import { ConnectDrive } from './components/ConnectDrive'
import { VaultPicker } from './components/VaultPicker'
import { Workspace } from './components/Workspace'
import './index.css'

function Root() {
  const { session, vault, demo } = useApp()

  if (!session && !demo) return <ConnectDrive />
  if (!vault) return <VaultPicker />
  return <Workspace />
}

export default function App() {
  return (
    <AppProvider>
      <Root />
    </AppProvider>
  )
}
