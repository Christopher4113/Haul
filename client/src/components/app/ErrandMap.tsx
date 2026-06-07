import { useEffect, useMemo, useState } from "react"
import Map, { Marker } from "react-map-gl/maplibre"
import "maplibre-gl/dist/maplibre-gl.css"

import type { Errand } from "@/lib/api"

const TORONTO = { latitude: 43.65, longitude: -79.38, zoom: 11 }

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

interface ErrandMapProps {
  errands: Errand[]
}

export function ErrandMap({ errands }: ErrandMapProps) {
  const geocoded = useMemo(
    () =>
      errands
        .map((errand, index) => ({ errand, index }))
        .filter(
          ({ errand }) =>
            errand.lat !== null &&
            errand.lng !== null &&
            Number.isFinite(errand.lat) &&
            Number.isFinite(errand.lng),
        ),
    [errands],
  )

  const [viewState, setViewState] = useState(TORONTO)

  useEffect(() => {
    if (geocoded.length === 0) {
      setViewState(TORONTO)
      return
    }

    const lats = geocoded.map(({ errand }) => errand.lat as number)
    const lngs = geocoded.map(({ errand }) => errand.lng as number)

    setViewState({
      latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
      longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
      zoom: geocoded.length === 1 ? 13 : 11,
    })
  }, [geocoded])

  return (
    <Map
      {...viewState}
      onMove={(event) => setViewState(event.viewState)}
      mapStyle={OSM_STYLE}
      style={{ width: "100%", height: "100%" }}
      attributionControl={{ compact: true }}
    >
      {geocoded.map(({ errand, index }) => (
        <Marker
          key={errand.id}
          longitude={errand.lng as number}
          latitude={errand.lat as number}
          anchor="center"
        >
          <div className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground shadow-md ring-2 ring-background">
            {index + 1}
          </div>
        </Marker>
      ))}
    </Map>
  )
}
