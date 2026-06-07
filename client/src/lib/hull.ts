export type LatLng = { lat: number; lng: number }

export type HullPolygonFeature = {
  type: "Feature"
  properties: Record<string, never>
  geometry: {
    type: "Polygon"
    coordinates: [number, number][][]
  }
}

function cross(origin: LatLng, a: LatLng, b: LatLng): number {
  return (a.lng - origin.lng) * (b.lat - origin.lat) - (a.lat - origin.lat) * (b.lng - origin.lng)
}

export function convexHull(points: LatLng[]): LatLng[] {
  if (points.length < 3) {
    return points
  }

  let leftmost = 0
  for (let index = 1; index < points.length; index += 1) {
    const candidate = points[index]
    const current = points[leftmost]
    if (
      candidate.lng < current.lng ||
      (candidate.lng === current.lng && candidate.lat < current.lat)
    ) {
      leftmost = index
    }
  }

  const hull: LatLng[] = []
  let current = leftmost

  do {
    hull.push(points[current])
    let next = (current + 1) % points.length

    for (let index = 0; index < points.length; index += 1) {
      const orientation = cross(points[current], points[index], points[next])
      if (orientation > 0) {
        next = index
      }
    }

    current = next
  } while (current !== leftmost && hull.length <= points.length)

  return hull
}

export function padHull(hull: LatLng[], paddingDeg = 0.003): LatLng[] {
  if (hull.length === 0) {
    return hull
  }

  const centroid = {
    lat: hull.reduce((sum, point) => sum + point.lat, 0) / hull.length,
    lng: hull.reduce((sum, point) => sum + point.lng, 0) / hull.length,
  }

  return hull.map((point) => ({
    lat: point.lat + (point.lat >= centroid.lat ? paddingDeg : -paddingDeg),
    lng: point.lng + (point.lng >= centroid.lng ? paddingDeg : -paddingDeg),
  }))
}

function ringFromPoints(points: LatLng[]): [number, number][] {
  if (points.length === 0) {
    return []
  }
  return [...points, points[0]].map((point) => [point.lng, point.lat])
}

export function polygonFromHull(hull: LatLng[]): HullPolygonFeature {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [ringFromPoints(hull)],
    },
  }
}

export function hullToGeoJSON(points: LatLng[]): HullPolygonFeature {
  return polygonFromHull(convexHull(points))
}
