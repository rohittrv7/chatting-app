# Production-Grade E2EE Messaging & Calling System

A mobile-first, end-to-end encrypted messaging and calling platform with multi-device support, offline-first sync, WebRTC audio/video calls, and WhatsApp-level UI polish.

## Project Structure

- `apps/mobile`: Flutter mobile client application (iOS/Android).
- `apps/backend`: NestJS TypeScript REST API and Socket.io gateway backend.
- `packages/shared-contracts`: Shared DTOs, socket event names, domain enums, and response envelopes.
- `packages/shared-config`: Environment validation schema and application constants.
- `infra/docker`: Containerization setup (PostgreSQL, Redis, Coturn, Backend).
- `infra/coturn`: Coturn STUN/TURN server setup.
- `infra/ci`: GitHub Actions pipeline.
- `docs`: ADRs, architecture diagrams, sequence flows, ER diagrams, and API guides.

## Environment Variables (.env)

```env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://chat_user:chat_password@localhost:5432/chatting_system_db?schema=public
REDIS_HOST=localhost
REDIS_PORT=6379
B2_BUCKET_NAME=chatting-media
B2_REGION=us-east-005
B2_ENDPOINT=s3.us-east-005.backblazeb2.com
B2_KEY_ID=your_backblaze_key_id
B2_APPLICATION_KEY=your_backblaze_application_key
COTURN_SECRET=coturn_super_secret_auth_key
JWT_SECRET=super_secret_jwt_access_key_12345
JWT_REFRESH_SECRET=super_secret_jwt_refresh_key_12345
```

## Quick Start

### 1. Boot Infrastructure (Postgres, Redis, Coturn)

```bash
docker-compose -f infra/docker/docker-compose.yml up -d
```

### 2. Install Dependencies & Build Packages

```bash
pnpm install
pnpm build
```

### 3. Database Migration

```bash
cd apps/backend
npx prisma migrate dev
```

### 4. Run Backend

```bash
cd apps/backend
npm run start:dev
```

API Documentation available at: `http://localhost:3000/docs/api`

### 5. Run Flutter Mobile App

```bash
cd apps/mobile
flutter run
```
