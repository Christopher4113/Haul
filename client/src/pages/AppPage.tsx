import { Check, Clock, Download, ExternalLink, Home, Loader2, MapPin, Minus, Plus, RotateCcw, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link, Navigate } from "react-router-dom"

import { ErrandMap, type OriginCoords } from "@/components/app/ErrandMap"
import { HistoryDrawer } from "@/components/app/HistoryDrawer"
import { PageShell } from "@/components/layout/Shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/hooks/use-auth"
import {
  api,
  toRouteGeoJSON,
  tokenStorage,
  type ClusterSummary,
  type Errand,
  type OptimizerEvent,
  type RouteGeoJSON,
  type RouteLeg,
  type SavedSession,
} from "@/lib/api"
import { getAuthErrorMessage } from "@/lib/errors"
import {
  computeArrivalScheduleWithDates,
  defaultDepartureTime,
  fetchOSRMSegment,
  formatDepartureTime,
  getGoogleMapsRouteMeta,
  isClosedOnArrival,
  mergeRouteCoordinates,
  openGoogleMaps,
  type ArrivalSlot,
  type RoadSegment,
} from "@/lib/maps"

const CLUSTER_COLORS = ["#F59E0B", "#3B82F6", "#22C55E", "#A855F7", "#EF4444", "#06B6D4"]
const INSTALL_DISMISSED_KEY = "haul-install-dismissed"

interface RouteSummary {
  stops: number
  clusters: number
  total_km?: number | null
  total_mins?: number | null
}

function defaultRunName(errands: Errand[]): string {
  const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })
  const sorted = [...errands].sort((a, b) => (a.seqOrder ?? 999) - (b.seqOrder ?? 999))
  const first = sorted[0]
  if (!first) {
    return date
  }
  const extra = errands.length - 1
  if (extra <= 0) {
    return `${date} · ${first.name}`
  }
  return `${date} · ${first.name} + ${extra} more`
}

function useAutoDismissError(error: string | null, onClear: () => void) {
  useEffect(() => {
    if (!error) {
      return
    }
    const timer = window.setTimeout(onClear, 5000)
    return () => window.clearTimeout(timer)
  }, [error, onClear])
}

function pinColor(clusterId: number | null) {
  if (clusterId === null) {
    return "bg-muted text-muted-foreground"
  }
  return "text-white"
}

function pinStyle(clusterId: number | null): React.CSSProperties | undefined {
  if (clusterId === null) {
    return undefined
  }
  return { backgroundColor: CLUSTER_COLORS[clusterId % CLUSTER_COLORS.length] }
}

function hasHoursData(errand: Errand) {
  return errand.openNow !== null || errand.opensAt !== null || errand.closesAt !== null
}

function HoursBadge({ errand }: { errand: Errand }) {
  if (!hasHoursData(errand)) {
    return null
  }

  const now = Date.now()

  if (errand.closesAt) {
    const closesAt = new Date(errand.closesAt).getTime()
    const minutesUntilClose = (closesAt - now) / 60_000
    if (minutesUntilClose > 0 && minutesUntilClose <= 60) {
      return <Badge variant="closing">Closes soon</Badge>
    }
  }

  if (errand.openNow === true) {
    return <Badge variant="open">Open</Badge>
  }

  if (errand.openNow === false) {
    return <Badge variant="closed">Closed</Badge>
  }

  return null
}

function applyOptimizerEvent(
  event: OptimizerEvent,
  setErrands: React.Dispatch<React.SetStateAction<Errand[]>>,
  setStatus: React.Dispatch<React.SetStateAction<string | null>>,
  setRouteGeoJSON: React.Dispatch<React.SetStateAction<RouteGeoJSON | null>>,
  setOptimizeError: React.Dispatch<React.SetStateAction<string | null>>,
  setOptimizing: React.Dispatch<React.SetStateAction<boolean>>,
  setRouteSummary: React.Dispatch<React.SetStateAction<RouteSummary | null>>,
  setLegs: React.Dispatch<React.SetStateAction<RouteLeg[]>>,
  setClusters: React.Dispatch<React.SetStateAction<ClusterSummary[]>>,
) {
  switch (event.type) {
    case "geocoded":
      setStatus(`Geocoded ${event.count} stops, clustering...`)
      break
    case "clustered":
      setClusters(event.clusters)
      setStatus(`Clustered into ${event.clusters.length} groups, optimizing...`)
      break
    case "optimized":
      setErrands((current) => {
        const orderMap = new Map(event.order.map((item) => [item.id, item]))
        return current.map((errand) => {
          const ordered = orderMap.get(errand.id)
          if (!ordered) {
            return errand
          }
          return {
            ...errand,
            clusterId: ordered.cluster_id,
            seqOrder: ordered.seq_order,
            lat: ordered.lat,
            lng: ordered.lng,
            openNow: ordered.open_now,
            opensAt: ordered.opens_at,
            closesAt: ordered.closes_at,
          }
        })
      })
      setRouteGeoJSON(toRouteGeoJSON(event.geojson))
      setLegs(event.legs ?? [])
      setRouteSummary({
        stops: event.order.length,
        clusters: new Set(event.order.map((item) => item.cluster_id)).size,
        total_km: event.total_km ?? null,
        total_mins: event.total_mins ?? null,
      })
      setStatus(null)
      setOptimizing(false)
      break
    case "done":
      setStatus(null)
      setOptimizing(false)
      break
    case "error":
      setOptimizeError(event.message)
      setStatus(null)
      setOptimizing(false)
      break
  }
}

export default function AppPage() {
  const { user, token, logout } = useAuth()
  const [sessionId, setSessionId] = useState<string>(() => crypto.randomUUID())

  const [origin, setOrigin] = useState("")
  const [originCoords, setOriginCoords] = useState<OriginCoords | null>(null)
  const [geocodingOrigin, setGeocodingOrigin] = useState(false)
  const lastGeocodedOrigin = useRef("")

  const [stopName, setStopName] = useState("")
  const [stopAddress, setStopAddress] = useState("")
  const [errands, setErrands] = useState<Errand[]>([])
  const [routeGeoJSON, setRouteGeoJSON] = useState<RouteGeoJSON | null>(null)
  const [routeSummary, setRouteSummary] = useState<RouteSummary | null>(null)
  const [legs, setLegs] = useState<RouteLeg[]>([])
  const [adding, setAdding] = useState(false)
  const [optimizing, setOptimizing] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [stopError, setStopError] = useState<string | null>(null)
  const [originError, setOriginError] = useState<string | null>(null)
  const [optimizeError, setOptimizeError] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [runSaved, setRunSaved] = useState(false)
  const [saveName, setSaveName] = useState("")
  const [savingRun, setSavingRun] = useState(false)
  const [saveToast, setSaveToast] = useState(false)
  const [departureTime, setDepartureTime] = useState(() => defaultDepartureTime())
  const [dwellMinutes, setDwellMinutes] = useState(15)
  const [roundTrip, setRoundTrip] = useState(false)
  const [returnLeg, setReturnLeg] = useState<RoadSegment | null>(null)
  const [clusters, setClusters] = useState<ClusterSummary[]>([])
  const [showClusters, setShowClusters] = useState(true)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installDismissed, setInstallDismissed] = useState(
    () => localStorage.getItem(INSTALL_DISMISSED_KEY) === "1",
  )

  const isStandalone = useMemo(
    () => window.matchMedia("(display-mode: standalone)").matches,
    [],
  )

  const showInstallBanner = installPrompt !== null && !isStandalone && !installDismissed

  const clearStopError = useCallback(() => setStopError(null), [])
  const clearOriginError = useCallback(() => setOriginError(null), [])
  const clearOptimizeError = useCallback(() => setOptimizeError(null), [])

  useAutoDismissError(stopError, clearStopError)
  useAutoDismissError(originError, clearOriginError)
  useAutoDismissError(optimizeError, clearOptimizeError)

  useEffect(() => {
    if (!saveToast) {
      return
    }
    const timer = window.setTimeout(() => setSaveToast(false), 2000)
    return () => window.clearTimeout(timer)
  }, [saveToast])

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
    }
    window.addEventListener("beforeinstallprompt", handler)
    return () => window.removeEventListener("beforeinstallprompt", handler)
  }, [])

  async function handleInstallApp() {
    if (!installPrompt) {
      return
    }
    await installPrompt.prompt()
    await installPrompt.userChoice
    setInstallPrompt(null)
  }

  function handleDismissInstall() {
    localStorage.setItem(INSTALL_DISMISSED_KEY, "1")
    setInstallDismissed(true)
  }

  const displayedErrands = useMemo(() => {
    const hasSequence = errands.some((errand) => errand.seqOrder !== null)
    if (!hasSequence) {
      return errands
    }
    return [...errands].sort((a, b) => (a.seqOrder ?? 0) - (b.seqOrder ?? 0))
  }, [errands])

  useEffect(() => {
    if (routeSummary && !runSaved) {
      setSaveName(defaultRunName(displayedErrands))
    }
  }, [routeSummary, runSaved, displayedErrands])

  const hasOptimizedRoute = useMemo(
    () => errands.some((errand) => errand.seqOrder !== null),
    [errands],
  )

  const googleMapsStops = useMemo(
    () =>
      displayedErrands
        .filter(
          (errand) =>
            errand.lat != null &&
            errand.lng != null &&
            errand.seqOrder != null &&
            Number.isFinite(errand.lat) &&
            Number.isFinite(errand.lng),
        )
        .map((errand) => ({
          lat: errand.lat as number,
          lng: errand.lng as number,
          seq_order: errand.seqOrder as number,
        })),
    [displayedErrands],
  )

  useEffect(() => {
    if (!originCoords) {
      setRoundTrip(false)
    }
  }, [originCoords])

  const googleMapsMeta = useMemo(
    () => getGoogleMapsRouteMeta(originCoords, googleMapsStops, roundTrip),
    [originCoords, googleMapsStops, roundTrip],
  )

  const arrivalStops = useMemo(
    () =>
      displayedErrands
        .filter(
          (errand) =>
            errand.seqOrder != null &&
            errand.lat != null &&
            errand.lng != null &&
            Number.isFinite(errand.lat) &&
            Number.isFinite(errand.lng),
        )
        .map((errand) => ({
          id: errand.id,
          seq_order: errand.seqOrder as number,
          name: errand.name,
          lat: errand.lat as number,
          lng: errand.lng as number,
        })),
    [displayedErrands],
  )

  const lastArrivalStop = useMemo(() => {
    if (arrivalStops.length === 0) {
      return null
    }
    return [...arrivalStops].sort((a, b) => b.seq_order - a.seq_order)[0]
  }, [arrivalStops])

  useEffect(() => {
    if (!roundTrip || !originCoords || !hasOptimizedRoute || !lastArrivalStop) {
      setReturnLeg(null)
      return
    }

    let cancelled = false

    void fetchOSRMSegment(
      { lat: lastArrivalStop.lat, lng: lastArrivalStop.lng },
      originCoords,
    )
      .then((segment) => {
        if (!cancelled) {
          setReturnLeg(segment)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setReturnLeg(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [roundTrip, originCoords, hasOptimizedRoute, lastArrivalStop])

  const arrivalSchedule = useMemo(() => {
    if (!hasOptimizedRoute || arrivalStops.length === 0) {
      return new Map<string, ArrivalSlot>()
    }
    return computeArrivalScheduleWithDates(
      departureTime,
      dwellMinutes,
      arrivalStops,
      legs,
      originCoords,
      roundTrip,
      returnLeg?.duration_mins ?? null,
    )
  }, [
    hasOptimizedRoute,
    arrivalStops,
    departureTime,
    dwellMinutes,
    legs,
    originCoords,
    roundTrip,
    returnLeg,
  ])

  const displayLegs = useMemo(() => {
    if (!roundTrip || !returnLeg || !lastArrivalStop) {
      return legs
    }

    return [
      ...legs,
      {
        from_id: lastArrivalStop.id,
        to_id: "origin",
        duration_mins: returnLeg.duration_mins,
        distance_km: returnLeg.distance_km,
      },
    ]
  }, [legs, roundTrip, returnLeg, lastArrivalStop])

  const finalReturnTime = useMemo(() => {
    if (arrivalSchedule.size === 0) {
      return null
    }
    if (roundTrip && originCoords) {
      return arrivalSchedule.get("origin")?.arrives_at ?? null
    }
    return lastArrivalStop ? arrivalSchedule.get(lastArrivalStop.id)?.departs_at ?? null : null
  }, [arrivalSchedule, lastArrivalStop, roundTrip, originCoords])

  const displayRouteGeoJSON = useMemo(() => {
    if (!routeGeoJSON) {
      return routeGeoJSON
    }
    if (!roundTrip || !returnLeg) {
      return routeGeoJSON
    }

    return {
      ...routeGeoJSON,
      geometry: {
        ...routeGeoJSON.geometry,
        coordinates: mergeRouteCoordinates(
          routeGeoJSON.geometry.coordinates,
          returnLeg.coordinates,
        ),
      },
    }
  }, [routeGeoJSON, roundTrip, returnLeg])

  if (!tokenStorage.get()) {
    return <Navigate to="/login" replace state={{ from: "/app" }} />
  }

  function handleNewRun() {
    setSessionId(crypto.randomUUID())
    setErrands([])
    setRouteGeoJSON(null)
    setRouteSummary(null)
    setLegs([])
    setReturnLeg(null)
    setClusters([])
    setOrigin("")
    setOriginCoords(null)
    lastGeocodedOrigin.current = ""
    setStatus(null)
    setOptimizing(false)
    setStopError(null)
    setOriginError(null)
    setOptimizeError(null)
    setRunSaved(false)
    setSaveName("")
    setSaveToast(false)
    setDepartureTime(defaultDepartureTime())
    setDwellMinutes(15)
    setRoundTrip(false)
    setShowClusters(true)
  }

  function handleLoadSession(session: SavedSession) {
    setSessionId(session.id)
    setErrands(
      session.stops.map((stop) => ({
        id: stop.id,
        name: stop.name,
        address: stop.address,
        lat: stop.lat,
        lng: stop.lng,
        clusterId: stop.cluster_id,
        seqOrder: stop.seq_order,
        openNow: null,
        opensAt: null,
        closesAt: null,
      })),
    )
    setRouteGeoJSON(session.geojson ? toRouteGeoJSON(session.geojson) : null)
    setRouteSummary({
      stops: session.stop_count,
      clusters: new Set(
        session.stops.map((stop) => stop.cluster_id).filter((id) => id != null),
      ).size,
      total_km: session.total_km,
      total_mins: session.total_mins,
    })
    setLegs([])
    setReturnLeg(null)
    setClusters([])
    setRunSaved(true)
    setSaveName(session.name)
    setOrigin("")
    setOriginCoords(null)
    lastGeocodedOrigin.current = ""
    setHistoryOpen(false)
    setOptimizing(false)
    setStatus(null)
    setStopError(null)
    setOriginError(null)
    setOptimizeError(null)
  }

  async function handleSaveRun() {
    if (!token || !saveName.trim() || savingRun || runSaved) {
      return
    }

    setSavingRun(true)
    try {
      await api.saveSession(token, sessionId, saveName.trim())
      setRunSaved(true)
      setSaveToast(true)
    } catch (err) {
      setOptimizeError(getAuthErrorMessage(err))
    } finally {
      setSavingRun(false)
    }
  }

  async function handleGeocodeOrigin() {
    const address = origin.trim()
    if (!token || !address || geocodingOrigin) {
      return
    }
    if (address === lastGeocodedOrigin.current && originCoords) {
      return
    }

    setGeocodingOrigin(true)
    setOriginError(null)

    try {
      const created = await api.addErrand(token, {
        session_id: sessionId,
        name: "origin",
        address,
      })
      setOriginCoords({ lat: created.lat, lng: created.lng })
      lastGeocodedOrigin.current = address
    } catch {
      setOriginCoords(null)
      setOriginError("Could not geocode this address. Try a more specific address.")
    } finally {
      setGeocodingOrigin(false)
    }
  }

  async function handleAddStop() {
    if (!token || !stopName.trim() || !stopAddress.trim()) {
      return
    }

    setAdding(true)
    setStopError(null)

    try {
      const created = await api.addErrand(token, {
        session_id: sessionId,
        name: stopName.trim(),
        address: stopAddress.trim(),
      })

      setErrands((current) => [
        ...current,
        {
          id: created.id,
          name: created.name,
          address: created.address,
          lat: created.lat,
          lng: created.lng,
          clusterId: null,
          seqOrder: null,
          openNow: null,
          opensAt: null,
          closesAt: null,
        },
      ])
      setStopName("")
      setStopAddress("")
    } catch {
      setStopError("Could not geocode this address. Try a more specific address.")
    } finally {
      setAdding(false)
    }
  }

  function handleRemoveStop(id: string) {
    setErrands((current) => current.filter((errand) => errand.id !== id))
    setRouteGeoJSON(null)
    setRouteSummary(null)
    setLegs([])
    setReturnLeg(null)
    setClusters([])
    setRunSaved(false)
  }

  async function handleOptimize() {
    if (!token || errands.length < 2) {
      return
    }

    setOptimizing(true)
    setOptimizeError(null)
    setStatus(null)
    setRouteGeoJSON(null)
    setRouteSummary(null)
    setLegs([])
    setReturnLeg(null)
    setClusters([])
    setRunSaved(false)

    try {
      const { route_id: routeId } = await api.optimizeRoute(token, {
        session_id: sessionId,
        ...(originCoords
          ? { origin_lat: originCoords.lat, origin_lng: originCoords.lng }
          : {}),
      })

      await api.streamRoute(token, routeId, (event) => {
        applyOptimizerEvent(
          event,
          setErrands,
          setStatus,
          setRouteGeoJSON,
          setOptimizeError,
          setOptimizing,
          setRouteSummary,
          setLegs,
          setClusters,
        )
      })
    } catch (err) {
      setOptimizeError(getAuthErrorMessage(err))
      setStatus(null)
    } finally {
      setOptimizing(false)
    }
  }

  function handleStopKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" && stopName.trim() && stopAddress.trim() && !adding) {
      event.preventDefault()
      void handleAddStop()
    }
  }

  function handleOriginKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" && origin.trim() && !geocodingOrigin) {
      event.preventDefault()
      void handleGeocodeOrigin()
    }
  }

  return (
    <PageShell className="flex h-svh flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border/70 bg-background/80 backdrop-blur-sm">
        <div className="flex h-14 items-center justify-between px-4 sm:px-6">
          <Link to="/dashboard" className="text-sm font-semibold tracking-tight">
            Haul
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <Clock className="size-4" />
              <span className="hidden sm:inline">History</span>
            </button>
            <span className="hidden text-muted-foreground sm:inline">{user?.name}</span>
            <button
              type="button"
              onClick={logout}
              className="text-muted-foreground hover:text-foreground"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-b border-border/70 bg-background/70 lg:w-[min(100%,420px)] lg:flex-none lg:border-r lg:border-b-0">
          <HistoryDrawer
            open={historyOpen}
            token={token ?? ""}
            onClose={() => setHistoryOpen(false)}
            onLoad={handleLoadSession}
          />
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5">
            <div className="mb-5">
              <h1 className="text-lg font-semibold tracking-tight">Start a run</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Add stops, then optimize your route on the map.
              </p>
              {errands.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-3 -ml-2 text-muted-foreground"
                  onClick={handleNewRun}
                  disabled={optimizing}
                >
                  <RotateCcw />
                  New run
                </Button>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="origin" className="text-xs text-muted-foreground">
                Origin
              </Label>
              <Input
                id="origin"
                placeholder="Home address"
                value={origin}
                onChange={(event) => {
                  setOrigin(event.target.value)
                  if (event.target.value.trim() !== lastGeocodedOrigin.current) {
                    setOriginCoords(null)
                  }
                }}
                onBlur={() => void handleGeocodeOrigin()}
                onKeyDown={handleOriginKeyDown}
                disabled={geocodingOrigin}
              />
              {geocodingOrigin && (
                <p className="text-xs text-muted-foreground">Geocoding origin…</p>
              )}
              {originError && <p className="text-sm text-destructive">{originError}</p>}
            </div>

            {errands.length > 0 && (
              <div className="mt-5 space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="departure-time" className="text-xs text-muted-foreground">
                    Departure time
                  </Label>
                  <Input
                    id="departure-time"
                    type="time"
                    value={departureTime}
                    onChange={(event) => setDepartureTime(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Time at each stop</Label>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-8 shrink-0"
                      disabled={dwellMinutes <= 5}
                      aria-label="Decrease dwell time"
                      onClick={() => setDwellMinutes((value) => Math.max(5, value - 5))}
                    >
                      <Minus className="size-4" />
                    </Button>
                    <span className="flex-1 text-center text-sm tabular-nums">
                      {dwellMinutes} min
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-8 shrink-0"
                      disabled={dwellMinutes >= 120}
                      aria-label="Increase dwell time"
                      onClick={() => setDwellMinutes((value) => Math.min(120, value + 5))}
                    >
                      <Plus className="size-4" />
                    </Button>
                  </div>
                </div>
                {originCoords && (
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="round-trip" className="text-xs text-muted-foreground">
                      Return to origin
                    </Label>
                    <button
                      id="round-trip"
                      type="button"
                      role="switch"
                      aria-checked={roundTrip}
                      onClick={() => setRoundTrip((value) => !value)}
                      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                        roundTrip ? "bg-amber-400" : "bg-muted"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block size-5 rounded-full bg-white shadow transition-transform ${
                          roundTrip ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                )}
                {hasOptimizedRoute && clusters.length > 0 && (
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="show-clusters" className="text-xs text-muted-foreground">
                      Show clusters
                    </Label>
                    <button
                      id="show-clusters"
                      type="button"
                      role="switch"
                      aria-checked={showClusters}
                      onClick={() => setShowClusters((value) => !value)}
                      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                        showClusters ? "bg-amber-400" : "bg-muted"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block size-5 rounded-full bg-white shadow transition-transform ${
                          showClusters ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="mt-5 space-y-3">
              <div className="space-y-2">
                <Label htmlFor="stop-name">Stop name</Label>
                <Input
                  id="stop-name"
                  placeholder="e.g. Grocery store"
                  value={stopName}
                  onChange={(event) => setStopName(event.target.value)}
                  onKeyDown={handleStopKeyDown}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="stop-address">Address</Label>
                <Input
                  id="stop-address"
                  placeholder="123 Main St, Toronto"
                  value={stopAddress}
                  onChange={(event) => setStopAddress(event.target.value)}
                  onKeyDown={handleStopKeyDown}
                />
                {stopError && <p className="text-sm text-destructive">{stopError}</p>}
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={adding || !stopName.trim() || !stopAddress.trim()}
                onClick={() => void handleAddStop()}
              >
                {adding ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Adding…
                  </>
                ) : (
                  "Add stop"
                )}
              </Button>
            </div>

            {displayedErrands.length > 0 ? (
              <ol className="mt-5 space-y-2 pr-1">
                {displayedErrands.map((errand, index) => (
                  <li key={errand.id} className="transition-all duration-300">
                    <Card className="border-border/70 bg-card/80 py-0 transition-all duration-300">
                      <CardContent className="flex items-start gap-3 p-3">
                        <span
                          className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-colors duration-300 ${pinColor(errand.clusterId)}`}
                          style={pinStyle(errand.clusterId)}
                        >
                          {errand.seqOrder ?? index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-medium">{errand.name}</p>
                            <HoursBadge errand={errand} />
                          </div>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {errand.address}
                          </p>
                          {hasOptimizedRoute && arrivalSchedule.has(errand.id) && (
                            <>
                              <p className="mt-1 text-xs text-muted-foreground">
                                Arrive {arrivalSchedule.get(errand.id)?.arrives_at} · Depart{" "}
                                {arrivalSchedule.get(errand.id)?.departs_at}
                              </p>
                              {isClosedOnArrival(
                                arrivalSchedule.get(errand.id)!.arrivesAt,
                                errand.closesAt,
                              ) && (
                                <p className="mt-0.5 text-xs text-amber-500">
                                  ⚠ May be closed on arrival
                                </p>
                              )}
                            </>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Remove ${errand.name}`}
                          onClick={() => handleRemoveStop(errand.id)}
                          disabled={optimizing}
                        >
                          <X />
                        </Button>
                      </CardContent>
                    </Card>
                  </li>
                ))}
                {roundTrip &&
                  originCoords &&
                  hasOptimizedRoute &&
                  arrivalSchedule.has("origin") && (
                    <li className="border-t border-dashed border-border/70 pt-2">
                      <Card className="border-border/70 bg-card/80 py-0">
                        <CardContent className="flex items-start gap-3 p-3">
                          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground">
                            <Home className="size-3.5" strokeWidth={2} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">Home</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Arrive {arrivalSchedule.get("origin")?.arrives_at}
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    </li>
                  )}
              </ol>
            ) : (
              <div className="mt-5 flex flex-col items-center px-4 py-10 text-center">
                <MapPin className="size-8 text-muted-foreground/60" strokeWidth={1.5} />
                <p className="mt-3 text-sm font-medium text-muted-foreground">No stops yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Add a stop above to get started
                </p>
              </div>
            )}

            {status && <p className="mt-4 text-sm text-muted-foreground">{status}</p>}

            {routeSummary && (
              <Card className="mt-4 border-zinc-800/80 bg-card/50 py-0">
                <CardContent className="space-y-1 p-3 text-xs text-muted-foreground">
                  {hasOptimizedRoute && (
                    <>
                      <p>Departs: {formatDepartureTime(departureTime)}</p>
                      {finalReturnTime && (
                        <p>
                          {roundTrip && originCoords
                            ? `Returns home: ${finalReturnTime}`
                            : `Returns: ${finalReturnTime}`}
                        </p>
                      )}
                    </>
                  )}
                  <p>Total stops: {routeSummary.stops}</p>
                  <p>Clusters: {routeSummary.clusters}</p>
                  {routeSummary.total_km != null && (
                    <p>
                      Estimated distance: {routeSummary.total_km?.toFixed(1) ?? "..."} km
                    </p>
                  )}
                  {routeSummary.total_mins != null && (
                    <p>
                      Estimated time: {Math.round(routeSummary.total_mins ?? 0)} min
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {routeSummary && (
              <div className="relative mt-3">
                {runSaved ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled
                  >
                    <Check className="text-amber-500" />
                    Run saved
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Input
                      value={saveName}
                      onChange={(event) => setSaveName(event.target.value)}
                      placeholder="Name this run"
                      disabled={savingRun}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && saveName.trim() && !savingRun) {
                          event.preventDefault()
                          void handleSaveRun()
                        }
                      }}
                    />
                    <Button
                      type="button"
                      size="icon"
                      className="shrink-0 bg-amber-400 text-amber-950 hover:bg-amber-500"
                      disabled={!saveName.trim() || savingRun}
                      aria-label="Save run"
                      onClick={() => void handleSaveRun()}
                    >
                      {savingRun ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <Check />
                      )}
                    </Button>
                  </div>
                )}
                {saveToast && (
                  <p className="mt-2 text-center text-xs font-medium text-amber-500">
                    Run saved
                  </p>
                )}
              </div>
            )}

            {routeSummary && (
              <div className="mt-3">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-amber-400 bg-transparent text-amber-600 hover:bg-amber-400/10 hover:text-amber-700"
                  disabled={!hasOptimizedRoute}
                  title={hasOptimizedRoute ? undefined : "Optimize first"}
                  onClick={() => openGoogleMaps(originCoords, googleMapsStops, roundTrip)}
                >
                  <ExternalLink />
                  Open in Google Maps
                </Button>
                {googleMapsMeta.truncated && (
                  <p className="mt-1.5 text-xs text-amber-500">
                    Google Maps limit: showing first 10 of {googleMapsMeta.totalStops} stops
                  </p>
                )}
              </div>
            )}

            <div className="mt-4 shrink-0 pb-2 pt-2">
              {optimizeError && (
                <p className="mb-3 text-sm text-destructive">{optimizeError}</p>
              )}
              <Button
                type="button"
                className="h-10 w-full bg-amber-400 text-amber-950 hover:bg-amber-500 disabled:bg-amber-400/50 disabled:text-amber-950/60"
                disabled={errands.length < 2 || optimizing}
                onClick={() => void handleOptimize()}
              >
                {optimizing ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Optimizing…
                  </>
                ) : (
                  "Optimize route"
                )}
              </Button>
            </div>
          </div>

          {showInstallBanner && (
            <div className="shrink-0 border-t border-border/70 bg-card/90 p-3 backdrop-blur-sm">
              <div className="flex items-center gap-3">
                <Download className="size-4 shrink-0 text-amber-500" />
                <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                  Add Haul to your home screen
                </p>
                <Button
                  type="button"
                  size="sm"
                  className="h-7 shrink-0 bg-amber-400 px-2.5 text-xs text-amber-950 hover:bg-amber-500"
                  onClick={() => void handleInstallApp()}
                >
                  Install
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="shrink-0 text-muted-foreground"
                  aria-label="Dismiss install prompt"
                  onClick={handleDismissInstall}
                >
                  <X />
                </Button>
              </div>
            </div>
          )}
        </aside>

        <div className="relative min-h-[280px] flex-1 lg:min-h-0">
          <ErrandMap
            errands={displayedErrands}
            routeGeoJSON={displayRouteGeoJSON}
            origin={originCoords}
            legs={displayLegs}
            arrivalSchedule={arrivalSchedule}
            showClusters={showClusters}
            clusters={clusters}
          />
        </div>
      </div>
    </PageShell>
  )
}
