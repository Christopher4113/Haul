# Builds both images using the local Docker daemon (Docker Desktop)
# and applies all K8s manifests. Run once for initial setup.

docker build -f docker/Dockerfile.api -t haul-api:latest ./server
docker build -f docker/Dockerfile.optimizer -t haul-optimizer:latest ./server

kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/secret.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/rbac.yaml
kubectl apply -f k8s/api-deployment.yaml
kubectl apply -f k8s/api-service.yaml
kubectl apply -f k8s/ingress.yaml

Write-Host "Done. Run: kubectl port-forward svc/haul-api 8080:8080 -n haul"
