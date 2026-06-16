# Stage 1: Build Frontend React app
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend-builder
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build Go Backend
FROM golang:1.26-alpine AS backend-builder
WORKDIR /app
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
# Copy compiled frontend assets from Stage 1 directly to the embed target directory
COPY --from=frontend-builder /app/dist/ ./internal/api/dist/

ARG VERSION=dev
ARG BUILD_DATE=unknown
ARG GIT_SHA=unknown
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w -X ratikka/internal/api.Version=${VERSION} -X ratikka/internal/api.BuildDate=${BUILD_DATE} -X ratikka/internal/api.GitCommit=${GIT_SHA}" -o ratikka ./cmd/ratikka

# Stage 3: Minimal Production Runtime
FROM alpine:3.21
RUN apk --no-cache add ca-certificates tzdata
WORKDIR /app
COPY --from=backend-builder /app/ratikka .
EXPOSE 8080
ENTRYPOINT ["./ratikka"]
