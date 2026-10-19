/**
 * Access token held in memory only (never localStorage), so an XSS payload cannot read a
 * long-lived credential. The refresh token lives in an httpOnly cookie the JS cannot see.
 */
let accessToken: string | null = null
const expiryListeners = new Set<() => void>()

export const tokenStore = {
  get: () => accessToken,
  set: (token: string | null) => {
    accessToken = token
  },
  /** Called by the API client when the session cannot be renewed. */
  expire() {
    accessToken = null
    expiryListeners.forEach((listener) => listener())
  },
  onExpire(listener: () => void) {
    expiryListeners.add(listener)
    return () => {
      expiryListeners.delete(listener)
    }
  },
}
