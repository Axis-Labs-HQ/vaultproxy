FROM rust:1.94-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y cmake gcc g++ pkg-config make && rm -rf /var/lib/apt/lists/*
COPY proxy/ .
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/vaultproxy-proxy .
EXPOSE 10255
CMD ["./vaultproxy-proxy"]
