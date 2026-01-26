#!/bin/bash
# Setup script for testing Kubernetes sandbox backend locally with kind

set -e

CLUSTER_NAME="${CLUSTER_NAME:-rayai-sandbox}"
AGENT_SANDBOX_VERSION="${AGENT_SANDBOX_VERSION:-v0.1.0}"

echo "=== Setting up kind cluster for sandbox testing ==="

# Check if kind is installed
if ! command -v kind &> /dev/null; then
    echo "Error: kind is not installed. Install it from https://kind.sigs.k8s.io/"
    exit 1
fi

# Check if kubectl is installed
if ! command -v kubectl &> /dev/null; then
    echo "Error: kubectl is not installed."
    exit 1
fi

# Create kind cluster if it doesn't exist
if kind get clusters | grep -q "^${CLUSTER_NAME}$"; then
    echo "Cluster ${CLUSTER_NAME} already exists"
else
    echo "Creating kind cluster: ${CLUSTER_NAME}"
    kind create cluster --name "${CLUSTER_NAME}"
fi

# Set kubectl context
kubectl cluster-info --context "kind-${CLUSTER_NAME}"

# Install agent-sandbox controller
echo "Installing agent-sandbox controller ${AGENT_SANDBOX_VERSION}..."
kubectl apply --context "kind-${CLUSTER_NAME}" \
    -f "https://github.com/kubernetes-sigs/agent-sandbox/releases/download/${AGENT_SANDBOX_VERSION}/manifest.yaml" \
    -f "https://github.com/kubernetes-sigs/agent-sandbox/releases/download/${AGENT_SANDBOX_VERSION}/extensions.yaml"

# Wait for controller to be ready
echo "Waiting for agent-sandbox controller to be ready..."
kubectl wait --context "kind-${CLUSTER_NAME}" --for=condition=available --timeout=120s deployment/agent-sandbox-controller -n agent-sandbox-system

# Create sandbox template and warm pool
echo "Creating SandboxTemplate and SandboxWarmPool..."
cat <<EOF | kubectl apply --context "kind-${CLUSTER_NAME}" -f -
apiVersion: extensions.agents.x-k8s.io/v1alpha1
kind: SandboxTemplate
metadata:
  name: python-runtime-template
  namespace: default
spec:
  podTemplate:
    metadata:
      labels:
        sandbox: python-sandbox
    spec:
      containers:
      - name: python-runtime
        image: registry.k8s.io/agent-sandbox/python-runtime-sandbox:${AGENT_SANDBOX_VERSION}
        ports:
        - containerPort: 8888
        readinessProbe:
          httpGet:
            path: "/"
            port: 8888
          initialDelaySeconds: 0
          periodSeconds: 1
        resources:
          requests:
            cpu: "250m"
            memory: "512Mi"
            ephemeral-storage: "512Mi"
      restartPolicy: "OnFailure"
---
apiVersion: extensions.agents.x-k8s.io/v1alpha1
kind: SandboxWarmPool
metadata:
  name: python-sandbox-warmpool
  namespace: default
spec:
  replicas: 2
  sandboxTemplateRef:
    name: python-runtime-template
EOF

# Deploy sandbox router
echo "Deploying sandbox router..."
cat <<EOF | kubectl apply --context "kind-${CLUSTER_NAME}" -f -
apiVersion: v1
kind: Service
metadata:
  name: sandbox-router-svc
  namespace: default
spec:
  type: ClusterIP
  ports:
  - port: 8080
    targetPort: 8080
  selector:
    app: sandbox-router
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sandbox-router
  namespace: default
spec:
  replicas: 1
  selector:
    matchLabels:
      app: sandbox-router
  template:
    metadata:
      labels:
        app: sandbox-router
    spec:
      serviceAccountName: default
      containers:
      - name: router
        image: registry.k8s.io/agent-sandbox/router:${AGENT_SANDBOX_VERSION}
        ports:
        - containerPort: 8080
        resources:
          requests:
            cpu: "100m"
            memory: "128Mi"
EOF

echo "Waiting for router to be ready..."
kubectl wait --context "kind-${CLUSTER_NAME}" --for=condition=available --timeout=120s deployment/sandbox-router -n default

echo ""
echo "=== Setup complete! ==="
echo ""
echo "To test the Kubernetes sandbox backend, run:"
echo ""
echo "  # Install the agent-sandbox Python client"
echo '  pip install "git+https://github.com/kubernetes-sigs/agent-sandbox.git#subdirectory=clients/python/agentic-sandbox-client"'
echo ""
echo "  # Set environment variables"
echo "  export RAYAI_SANDBOX_BACKEND=kubernetes"
echo "  export RAYAI_SANDBOX_TEMPLATE=python-runtime-template"
echo "  export RAYAI_SANDBOX_NAMESPACE=default"
echo ""
echo "  # Run your agent"
echo "  python -c 'from rayai.sandbox import execute_code; import ray; ray.init(); print(ray.get(execute_code.remote(\"print(1+1)\"))'"
echo ""
echo "To delete the cluster later:"
echo "  kind delete cluster --name ${CLUSTER_NAME}"
