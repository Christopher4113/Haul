import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import { AuthContext } from "@/context/auth-context"
import { api, tokenStorage, type User } from "@/lib/api"

function readStoredToken() {
  return tokenStorage.get()
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(readStoredToken)
  const [loading, setLoading] = useState(() => readStoredToken() !== null)

  useEffect(() => {
    if (!token) {
      return
    }

    let cancelled = false

    api.me(token)
      .then((profile) => {
        if (!cancelled) {
          setUser(profile)
        }
      })
      .catch(() => {
        if (!cancelled) {
          tokenStorage.remove()
          setToken(null)
          setUser(null)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [token])

  const persistSession = useCallback((nextToken: string, nextUser: User) => {
    tokenStorage.set(nextToken)
    setToken(nextToken)
    setUser(nextUser)
    setLoading(false)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const response = await api.login({ email, password })
    persistSession(response.token, response.user)
  }, [persistSession])

  const signup = useCallback(async (name: string, email: string, password: string) => {
    const response = await api.register({ name, email, password })
    persistSession(response.token, response.user)
  }, [persistSession])

  const logout = useCallback(() => {
    tokenStorage.remove()
    setToken(null)
    setUser(null)
    setLoading(false)
  }, [])

  const value = useMemo(
    () => ({ user, token, loading, login, signup, logout }),
    [user, token, loading, login, signup, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
