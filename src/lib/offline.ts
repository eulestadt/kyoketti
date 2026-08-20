/** Network / auth failure helpers for offline vault support. */

export class OfflineError extends Error {
  constructor(message = 'You are offline') {
    super(message)
    this.name = 'OfflineError'
  }
}

function statusOf(err: unknown): number | null {
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status: unknown }).status
    if (typeof status === 'number') return status
  }
  return null
}

export function isUnauthorizedError(err: unknown): boolean {
  if (statusOf(err) === 401) return true
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase()
  return message.includes('unauthorized') || message.includes('invalid credentials')
}

export function isNetworkFailure(err: unknown): boolean {
  if (err instanceof OfflineError) return true
  if (err instanceof TypeError) {
    const message = err.message.toLowerCase()
    return (
      message.includes('failed to fetch') ||
      message.includes('networkerror') ||
      message.includes('network error') ||
      message.includes('load failed')
    )
  }
  if (typeof DOMException !== 'undefined' && err instanceof DOMException) {
    return err.name === 'NetworkError' || err.name === 'AbortError'
  }
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase()
  return (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network error') ||
    message.includes('load failed')
  )
}

export function isOfflineError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  return isNetworkFailure(err)
}

/** Queue when a retry is likely to succeed later (offline / dropped network). */
export function shouldQueueOffline(err: unknown): boolean {
  if (isUnauthorizedError(err) && !isNetworkFailure(err) && navigator.onLine) return false
  if (isOfflineError(err)) return true
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase()
  return (
    message.includes('unknown local file') ||
    message.includes('no local vault') ||
    (message.includes('permission') && message.includes('local'))
  )
}

export function browserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}
