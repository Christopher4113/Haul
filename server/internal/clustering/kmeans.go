package clustering

import (
	"math"
	"time"
)

type Point struct {
	Lat      float64
	Lng      float64
	PlaceID  string
	OpenNow  bool
	OpensAt  time.Time
	ClosesAt time.Time
	HasHours bool
}

func KMeans(points []Point, k int, now time.Time) []int {
	n := len(points)
	if n == 0 {
		return nil
	}
	if k <= 0 {
		k = 1
	}
	if k > n {
		k = n
	}

	assignments := make([]int, n)
	centroids := make([]Point, k)
	for i := 0; i < k; i++ {
		centroids[i] = points[i]
	}

	const maxIter = 100
	const delta = 0.0001

	for iter := 0; iter < maxIter; iter++ {
		for i, p := range points {
			best := 0
			bestDist := WeightedDistance(centroids[0], p, now)
			for c := 1; c < k; c++ {
				if d := WeightedDistance(centroids[c], p, now); d < bestDist {
					bestDist = d
					best = c
				}
			}
			assignments[i] = best
		}

		newCentroids := make([]Point, k)
		counts := make([]int, k)
		for i, p := range points {
			c := assignments[i]
			newCentroids[c].Lat += p.Lat
			newCentroids[c].Lng += p.Lng
			counts[c]++
		}

		maxMove := 0.0
		for c := 0; c < k; c++ {
			if counts[c] == 0 {
				newCentroids[c] = points[c%n]
				continue
			}
			newCentroids[c].Lat /= float64(counts[c])
			newCentroids[c].Lng /= float64(counts[c])
			if move := HaversineKm(centroids[c].Lat, centroids[c].Lng, newCentroids[c].Lat, newCentroids[c].Lng); move > maxMove {
				maxMove = move
			}
		}
		centroids = newCentroids

		if maxMove < delta {
			break
		}
	}

	return assignments
}

func HaversineKm(lat1, lng1, lat2, lng2 float64) float64 {
	const earthRadiusKm = 6371.0
	dLat := (lat2 - lat1) * math.Pi / 180
	dLng := (lng2 - lng1) * math.Pi / 180

	lat1Rad := lat1 * math.Pi / 180
	lat2Rad := lat2 * math.Pi / 180

	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1Rad)*math.Cos(lat2Rad)*math.Sin(dLng/2)*math.Sin(dLng/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return earthRadiusKm * c
}

func WeightedDistance(p1, p2 Point, now time.Time) float64 {
	dist := HaversineKm(p1.Lat, p1.Lng, p2.Lat, p2.Lng)
	if !p2.HasHours {
		return dist
	}

	multiplier := 1.0
	if !p2.OpenNow {
		multiplier *= 3.0
	}
	if !p2.ClosesAt.IsZero() && now.Before(p2.ClosesAt) && p2.ClosesAt.Sub(now) <= 30*time.Minute {
		multiplier *= 1.5
	}
	if !p2.OpensAt.IsZero() && now.Before(p2.OpensAt) {
		multiplier *= 2.0
	}

	return dist * multiplier
}

func Centroid(points []Point) Point {
	if len(points) == 0 {
		return Point{}
	}
	var sum Point
	for _, p := range points {
		sum.Lat += p.Lat
		sum.Lng += p.Lng
	}
	n := float64(len(points))
	return Point{Lat: sum.Lat / n, Lng: sum.Lng / n}
}
