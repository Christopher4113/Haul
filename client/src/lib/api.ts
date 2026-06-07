const API_URL = import.meta.env.VITE_API_URL as string

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null,
): Promise<T> {
  const headers = new Headers(options.headers)
  headers.set("Content-Type", "application/json")
  if (token) {
    headers.set("Authorization", `Bearer ${token}`)
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new ApiError(
      response.status,
      typeof payload.error === "string" ? payload.error : "Request failed",
    )
  }

  return payload as T
}

export interface User {
  id: string
  email: string
  name: string
  created_at: string
}

export interface AuthResponse {
  token: string
  user: User
}

export interface ErrandResponse {
  id: string
  name: string
  address: string
  lat: number
  lng: number
}

export interface Errand {
  id: string
  name: string
  address: string
  lat: number | null
  lng: number | null
  clusterId: string | null
}

export const api = {
  register: (body: { name: string; email: string; password: string }) =>
    request<AuthResponse>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  login: (body: { email: string; password: string }) =>
    request<AuthResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  me: (token: string) =>
    request<User>("/api/auth/me", { method: "GET" }, token),

  forgotPassword: (body: { email: string }) =>
    request<{ message: string }>("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  resetPassword: (body: { token: string; password: string }) =>
    request<{ message: string }>("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  addErrand: (
    token: string,
    body: { session_id: string; name: string; address: string },
  ) =>
    request<ErrandResponse>(
      "/api/errands",
      { method: "POST", body: JSON.stringify(body) },
      token,
    ),

  optimizeRoute: async (token: string, sessionId: string, signal?: AbortSignal) => {
    const response = await fetch(`${API_URL}/api/routes/optimize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ session_id: sessionId }),
      signal,
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new ApiError(
        response.status,
        typeof payload.error === "string" ? payload.error : "Request failed",
      )
    }

    return response
  },
}

export const TOKEN_KEY = "haul_token"

export const tokenStorage = {
  get: () => sessionStorage.getItem(TOKEN_KEY),
  set: (token: string) => sessionStorage.setItem(TOKEN_KEY, token),
  remove: () => sessionStorage.removeItem(TOKEN_KEY),
}
