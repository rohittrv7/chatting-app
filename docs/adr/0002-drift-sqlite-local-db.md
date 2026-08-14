# ADR 0002: Choice of Drift (SQLite + SQLCipher) for Mobile Local Persistence

## Context
The Flutter mobile client operates offline-first. It needs to store conversation history, encrypted media references, contact mappings, and message state machine statuses locally. Local data MUST be encrypted at rest.

## Decision
We choose **Drift** (reactive persistence library for Flutter/Dart) backed by **SQLite encrypted via SQLCipher**.

## Consequences
- **E2EE at Rest:** SQLCipher transparently encrypts database files using AES-256 with keys securely derived and stored in `flutter_secure_storage`.
- **Reactive Streams:** Drift provides native Dart Stream subscriptions for database queries, seamlessly powering Riverpod UI updates when local sync changes occur.
- **Strict Typing:** Drift generates Dart classes from schema files, guaranteeing compile-time type safety across offline tables.

## Alternatives Considered
- **Hive / Isar:** Fast Key-Value / NoSQL document databases, but lack ACID multi-table join capabilities required for complex message-attachment-receipt relationships and SQLCipher integration.
- **sqflite directly:** Low-level SQLite binding requiring manual raw SQL string queries and manual object mapping.
