# Migration 20260801000000_init: Initial Schema Baseline

## Overview
This initial migration creates all 16 relational database tables and 6 enum types powering the E2EE messaging and calling platform.

## Tables Created
1. `User`: Account identities.
2. `Device`: Multi-device registration per user.
3. `RefreshToken`: Hashed JWT refresh tokens bound to devices.
4. `IdentityKey`: Signal Protocol IK per device.
5. `SignedPreKey`: Signal Protocol SPK per device.
6. `OneTimePreKey`: Signal Protocol OPK pool per device.
7. `Conversation`: Direct 1:1 and Group chat sessions.
8. `ConversationMember`: Membership roles (ADMIN/MEMBER).
9. `Message`: Encrypted message envelopes holding device fan-out ciphertexts.
10. `Attachment`: AES-256-GCM client-encrypted media references stored in MinIO.
11. `Receipt`: Per-device delivery and read receipt tracking.
12. `Reaction`: Emoji reactions.
13. `Call`: WebRTC Audio/Video calling metadata.
14. `Participant`: Call participants state.
15. `BlockedUser`: User block list.
16. `Setting`: Account preferences and privacy visibility settings.

## Verification & Rollback
Rollback script is provided in `apps/backend/prisma/migrations/20260801000000_init/rollback.sql`.
