export type Env = {
  DB: D1Database
  ASSETS: Fetcher
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  SESSION_SECRET: string
  APP_ORIGIN?: string
}

export type UserRow = {
  id: string
  email: string | null
  name: string | null
  picture: string | null
  refresh_token_enc: string
  vault_folder_id: string | null
  vault_folder_name: string | null
  created_at: string
  updated_at: string
}

export type PublicUser = {
  id: string
  email: string | null
  name: string | null
  picture: string | null
}

export type VaultInfo = {
  folderId: string
  folderName: string
} | null
