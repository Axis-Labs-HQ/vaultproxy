FROM golang:1.23-alpine AS builder

RUN apk add --no-cache gcc musl-dev

WORKDIR /app

COPY control-plane/go.mod control-plane/go.sum ./
COPY control-plane/ .

RUN go mod tidy && CGO_ENABLED=1 go build -o vaultproxy ./cmd/server

FROM alpine:3.20

RUN apk add --no-cache ca-certificates

WORKDIR /app

COPY --from=builder /app/vaultproxy .

EXPOSE 8080

CMD ["./vaultproxy"]
