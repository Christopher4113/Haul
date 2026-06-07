import { Home, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import Map, { Layer, Marker, Popup, Source } from "react-map-gl/maplibre"
import type { MapLayerMouseEvent } from "react-map-gl/maplibre"
import "maplibre-gl/dist/maplibre-gl.css"

import type { Errand, RouteGeoJSON, RouteLeg, ClusterSummary } from "@/lib/api"
import { convexHull, padHull, polygonFromHull } from "@/lib/hull"
import { isClosedOnArrival, type ArrivalSlot } from "@/lib/maps"

const TORONTO = { latitude: 43.65, longitude: -79.38, zoom: 11 }

const CLUSTER_COLORS = ["#F59E0B", "#3B82F6", "#22C55E", "#A855F7", "#EF4444", "#06B6D4"]
const CLUSTER_POLYGON_COLORS = ["#F59E0B", "#3B82F6", "#22C55E", "#A855F7", "#EF4444"]

const OSM_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: "raster" as const,
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [
    {
      id: "osm",
      type: "raster" as const,
      source: "osm",
      minzoom: 0,
      maxzoom: 19,
    },
  ],
}

export interface OriginCoords {
  lat: number
  lng: number
}

interface ErrandMapProps {
  errands: Errand[]
  routeGeoJSON: RouteGeoJSON | null
  origin: OriginCoords | null
  legs?: RouteLeg[]
  arrivalSchedule?: Map<string, ArrivalSlot>
  showClusters?: boolean
  clusters?: ClusterSummary[]
}

function clusterColor(clusterId: number): string {
  return CLUSTER_POLYGON_COLORS[clusterId % CLUSTER_POLYGON_COLORS.length]
}

function clusterPointsFor(errands: Errand[], clusterId: number): Array<{ lat: number; lng: number }> {
  return errands
    .filter(
      (errand) =>
        errand.clusterId === clusterId &&
        errand.lat != null &&
        errand.lng != null &&
        Number.isFinite(errand.lat) &&
        Number.isFinite(errand.lng),
    )
    .map((errand) => ({ lat: errand.lat as number, lng: errand.lng as number }))
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "")
  const r = Number.parseInt(normalized.slice(0, 2), 16)
  const g = Number.parseInt(normalized.slice(2, 4), 16)
  const b = Number.parseInt(normalized.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function pinColor(clusterId: number | null) {
  if (clusterId === null) {
    return "#6d28d9"
  }
  return CLUSTER_COLORS[clusterId % CLUSTER_COLORS.length]
}

function formatTime(t: string | null): string {
  if (!t) {
    return ""
  }

  const clockMatch = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?/)
  if (clockMatch) {
    const hours = Number(clockMatch[1])
    const minutes = Number(clockMatch[2])
    const period = hours >= 12 ? "PM" : "AM"
    const hour12 = hours % 12 || 12
    return `${hour12}:${minutes.toString().padStart(2, "0")} ${period}`
  }

  const parsed = new Date(t)
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
  }

  return ""
}

function stopLabel(id: string, errands: Errand[]): string {
  if (id === "origin") {
    return "Origin"
  }
  const errand = errands.find((e) => e.id === id)
  if (!errand) {
    return "Stop"
  }
  return `Stop ${errand.seqOrder ?? "?"}`
}

function midpoint(
  a: { lng: number; lat: number },
  b: { lng: number; lat: number },
): { lng: number; lat: number } {
  return { lng: (a.lng + b.lng) / 2, lat: (a.lat + b.lat) / 2 }
}

function euclideanDist(
  p1: { lng: number; lat: number },
  p2: { lng: number; lat: number },
): number {
  const dx = p1.lng - p2.lng
  const dy = p1.lat - p2.lat
  return dx * dx + dy * dy
}

function resolveWaypointCoords(
  id: string,
  errands: Errand[],
  origin: OriginCoords | null,
): { lng: number; lat: number } | null {
  if (id === "origin" && origin) {
    return { lng: origin.lng, lat: origin.lat }
  }
  const errand = errands.find((e) => e.id === id)
  if (errand?.lng != null && errand?.lat != null) {
    return { lng: errand.lng, lat: errand.lat }
  }
  return null
}

function findNearestLeg(
  click: { lng: number; lat: number },
  legs: RouteLeg[],
  errands: Errand[],
  origin: OriginCoords | null,
): RouteLeg | null {
  if (legs.length === 0) {
    return null
  }

  let bestLeg = legs[0]
  let bestDist = Infinity

  for (const leg of legs) {
    const from = resolveWaypointCoords(leg.from_id, errands, origin)
    const to = resolveWaypointCoords(leg.to_id, errands, origin)
    if (!from || !to) {
      continue
    }
    const mid = midpoint(from, to)
    const dist = euclideanDist(click, mid)
    if (dist < bestDist) {
      bestDist = dist
      bestLeg = leg
    }
  }

  return bestLeg
}

function isValidCoord(lng: number | null | undefined, lat: number | null | undefined): boolean {
  const lngNum = Number(lng)
  const latNum = Number(lat)
  return Number.isFinite(lngNum) && Number.isFinite(latNum)
}

function HoursLine({ errand }: { errand: Errand }) {
  if (errand.openNow === true && errand.closesAt) {
    const closes = formatTime(errand.closesAt)
    if (!closes) {
      return null
    }
    return (
      <p className="mt-1 text-xs text-green-600">
        Open · Closes {closes}
      </p>
    )
  }

  if (errand.openNow === false && errand.opensAt) {
    const opens = formatTime(errand.opensAt)
    if (!opens) {
      return <p className="mt-1 text-xs text-red-600">Closed</p>
    }
    return (
      <p className="mt-1 text-xs text-red-600">
        Closed · Opens {opens}
      </p>
    )
  }

  if (errand.openNow === false) {
    return <p className="mt-1 text-xs text-red-600">Closed</p>
  }

  return null
}

function ArrivalLines({
  errand,
  schedule,
}: {
  errand: Errand
  schedule: Map<string, ArrivalSlot> | undefined
}) {
  const slot = schedule?.get(errand.id)
  if (!slot) {
    return null
  }

  return (
    <>
      <p className="mt-1 text-xs text-zinc-500">Arrive {slot.arrives_at}</p>
      <p className="text-xs text-zinc-500">Depart {slot.departs_at}</p>
      {isClosedOnArrival(slot.arrivesAt, errand.closesAt) && (
        <p className="mt-0.5 text-xs text-amber-500">⚠ May be closed on arrival</p>
      )}
    </>
  )
}

export function ErrandMap({
  errands,
  routeGeoJSON,
  origin,
  legs,
  arrivalSchedule,
  showClusters = false,
  clusters = [],
}: ErrandMapProps) {
  const safeLegs = legs ?? []
  const layerVisibility = showClusters ? "visible" : "none"

  const geocoded = useMemo(
    () =>
      errands
        .map((errand) => ({ errand }))
        .filter(
          ({ errand }) =>
            errand.lat !== null &&
            errand.lng !== null &&
            Number.isFinite(errand.lat) &&
            Number.isFinite(errand.lng),
        )
        .sort((a, b) => (a.errand.seqOrder ?? Infinity) - (b.errand.seqOrder ?? Infinity)),
    [errands],
  )

  const [viewState, setViewState] = useState(TORONTO)
  const [mapLoaded, setMapLoaded] = useState(false)
  const [activeStopPopup, setActiveStopPopup] = useState<{ errandId: string } | null>(null)
  const [activeLegPopup, setActiveLegPopup] = useState<{
    lngLat: { lng: number; lat: number }
    leg: RouteLeg
  } | null>(null)

  const originLat = origin?.lat ?? null
  const originLng = origin?.lng ?? null

  useEffect(() => {
    const points: { lat: number; lng: number }[] = geocoded.map(({ errand }) => ({
      lat: errand.lat as number,
      lng: errand.lng as number,
    }))
    if (originLat != null && originLng != null) {
      points.push({ lat: originLat, lng: originLng })
    }

    if (points.length === 0) {
      setViewState(TORONTO)
      return
    }

    const lats = points.map((point) => point.lat)
    const lngs = points.map((point) => point.lng)

    setViewState({
      latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
      longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
      zoom: points.length === 1 ? 13 : 11,
    })
  }, [geocoded, originLat, originLng])

  function handleMapClick(event: MapLayerMouseEvent) {
    const features = event.target.queryRenderedFeatures(event.point, {
      layers: ["route-line"],
    })

    if (features.length > 0 && safeLegs.length > 0) {
      const leg = findNearestLeg(event.lngLat, safeLegs, errands, origin)
      if (leg) {
        setActiveLegPopup({
          lngLat: {
            lng: Number(event.lngLat.lng),
            lat: Number(event.lngLat.lat),
          },
          leg,
        })
        setActiveStopPopup(null)
        return
      }
    }

    setActiveLegPopup(null)
    setActiveStopPopup(null)
  }

  const activeStopErrand = activeStopPopup
    ? errands.find((e) => e.id === activeStopPopup.errandId)
    : null

  const stopPopupCoords =
    activeStopErrand && isValidCoord(activeStopErrand.lng, activeStopErrand.lat)
      ? { lng: Number(activeStopErrand.lng), lat: Number(activeStopErrand.lat) }
      : null

  const legPopupCoords =
    activeLegPopup?.lngLat &&
    isValidCoord(activeLegPopup.lngLat.lng, activeLegPopup.lngLat.lat)
      ? {
          lng: Number(activeLegPopup.lngLat.lng),
          lat: Number(activeLegPopup.lngLat.lat),
        }
      : null

  return (
    <Map
      {...viewState}
      onLoad={() => setMapLoaded(true)}
      onMove={(event) => setViewState(event.viewState)}
      onClick={handleMapClick}
      interactiveLayerIds={safeLegs.length > 0 ? ["route-line"] : []}
      cursor={safeLegs.length > 0 ? "pointer" : undefined}
      mapStyle={OSM_STYLE}
      style={{ width: "100%", height: "100%" }}
      attributionControl={{ compact: true }}
    >
      {clusters.map((cluster) => {
        const points = clusterPointsFor(errands, cluster.id)
        if (points.length === 0) {
          return null
        }

        const color = clusterColor(cluster.id)

        if (points.length === 1) {
          const point = points[0]
          return (
            <Source
              key={`cluster-point-${cluster.id}`}
              id={`cluster-point-${cluster.id}`}
              type="geojson"
              data={{
                type: "Feature",
                properties: {},
                geometry: {
                  type: "Point",
                  coordinates: [point.lng, point.lat],
                },
              }}
            >
              <Layer
                id={`cluster-fill-${cluster.id}`}
                type="circle"
                layout={{ visibility: layerVisibility }}
                paint={{
                  "circle-color": color,
                  "circle-opacity": 0.15,
                  "circle-radius": 22,
                  "circle-stroke-color": color,
                  "circle-stroke-width": 1.5,
                  "circle-stroke-opacity": 0.6,
                }}
              />
            </Source>
          )
        }

        if (points.length === 2) {
          const [first, second] = points
          return (
            <Source
              key={`cluster-line-src-${cluster.id}`}
              id={`cluster-line-src-${cluster.id}`}
              type="geojson"
              data={{
                type: "Feature",
                properties: {},
                geometry: {
                  type: "LineString",
                  coordinates: [
                    [first.lng, first.lat],
                    [second.lng, second.lat],
                  ],
                },
              }}
            >
              <Layer
                id={`cluster-line-${cluster.id}`}
                type="line"
                layout={{ visibility: layerVisibility }}
                paint={{
                  "line-color": color,
                  "line-width": 1.5,
                  "line-opacity": 0.6,
                  "line-dasharray": [4, 2],
                }}
              />
            </Source>
          )
        }

        const polygon = polygonFromHull(padHull(convexHull(points)))

        return (
          <Source
            key={`cluster-polygon-${cluster.id}`}
            id={`cluster-polygon-${cluster.id}`}
            type="geojson"
            data={polygon}
          >
            <Layer
              id={`cluster-fill-${cluster.id}`}
              type="fill"
              layout={{ visibility: layerVisibility }}
              paint={{
                "fill-color": color,
                "fill-opacity": 0.15,
              }}
            />
            <Layer
              id={`cluster-line-${cluster.id}`}
              type="line"
              layout={{ visibility: layerVisibility }}
              paint={{
                "line-color": color,
                "line-width": 1.5,
                "line-opacity": 0.6,
                "line-dasharray": [4, 2],
              }}
            />
          </Source>
        )
      })}

      {routeGeoJSON && (
        <Source id="route" type="geojson" data={routeGeoJSON}>
          <Layer
            id="route-line"
            type="line"
            paint={{
              "line-color": "#F59E0B",
              "line-width": 3,
              "line-opacity": 0.8,
            }}
          />
        </Source>
      )}

      {origin && (
        <Marker longitude={origin.lng} latitude={origin.lat} anchor="center">
          <div className="flex size-9 items-center justify-center rounded-full border-2 border-zinc-800 bg-white text-zinc-900 shadow-md">
            <Home className="size-4" strokeWidth={2} />
          </div>
        </Marker>
      )}

      {showClusters &&
        clusters.map((cluster) => {
          const color = clusterColor(cluster.id)
          return (
            <Marker
              key={`cluster-label-${cluster.id}`}
              longitude={cluster.centroid_lng}
              latitude={cluster.centroid_lat}
              anchor="center"
            >
              <div
                className="whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{
                  backgroundColor: hexToRgba(color, 0.3),
                  color,
                }}
              >
                Cluster {cluster.id + 1} · {cluster.count} stops
              </div>
            </Marker>
          )
        })}

      {geocoded.map(({ errand }, index) => {
        const label = errand.seqOrder ?? index + 1
        const color = pinColor(errand.clusterId)

        return (
          <Marker
            key={errand.id}
            longitude={errand.lng as number}
            latitude={errand.lat as number}
            anchor="center"
          >
            <button
              type="button"
              className="flex size-8 cursor-pointer items-center justify-center rounded-full text-xs font-semibold text-white shadow-md ring-2 ring-background transition-colors duration-300"
              style={{ backgroundColor: color }}
              onClick={(event) => {
                event.stopPropagation()
                setActiveStopPopup({ errandId: errand.id })
                setActiveLegPopup(null)
              }}
            >
              {label}
            </button>
          </Marker>
        )
      })}

      {mapLoaded && stopPopupCoords && activeStopPopup && activeStopErrand && (
        <Popup
          key={activeStopPopup.errandId}
          longitude={stopPopupCoords.lng}
          latitude={stopPopupCoords.lat}
          anchor="top"
          closeButton={false}
          closeOnClick={false}
          onClose={() => setActiveStopPopup(null)}
          offset={12}
          className="haul-popup"
        >
          <div className="relative min-w-[200px] rounded-lg bg-white p-3 shadow-md">
            <button
              type="button"
              aria-label="Close"
              className="absolute right-2 top-2 text-zinc-400 hover:text-zinc-700"
              onClick={() => setActiveStopPopup(null)}
            >
              <X className="size-3.5" />
            </button>
            <p className="pr-5 text-sm font-bold">{activeStopErrand.name}</p>
            <p className="mt-0.5 text-xs text-zinc-500">{activeStopErrand.address}</p>
            <HoursLine errand={activeStopErrand} />
            <ArrivalLines errand={activeStopErrand} schedule={arrivalSchedule} />
            <p className="mt-2 text-xs font-medium text-amber-500">
              Stop {activeStopErrand.seqOrder ?? "?"}
            </p>
          </div>
        </Popup>
      )}

      {mapLoaded && legPopupCoords && activeLegPopup && (
        <Popup
          key={`leg-${activeLegPopup.leg.from_id}-${activeLegPopup.leg.to_id}-${legPopupCoords.lng}-${legPopupCoords.lat}`}
          longitude={legPopupCoords.lng}
          latitude={legPopupCoords.lat}
          anchor="top"
          closeButton={false}
          closeOnClick={false}
          onClose={() => setActiveLegPopup(null)}
          className="haul-popup"
        >
          <div className="min-w-[200px] rounded-lg bg-white p-3 shadow-md">
            <p className="text-base font-bold text-amber-500">
              ~{Math.round(activeLegPopup.leg.duration_mins)} min drive
            </p>
            <p className="mt-0.5 text-sm text-zinc-500">
              {activeLegPopup.leg.distance_km.toFixed(1)} km
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              {stopLabel(activeLegPopup.leg.from_id, errands)} →{" "}
              {stopLabel(activeLegPopup.leg.to_id, errands)}
            </p>
          </div>
        </Popup>
      )}
    </Map>
  )
}
