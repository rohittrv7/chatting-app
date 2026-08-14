# ADR 0004: Choice of Socket.io for Real-time Transport

## Context
Instant messaging, presence detection, typing indicators, delivery receipts, and WebRTC call signaling demand low-latency, bidirectional, persistent connections between mobile clients and the backend cluster.

## Decision
We choose **Socket.io** with `@socket.io/redis-adapter` as our WebSocket framework.

## Consequences
- **Horizontal Scalability:** The Redis Adapter enables seamless Pub/Sub event broadcasting across multiple stateless NestJS node instances.
- **Transport Fallback & Heartbeat:** Robust automatic reconnection, heartbeat ping/pong latency monitoring, and binary stream support.
- **Client Ecosystem:** Official and mature `socket_io_client` Flutter package available for Android/iOS.

## Alternatives Considered
- **Raw WebSockets (`ws` package):** Requires re-implementing room management, heartbeat reconnect logic, and multi-node Redis adapter fan-out manually.
- **gRPC Streams:** Excellent binary performance, but web/mobile network proxies sometimes drop HTTP/2 streaming connections compared to standard WebSocket upgrade flows.
