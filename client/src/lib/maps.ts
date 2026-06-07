import { haversineKm } from "@/lib/geo"

export const GOOGLE_MAPS_MAX_STOPS = 10

type LatLng = { lat: number; lng: number }

type RouteStop = LatLng & { seq_order: number }

function isValidCoord(point: LatLng): boolean {
  return Number.isFinite(point.lat) && Number.isFinite(point.lng)
}

function formatCoord(point: LatLng): string {
  return `${point.lat},${point.lng}`
}

function sortedStops(stops: RouteStop[]): LatLng[] {
  return [...stops]
    .filter((stop) => isValidCoord(stop) && Number.isFinite(stop.seq_order))
    .sort((a, b) => a.seq_order - b.seq_order)
    .map(({ lat, lng }) => ({ lat, lng }))
}

function buildRoutePoints(
  origin: LatLng | null,
  stops: RouteStop[],
): LatLng[] {
  const sorted = sortedStops(stops)

  if (origin && isValidCoord(origin)) {
    return [{ lat: origin.lat, lng: origin.lng }, ...sorted]
  }

  return sorted
}

function estimateReturnDriveMins(from: LatLng, to: LatLng): number {
  const km = haversineKm(from.lat, from.lng, to.lat, to.lng)
  return Math.ceil((km / 40) * 60)
}

export function getGoogleMapsRouteMeta(
  origin: LatLng | null,
  stops: RouteStop[],
  roundTrip = false,
): { totalStops: number; truncated: boolean } {
  if (roundTrip && origin && isValidCoord(origin)) {
    const stopCount = sortedStops(stops).length
    const total = 1 + stopCount
    return {
      totalStops: total,
      truncated: total > GOOGLE_MAPS_MAX_STOPS,
    }
  }

  const points = buildRoutePoints(origin, stops)
  return {
    totalStops: points.length,
    truncated: points.length > GOOGLE_MAPS_MAX_STOPS,
  }
}

export function buildGoogleMapsURL(
  origin: LatLng | null,
  stops: RouteStop[],
  roundTrip = false,
): string {
  if (roundTrip && origin && isValidCoord(origin)) {
    let sorted = sortedStops(stops)
    if (sorted.length === 0) {
      return ""
    }

    const truncated = 1 + sorted.length > GOOGLE_MAPS_MAX_STOPS
    if (truncated) {
      sorted = sorted.slice(0, GOOGLE_MAPS_MAX_STOPS - 1)
    }

    const params = new URLSearchParams({
      api: "1",
      travelmode: "driving",
      origin: formatCoord(origin),
      destination: formatCoord(origin),
      waypoints: sorted.map(formatCoord).join("|"),
    })

    return `https://www.google.com/maps/dir/?${params.toString()}`
  }

  const points = buildRoutePoints(origin, stops)
  if (points.length === 0) {
    return ""
  }

  const routePoints =
    points.length > GOOGLE_MAPS_MAX_STOPS
      ? points.slice(0, GOOGLE_MAPS_MAX_STOPS)
      : points

  const params = new URLSearchParams({
    api: "1",
    travelmode: "driving",
    origin: formatCoord(routePoints[0]),
    destination: formatCoord(routePoints[routePoints.length - 1]),
  })

  const waypoints = routePoints.slice(1, -1)
  if (waypoints.length > 0) {
    params.set("waypoints", waypoints.map(formatCoord).join("|"))
  }

  return `https://www.google.com/maps/dir/?${params.toString()}`
}

export function openGoogleMaps(
  origin: LatLng | null,
  stops: RouteStop[],
  roundTrip = false,
): void {
  const url = buildGoogleMapsURL(origin, stops, roundTrip)
  if (url) {
    window.open(url, "_blank", "noopener,noreferrer")
  }
}

export interface ArrivalStop {
  id: string
  seq_order: number
  name: string
  lat: number
  lng: number
}

export interface ArrivalLeg {
  from_id: string
  to_id: string
  duration_mins: number
}

export interface ArrivalSlot {
  arrives_at: string
  departs_at: string
  arrivesAt: Date
  departsAt: Date
}

function formatTime12FromDate(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
}

export function defaultDepartureTime(now = new Date()): string {
  const rounded = new Date(now)
  const minutes = rounded.getMinutes()
  const nextQuarter = Math.ceil(minutes / 15) * 15
  if (nextQuarter >= 60) {
    rounded.setHours(rounded.getHours() + 1)
    rounded.setMinutes(0, 0, 0)
  } else {
    rounded.setMinutes(nextQuarter, 0, 0)
  }
  return `${rounded.getHours().toString().padStart(2, "0")}:${rounded.getMinutes().toString().padStart(2, "0")}`
}

export function formatDepartureTime(time24: string): string {
  const match = time24.match(/^(\d{1,2}):(\d{2})/)
  if (!match) {
    return time24
  }
  const date = new Date()
  date.setHours(Number(match[1]), Number(match[2]), 0, 0)
  return formatTime12FromDate(date)
}

function parseDepartureDate(departureTime: string): Date {
  const match = departureTime.match(/^(\d{1,2}):(\d{2})/)
  const date = new Date()
  if (match) {
    date.setHours(Number(match[1]), Number(match[2]), 0, 0)
  }
  return date
}

function computeArrivalSchedule(
  departureTime: string,
  dwellMinutes: number,
  stops: ArrivalStop[],
  legs: ArrivalLeg[],
  originLatLng: LatLng | null,
  roundTrip = false,
  returnDriveMins: number | null = null,
): Map<string, ArrivalSlot> {
  const result = new Map<string, ArrivalSlot>()
  const sorted = [...stops].sort((a, b) => a.seq_order - b.seq_order)
  if (sorted.length === 0) {
    return result
  }

  const departure = parseDepartureDate(departureTime)
  let previousDepartsAt = new Date(departure)

  for (let i = 0; i < sorted.length; i += 1) {
    const stop = sorted[i]
    const leg = legs.find((item) => item.to_id === stop.id)
    const driveMins = leg?.duration_mins ?? 0

    let arrivesAt: Date
    if (i === 0) {
      if (originLatLng && isValidCoord(originLatLng)) {
        arrivesAt = new Date(previousDepartsAt.getTime() + driveMins * 60_000)
      } else {
        arrivesAt = new Date(previousDepartsAt)
      }
    } else {
      arrivesAt = new Date(previousDepartsAt.getTime() + driveMins * 60_000)
    }

    const departsAt = new Date(arrivesAt.getTime() + dwellMinutes * 60_000)
    result.set(stop.id, {
      arrives_at: formatTime12FromDate(arrivesAt),
      departs_at: formatTime12FromDate(departsAt),
      arrivesAt,
      departsAt,
    })
    previousDepartsAt = departsAt
  }

  if (roundTrip && originLatLng && isValidCoord(originLatLng)) {
    const lastStop = sorted[sorted.length - 1]
    const lastSlot = result.get(lastStop.id)
    if (lastSlot) {
      const driveMins =
        returnDriveMins ?? estimateReturnDriveMins(lastStop, originLatLng)
      const arrivesAt = new Date(lastSlot.departsAt.getTime() + driveMins * 60_000)
      result.set("origin", {
        arrives_at: formatTime12FromDate(arrivesAt),
        departs_at: "-",
        arrivesAt,
        departsAt: arrivesAt,
      })
    }
  }

  return result
}

export function computeArrivalTimes(
  departureTime: string,
  dwellMinutes: number,
  stops: ArrivalStop[],
  legs: ArrivalLeg[],
  originLatLng: LatLng | null,
  roundTrip = false,
): Map<string, { arrives_at: string; departs_at: string }> {
  const schedule = computeArrivalSchedule(
    departureTime,
    dwellMinutes,
    stops,
    legs,
    originLatLng,
    roundTrip,
  )
  const result = new Map<string, { arrives_at: string; departs_at: string }>()
  for (const [id, slot] of schedule) {
    result.set(id, { arrives_at: slot.arrives_at, departs_at: slot.departs_at })
  }
  return result
}

export function computeArrivalScheduleWithDates(
  departureTime: string,
  dwellMinutes: number,
  stops: ArrivalStop[],
  legs: ArrivalLeg[],
  originLatLng: LatLng | null,
  roundTrip = false,
  returnDriveMins: number | null = null,
): Map<string, ArrivalSlot> {
  return computeArrivalSchedule(
    departureTime,
    dwellMinutes,
    stops,
    legs,
    originLatLng,
    roundTrip,
    returnDriveMins,
  )
}

function parseCloseTimeOnDay(closesAt: string, reference: Date): Date | null {
  const clockMatch = closesAt.match(/^(\d{1,2}):(\d{2})/)
  if (clockMatch) {
    const date = new Date(reference)
    date.setHours(Number(clockMatch[1]), Number(clockMatch[2]), 0, 0)
    return date
  }

  const parsed = new Date(closesAt)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  const date = new Date(reference)
  date.setHours(parsed.getHours(), parsed.getMinutes(), 0, 0)
  return date
}

export function isClosedOnArrival(arrivesAt: Date, closesAt: string | null): boolean {
  if (!closesAt) {
    return false
  }
  const closing = parseCloseTimeOnDay(closesAt, arrivesAt)
  if (!closing) {
    return false
  }
  return arrivesAt.getTime() > closing.getTime()
}

export interface RoadSegment {
  coordinates: [number, number][]
  duration_mins: number
  distance_km: number
}

type OSRMSegmentResponse = {
  code: string
  routes: Array<{
    distance: number
    duration: number
    geometry: {
      type: "LineString"
      coordinates: [number, number][]
    }
  }>
}

export async function fetchOSRMSegment(from: LatLng, to: LatLng): Promise<RoadSegment> {
  const url = `http://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 10_000)

  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`OSRM returned status ${response.status}`)
    }

    const payload = (await response.json()) as OSRMSegmentResponse
    if (payload.code !== "Ok" || payload.routes.length === 0) {
      throw new Error(`OSRM returned code ${payload.code}`)
    }

    const route = payload.routes[0]
    const coordinates = route.geometry?.coordinates ?? []
    if (coordinates.length === 0) {
      throw new Error("OSRM returned empty geometry")
    }

    return {
      coordinates,
      duration_mins: route.duration / 60,
      distance_km: route.distance / 1000,
    }
  } finally {
    window.clearTimeout(timeout)
  }
}

export function mergeRouteCoordinates(
  base: [number, number][],
  append: [number, number][],
): [number, number][] {
  if (append.length === 0) {
    return base
  }

  const merged = [...base]
  let startIndex = 0
  const last = merged[merged.length - 1]
  const first = append[0]

  if (
    last &&
    first &&
    Math.abs(last[0] - first[0]) < 1e-6 &&
    Math.abs(last[1] - first[1]) < 1e-6
  ) {
    startIndex = 1
  }

  merged.push(...append.slice(startIndex))
  return merged
}

