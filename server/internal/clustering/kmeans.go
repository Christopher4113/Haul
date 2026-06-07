package clustering

import "math"

type Point struct {
	Lat float64
	Lng float64
}

func KMeans(points []Point, k int) []int {
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
			bestDist := squaredDistance(p, centroids[0])
			for c := 1; c < k; c++ {
				if d := squaredDistance(p, centroids[c]); d < bestDist {
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
			if move := math.Sqrt(squaredDistance(newCentroids[c], centroids[c])); move > maxMove {
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

func squaredDistance(a, b Point) float64 {
	dLat := a.Lat - b.Lat
	dLng := a.Lng - b.Lng
	return dLat*dLat + dLng*dLng
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
