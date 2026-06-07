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
  clusterId: number | null
  seqOrder: number | null
  openNow: boolean | null
  opensAt: string | null
  closesAt: string | null
}

export interface OptimizeRouteResponse {
  route_id: string
}

export interface ClusterSummary {
  id: number
  centroid_lat: number
  centroid_lng: number
  count: number
}

export interface RouteLeg {
  from_id: string
  to_id: string
  duration_mins: number
  distance_km: number
}

export interface OptimizedOrderItem {
  id: string
  name: string
  seq_order: number
  lat: number
  lng: number
  cluster_id: number
  open_now: boolean | null
  opens_at: string | null
  closes_at: string | null
}

export interface GeoJSONLineString {
  type: "LineString"
  coordinates: [number, number][]
}

export type OptimizerEvent =
  | { type: "geocoded"; count: number }
  | { type: "clustered"; clusters: ClusterSummary[] }
  | {
      type: "optimized"
      geojson: GeoJSONLineString
      total_km?: number
      total_mins?: number
      legs?: RouteLeg[]
      order: OptimizedOrderItem[]
    }
  | { type: "done" }
  | { type: "error"; message: string }

export interface RouteGeoJSON {
  type: "Feature"
  properties: Record<string, never>
  geometry: GeoJSONLineString
}

export interface SavedStop {
  id: string
  name: string
  address: string
  lat: number
  lng: number
  seq_order: number | null
  cluster_id: number | null
}

export interface SavedSession {
  id: string
  name: string
  saved_at: string
  stop_count: number
  total_km: number | null
  total_mins: number | null
  status: string
  stops: SavedStop[]
  geojson: GeoJSONLineString | null
}

export interface SaveSessionResponse {
  id: string
  name: string
  saved_at: string
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

  optimizeRoute: (
    token: string,
    body: {
      session_id: string
      origin_lat?: number
      origin_lng?: number
    },
  ) =>
    request<OptimizeRouteResponse>(
      "/api/routes/optimize",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
      token,
    ),

  streamRoute: async (
    token: string,
    routeId: string,
    onEvent: (event: OptimizerEvent) => void,
    signal?: AbortSignal,
  ) => {
    const response = await fetch(`${API_URL}/api/routes/${routeId}/stream`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new ApiError(
        response.status,
        typeof payload.error === "string" ? payload.error : "Request failed",
      )
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new ApiError(500, "Stream not available")
    }

    const decoder = new TextDecoder()
    let buffer = ""

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split("\n\n")
        buffer = chunks.pop() ?? ""

        for (const chunk of chunks) {
          const dataLine = chunk
            .split("\n")
            .find((line) => line.startsWith("data: "))
          if (!dataLine) {
            continue
          }

          const event = JSON.parse(dataLine.slice(6)) as OptimizerEvent
          onEvent(event)

          if (
            event.type === "optimized" ||
            event.type === "done" ||
            event.type === "error"
          ) {
            return
          }
        }
      }
    } finally {
      await reader.cancel()
    }
  },

  saveSession: (token: string, sessionId: string, name: string) =>
    request<SaveSessionResponse>(
      `/api/sessions/${sessionId}`,
      { method: "PATCH", body: JSON.stringify({ name }) },
      token,
    ),

  getSessions: (token: string) =>
    request<SavedSession[]>("/api/sessions", { method: "GET" }, token),

  deleteSession: async (token: string, sessionId: string) => {
    const response = await fetch(`${API_URL}/api/sessions/${sessionId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: "Delete failed" }))
      throw new ApiError(
        response.status,
        typeof err.error === "string" ? err.error : "Delete failed",
      )
    }
  },
}

export function toRouteGeoJSON(lineString: GeoJSONLineString): RouteGeoJSON {
  return {
    type: "Feature",
    properties: {},
    geometry: lineString,
  }
}

export const TOKEN_KEY = "haul_token"

export const tokenStorage = {
  get: () => sessionStorage.getItem(TOKEN_KEY),
  set: (token: string) => sessionStorage.setItem(TOKEN_KEY, token),
  remove: () => sessionStorage.removeItem(TOKEN_KEY),
}
