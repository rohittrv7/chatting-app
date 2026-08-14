# Data Compatibility Report: Migration 20260801000000_init

## Baseline Status
- **Type:** Fresh Database Baseline.
- **Affected Data:** None (initial database creation).

## Forward & Backward Compatibility
- **API Versions Supported:** `v1.*` REST endpoints & Socket events.
- **Multi-Device Compatibility:** All message fan-out ciphertexts are keyed by target device ID in JSON map structure, guaranteeing older/newer device clients receive targeted Signal envelopes without schema migration requirements.
- **Backfill Requirements:** None.
