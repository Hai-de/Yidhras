import { defineStore } from 'pinia'

const AUTH_TOKEN_KEY = 'yd-auth-token'

const readPersistedToken = (): string | null => {
  if (typeof window === 'undefined') return null

  try {
    return window.localStorage.getItem(AUTH_TOKEN_KEY) ?? window.sessionStorage.getItem(AUTH_TOKEN_KEY)
  } catch {
    return null
  }
}

const persistToken = (token: string | null, remember: boolean) => {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.removeItem(AUTH_TOKEN_KEY)
    window.sessionStorage.removeItem(AUTH_TOKEN_KEY)

    if (!token) return

    if (remember) {
      window.localStorage.setItem(AUTH_TOKEN_KEY, token)
    } else {
      window.sessionStorage.setItem(AUTH_TOKEN_KEY, token)
    }
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

export const useAuthStore = defineStore('auth', {
  state: (): {
    token: string | null
  } => ({
    token: readPersistedToken()
  }),
  getters: {
    isAuthenticated: state => state.token !== null
  },
  actions: {
    setToken(token: string, remember = true) {
      this.token = token
      persistToken(token, remember)
    },
    clearToken() {
      this.token = null
      persistToken(null, false)
    }
  }
})
