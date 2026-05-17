import { defineStore } from 'pinia'

const AUTH_TOKEN_KEY = 'yd-auth-token'

const readPersistedToken = (): string | null => {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(AUTH_TOKEN_KEY)
}

const persistToken = (token: string | null) => {
  if (typeof window === 'undefined') return
  if (token) {
    window.localStorage.setItem(AUTH_TOKEN_KEY, token)
  } else {
    window.localStorage.removeItem(AUTH_TOKEN_KEY)
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
    setToken(token: string) {
      this.token = token
      persistToken(token)
    },
    clearToken() {
      this.token = null
      persistToken(null)
    }
  }
})
