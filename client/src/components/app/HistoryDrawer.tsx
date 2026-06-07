import { Clock, Map, Play, Trash2, X } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { api, type SavedSession } from "@/lib/api"
import { getGoogleMapsRouteMeta, openGoogleMaps } from "@/lib/maps"

interface HistoryDrawerProps {
  open: boolean
  token: string
  onClose: () => void
  onLoad: (session: SavedSession) => void
}

function formatSavedDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function formatRunStats(run: SavedSession): string {
  const parts = [`${run.stop_count} stops`]
  if (run.total_km != null) {
    parts.push(`${run.total_km.toFixed(1)} km`)
  }
  if (run.total_mins != null) {
    parts.push(`${run.total_mins} min`)
  }
  return parts.join(" · ")
}

function SkeletonRows() {
  return (
    <div className="space-y-3 p-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="animate-pulse space-y-2 rounded-lg border border-border/60 p-3">
          <div className="h-4 w-3/4 rounded bg-muted" />
          <div className="h-3 w-1/2 rounded bg-muted" />
          <div className="h-3 w-2/3 rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}

export function HistoryDrawer({ open, token, onClose, onLoad }: HistoryDrawerProps) {
  const [sessions, setSessions] = useState<SavedSession[]>([])
  const [loading, setLoading] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteErrorId, setDeleteErrorId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setConfirmDeleteId(null)
      setDeleteErrorId(null)
      return
    }

    let cancelled = false
    setLoading(true)

    void api
      .getSessions(token)
      .then((data) => {
        if (!cancelled) {
          setSessions(data)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSessions([])
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
  }, [open, token])

  async function handleDelete(sessionId: string) {
    setDeletingId(sessionId)
    setDeleteErrorId(null)

    try {
      await api.deleteSession(token, sessionId)
      setSessions((current) => current.filter((session) => session.id !== sessionId))
    } catch {
      setDeleteErrorId(sessionId)
    } finally {
      setDeletingId(null)
      setConfirmDeleteId(null)
    }
  }

  return (
    <>
      <div
        className={`absolute inset-0 z-30 bg-black/40 transition-opacity duration-300 lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden={!open}
      />

      <div
        className={`absolute inset-y-0 left-0 z-40 flex w-80 flex-col border-r border-border/70 bg-background shadow-xl transition-transform duration-300 ease-in-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-hidden={!open}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border/70 px-4">
          <h2 className="text-sm font-semibold">Past runs</h2>
          <Button type="button" variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <SkeletonRows />
          ) : sessions.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <Clock className="size-8 text-muted-foreground/60" strokeWidth={1.5} />
              <p className="mt-3 text-sm font-medium text-muted-foreground">No saved runs yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Optimize a route and save it to see it here
              </p>
            </div>
          ) : (
            <ul className="space-y-2 p-4">
              {sessions.map((session) => {
                const mapsStops = session.stops
                  .filter(
                    (stop) =>
                      stop.seq_order != null &&
                      Number.isFinite(stop.lat) &&
                      Number.isFinite(stop.lng),
                  )
                  .map((stop) => ({
                    lat: stop.lat,
                    lng: stop.lng,
                    seq_order: stop.seq_order as number,
                  }))
                const mapsMeta = getGoogleMapsRouteMeta(null, mapsStops)
                const canOpenMaps = session.geojson != null && mapsStops.length > 0

                return (
                <li
                  key={session.id}
                  className="rounded-lg border border-border/70 bg-card/80 p-3"
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{session.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatSavedDate(session.saved_at)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatRunStats(session)}
                      </p>
                      {canOpenMaps && mapsMeta.truncated && (
                        <p className="mt-1 text-xs text-amber-500">
                          Google Maps limit: showing first 10 of {mapsMeta.totalStops} stops
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {canOpenMaps && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Open ${session.name} in Google Maps`}
                          onClick={() => openGoogleMaps(null, mapsStops)}
                        >
                          <Map className="size-3.5" />
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Load ${session.name}`}
                        onClick={() => onLoad(session)}
                      >
                        <Play className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Delete ${session.name}`}
                        disabled={deletingId === session.id}
                        onClick={() => {
                          setDeleteErrorId(null)
                          setConfirmDeleteId(session.id)
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>

                  {deleteErrorId === session.id && (
                    <p className="mt-2 text-xs text-destructive">Delete failed</p>
                  )}

                  {confirmDeleteId === session.id && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-muted-foreground">Delete?</span>
                      <button
                        type="button"
                        className="font-medium text-destructive hover:underline disabled:opacity-50"
                        disabled={deletingId === session.id}
                        onClick={(event) => {
                          event.stopPropagation()
                          void handleDelete(session.id)
                        }}
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        className="text-muted-foreground hover:underline"
                        onClick={(event) => {
                          event.stopPropagation()
                          setConfirmDeleteId(null)
                          setDeleteErrorId(null)
                        }}
                      >
                        No
                      </button>
                    </div>
                  )}
                </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  )
}
