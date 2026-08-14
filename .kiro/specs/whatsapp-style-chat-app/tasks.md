# Implementation Plan: WhatsApp-Style E2EE Chat Application

## Overview

This plan converts the full design into discrete coding tasks for the NestJS backend (TypeScript), Flutter mobile client (Dart), and shared packages. Tasks are ordered to build foundational layers first, integrate incrementally, and validate early via tests. All 10 correctness properties from the design are covered by property-based tests using fast-check (backend) and glados (Flutter).

## Tasks

- [x] 1. Shared Contracts Package and Monorepo Foundation
  - [x] 1.1 Create `packages/shared-contracts` with socket event enum and payload interfaces
    - Create `packages/shared-contracts/src/events.ts` exporting `SocketEvent` enum with all `v1.*` event names
    - Create TypeScript interfaces for every socket event payload listed in the design event catalog
    - Export all shared enums: `DeliveryStatus`, `MessageType`, `CallType`, `CallStatus`, `Role`, `ConversationType`
    - Export REST DTO classes decorated with class-validator
    - Configure `package.json` with workspace alias `@chat/shared-contracts`
    - _Requirements: 24.1, 24.2, 24.3, 24.4, 38.3_

  - [x] 1.2 Create `packages/shared-config` with environment schema and base configs
    - Define Zod/class-validator schema for all required environment variables
    - Export base ESLint and TypeScript configs
    - Configure `package.json` with workspace alias `@chat/shared-config`
    - _Requirements: 38.3, 35.1_

  - [x] 1.3 Configure pnpm workspaces and root-level tooling
    - Create `pnpm-workspace.yaml` listing all packages and apps
    - Add root `package.json` with dev-dependency scripts for lint, test, build
    - Configure Husky + lint-staged for pre-commit ESLint + Prettier on staged files
    - _Requirements: 38.2, 35.2_

  - [-]* 1.4 Write unit tests for shared-contracts enum completeness
    - Assert every `SocketEvent` enum value matches the pattern `v\d+\.\w+`
    - Assert all DeliveryStatus transitions are defined
    - _Requirements: 24.1, 24.3_

- [x] 2. Database Schema, Migrations, and Prisma Service
  - [x] 2.1 Finalize Prisma schema and create new migration for `deletedAt` soft-delete
    - Add `deletedAt DateTime?` to the `Conversation` model
    - Run `prisma migrate dev` to generate migration SQL
    - Write `rollback.sql` reversing the `deletedAt` column addition
    - Write `migration-notes.md` with change summary, affected entities, and data compatibility assessment
    - _Requirements: 4.8, 25.1, 25.2, 25.3_

  - [x] 2.2 Complete PrismaService with health-check query and graceful shutdown hook
    - Extend `apps/backend/src/database/prisma.service.ts` to call `$connect()` on `onModuleInit`
    - Implement `enableShutdownHooks()` to call `$disconnect()` on SIGTERM
    - Add a `ping()` method used by the health endpoint
    - _Requirements: 23.1, 39.5_

  - [-]* 2.3 Write integration tests for PrismaService connection lifecycle
    - Test `ping()` returns successfully against a test database
    - _Requirements: 40.2_

- [x] 3. Backend Core Infrastructure (Security, Observability, Error Handling)
  - [x] 3.1 Implement SecurityModule with NonceGuard, CsrfGuard, and SecurityHeadersMiddleware
    - Create `src/modules/security/nonce.guard.ts`: store nonces in Redis with 5-min TTL; reject duplicate nonces with HTTP 409 / `REPLAY_DETECTED`
    - Create `src/modules/security/csrf.guard.ts`: double-submit cookie validation on state-mutating routes
    - Create `src/modules/security/security-headers.middleware.ts`: attach HSTS, X-Content-Type-Options, X-Frame-Options, CSP, Referrer-Policy headers
    - Register guards and middleware in `SecurityModule` and import in `AppModule`
    - _Requirements: 26.3, 26.4, 26.5_

  - [x] 3.2 Implement ObservabilityModule with Pino logger, PrometheusInterceptor, and OtelService
    - Configure pino global logger (JSON output) with level, timestamp, requestId fields; bind to NestJS Logger
    - Create `PrometheusInterceptor` tracking request count and duration histogram
    - Create `OtelService` initializing OpenTelemetry tracer provider with requestId span attribute propagation
    - Expose `GET /metrics` endpoint in Prometheus text format
    - _Requirements: 23.3, 23.4, 23.5, 23.6, 23.7_

  - [x] 3.3 Complete HttpExceptionFilter and global response transform interceptor
    - Ensure `HttpExceptionFilter` formats all errors as `{ success, code, message, details }` and suppresses stack traces outside development
    - Ensure `TransformInterceptor` wraps success responses as `{ success, message, data, timestamp }`
    - Attach unique UUIDv4 `requestId` to every request via middleware; include in response header `X-Request-Id` and all socket event payloads
    - _Requirements: 20.1, 20.2, 20.3, 20.6_

  - [ ]* 3.4 Write unit tests for SecurityModule guards
    - Test NonceGuard allows first nonce and rejects replay
    - Test CsrfGuard rejects requests without valid CSRF token
    - Test SecurityHeadersMiddleware attaches all required headers
    - _Requirements: 26.3, 26.4, 26.5_

- [x] 4. AuthModule — OTP, JWT, Refresh Tokens, Device Management
  - [x] 4.1 Implement AuthService OTP generation, verification, and lockout logic
    - Store OTP code, attempt count, and `lockedUntil` in Redis hash `otp:{phoneNumber}` with 10-min TTL
    - Enforce 5-attempt lockout → 30-min ban; return remaining attempts in 400 responses
    - On correct OTP: create User if new, issue JWT (15-min), issue RefreshToken (argon2id hash, 7-day), reset failure counter, invalidate previous Device tokens
    - Apply throttler guard (5 req / 10 min per phone) using Redis throttler store on OTP-send endpoint
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 22.2_

  - [x] 4.2 Implement JWT issuance, JwtStrategy, and JwtAuthGuard
    - Configure passport-jwt strategy validating `sub` + `deviceId` claims
    - Apply `JwtAuthGuard` globally; exclude OTP routes
    - Implement token refresh endpoint with argon2id hash verification and rotation (invalidate on replay)
    - Store RefreshToken hash with argon2id (time cost ≥2, memory cost 65536 KB)
    - _Requirements: 1.5, 1.6, 1.7, 21.1, 26.8_

  - [x] 4.3 Implement device registration and management endpoints
    - `POST /auth/otp/verify` stores Device with platform enum, device name (1–50 chars), optional FCM token
    - `GET /auth/devices` lists all User devices with name, platform, lastActiveAt
    - `DELETE /auth/devices/:deviceId` invalidates tokens and emits `v1.device.force-logout` socket event
    - Update `lastActiveAt` on every authenticated request via interceptor
    - Enforce 5-device limit; return HTTP 409 `DEVICE_LIMIT_EXCEEDED` when exceeded
    - _Requirements: 1.9, 15.1, 15.2, 15.5, 15.6, 15.8_

  - [ ]* 4.4 Write unit tests for AuthService
    - Test OTP generation, correct/incorrect verification, lockout after 5 failures, unlock after 30 min
    - Test RefreshToken rotation and replay detection
    - Test device limit enforcement
    - _Requirements: 40.1_

  - [ ]* 4.5 Write integration tests for auth endpoints
    - Test full OTP → JWT → refresh → logout flow against test database
    - _Requirements: 40.2_

- [~] 5. Checkpoint — Auth and Core Infrastructure
  - Ensure all tests in tasks 1–4 pass, ask the user if questions arise.

- [-] 6. KeyModule — Signal Protocol Key Distribution
  - [-] 6.1 Implement KeyService with key upload validation and atomic OneTimePreKey consumption
    - Validate SignedPreKey signature against IdentityKey using `@signalapp/libsignal-client`; reject entire upload with HTTP 422 on failure
    - Store IdentityKey, SignedPreKey, and batch of 100 OneTimePreKeys in a single Prisma `$transaction`
    - Implement `GET /keys/bundle/:userId/:deviceId`: atomically mark one unused OTPk as used in a transaction; return SignedPreKey-only bundle if pool empty and emit replenish event immediately
    - Check OTPk count after each consumption; dispatch BullMQ `replenish-otpk` job when count < 10
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.9, 3.10_

  - [-] 6.2 Implement BullMQ key event workers (replenish and rotate)
    - `replenish-otpk` worker: emit `v1.keys.replenish` socket event to all active sockets for the Device
    - Scheduled 30-day job: emit `v1.keys.rotate-signed` socket event to all active sockets for Device
    - Configure queues with 3-retry exponential backoff (1s, 2s, 4s) and dead-letter queue
    - _Requirements: 3.5, 3.7, 31.1, 31.2, 31.3_

  - [ ]* 6.3 Write property test for OneTimePreKey single-consumption (Property 5)
    - **Property 5: OneTimePreKey Single-Consumption**
    - Simulate N concurrent bundle requests against a seeded key pool using fast-check
    - Assert each returned OneTimePreKey ID is unique across all N concurrent responses
    - **Validates: Requirements 3.9, 3.10**
    - _Tag: Feature: whatsapp-style-chat-app, Property 5: OneTimePreKey Single-Consumption_

  - [ ]* 6.4 Write unit tests for KeyService
    - Test signature validation rejection, pool empty fallback, replenish threshold trigger
    - _Requirements: 40.1_

- [ ] 7. ConversationModule — 1:1 and Group Conversation Management
  - [~] 7.1 Implement ConversationService DIRECT de-duplication and GROUP creation
    - DIRECT: find-or-create using unordered user-pair lookup (prevent duplicate DIRECT conversations regardless of request order)
    - GROUP: create with title (1–50 chars), optional avatar, 2–256 member list; assign creator ADMIN, others MEMBER
    - Enforce 256-member group limit; return HTTP 400 `GROUP_MEMBER_LIMIT` on violation
    - Enforce block-pair check; return HTTP 403 `USER_BLOCKED` for blocked pairs
    - _Requirements: 4.1, 4.2, 4.3, 4.10, 4.11_

  - [~] 7.2 Implement member management: add, remove, leave, sole-admin guard
    - ADMIN add-member: create ConversationMember, fan-out `MEMBER_ADDED` SYSTEM message to existing + new member
    - ADMIN remove-member: delete record, fan-out `MEMBER_REMOVED` to remaining (not to removed user)
    - MEMBER leave: delete record, fan-out `MEMBER_LEFT` to remaining (not to leaver)
    - Sole-admin guard: return HTTP 400 `SOLE_ADMIN_LEAVE` if last admin tries to leave
    - Soft-delete Conversation (`deletedAt`) when last member leaves
    - _Requirements: 4.4, 4.5, 4.6, 4.7, 4.8_

  - [ ]* 7.3 Write property test for DIRECT conversation de-duplication (Property 10)
    - **Property 10: DIRECT Conversation De-duplication**
    - Generate (userA, userB) pairs in both request orders using fast-check
    - Assert the same Conversation ID is returned for both orderings
    - **Validates: Requirement 4.1**
    - _Tag: Feature: whatsapp-style-chat-app, Property 10: DIRECT Conversation De-duplication_

  - [ ]* 7.4 Write unit tests for ConversationService
    - Test group member limit, sole-admin leave rejection, soft-delete on empty group
    - _Requirements: 40.1_

- [ ] 8. MessageModule — Store-and-Forward, Receipt State Machine, Fan-Out
  - [~] 8.1 Implement MessageGateway `v1.message.send` handler with ciphertext store-and-forward
    - Persist Message with ciphertexts JSON (no plaintext) and initial status `SERVER_RECEIVED`
    - Fan-out `v1.message.receive` to each online recipient Device socket room
    - For offline recipients: queue ciphertext in DB; emit `v1.message.ack` to sender with `SERVER_RECEIVED`
    - Deliver all pending ciphertexts to a Device within 3 seconds of WebSocket handshake completion
    - Enqueue FCM BullMQ job for all offline Devices
    - _Requirements: 5.2, 5.3, 5.4, 6.3, 13.1_

  - [~] 8.2 Implement receipt state machine and fan-out (`v1.message.receipt`)
    - Handle `DELIVERED` and `READ` receipt events from recipient Devices
    - Update Receipt per device; advance Message.status only forward (QUEUED→SENDING→SERVER_RECEIVED→DELIVERED→READ)
    - Fan-out `v1.message.receipt.fan-out` to sender Device on each receipt update
    - On sender reconnect: reconcile and emit current receipt states for all unacknowledged messages
    - _Requirements: 6.4, 6.5, 6.6, 6.7, 6.12_

  - [~] 8.3 Implement message deletion (delete-for-everyone and delete-for-me)
    - Delete-for-everyone (within 30 min, sender or ADMIN only): mark Message deleted, fan-out `v1.message.deleted` to all Devices, enqueue MinIO attachment deletion job
    - Delete-for-me: no server action needed (handled client-side in Drift)
    - Enforce sender/ADMIN ownership guard; return HTTP 403 `FORBIDDEN` otherwise
    - _Requirements: 41.1, 41.2, 41.4, 41.5, 21.5_

  - [ ]* 8.4 Write property test for DeliveryStatus forward-only progression (Property 3)
    - **Property 3: DeliveryStatus Forward-Only Progression**
    - Generate arbitrary valid and invalid status transition sequences using fast-check `fc.constantFrom`
    - Assert state machine accepts only monotone forward paths; assert no backward transition is accepted
    - **Validates: Requirements 6.1–6.7, 6.11**
    - _Tag: Feature: whatsapp-style-chat-app, Property 3: DeliveryStatus Forward-Only Progression_

  - [ ]* 8.5 Write property test for receipt fan-out completeness (Property 9)
    - **Property 9: Delivery Receipt Fan-Out Completeness**
    - Generate N recipient devices using fast-check; simulate receipt submission from all N devices
    - Assert sender receives exactly N distinct receipt update events; no duplicates or drops
    - **Validates: Requirements 6.4, 6.6, 6.12**
    - _Tag: Feature: whatsapp-style-chat-app, Property 9: Delivery Receipt Fan-Out Completeness_

  - [ ]* 8.6 Write property test for offline queue ordering (Property 4)
    - **Property 4: Offline Queue Ordering Invariant**
    - Generate lists of messages with random content and creation timestamps using fast-check
    - Assert messages are dispatched to backend in the same creation-order as composed
    - **Validates: Requirements 7.1, 7.2**
    - _Tag: Feature: whatsapp-style-chat-app, Property 4: Offline Queue Ordering Invariant_

  - [ ]* 8.7 Write unit tests for MessageService
    - Test store-and-forward, offline queue, receipt state machine forward-only enforcement
    - _Requirements: 40.1_

- [~] 9. Checkpoint — Core Backend Messaging
  - Ensure all tests in tasks 6–8 pass, ask the user if questions arise.

- [ ] 10. MediaModule — Encrypted Attachment Upload/Download and Expiry
  - [~] 10.1 Implement MediaService upload with MIME validation, MinIO presigned PUT, and AES-256-GCM metadata storage
    - Validate MIME type against design allowlist; return HTTP 415 `UNSUPPORTED_MEDIA_TYPE` on rejection
    - Enforce 100 MB max file size; return HTTP 413 `PAYLOAD_TOO_LARGE`
    - PUT encrypted ciphertext bytes to MinIO; store `encryptionKey` and `iv` in Attachment record
    - Schedule BullMQ delayed job for 30-day expiry
    - _Requirements: 8.1, 8.10, 8.11, 8.12_

  - [~] 10.2 Implement MediaService presigned GET URL generation and attachment expiry worker
    - `GET /media/:attachmentId/url`: generate MinIO presigned GET URL (15-min TTL) and return to authenticated member
    - Expiry worker: delete MinIO object, mark Attachment `expired = true`, emit `v1.media.expired` to online Devices
    - _Requirements: 8.5, 31.5_

  - [ ]* 10.3 Write property test for AES-256-GCM media round-trip (Property 2)
    - **Property 2: AES-256-GCM Media Round-Trip**
    - Generate arbitrary `Buffer` payloads, random 32-byte keys and 12-byte IVs using fast-check
    - Assert encrypt→decrypt produces identical bytes; assert ciphertext byte modification causes auth-tag failure
    - **Validates: Requirements 8.1, 8.6**
    - _Tag: Feature: whatsapp-style-chat-app, Property 2: AES-256-GCM Media Round-Trip_

  - [ ]* 10.4 Write unit tests for MediaService
    - Test MIME rejection, size limit, presigned URL TTL
    - _Requirements: 40.1_

- [ ] 11. PresenceModule — Online Status, Typing Indicators, Privacy Filtering
  - [~] 11.1 Implement PresenceGateway and PresenceService with Redis presence store
    - On `v1.presence.online`: set Redis `user:{userId}:presence` hash `{ online: true, lastSeenAt: <utc> }` for the socket user
    - On `v1.presence.offline` / disconnect: set `online: false`, record `lastSeenAt`; fan-out `v1.presence.update` via Redis pub/sub to all instances
    - Typing start: set Redis key `user:{userId}:typing:{conversationId}` with 5-s TTL; broadcast to conversation members
    - Typing stop: delete key and broadcast stop event
    - Enforce 2-second debounce before emitting typing-start from client side (handled in Flutter, validated in gateway)
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - [~] 11.2 Implement presence visibility filtering in all API and socket responses
    - Apply `lastSeenVisibility` filter: EVERYONE → include fields; MY_CONTACTS → include only if requester is in contact list; NOBODY → exclude both fields
    - Apply same filter to `profilePhotoVis` for `avatarUrl`
    - Suppress read-receipt events when `readReceipts = false`
    - _Requirements: 12.7, 12.8, 12.9, 19.2, 19.3, 19.4_

  - [ ]* 11.3 Write property test for presence visibility filtering (Property 7)
    - **Property 7: Presence Visibility Filtering**
    - Generate random `(visibilitySetting, isContact)` pairs using fast-check
    - Assert `lastSeenAt` and `online` field presence matches the filtering rule for all combinations
    - **Validates: Requirements 12.7–12.9, 19.3**
    - _Tag: Feature: whatsapp-style-chat-app, Property 7: Presence Visibility Filtering_

  - [ ]* 11.4 Write unit tests for PresenceService
    - Test typing-stop auto-expire after 5 s, cross-instance Redis pub/sub fan-out, privacy filter application
    - _Requirements: 40.1_

- [ ] 12. CallModule — WebRTC Signaling and Call Lifecycle
  - [~] 12.1 Implement CallGateway and CallService call lifecycle management
    - `v1.call.initiate`: create Call record (INITIATED); fan-out `v1.call.incoming` to all online recipient Devices; enqueue FCM missed-call job for offline Devices
    - `v1.call.accept`: update status to ACCEPTED; relay SDP offer/answer exchange
    - `v1.call.decline`: update status to DECLINED; emit declined event to caller
    - `v1.call.end`: update status to ENDED, record `endedAt`
    - Unanswered ring timeout (30 s): set status to MISSED, emit `v1.call.missed` to caller
    - SDP exchange timeout (10 s post-accept): emit `v1.call.timeout`, set status to MISSED
    - BUSY detection: if callee already in active call, set status to BUSY and relay busy event
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.11, 14.12, 14.13_

  - [~] 12.2 Implement ICE candidate and SDP relay (unmodified pass-through)
    - Relay `v1.call.ice-candidate`, `v1.call.sdp-offer`, `v1.call.sdp-answer` between parties without modifying DTLS parameters
    - Handle WebSocket drop during active call: attempt 30-s reconnect window; update status to ENDED on failure
    - _Requirements: 14.3, 14.5, 14.14, 18.5_

  - [ ]* 12.3 Write unit tests for CallService
    - Test state transitions: INITIATED → ACCEPTED → ENDED, timeout paths, BUSY detection
    - _Requirements: 40.1_

- [ ] 13. NotificationModule — FCM Push Notifications
  - [~] 13.1 Implement NotificationService with firebase-admin FCM dispatch and batching
    - Send data-only FCM payloads (no plaintext) to Device FCM tokens
    - Batch up to 5 unread messages per conversation within a 3-second window before sending
    - Clean up invalid FCM tokens on firebase-admin error response
    - Enqueue missed-call notifications via BullMQ with 3-retry exponential backoff
    - _Requirements: 13.1, 13.2, 13.4, 13.5, 13.6_

  - [ ]* 13.2 Write unit tests for NotificationService
    - Test batching window, invalid-token cleanup, data-only payload assertion (no plaintext)
    - _Requirements: 40.1_

- [ ] 14. Rate Limiting, Health Checks, and Metrics Endpoints
  - [~] 14.1 Configure global and per-route rate limiting using @nestjs/throttler with Redis
    - Global REST: 60 req/min per IP
    - OTP send: 5 req / 10 min per phone number
    - WebSocket events: 10 events/sec per authenticated user; 5 simultaneous WS connections per user
    - JSON body limit 10 KB; multipart 100 MB
    - Return HTTP 429 with `Retry-After` header on REST limit; send `RATE_LIMIT_EXCEEDED` error event on WS limit
    - _Requirements: 22.1, 22.2, 22.3, 22.4, 22.5, 22.6, 22.7, 22.8_

  - [~] 14.2 Implement health check endpoints `/health` and `/health/ready`
    - `/health`: check PostgreSQL ping, Redis ping, MinIO bucket access; return `{ status: "ok" }` only if all healthy
    - `/health/ready`: return 200 only after startup completes
    - _Requirements: 23.1, 23.2_

  - [ ]* 14.3 Write integration tests for rate limiting and health endpoints
    - Test 429 response and `Retry-After` header on OTP rate limit
    - Test health endpoint returns 503 when a dependency is unavailable
    - _Requirements: 40.2_

- [~] 15. Checkpoint — Full Backend Feature Completeness
  - Ensure all backend unit and integration tests pass (≥80% line coverage per service). Ask the user if questions arise.

- [ ] 16. Flutter Core Layer — Drift/SQLCipher, Secure Storage, Network Client
  - [~] 16.1 Implement Drift database with SQLCipher encryption and seed key management
    - On first launch: generate 256-bit seed with `Random.secure()`, store in `flutter_secure_storage`, open Drift DB encrypted with derived key
    - On subsequent launches: retrieve seed; if missing, display "Local data unavailable" error and require re-login
    - Define Drift tables: `Conversations`, `Messages`, `Attachments`, `SignalSessions`, `LocalUsers`
    - Implement `stepByStep` Drift migrations; block launch and show error on migration failure
    - _Requirements: 30.1, 30.2, 30.3, 30.4, 30.7_

  - [~] 16.2 Implement Dio HTTP client and socket_io_client with TLS 1.3 enforcement and certificate pinning
    - Configure Dio to enforce TLS 1.3 minimum; abort connections negotiating lower versions
    - Bundle SPKI fingerprint; validate server certificate on every HTTPS and WebSocket connection; abort and show "Connection security error" on failure
    - Configure `socket_io_client` with same TLS constraints
    - _Requirements: 26.1, 26.10, 1.8_

  - [~] 16.3 Implement root/jailbreak detection and `blockOnRootedDevice` flag
    - Detect rooted (Android) / jailbroken (iOS) at launch
    - Show security warning modal; if `blockOnRootedDevice = true` block all usage until check passes
    - _Requirements: 26.2_

  - [ ]* 16.4 Write Drift database unit tests using in-memory NativeDatabase
    - Test DAO queries for Messages, Conversations, Attachments on in-memory database
    - Test SQLCipher key derivation and schema migration steps
    - _Requirements: 40.4_

- [ ] 17. Flutter Crypto Layer — Signal Protocol Session Manager and AES-256-GCM Helpers
  - [~] 17.1 Implement SignalSessionManager using libsignal_protocol_dart
    - X3DH session establishment from fetched key bundle
    - Double Ratchet encrypt/decrypt for established sessions
    - Persist serialised ratchet state in `SignalSessions` Drift table under SQLCipher encryption
    - Private keys stored exclusively in `flutter_secure_storage`; never transmitted
    - _Requirements: 5.1, 5.5, 3.8, 30.4_

  - [~] 17.2 Implement AES-256-GCM media encryption/decryption helpers
    - Encrypt file bytes with random key/IV generated by `Random.secure()`
    - Decrypt and verify auth tag before displaying; discard file and show error on tag failure
    - _Requirements: 8.1, 8.6, 26.9_

  - [ ]* 17.3 Write property test for Signal Protocol round-trip (Property 1) — Flutter
    - **Property 1: Signal Protocol Round-Trip Preservation**
    - Generate arbitrary `Uint8List` plaintexts with glados
    - Encrypt using mock Signal session → decrypt → assert byte-for-byte identity
    - **Validates: Requirements 5.1, 5.2, 5.5**
    - _Tag: Feature: whatsapp-style-chat-app, Property 1: Signal Protocol Round-Trip Preservation_

  - [ ]* 17.4 Write property test for AES-256-GCM round-trip (Property 2) — Flutter
    - **Property 2: AES-256-GCM Media Round-Trip**
    - Generate arbitrary byte arrays, 32-byte keys, 12-byte IVs with glados
    - Assert encrypt→decrypt identity; assert tampered ciphertext fails auth-tag verification
    - **Validates: Requirements 8.1, 8.6**
    - _Tag: Feature: whatsapp-style-chat-app, Property 2: AES-256-GCM Media Round-Trip_

- [ ] 18. Flutter Auth Feature — OTP Screens and Token Management
  - [~] 18.1 Implement auth Riverpod providers and repository
    - `AuthRepository`: call `POST /auth/otp/request`, `POST /auth/otp/verify`, `POST /auth/token/refresh`
    - `AuthNotifierProvider`: manage loading/data/error states for OTP request and verification
    - Store JWT and RefreshToken in `flutter_secure_storage`
    - Implement silent token refresh interceptor in Dio; on refresh failure clear tokens and redirect to phone entry screen
    - _Requirements: 1.5, 1.6, 26.6, 29.3_

  - [~] 18.2 Implement OTP screens (phone entry and OTP input)
    - Phone number entry screen with E.164 format validation
    - OTP input screen (6-digit) with countdown timer, remaining-attempts display, and lockout message
    - Navigate to home on successful auth
    - _Requirements: 1.1, 1.3, 1.4_

  - [ ]* 18.3 Write Riverpod provider unit tests for AuthNotifierProvider
    - Test loading → data → error state transitions using ProviderContainer with mocked repository
    - _Requirements: 40.4_

- [ ] 19. Flutter Conversations Feature — List and Chat Screen
  - [~] 19.1 Implement ConversationRepository, providers, and conversation list screen
    - Fetch and cache conversations in Drift; sort by most-recent-message `createdAt` descending
    - `ConversationsNotifierProvider` with `AsyncNotifierProvider` (loading/data/error states)
    - Conversation list UI with shimmer loading skeleton while fetching
    - _Requirements: 4.9, 7.8, 7.9, 29.3, 27.5_

  - [~] 19.2 Implement chat screen — message list, composition field, send action
    - Render message list from Drift streaming queries; update UI within 500 ms of DB write
    - Text composition field with 65,536-character limit and inline error
    - Send button triggers Signal encrypt → `v1.message.send` via socket; update local DeliveryStatus to QUEUED → SENDING
    - Display per-message DeliveryStatus icons: clock, single tick, double tick, filled double tick, "!"
    - Render reply-to preview; show "Original message was deleted" placeholder for deleted referenced messages
    - _Requirements: 5.7, 5.8, 5.9, 6.1, 6.2, 6.13, 6.14, 30.6_

  - [~] 19.3 Implement offline queue and reconnection flow in Flutter
    - Connectivity monitor via `connectivity_plus` (detects state changes within 2 s)
    - Queue up to 500 messages per conversation in Drift with status QUEUED while offline
    - On reconnect: refresh JWT if expired → re-authenticate WebSocket → dispatch QUEUED messages in creation-order within 3 s
    - Display offline banner; preserve queued messages on JWT refresh failure
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.9_

  - [ ]* 19.4 Write property test for offline queue ordering (Property 4) — Flutter
    - **Property 4: Offline Queue Ordering Invariant**
    - Generate lists of messages with random content using glados
    - Assert offline queue dispatches messages to backend in creation-order
    - **Validates: Requirements 7.1, 7.2**
    - _Tag: Feature: whatsapp-style-chat-app, Property 4: Offline Queue Ordering Invariant_

  - [ ]* 19.5 Write property test for DeliveryStatus forward-only (Property 3) — Flutter
    - **Property 3: DeliveryStatus Forward-Only Progression**
    - Generate arbitrary status transition sequences with glados
    - Assert only forward monotone transitions are accepted by the client-side state machine
    - **Validates: Requirements 6.1–6.7, 6.11**
    - _Tag: Feature: whatsapp-style-chat-app, Property 3: DeliveryStatus Forward-Only Progression_

  - [ ]* 19.6 Write Flutter widget tests for chat bubble and conversation list item
    - Test sent/received bubble rendering, DeliveryStatus icon rendering, shimmer skeleton
    - _Requirements: 40.3_

- [~] 20. Checkpoint — Flutter Core Messaging
  - Ensure all Flutter unit and widget tests pass for tasks 16–19. Ask the user if questions arise.

- [ ] 21. Flutter Media Feature — Upload, Download, Progress, and Expiry
  - [~] 21.1 Implement media upload with client-side AES-256-GCM encryption, compression, and resumable upload
    - Compress images (max 1920×1080, 500 KB) using `flutter_image_compress`
    - Compress videos (max 1280×720, 1500 kbps) using `video_compress`
    - Generate random AES-256-GCM key/IV with `Random.secure()`, encrypt file, upload ciphertext to backend
    - Track last confirmed uploaded byte; resume from that offset on retry using HTTP range requests
    - Display upload progress percentage in chat bubble (0–100%)
    - Mark message FAILED after 3 resume failures
    - _Requirements: 8.1, 8.2, 8.3, 8.7, 8.8, 8.9_

  - [~] 21.2 Implement media download with AES-256-GCM auth-tag verification
    - Call `GET /media/:attachmentId/url` to get presigned URL; download ciphertext from MinIO
    - Verify AES-256-GCM auth tag; on failure discard file and show "Attachment could not be verified" error in bubble
    - Display download progress percentage in chat bubble
    - Adapt quality on 2G/3G: reduce image thumbnails (max 200×200, 20 KB); skip video auto-download; show download button with file size
    - Handle `v1.media.expired` socket event: mark attachment expired in Drift
    - _Requirements: 8.5, 8.6, 8.7, 42.2, 42.3_

  - [ ]* 21.3 Write Flutter widget tests for media attachment bubble
    - Test upload progress display, download progress, expired attachment state, auth-tag failure error
    - _Requirements: 40.3_

- [ ] 22. Flutter Voice Notes Feature
  - [~] 22.1 Implement voice note recording, waveform computation, and send
    - Request microphone permission; show explanation screen on denial
    - Begin recording on hold (>200 ms) using opus codec at 48 kHz; stop on release or 5-min limit
    - Compute per-chunk amplitude data (60 samples/sec); store as waveform metadata in Message ciphertext
    - Encrypt voice note with AES-256-GCM and send as AUDIO MessageType
    - Display elapsed recording duration updated every 1 second
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.11_

  - [~] 22.2 Implement voice note playback widget with waveform, seek, and speed controls
    - Render animated bar-graph waveform using amplitude data
    - Play/pause, scrub on waveform, speed: 1×/1.5×/2×
    - Support background audio playback while navigating to other screens
    - Mark message READ when playback begins for first time (recipient)
    - _Requirements: 9.7, 9.8, 9.9, 9.10_

  - [ ]* 22.3 Write Flutter widget tests for voice note recording and playback widgets
    - Test recording timer, waveform render, playback controls, background playback continuation
    - _Requirements: 40.3_

- [ ] 23. Flutter Reactions Feature
  - [~] 23.1 Implement reaction-add/remove events, optimistic UI, and reaction bar widget
    - Long-press (≥300 ms) shows quick-reaction bar: last 6 used emoji (fallback: 👍 ❤️ 😂 😮 😢 🙏) + "other" picker button
    - Emit `v1.reaction.add` / `v1.reaction.remove` with messageId, emoji, requestId
    - Apply optimistic update to reaction counts; revert with error indicator if ack not received within 10 s
    - Display aggregated reaction counts beneath bubble (max 20 distinct emoji + "+N more")
    - Show reaction users in bottom sheet on tap
    - _Requirements: 11.3, 11.4, 11.6, 11.7, 11.8, 11.9_

  - [ ]* 23.2 Write property test for reaction upsert idempotence (Property 6) — backend
    - **Property 6: Reaction Upsert Idempotence**
    - Generate random `(messageId, userId, emoji)` triples and N add events using fast-check
    - Assert exactly one Reaction record exists after N adds; assert zero records after subsequent remove
    - **Validates: Requirements 11.5, 11.6**
    - _Tag: Feature: whatsapp-style-chat-app, Property 6: Reaction Upsert Idempotence_

  - [ ]* 23.3 Write Flutter widget tests for reaction bar and reaction count display
    - Test quick-reaction bar rendering, "+N more" overflow label, bottom sheet user list
    - _Requirements: 40.3_

- [ ] 24. Flutter Location Sharing Feature
  - [~] 24.1 Implement location sharing with permission handling, geocoding, and map display
    - Request location permission with `permission_handler`; show settings-link screen on denial
    - Retrieve GPS coordinates with `geolocator` (≤50 m accuracy) within 15 s timeout
    - Reverse-geocode within 10 s with `geocoding`; send coordinates only on geocoding failure
    - Send encrypted LOCATION Message via Signal Protocol channel
    - Render received LOCATION message as interactive `flutter_map` tile (OSM, zoom 15, pin marker)
    - Full-screen map on tap: pinch-zoom (zoom 1–18), pan
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8_

- [ ] 25. Flutter Calls Feature — WebRTC with DTLS-SRTP
  - [~] 25.1 Implement call initiation, incoming call handling, and call screen
    - Emit `v1.call.initiate` with conversationId, callType, ICE config
    - Display incoming call screen with accept/decline buttons
    - On accept: emit `v1.call.accept`; on decline: emit `v1.call.decline`
    - Display caller name, elapsed timer, mute/speaker/end-call controls
    - Video call: render local/remote feeds, camera toggle (front/rear), local video track toggle
    - Handle missed, busy, and timeout events; dismiss call UI accordingly
    - _Requirements: 14.1, 14.3, 14.4, 14.5, 14.9, 14.10, 14.11, 14.12, 14.13_

  - [~] 25.2 Implement DTLS-SRTP security enforcement and ICE candidate exchange
    - Configure all WebRTC peer connections with DTLS-SRTP mandatory profile via `flutter_webrtc`
    - Reject any SDP offer missing a valid DTLS fingerprint; emit `v1.call.end` with `SECURITY_FAILURE`
    - Verify received SDP DTLS fingerprint matches signaling message before allowing media flow
    - Include coturn STUN/TURN candidates; fall back to TURN relay if P2P fails
    - _Requirements: 14.6, 14.7, 14.8, 18.1, 18.2, 18.3, 18.4, 18.6, 18.7_

  - [ ]* 25.3 Write Flutter widget tests for call screen
    - Test call UI states: initiating, ringing, active (audio + video), ended
    - Test "Insecure call rejected" and "Call security verification failed" error displays
    - _Requirements: 40.3_

- [ ] 26. Flutter Presence, Typing Indicators, and Push Notifications
  - [~] 26.1 Implement presence providers and typing indicator UI
    - Emit `v1.presence.online` on foreground, `v1.presence.offline` on background/disconnect
    - Display "Online" or "last seen [relative time]" in conversation header (respecting visibility settings)
    - Emit typing-start after first keypress + 2-s debounce; emit typing-stop on send or field clear
    - Display animated typing indicator (three-dot) in conversation while remote user is typing
    - _Requirements: 12.1, 12.2, 12.5, 12.6, 12.10_

  - [~] 26.2 Implement FCM integration and local notifications
    - Register/update FCM token on launch; send updated token to backend device endpoint
    - Handle incoming data-only FCM payload; decrypt locally; display via `flutter_local_notifications`
    - Display "Missed Call" notification with caller name and callback action
    - Support notification grouping by Conversation on Android and iOS
    - Navigate to correct Conversation on notification tap using go_router deep link
    - _Requirements: 13.2, 13.3, 13.5, 13.7, 13.8, 28.2_

  - [ ]* 26.3 Write Riverpod provider unit tests for PresenceNotifierProvider and TypingNotifierProvider
    - Test online/offline state transitions, typing debounce logic, visibility filtering application
    - _Requirements: 40.4_

- [ ] 27. Flutter Search, Settings, and Contacts Sync Features
  - [~] 27.1 Implement local and global full-text search using Drift
    - Local search: Dart string matching over decrypted messages in a single conversation (≤100 ms for 10,000 messages)
    - Global search: across all Drift conversations (≤500 ms); results grouped by conversation
    - Media search: thumbnail grid of IMAGE/VIDEO attachments filterable by date range
    - Document search: DOCUMENT attachments listed with name, size, date
    - Highlight matching substrings; tap result navigates to message with matched text scrolled into view
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8_

  - [~] 27.2 Implement Privacy Settings screen and persistence
    - Controls for `lastSeenVisibility`, `profilePhotoVis`, and `readReceipts` (all with EVERYONE/MY_CONTACTS/NOBODY options)
    - Persist settings via `PATCH /settings` API; update Riverpod providers on change
    - _Requirements: 19.1, 19.5_

  - [~] 27.3 Implement Contacts sync and device management screens
    - Upload SHA-256 hashed phone numbers to contact discovery endpoint; display matched contacts as suggestions
    - Refresh at most once per 24 h or on explicit pull-to-refresh; manual phone-number search fallback on permission denial
    - Device Management screen listing devices with name, platform, lastActiveAt; remote logout action
    - Handle `v1.device.force-logout` event: clear Drift DB + secure storage, redirect to phone entry screen
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 15.5, 15.6, 15.7_

- [ ] 28. Flutter Design System and Navigation
  - [~] 28.1 Implement colour token system, typography, and ThemeData
    - Define semantic colour tokens (surfacePrimary, onSurface, accent, error) for light and dark themes
    - Configure Inter/Manrope via `google_fonts` for all body and heading text
    - Implement WCAG 2.1 AA contrast ratios for all text/background combinations
    - _Requirements: 27.1, 27.2, 27.10_

  - [~] 28.2 Implement custom widgets: chat bubble, reaction bar, waveform player, shimmer skeleton, animated bottom nav bar
    - Chat bubble: sent (right-aligned, accent) / received (left-aligned, surface) with sender name in groups
    - Send confirmation scale-in animation, reaction spring-scale pop, shared-element conversation transition via `flutter_animate`
    - Shimmer loading skeletons for conversation list and message list while loading
    - Custom animated bottom navigation bar with icon transition animations
    - _Requirements: 27.3, 27.4, 27.5, 27.6_

  - [~] 28.3 Configure go_router with typed routes, deep links, scroll preservation, and back gestures
    - Typed route definitions for all screens
    - Deep link handler for notification taps routing to correct Conversation with correct params
    - Preserve scroll position in message list on navigate-away and return
    - Support Android back button and iOS swipe-back throughout navigation stack
    - _Requirements: 28.1, 28.2, 28.3, 28.4, 28.5_

  - [~] 28.4 Implement network quality indicator and adaptive UI for low-bandwidth
    - Monitor network type with `connectivity_plus`; display banner when speed <500 kbps
    - Reduce image thumbnail quality on 2G/3G; increase request timeouts (30 s on 3G, 60 s on 2G)
    - _Requirements: 27.9, 42.1, 42.4, 42.5_

  - [ ]* 28.5 Write Flutter widget tests for design system components
    - Test chat bubble variants (sent/received, group name, deleted state), shimmer skeleton, bottom nav animation, reaction pop animation
    - _Requirements: 40.3_

- [~] 29. Checkpoint — Full Flutter Feature Completeness
  - Ensure all Flutter widget and provider tests pass. Ask the user if questions arise.

- [ ] 30. Message Deletion Scope Property and Property-Based Test
  - [~] 30.1 Write property test for message deletion scope invariant (Property 8) — backend
    - **Property 8: Message Deletion Scope Invariant**
    - Generate random `(deletionTimestamp, messageCreatedAt)` pairs using fast-check
    - When `deletionTime − messageCreatedAt ≤ 30 min`: assert delete-for-everyone path is taken
    - When `deletionTime − messageCreatedAt > 30 min`: assert only delete-for-me path is valid; assert server does not fan-out deleted event
    - **Validates: Requirements 41.1, 41.2, 41.3**
    - _Tag: Feature: whatsapp-style-chat-app, Property 8: Message Deletion Scope Invariant_

  - [ ]* 30.2 Write property test for message deletion scope (Property 8) — Flutter
    - **Property 8: Message Deletion Scope Invariant**
    - Generate random `(messageAge, deletionTime)` pairs with glados
    - Assert client dispatches delete-for-everyone only within 30-min window
    - **Validates: Requirements 41.1, 41.2, 41.3**
    - _Tag: Feature: whatsapp-style-chat-app, Property 8: Message Deletion Scope Invariant_

- [ ] 31. Infrastructure — Docker, coturn, CI/CD Pipeline, and Swagger
  - [~] 31.1 Create docker-compose.yml and infrastructure configuration
    - `infra/docker/docker-compose.yml` starting: NestJS backend, PostgreSQL 16, Redis 7, MinIO, coturn
    - Health checks for all services; dependent services wait for dependencies to be healthy
    - Named volumes for PostgreSQL and MinIO data persistence
    - MinIO init script creating attachments bucket on first startup
    - coturn config: enable DTLS, disable UDP relay without TLS credentials
    - `.env.example` at workspace root with all required variable names and placeholder values
    - _Requirements: 34.1, 34.2, 34.3, 34.4, 34.5, 34.6_

  - [~] 31.2 Create GitHub Actions CI/CD workflows
    - Pipeline stages in order: lint → test → build → Docker image build → deploy
    - PR: run lint + test, block merge on failure
    - Main branch push: build Docker image, tag with Git SHA (multi-stage Dockerfile, non-root user, no dev deps in final image)
    - Run `flutter analyze` + `flutter test` in test stage
    - Fail on TypeScript strict-mode errors; fail on ESLint errors
    - Migration governance check: verify every migration dir has `rollback.sql` + `migration-notes.md`
    - _Requirements: 33.1, 33.2, 33.3, 33.4, 33.5, 33.6, 25.6_

  - [~] 31.3 Implement Swagger documentation and ADR files
    - Configure `@nestjs/swagger` at `/api` with all endpoint request/response schemas documented
    - Create ADR files in `/docs/architecture` for each technology choice listed in Requirement 32
    - _Requirements: 36.2, 32.1, 32.2, 32.3_

  - [~] 31.4 Create documentation files (README, ER diagram, sequence diagrams, socket events guide, deployment guide)
    - `README.md` at workspace root with overview, prerequisites, setup instructions
    - ER diagram in `/docs/er-diagrams` as Mermaid covering all Prisma models
    - Sequence diagrams in `/docs/sequence-diagrams`: X3DH, message send/receive, WebRTC call, offline delivery, media upload/download
    - Socket Events Guide in `/docs/socket-events` with all versioned event names and payloads
    - Deployment guide in `/docs/deployment` covering Docker, env vars, migration, coturn
    - _Requirements: 36.1, 36.3, 36.4, 36.5, 36.6, 36.7_

- [ ] 32. Final Integration and Wiring
  - [~] 32.1 Wire all backend modules into AppModule with Redis Adapter, graceful shutdown, and global middleware
    - Import all feature modules into `AppModule`
    - Configure `@socket.io/redis-adapter` for cross-instance Socket.io fan-out
    - Configure Redis connection pool (min 5, max 50 connections)
    - Register `SecurityHeadersMiddleware` globally; register `NonceGuard` and `CsrfGuard` as global guards
    - Register `PrometheusInterceptor` and `TransformInterceptor` globally
    - Implement SIGTERM handler for graceful shutdown (drain BullMQ, complete in-flight requests within 30 s)
    - Ensure `prisma migrate deploy` runs in container entrypoint before HTTP server starts
    - _Requirements: 39.1, 39.2, 39.3, 39.4, 39.5, 38.5_

  - [~] 32.2 Wire Flutter app: Riverpod providers, socket event listeners, and go_router root
    - Initialize Riverpod `ProviderScope` at app root
    - Set up socket_io_client event listeners for all `SocketEvent` enum values; invalidate relevant providers on receipt
    - Configure go_router with all typed routes and root redirect guard (unauthenticated → phone entry)
    - _Requirements: 29.1, 29.2, 29.4, 29.6_

  - [ ]* 32.3 Write end-to-end backend integration tests for message send/receive, key exchange, and call flow
    - Test X3DH key bundle fetch → message send → receipt fan-out full flow against test database + test socket client
    - Test WebRTC call initiate → accept → end lifecycle
    - _Requirements: 40.2_

- [~] 33. Final Checkpoint — All Tests Pass
  - Ensure all backend and Flutter tests pass (backend ≥80% line coverage per service, Flutter analyze zero warnings). Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP, but property-based and unit tests are strongly recommended before shipping.
- Each task references specific requirements from `requirements.md` for full traceability.
- All 10 design correctness properties are covered by property-based tests: Properties 1–10 implemented with **fast-check** (backend, TypeScript) and **glados** (Flutter, Dart).
- Checkpoints ensure incremental validation and allow the user to review progress at reasonable milestones.
- The design uses TypeScript (NestJS) for the backend and Dart (Flutter) for the mobile client — no pseudocode; no language selection was needed.
- Backend tests target ≥80% line coverage per service file as required by Requirement 40.1.
- Flutter `flutter analyze` must produce zero warnings (Requirement 35.6).
- Every new Prisma migration must include `rollback.sql` and `migration-notes.md` (Requirements 25.2, 25.3).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["1.4", "2.1", "2.2"] },
    { "id": 2, "tasks": ["2.3", "3.1", "3.2", "3.3"] },
    { "id": 3, "tasks": ["3.4", "4.1", "4.2"] },
    { "id": 4, "tasks": ["4.3", "6.1"] },
    { "id": 5, "tasks": ["4.4", "4.5", "6.2", "7.1"] },
    { "id": 6, "tasks": ["6.3", "6.4", "7.2", "14.1", "14.2"] },
    { "id": 7, "tasks": ["7.3", "7.4", "8.1", "14.3"] },
    { "id": 8, "tasks": ["8.2", "8.3", "10.1"] },
    { "id": 9, "tasks": ["8.4", "8.5", "8.6", "8.7", "10.2", "11.1"] },
    { "id": 10, "tasks": ["10.3", "10.4", "11.2", "12.1", "13.1"] },
    { "id": 11, "tasks": ["11.3", "11.4", "12.2", "12.3", "13.2"] },
    { "id": 12, "tasks": ["16.1", "16.2"] },
    { "id": 13, "tasks": ["16.3", "16.4", "17.1"] },
    { "id": 14, "tasks": ["17.2", "18.1"] },
    { "id": 15, "tasks": ["17.3", "17.4", "18.2"] },
    { "id": 16, "tasks": ["18.3", "19.1"] },
    { "id": 17, "tasks": ["19.2", "19.3"] },
    { "id": 18, "tasks": ["19.4", "19.5", "19.6", "21.1"] },
    { "id": 19, "tasks": ["21.2", "22.1", "23.1"] },
    { "id": 20, "tasks": ["21.3", "22.2", "23.2"] },
    { "id": 21, "tasks": ["22.3", "23.3", "24.1", "25.1"] },
    { "id": 22, "tasks": ["25.2", "26.1"] },
    { "id": 23, "tasks": ["25.3", "26.2", "27.1"] },
    { "id": 24, "tasks": ["26.3", "27.2", "27.3"] },
    { "id": 25, "tasks": ["28.1", "28.2"] },
    { "id": 26, "tasks": ["28.3", "28.4"] },
    { "id": 27, "tasks": ["28.5", "30.1"] },
    { "id": 28, "tasks": ["30.2", "31.1"] },
    { "id": 29, "tasks": ["31.2", "31.3", "31.4"] },
    { "id": 30, "tasks": ["32.1", "32.2"] },
    { "id": 31, "tasks": ["32.3"] }
  ]
}
```
