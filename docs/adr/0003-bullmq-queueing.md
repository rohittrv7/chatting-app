# ADR 0003: Choice of BullMQ for Asynchronous Task Queueing

## Context
Background tasks such as Firebase Cloud Messaging (FCM) push notification delivery, orphan Signal prekey cleanup, and media compression processing require isolated asynchronous execution without blocking HTTP request execution or Socket gateway threads.

## Decision
We choose **BullMQ** (Redis-backed queueing system for Node.js).

## Consequences
- **Distributed Queues:** Offloads push delivery and async notifications to separate background worker processes.
- **Retry & Backoff:** Built-in configurable backoff strategies for handling FCM API rate limits and transient network failures.
- **Observability:** Integrates cleanly with Prometheus metrics to track queue depth, process latency, and failure rates.

## Alternatives Considered
- **RabbitMQ / Kafka:** Enterprise messaging queues providing massive event streams, but adding high operational complexity for queue requirements natively solved by Redis-backed BullMQ.
- **In-process Async Timers:** Unreliable across server restarts and non-scalable across multi-instance load balancers.
