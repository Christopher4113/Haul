# Quick rebuild for iterating — rebuilds API image and rolls the deployment
docker build -f docker/Dockerfile.api -t haul-api:latest ./server
kubectl rollout restart deployment/haul-api -n haul
kubectl rollout status deployment/haul-api -n haul
