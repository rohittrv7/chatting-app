# ADR 0005: Choice of MinIO for S3-Compatible Object Storage

## Context
Client-encrypted media attachments (images, audio voice notes, video clips, documents) must be uploaded, stored, and retrieved securely.

## Decision
We choose **MinIO** as the self-hosted S3-compatible object storage server.

## Consequences
- **S3 API Compatibility:** Standard S3 API contracts allow seamless local development and drop-in production migration to AWS S3 or GCP Cloud Storage if needed.
- **Presigned URLs:** Enables secure direct client-to-MinIO uploads via presigned URLs without piping heavy encrypted binary media payloads through backend NestJS application servers.
- **Zero Plaintext Leak:** MinIO only receives AES-256-GCM encrypted binary blobs. The backend never has the AES media keys.

## Alternatives Considered
- **Direct Database Byte Storage (BLOBs):** Bloats PostgreSQL database size, degrades backup times, and severely penalizes database performance.
- **Local Filesystem Directories:** Incompatible with stateless horizontal backend scaling across containerized deployments.
