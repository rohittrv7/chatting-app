# 💬 WhatsApp Connect - Real-Time Chat & VoIP Monorepo

> **Production-grade, End-to-End Encrypted Real-Time Chatting & Calling Application** built with **NestJS**, **Redis**, **PostgreSQL (Prisma)**, and **React Native (Expo)**.

---

## 🚀 Live Repository
- **GitHub Repository**: [https://github.com/rohittrv7/chatting-app](https://github.com/rohittrv7/chatting-app)
- **Active Branch**: `develop` / `main`

---

## 🌟 Key Architecture & Features

### 1. ⚡ Real-Time Socket Gateway & Messaging
- **Real-Time WebSockets (`Socket.IO`)**: Instant message delivery with Single Tick (`✓` Server Received), Double Tick (`✓✓` Delivered), and Violet Double Tick (`✓✓` Read Receipts).
- **Persistent Connection**: Continuous background socket lifecycle that stays connected throughout app navigation.
- **Typing Indicators & Online Status**: Real-time presence detection across all active devices.

### 2. 🛡️ Advanced Authentication & Security
- **JWT + Refresh Token Rotation**: Automatic, silent background token refresh (`/auth/token/refresh`) with argon2id hashed tokens stored in PostgreSQL. Users stay permanently logged in without interruption.
- **Instant 401 Session Handling**: Unrecoverable session revocation automatically cleans client state and safely resets navigation to the Phone Login screen.
- **Privacy First (No Phone Numbers Exposed)**: Only User Display Names and Handles (`@username`) are shown across conversation lists, headers, and contact cards.
- **End-to-End Encryption**: Signal protocol key bundle exchange support for verified private messaging.

### 3. 🔍 High-Performance Contact Discovery & Global Search
- **Sub-2ms Redis Caching**: Contact synchronization results are cached in Redis (`cache:sync_contacts`) to eliminate unnecessary DB queries.
- **Zero-Latency In-Memory Device Contact Cache**: Instantaneous tab switching between Chats, Calls, People, and Settings without re-fetching or flickering.
- **Global Username Search**: Platform-wide user lookup allowing users to discover and chat with any registered account by `@username`.

### 4. 🎨 Modern Mobile UI & Aesthetics
- **Instagram-Style Slide-Down Progress Bar**: Dynamic animated pull-to-refresh loader on the Chats list with smooth shimmer progress animations.
- **Custom Glassmorphic Logout Dialog**: Sleek in-app danger modal replacing native alerts.
- **Full Screen Contact Info Modal**: Responsive profile overview with quick VoIP calling actions and encryption security status.
- **Developer Live Inspector**: In-app real-time telemetry modal showing live API latency (ms), Redis cache hits (`⚡ REDIS CACHE HIT`), UI mount lifecycles, and WebSocket packet traffic.

---

## 🏗️ Monorepo Architecture

```
chatting-system/
├── apps/
│   ├── backend/             # NestJS API, WebSocket Gateway, Prisma ORM, Redis OTP & Cache
│   │   ├── src/
│   │   │   ├── modules/auth/           # Phone OTP, JWT Rotation, Device Management, Contact Sync & Global Search
│   │   │   ├── modules/messages/       # Real-time WebSocket Gateway & Message Persistence
│   │   │   ├── modules/conversations/  # Room & Chat Management
│   │   │   └── database/               # Prisma PostgreSQL Service
│   └── mobile/              # React Native (Expo) Universal Mobile App
│       ├── src/
│       │   ├── components/  # DevInspectorModal, LogoutConfirmModal, AppLogo
│       │   ├── context/     # ChatContext, ThemeContext, ToastContext
│       │   ├── screens/     # ConversationListScreen, ChatScreen, ContactsScreen, Auth Screens
│       │   ├── services/    # apiService, socketService, contactsService, devInspectorService
│       │   └── store/       # Redux Toolkit (authSlice, chatSlice)
└── packages/
    └── shared-contracts/    # Shared TypeScript DTOs & Validation Schemas
```

---

## 🛠️ Quick Start & Local Development

### 1. Prerequisites
- **Node.js**: `v18+`
- **pnpm**: `v8+`
- **PostgreSQL** & **Redis**

### 2. Installation
```bash
# Clone the repository
git clone https://github.com/rohittrv7/chatting-app.git
cd chatting-app

# Install all workspace dependencies
pnpm install
```

### 3. Run Backend Development Server
```bash
pnpm --filter @chat/backend start:dev
# Backend runs at http://localhost:3000/api/v1
# Swagger docs at http://localhost:3000/docs
```

### 4. Run Mobile App (Expo Metro Bundler)
```bash
pnpm --filter ./apps/mobile start
# Scan QR code with Expo Go on Android / iOS
```

---

## 🧪 Quality & Type Safety
```bash
# Run full workspace TypeScript verification
pnpm -r run typecheck
```

---

## 📄 License
MIT License © 2026 Rohit & WhatsApp Connect Team.
