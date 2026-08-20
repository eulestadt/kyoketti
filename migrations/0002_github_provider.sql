-- Multi-provider auth (Google Drive + GitHub)
ALTER TABLE users ADD COLUMN provider TEXT NOT NULL DEFAULT 'google';
ALTER TABLE oauth_states ADD COLUMN provider TEXT NOT NULL DEFAULT 'google';

CREATE INDEX IF NOT EXISTS users_provider_idx ON users(provider);
