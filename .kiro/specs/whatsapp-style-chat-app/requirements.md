# Requirements Document

## Introduction

This document specifies the complete functional and non-functional requirements for a production-grade, WhatsApp-style end-to-end encrypted (E2EE) messaging and calling application. The system comprises a Flutter mobile client, a NestJS backend, a PostgreSQL database, Redis, MinIO object storage, a coturn TURN/STUN server, and a shared contracts package. All requirements are expressed using EARS patterns and comply with INCOSE quality rules.

The application supports 1:1 and group text chat, audio/video calling over WebRTC, file/photo/video/audio/location sharing, voice notes, end-to-end encryption (Signal Protocol), push notifications, offline-first operation, multi-device support, and full-text search — all delivered at Telegram/Signal-level polish on mobile.

## Glossary

- **App**: The Flutter mobile application running on the user's device.
- **Backend**: The NestJS server application.
- **User**: A registered account identified by a phone number.
- **Device**: A physical mobile device registered to a User, identified by a Device ID.
- **Conversation**: A thread of Messages shared between two or more Users (DIRECT or GROUP).
- **ConversationMember**: A User's membership record in a Conversation, with a role (MEMBER or ADMIN).
- **Message**: A unit of communication within a Conversation, stored as ciphertext on the Backend.
- **Attachment**: A file (image, video, audio, document) associated with a Message, encrypted client-side.
- **Call**: A WebRTC audio or video session between Users.
- **Participant**: A User's participation record in a Call.
- **IdentityKey**: A long-term Signal Protocol public key bound to a Device.
- **SignedPreKey**: A medium-term Signal Protocol key signed by the IdentityKey.
- **OneTimePreKey**: A single-use Signal Protocol key for X3DH key agreement.
- **RefreshToken**: A hashed, rotated token used to obtain new JWT access tokens.
- **Receipt**: A per-device delivery/read acknowledgement for a Message.
- **Reaction**: An emoji response attached to a Message by a User.
- **BlockedUser**: A record indicating one User has blocked another.
- **Setting**: Per-User configuration for privacy, theme, and notification preferences.
- **Signal_Protocol**: The libsignal_protocol_dart (Flutter) / @signalapp/libsignal-client (Node.js) E2EE library.
- **Double_Ratchet**: The Signal Protocol double ratchet algorithm for forward secrecy per session.
- **X3DH**: Extended Triple Diffie-Hellman key agreement algorithm for session establishment.
- **STUN_TURN**: Session Traversal Utilities for NAT and Traversal Using Relays around NAT — provided by coturn.
- **BullMQ**: Redis-backed job queue used for async processing (notifications, key replenishment, etc.).
- **MinIO**: S3-compatible object storage for Attachments.
- **Drift**: Flutter SQLite ORM with SQLCipher encryption for local data persistence.
- **Riverpod**: Flutter state management and dependency injection framework.
- **PrismaService**: The NestJS service wrapping the Prisma ORM client.
- **SocketGateway**: The NestJS WebSocket gateway built on Socket.io.
- **DeliveryStatus**: The state machine enum — QUEUED → SENDING → SERVER_RECEIVED → DELIVERED → READ / FAILED → RETRYING → SENDING.
- **FCM**: Firebase Cloud Messaging push notification service.
- **OTP**: One-time password delivered via SMS for phone number verification.
- **JWT**: JSON Web Token — short-lived (15 min) access token.
- **TLS**: Transport Layer Security version 1.3, required for all network connections.
- **SRTP**: Secure Real-time Transport Protocol for WebRTC media encryption.
- **AES-256-GCM**: Symmetric authenticated encryption algorithm used for media files.
- **OpenTelemetry**: Distributed tracing and observability framework.
- **Prometheus**: Metrics exposition format used at the /metrics endpoint.
- **ADR**: Architecture Decision Record.
- **CQRS**: Command Query Responsibility Segregation pattern.
- **SOLID**: Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, Dependency Inversion principles.

## Requirements

---

### Requirement 1: Phone Number Registration and OTP Authentication

**User Story:** As a new user, I want to register with my phone number and verify it via OTP, so that I can create an account and access the application securely.

#### Acceptance Criteria

1. WHEN a User submits a valid E.164-format phone number, THE Backend SHALL send a 6-digit OTP to that number via SMS and return a session token valid for 10 minutes.
2. WHEN a User submits the correct OTP within the 10-minute window, THE Backend SHALL create the User account (if not existing), issue a JWT access token (15-minute expiry), invalidate any existing RefreshTokens for that Device, reset the failure counter for that phone number, and issue a new rotated RefreshToken stored as an argon2id hash in the database.
3. IF a User submits an incorrect OTP, THEN THE Backend SHALL increment a per-phone-number failure counter and return an HTTP 400 error with the remaining attempt count.
4. IF a User exceeds 5 consecutive incorrect OTP attempts, THEN THE Backend SHALL lock the phone number for 30 minutes and return an HTTP 429 response.
5. WHEN a User's JWT expires, THE App SHALL use the stored RefreshToken to request a new JWT and RefreshToken pair; IF the refresh request succeeds, THE App SHALL store the new tokens and retry the original request without user interaction.
6. IF the RefreshToken is expired or invalid during a silent refresh, THEN THE App SHALL clear all stored tokens and redirect the User to the phone number entry screen.
7. IF a RefreshToken is used more than once (replay detected), THEN THE Backend SHALL invalidate all RefreshTokens for that Device and return an HTTP 401 response.
8. THE Backend SHALL enforce TLS 1.3 on all authentication endpoints.
9. WHEN a User registers a Device, THE Backend SHALL store the Device record with platform (enumerated: ANDROID, IOS), device name (1–50 characters), and FCM token (optional at registration time).

---

### Requirement 2: User Profile Management

**User Story:** As a registered user, I want to manage my display name, avatar, and about text, so that other users can identify me and I can express my identity.

#### Acceptance Criteria

1. THE App SHALL allow a User to set a display name of 1–25 characters.
2. THE App SHALL allow a User to set an about text of 0–139 characters.
3. WHEN a User uploads a profile photo, THE App SHALL compress the image to a maximum of 500×500 pixels and 100 KB before uploading to MinIO.
4. WHEN a profile photo upload completes, THE Backend SHALL update the User's avatarUrl field and broadcast a presence update to all Conversations the User is a member of.
5. THE Backend SHALL validate all profile update inputs using class-validator on the DTO, rejecting requests with invalid field lengths.
6. IF a User's display name is unset, THEN THE App SHALL display the User's phone number as a fallback identifier.

---

### Requirement 3: Signal Protocol Key Registration and Management

**User Story:** As a user, I want my devices to register cryptographic keys with the server, so that other users can establish end-to-end encrypted sessions with me.

#### Acceptance Criteria

1. WHEN a Device completes registration, THE App SHALL generate an IdentityKey pair, a SignedPreKey (including its signature over the public key), and a batch of 100 OneTimePreKeys using Signal_Protocol.
2. WHEN keys are generated, THE App SHALL upload the IdentityKey public key, SignedPreKey public key + signature, and all 100 OneTimePreKey public keys to the Backend's key distribution endpoint in a single atomic request.
3. WHEN the Backend receives a key upload, THE Backend SHALL validate the SignedPreKey signature against the IdentityKey public key; IF validation fails, THE Backend SHALL reject the entire upload with HTTP 422 and store no keys.
4. THE Backend SHALL store the uploaded public keys in the IdentityKey, SignedPreKey, and OneTimePreKey tables without accessing or storing private keys.
5. WHEN the Backend's count of unused OneTimePreKeys for a Device drops below 10, THE Backend SHALL publish a BullMQ job that, upon processing, emits a `replenish-one-time-pre-keys` socket event to all active SocketGateway connections for that Device.
6. WHEN the App receives a `replenish-one-time-pre-keys` socket event, THE App SHALL generate and upload a new batch of 100 OneTimePreKeys.
7. WHEN 30 days elapse since the last SignedPreKey rotation for a Device (checked via a scheduled BullMQ job), THE Backend SHALL emit a `rotate-signed-pre-key` socket event to all active SocketGateway connections for that Device.
8. THE App SHALL store all private keys exclusively in flutter_secure_storage and never transmit them.
9. WHEN an authenticated request is received for a key bundle for a target User/Device, THE Backend SHALL atomically mark one unused OneTimePreKey as used and return the bundle (IdentityKey + SignedPreKey + that OneTimePreKey) in a single transaction; concurrent requests SHALL NOT retrieve the same OneTimePreKey.
10. IF the OneTimePreKey pool for a Device is empty when a key bundle is requested, THE Backend SHALL return a bundle without a OneTimePreKey (SignedPreKey-only fallback per X3DH spec) and immediately emit a `replenish-one-time-pre-keys` event to the target Device.

---

### Requirement 4: 1:1 and Group Conversation Management

**User Story:** As a user, I want to create direct and group conversations with my contacts, so that I can communicate with individuals and groups.

#### Acceptance Criteria

1. WHEN a User initiates a direct message to a contact, THE Backend SHALL find or create a DIRECT Conversation identified by the unordered pair of the two User IDs (preventing duplicate DIRECT conversations regardless of request order) and return the Conversation record.
2. WHEN a User creates a group Conversation, THE Backend SHALL create a GROUP Conversation with a title (1–50 characters), optional avatar, and a list of 2–256 member User IDs.
3. WHEN a group Conversation is created, THE Backend SHALL assign the group creator the ADMIN role in ConversationMember and assign all other initial members the MEMBER role.
4. WHEN an ADMIN adds a member to a group, THE Backend SHALL create a ConversationMember record and fan-out a SYSTEM Message of type MEMBER_ADDED to all existing members; the newly added member SHALL also receive this SYSTEM Message.
5. WHEN an ADMIN removes a member from a group, THE Backend SHALL delete the ConversationMember record and fan-out a SYSTEM Message of type MEMBER_REMOVED to all remaining members; the removed member SHALL NOT receive the MEMBER_REMOVED system Message.
6. WHEN a MEMBER leaves a group, THE Backend SHALL delete that member's ConversationMember record and fan-out a SYSTEM Message of type MEMBER_LEFT to all remaining members; the leaving member SHALL NOT receive the MEMBER_LEFT system Message.
7. IF the sole ADMIN of a group attempts to leave, THEN THE Backend SHALL return HTTP 400 and require the ADMIN to either assign another member as ADMIN or delete the group first.
8. IF a group has no remaining members after a leave or removal, THEN THE Backend SHALL soft-delete the Conversation by setting a `deletedAt` timestamp.
9. WHILE the Conversation list is visible, THE App SHALL display conversations sorted by the `createdAt` timestamp of the most recent Message in descending order; conversations with no Messages SHALL be sorted by the Conversation `createdAt` timestamp.
10. THE Backend SHALL enforce a maximum of 256 members per GROUP Conversation, returning HTTP 400 for add-member requests that would exceed this limit.
11. WHEN a User blocks another User, THE Backend SHALL prevent message delivery between the two Users and return HTTP 403 for message send and DIRECT conversation initiation API calls between the blocked pair.

---

### Requirement 5: End-to-End Encrypted Message Sending

**User Story:** As a user, I want every message I send to be end-to-end encrypted, so that only the intended recipients can read message content.

#### Acceptance Criteria

1. WHEN the App sends a Message, THE App SHALL encrypt the plaintext payload individually for each recipient Device using Signal_Protocol (X3DH for new sessions, Double_Ratchet for established sessions).
2. THE App SHALL store the ciphertext for each recipient Device as an entry in the Message's ciphertexts JSON field; the Backend SHALL store and forward this ciphertext without decryption.
3. WHEN a recipient Device comes online, THE Backend SHALL deliver all pending ciphertexts addressed to that Device within 3 seconds of the Device establishing a SocketGateway connection.
4. THE Backend SHALL never store, log, or transmit plaintext message content or encryption keys.
5. WHEN the App receives a ciphertext, THE App SHALL decrypt it using the active Double_Ratchet session for the sender Device and store the plaintext in the Drift encrypted local database.
6. IF decryption of a received Message fails, THEN THE App SHALL discard the ciphertext, store no partial plaintext, display a "Message could not be decrypted" indicator in the conversation, and log the failure at ERROR level without including any key material or ciphertext bytes in the log entry.
7. THE App SHALL support message types: TEXT, IMAGE, VIDEO, AUDIO, DOCUMENT, LOCATION, and SYSTEM.
8. WHEN a TEXT Message plaintext exceeds 65,536 characters, THE App SHALL block the send action and display an inline error in the composition field indicating the character limit.
9. THE App SHALL support quoting (replying to) any existing Message in a Conversation by setting replyToId; IF the referenced Message has been deleted, THE App SHALL render a "Original message was deleted" placeholder in the reply preview.
10. IF the OneTimePreKey pool for a recipient Device is empty when initiating a new session, THE App SHALL fall back to a SignedPreKey-only X3DH session establishment.

---

### Requirement 6: Message Delivery State Machine

**User Story:** As a user, I want to see accurate delivery and read status for every message I send, so that I know whether my messages have been received and read.

#### Acceptance Criteria

1. THE App SHALL assign every outgoing Message the initial DeliveryStatus of QUEUED before the network send is attempted.
2. WHEN the App begins the network send of a Message, THE App SHALL update the DeliveryStatus to SENDING.
3. WHEN the Backend receives and persists a Message, THE Backend SHALL set the Message status to SERVER_RECEIVED and emit a receipt acknowledgement to the sender Device.
4. WHEN a recipient Device acknowledges delivery (app in background or foreground), THE Backend SHALL update the Receipt for that Device to DELIVERED and fan-out the receipt to the sender Device.
5. WHEN a recipient User's active Conversation screen scrolls a Message into the visible viewport, THE App SHALL emit a read receipt for that Message.
6. WHEN the Backend receives a read receipt, THE Backend SHALL update the Receipt for that Device to READ and fan-out the receipt to the sender Device.
7. WHEN all Devices of all recipient Users for a Message have a Receipt status of READ, THE Backend SHALL set Message.status to READ; Message.status SHALL only advance forward and SHALL NOT regress to a prior state.
8. IF the network send does not receive a SERVER_RECEIVED acknowledgement within 30 seconds, THEN THE App SHALL treat the send as failed and set the DeliveryStatus to FAILED.
9. WHEN a DeliveryStatus is set to FAILED, THE App SHALL schedule a retry with exponential backoff (initial delay 2s, doubled per retry, maximum delay 60s, maximum 5 retries).
10. WHEN a retry is scheduled, THE App SHALL set the DeliveryStatus to RETRYING.
11. IF all retries are exhausted, THEN THE App SHALL set the DeliveryStatus to FAILED with no further automatic retries and display a "!" error indicator on the message bubble.
12. WHEN the sender Device reconnects after being offline, THE Backend SHALL reconcile any unacknowledged receipts and emit their current status to the sender Device.
13. THE App SHALL display a distinct UI icon for each DeliveryStatus: clock (QUEUED/SENDING), single tick (SERVER_RECEIVED), double tick (DELIVERED), filled double tick (READ), and "!" (FAILED).
14. THE App SHALL persist the DeliveryStatus in the Drift local database so status is preserved across app restarts.

---

### Requirement 7: Offline-First Operation and Message Queue

**User Story:** As a user on an unreliable network, I want to compose and queue messages while offline, so that they are automatically sent when connectivity is restored.

#### Acceptance Criteria

1. WHILE the App has no network connectivity, THE App SHALL accept new Message composition (up to 500 queued Messages per Conversation) and store outgoing Messages with DeliveryStatus QUEUED in the Drift local database.
2. WHEN network connectivity is restored, THE App SHALL begin dispatching all QUEUED Messages in creation-order within 3 seconds of reconnection, processing one Message at a time per Conversation.
3. THE App SHALL implement a connectivity monitor using the connectivity_plus package that detects transitions between offline and online states within 2 seconds.
4. WHEN network connectivity is restored, THE App SHALL refresh the JWT if it has expired before attempting SocketGateway re-authentication.
5. WHEN the refreshed JWT is valid, THE App SHALL re-authenticate the WebSocket connection using the valid JWT within 5 seconds of reconnection.
6. IF the JWT refresh fails during reconnection, THEN THE App SHALL retain all QUEUED Messages in the Drift database and redirect the User to the phone number entry screen.
7. IF a queued Message fails to send after all retries, THEN THE App SHALL mark the Message as FAILED and display an in-conversation error indicator.
8. THE App SHALL cache all received Messages, Conversations, and User profiles in the Drift local database.
9. WHILE the App is offline, THE App SHALL display all cached Conversations and Messages from the Drift local database with an offline status banner and without network error dialogs.

---

### Requirement 8: Encrypted Media Attachment Sharing

**User Story:** As a user, I want to share photos, videos, documents, and audio files securely, so that only conversation participants can access my shared files.

#### Acceptance Criteria

1. WHEN a User selects a media file to send, THE App SHALL generate a cryptographically random AES-256-GCM key and IV, encrypt the file client-side, and upload the ciphertext to MinIO via the Backend's upload endpoint.
2. THE App SHALL compress images using flutter_image_compress to a maximum of 1920×1080 pixels (preserving aspect ratio) and 500 KB before encryption.
3. THE App SHALL compress videos using video_compress to a maximum bitrate of 1500 kbps and resolution of 1280×720 (preserving aspect ratio) before encryption.
4. WHEN the upload completes, THE App SHALL share the AES-256-GCM key and IV to recipient Devices via the Signal_Protocol session (encrypted within the Message ciphertext).
5. WHEN a recipient Device requests media download, THE Backend SHALL generate a presigned MinIO URL valid for 15 minutes and return it in the API response.
6. WHEN a recipient downloads media, THE App SHALL verify the AES-256-GCM authentication tag before displaying the file; IF the tag fails verification, THE App SHALL discard the file and display an "Attachment could not be verified" error within the chat bubble.
7. THE App SHALL display upload and download progress as a percentage indicator (0–100%) within the chat bubble.
8. THE App SHALL track the last confirmed uploaded byte for each upload; WHEN an upload is interrupted, THE App SHALL resume from that byte on retry using HTTP range requests.
9. IF an upload fails to resume after 3 attempts, THE App SHALL set the Message to FAILED and display an error indicator.
10. THE Backend SHALL enforce a maximum attachment file size of 100 MB per file, returning HTTP 413 for oversized uploads.
11. THE Backend SHALL validate the MIME type of uploaded files against this allowlist: image/jpeg, image/png, image/gif, image/webp, video/mp4, audio/mpeg, audio/ogg, audio/aac, audio/opus, application/pdf, application/zip, application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document, application/vnd.ms-excel, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, text/plain.
12. WHEN media has not been downloaded within 30 days, THE Backend SHALL schedule a BullMQ job to delete the MinIO object and mark the Attachment with an expired flag in the database.

---

### Requirement 9: Voice Notes

**User Story:** As a user, I want to record and send voice notes, so that I can communicate quickly without typing.

#### Acceptance Criteria

1. WHEN the App needs to record audio and microphone permission has not been granted, THE App SHALL request microphone permission; IF permission is denied, THE App SHALL display an in-app explanation screen and not start recording.
2. WHEN a User holds the microphone button for more than 200 ms and microphone permission is granted, THE App SHALL begin recording audio using the device microphone in the opus codec at 48 kHz.
3. WHEN the User releases the microphone button, THE App SHALL stop recording and prepare the audio file for sending as an AUDIO Message type.
4. THE App SHALL enforce a maximum voice note duration of 5 minutes; WHEN 5 minutes of recording elapses, THE App SHALL automatically stop recording and initiate sending without waiting for the User to release the button.
5. THE App SHALL display the elapsed recording duration updated at most every 1 second in real time.
6. WHEN a voice note is recorded, THE App SHALL compute per-chunk amplitude data (60 samples per second) and store it as waveform metadata within the Message ciphertext.
7. THE App SHALL render the waveform as an animated bar graph within the audio chat bubble using the amplitude data.
8. THE App SHALL provide playback controls: play/pause, seek/scrub on the waveform, and speed selection of 1×, 1.5×, and 2×.
9. THE App SHALL support background audio playback of voice notes while the User navigates to other screens.
10. WHEN a voice note playback begins for the first time by the recipient (playback starts from the beginning), THE App SHALL mark the Message status as READ.
11. THE App SHALL encrypt voice notes using AES-256-GCM before upload, following Requirement 8.

---

### Requirement 10: Location Sharing

**User Story:** As a user, I want to share my current location with a conversation, so that contacts know where I am.

#### Acceptance Criteria

1. WHEN a User taps the location share button, THE App SHALL request location permission using permission_handler; IF permission is granted, THE App SHALL retrieve the current GPS coordinates using geolocator with an accuracy of at least 50 metres.
2. WHEN GPS coordinates are obtained, THE App SHALL reverse-geocode the coordinates using geocoding within 10 seconds; the resolved address SHALL include at minimum the street name or locality and the country.
3. THE App SHALL send the encrypted LOCATION Message (containing latitude, longitude, and address) via the standard Signal_Protocol encrypted Message channel.
4. WHEN a recipient opens a LOCATION Message, THE App SHALL display an interactive map tile using flutter_map (OpenStreetMap tiles) centred on the shared coordinates at zoom level 15 with a pin marker.
5. WHEN the User taps the map tile, THE App SHALL open a full-screen map view supporting pinch-to-zoom (zoom levels 1–18) and pan gestures.
6. IF location permission is denied, THEN THE App SHALL display an in-app screen explaining why the permission is needed with a button to open the system settings, and SHALL NOT send a location Message.
7. IF GPS coordinates are not obtained within 15 seconds, THE App SHALL display a "Location unavailable" error and cancel the send.
8. IF reverse-geocoding fails or times out, THE App SHALL send a LOCATION Message containing only the latitude and longitude (omitting the address field) and notify the sender that the address could not be resolved.

---

### Requirement 11: Emoji Support and Reactions

**User Story:** As a user, I want to send emoji in messages and react to messages with emoji, so that I can express myself quickly and respond without full text replies.

#### Acceptance Criteria

1. THE App SHALL provide an emoji picker using emoji_picker_flutter with category tabs and a recently-used section storing the last 30 used emoji.
2. THE App SHALL support native keyboard emoji input in the text composition field.
3. WHEN a User long-presses a Message bubble for at least 300 ms, THE App SHALL display a quick-reaction bar showing the 6 most recently used emoji from the User's history (falling back to: 👍 ❤️ 😂 😮 😢 🙏 for slots with no history) plus an "other" button opening the full emoji picker.
4. WHEN a User selects a reaction emoji, THE App SHALL emit a reaction-add event to the Backend with the messageId, emoji codepoint, and requestId.
5. WHEN the Backend receives a reaction-add event, THE Backend SHALL upsert a Reaction record (unique per messageId + userId + emoji) and fan-out the reaction to all Conversation member Devices.
6. WHEN a User selects the same reaction emoji a second time on the same Message, THE App SHALL emit a reaction-remove event; THE Backend SHALL delete the Reaction record and fan-out the removal to all Conversation member Devices.
7. WHEN the Backend fans out a reaction event, THE App SHALL update the reaction counts beneath the affected Message bubble using optimistic UI; IF a reaction acknowledgement is not received within 10 seconds, THE App SHALL revert the optimistic update and display an error indicator.
8. THE App SHALL display aggregated reaction counts beneath each Message bubble, grouped by emoji, showing at most 20 distinct emoji types with a "+N more" label for overflow.
9. WHEN the User taps a reaction group, THE App SHALL display a bottom sheet listing the Users who reacted with that emoji, sorted by reaction timestamp ascending.

---

### Requirement 12: Typing Indicators and Online/Last-Seen Presence

**User Story:** As a user, I want to see when contacts are typing or when they were last online, so that I can gauge conversation activity in real time.

#### Acceptance Criteria

1. WHEN a User types at least one character in the message input field and at least 2 seconds have elapsed since the last typing-start event was emitted, THE App SHALL emit a typing-start event to the SocketGateway with the conversationId.
2. WHEN a User clears the message input or sends the Message, THE App SHALL emit a typing-stop event to the SocketGateway.
3. IF a typing-stop event is not received within 5 seconds after the last typing-start event, THEN THE Backend SHALL treat the typing indicator as stopped and broadcast a typing-stop event to all other Conversation members.
4. WHEN the Backend receives a typing-start or typing-stop event, THE Backend SHALL broadcast it to all other members of the Conversation (excluding the typing User).
5. WHEN the App moves to the foreground, THE App SHALL emit a presence-online event to the SocketGateway; THE Backend SHALL set the online flag to true and update lastSeenAt to the current UTC timestamp in Redis for that User.
6. WHEN the App moves to the background or disconnects, THE App SHALL emit a presence-offline event; THE Backend SHALL set the online flag to false and record the lastSeenAt timestamp in Redis for that User.
7. WHERE a User's lastSeenVisibility is set to EVERYONE, THE Backend SHALL include lastSeenAt and the online flag in all relevant API and socket responses for that User.
8. WHERE a User's lastSeenVisibility is set to MY_CONTACTS, THE Backend SHALL include lastSeenAt and the online flag only when the requesting User is in the profile owner's contact list.
9. WHERE a User's lastSeenVisibility is set to NOBODY, THE Backend SHALL exclude both the lastSeenAt field and the online flag from all API and socket responses for that User.
10. THE App SHALL display "Online" for Users with the online flag set to true, and "last seen [relative time]" (e.g., "last seen today at 14:32", "last seen yesterday", "last seen [day of week]", "last seen [date]") for others when permitted by lastSeenVisibility.

---

### Requirement 13: Push Notifications

**User Story:** As a user, I want to receive push notifications for new messages and missed calls when the app is in the background, so that I do not miss important communications.

#### Acceptance Criteria

1. WHEN a new Message is delivered to a recipient Device and the Device is not connected to the SocketGateway, THE Backend SHALL send an FCM push notification to the Device's FCM token via firebase-admin.
2. THE Backend SHALL send push notifications using data-only payloads; the App SHALL decrypt and display the notification locally using flutter_local_notifications without transmitting plaintext to FCM.
3. WHEN the App registers or updates its FCM token, THE App SHALL send the updated token to the Backend's device update endpoint.
4. IF an FCM token is reported as invalid by the FCM service, THEN THE Backend SHALL delete the Device's fcmToken and stop sending FCM notifications to that token.
5. WHEN a User receives a missed call notification, THE App SHALL display a "Missed Call" notification with the caller's display name and a call-back action.
6. THE Backend SHALL batch notifications for up to 5 unread messages per conversation within a 3-second window before sending a single FCM payload.
7. WHEN a User taps a notification, THE App SHALL navigate directly to the relevant Conversation screen.
8. THE App SHALL support notification grouping by Conversation on Android and iOS.

---

### Requirement 14: 1:1 Audio and Video Calling (WebRTC)

**User Story:** As a user, I want to make end-to-end encrypted audio and video calls to my contacts, so that I can have real-time voice and video conversations.

#### Acceptance Criteria

1. WHEN a User initiates a Call, THE App SHALL emit a call-initiate event via the SocketGateway containing the conversationId, callType (AUDIO or VIDEO), and the caller's ICE configuration.
2. WHEN the Backend receives a call-initiate event, THE Backend SHALL create a Call record with status INITIATED, emit a call-incoming event to all online Devices of the recipient, and enqueue an FCM push notification BullMQ job for all offline Devices.
3. WHEN a recipient accepts the Call, THE App SHALL emit a call-accept event; THE Backend SHALL update the Call status to ACCEPTED and begin relaying WebRTC offer/answer signaling through the SocketGateway.
4. WHEN a recipient declines the Call, THE App SHALL emit a call-decline event; THE Backend SHALL update the Call status to DECLINED and emit a call-declined event to the caller's Device.
5. IF the WebRTC offer/answer exchange is not completed within 10 seconds of call acceptance, THEN THE App SHALL emit a call-timeout event, THE Backend SHALL update the Call status to MISSED, and the App SHALL dismiss the call UI.
6. THE App SHALL use DTLS-SRTP for all WebRTC media tracks (both audio and video); plaintext RTP SHALL NOT be permitted.
7. IF an ICE offer is received that does not include a valid DTLS fingerprint, THEN THE App SHALL reject the offer, abort the call setup, and display an "Insecure call rejected" error to the User.
8. THE App SHALL include coturn STUN and TURN candidates in ICE candidate gathering; IF a direct peer-to-peer connection cannot be established after ICE gathering completes, THE App SHALL relay media through the coturn TURN server.
9. WHEN a Call is established, THE App SHALL display the caller's display name, an elapsed call duration timer, and controls for: mute/unmute (audio), enable/disable speaker, and end call.
10. WHEN a video Call is established, THE App SHALL render local and remote video feeds and provide controls for: camera toggle (front/rear) and local video track enable/disable.
11. WHEN either party ends the Call, THE App SHALL emit a call-end event; THE Backend SHALL update the Call status to ENDED and record the endedAt timestamp.
12. IF a Call is not answered within 30 seconds of being initiated, THE Backend SHALL set the Call status to MISSED and emit a call-missed event to the caller's Device.
13. IF a User is already in an active Call and a new incoming Call arrives, THEN THE App SHALL emit a call-busy event; THE Backend SHALL set the new Call status to BUSY and relay a call-busy event to the calling party.
14. IF either party's WebSocket connection drops unexpectedly during an active Call, THEN THE App SHALL attempt to reconnect for up to 30 seconds; IF reconnection fails, THE App SHALL end the call and THE Backend SHALL update the Call status to ENDED.

---

### Requirement 15: Multi-Device Support

**User Story:** As a user, I want to use the application on multiple devices simultaneously, so that I can access my conversations from any of my registered devices.

#### Acceptance Criteria

1. THE Backend SHALL allow a User to register up to 5 Devices simultaneously.
2. IF a Device registration request is received when the User already has 5 registered Devices, THEN THE Backend SHALL return HTTP 409 with an error code of DEVICE_LIMIT_EXCEEDED.
3. WHEN a Message is sent by one Device, THE Backend SHALL fan-out the Message ciphertext to all other registered Devices of the sender User; IF the recipient Device is offline, THE Backend SHALL queue the ciphertext for delivery upon next reconnection.
4. WHEN a new Device registers for a User that has at least 1 other registered Device, THE App SHALL initiate a new independent Signal_Protocol session for each existing peer Device using that peer Device's key bundle.
5. THE App SHALL display a Device Management screen listing all registered Devices with: device name, platform, and lastActiveAt timestamp in UTC ISO 8601 format.
6. WHEN a User initiates remote logout for a Device from the Device Management screen, THE Backend SHALL invalidate all RefreshTokens for that Device and emit a force-logout event to any active SocketGateway connection for that Device.
7. WHEN the App receives a force-logout event or detects that its RefreshTokens have been invalidated, THE App SHALL clear all local Drift database data and flutter_secure_storage keys and redirect the User to the phone number entry screen.
8. THE Backend SHALL update the Device's lastActiveAt timestamp in UTC ISO 8601 format on every authenticated request from that Device.

---

### Requirement 16: Contacts Sync and Management

**User Story:** As a user, I want the app to identify which of my phone contacts use the application, so that I can start conversations with them without manually searching.

#### Acceptance Criteria

1. WHEN a User grants contacts permission, THE App SHALL read the device address book using flutter_contacts and upload hashed phone numbers (SHA-256) to the Backend's contact discovery endpoint.
2. THE Backend SHALL match the hashed phone numbers against the User table and return the matched User IDs and display names without storing the hashed phone numbers.
3. THE App SHALL display matched contacts as the suggested contact list for starting new Conversations.
4. THE App SHALL refresh contact discovery at most once every 24 hours or on explicit user pull-to-refresh.
5. IF a User denies contacts permission, THEN THE App SHALL provide a manual search-by-phone-number fallback for starting Conversations.
6. THE Backend SHALL rate-limit the contact discovery endpoint to 1 request per User per hour using @nestjs/throttler with Redis.

---

### Requirement 17: Full-Text Search

**User Story:** As a user, I want to search my messages, media, and documents, so that I can find specific content quickly across all my conversations.

#### Acceptance Criteria

1. THE App SHALL provide Local Search within a single Conversation, filtering decrypted Messages on the client side using Dart string matching, returning results within 100 ms for up to 10,000 messages.
2. THE App SHALL provide Global Search across all Conversations on the client, searching decrypted message plaintext stored in Drift, returning results within 500 ms.
3. THE App SHALL provide Media Search within a Conversation, listing IMAGE and VIDEO Attachments in a thumbnail grid, filterable by date range.
4. THE App SHALL provide Document Search within a Conversation, listing DOCUMENT Attachments with file name, size, and date.
5. THE App SHALL provide Message Search with full-text matching against decrypted plaintext in the Drift database; THE Backend SHALL NOT be queried for message content in any search.
6. WHEN a User enters a search query, THE App SHALL highlight matching substrings in the results list.
7. THE App SHALL display search results grouped by Conversation in the Global Search view.
8. THE App SHALL allow the User to tap a search result to navigate directly to the Message in its Conversation with the matched text scrolled into view and highlighted.

---

### Requirement 18: End-to-End Encryption for Calls

**User Story:** As a user, I want my audio and video calls to be end-to-end encrypted, so that no intermediary server can intercept call media.

#### Acceptance Criteria

1. THE App SHALL configure all WebRTC peer connections (both audio and video calls) with DTLS-SRTP as the mandatory media security profile.
2. IF an ICE offer is received that does not include a valid DTLS fingerprint, THEN THE App SHALL abort the call setup, display a "Secure connection could not be established" error to the User, and update the Call status to ENDED.
3. THE App SHALL negotiate DTLS certificates using on-device keys generated via flutter_webrtc.
4. THE DTLS private keys SHALL NOT leave the device and SHALL NOT be accessible to the Backend or any other party.
5. THE Backend's signaling Gateway SHALL relay SDP offers, SDP answers, and ICE candidates without decrypting or modifying the DTLS parameters within the SDP body.
6. WHEN the App receives the remote SDP via the SocketGateway signal, THE App SHALL compare the DTLS fingerprint in the SDP against the fingerprint confirmed in the signaling message before allowing media to flow; IF the fingerprints do not match, THE App SHALL terminate the call and display a "Call security verification failed" error.
7. IF the DTLS fingerprint comparison in criterion 6 fails, THEN THE App SHALL emit a call-end event with reason SECURITY_FAILURE and THE Backend SHALL update the Call status to ENDED.

---

### Requirement 19: Privacy Settings

**User Story:** As a user, I want to control who can see my last-seen time, profile photo, and read receipts, so that I can protect my privacy.

#### Acceptance Criteria

1. THE App SHALL provide a Privacy Settings screen with controls for lastSeenVisibility (EVERYONE, MY_CONTACTS, NOBODY), profilePhotoVis (EVERYONE, MY_CONTACTS, NOBODY), and readReceipts (enabled/disabled).
2. WHEN a User disables readReceipts, THE Backend SHALL suppress read receipt events for messages sent to that User, and THE App SHALL not display read receipt status for messages sent to that User.
3. WHERE lastSeenVisibility is set to NOBODY, THE Backend SHALL exclude the lastSeenAt field from all API and socket responses for that User.
4. WHERE profilePhotoVis is set to MY_CONTACTS, THE Backend SHALL return the avatarUrl only to Users who are in the contact list of the profile owner.
5. THE Backend SHALL persist all privacy settings in the Setting table and apply them on every relevant API response.

---

### Requirement 20: REST API Standard and Error Handling

**User Story:** As a backend consumer, I want every API response to follow a consistent envelope format, so that the client can handle all responses uniformly.

#### Acceptance Criteria

1. THE Backend SHALL wrap every successful REST response body in `{ "success": true, "message": "<string>", "data": <payload or null>, "timestamp": "<ISO 8601 UTC>" }`.
2. THE Backend SHALL wrap every error REST response body in `{ "success": false, "code": "<UPPER_SNAKE_CASE string>", "message": "<string>", "details": <object or null> }`.
3. THE Backend SHALL attach a unique requestId (UUIDv4) to every REST request and include it in all response headers as `X-Request-Id`, regardless of whether the response is a success or error.
4. THE Backend SHALL include the requestId in every Socket.io event payload emitted by the server under the field `requestId`.
5. WHEN the Backend receives an HTTP request with an invalid or missing DTO field, THE Backend SHALL return HTTP 400 with a `details` array where each element contains the field name and a human-readable constraint description.
6. WHEN `NODE_ENV` is not `development`, THE Backend SHALL omit stack traces and internal system error details from all error response bodies, returning only the `code` and `message` fields.

---

### Requirement 21: Authentication and Authorization Guards

**User Story:** As a backend engineer, I want all protected endpoints to enforce JWT authentication, so that only authenticated users can access application data.

#### Acceptance Criteria

1. THE Backend SHALL protect all REST endpoints (except OTP send and OTP verify) with the JwtAuthGuard.
2. THE Backend SHALL protect all SocketGateway events with a JWT validation step performed during the WebSocket handshake.
3. WHEN a WebSocket connection presents an expired JWT, THE Backend SHALL reject the connection with a 401 event and close the socket.
4. THE Backend SHALL enforce role-based access for group admin operations (add/remove member, update group info) using a ConversationRole guard.
5. THE Backend SHALL enforce resource ownership for message deletion: only the message sender or a CONVERSATION ADMIN may delete a Message.

---

### Requirement 22: Rate Limiting and DoS Protection

**User Story:** As a platform operator, I want the backend to enforce rate limits, so that abusive clients cannot overload the system or brute-force credentials.

#### Acceptance Criteria

1. THE Backend SHALL apply global rate limiting at 60 requests per minute per IP for REST endpoints, using Redis as the throttler store.
2. THE Backend SHALL apply a stricter rate limit of 5 requests per 10 minutes per phone number on the OTP send endpoint.
3. THE Backend SHALL apply a rate limit of 10 WebSocket message events per second per authenticated User.
4. THE Backend SHALL apply a connection limit of 5 simultaneous WebSocket connections per User.
5. WHEN a REST rate limit is exceeded, THE Backend SHALL return HTTP 429 with a `Retry-After` header indicating the number of seconds until the limit resets.
6. THE Backend SHALL apply request body size limits: 10 KB for JSON payloads and 100 MB for multipart uploads.
7. WHEN a WebSocket message rate limit is exceeded for a User, THE Backend SHALL send an error event to the offending socket with code RATE_LIMIT_EXCEEDED and drop the event; existing connections SHALL NOT be terminated.
8. WHEN a request body exceeds the size limit, THE Backend SHALL return HTTP 413 with error code PAYLOAD_TOO_LARGE.

---

### Requirement 23: Observability, Health, and Metrics

**User Story:** As a DevOps engineer, I want the backend to expose health checks and Prometheus metrics, so that I can monitor system health and set up alerting.

#### Acceptance Criteria

1. THE Backend SHALL expose a GET /health endpoint returning HTTP 200 with `{ status: "ok" }` when all dependencies (PostgreSQL, Redis, MinIO) are reachable.
2. THE Backend SHALL expose a GET /health/ready endpoint returning HTTP 200 only when the application has completed startup and is ready to serve traffic.
3. THE Backend SHALL expose a GET /metrics endpoint in Prometheus text exposition format, including request count, request duration histogram, active WebSocket connections, BullMQ queue depth, and Node.js process metrics.
4. THE Backend SHALL instrument all service operations with OpenTelemetry spans, propagating trace context from REST requests through Redis and BullMQ jobs.
5. THE Backend SHALL attach a requestId to every OpenTelemetry span as a span attribute.
6. THE Backend SHALL use pino for structured JSON logging; logs SHALL include level, timestamp, requestId, and message fields.
7. THE Backend SHALL NEVER log message content, encryption keys, OTP values, JWT tokens, or refresh tokens.

---

### Requirement 24: Socket Event Versioning and Shared Contracts

**User Story:** As a full-stack engineer, I want all socket events and DTOs to be defined in a shared contracts package, so that backend and mobile clients remain synchronized without manual coordination.

#### Acceptance Criteria

1. THE packages/shared-contracts package SHALL export an enum of all Socket.io event names, each prefixed with a version string (e.g., `v1.message.send`).
2. THE packages/shared-contracts package SHALL export a TypeScript interface or class for the payload of every socket event.
3. THE packages/shared-contracts package SHALL export all shared enums (DeliveryStatus, MessageType, CallType, CallStatus, Role, ConversationType).
4. THE Backend SHALL import all socket event names and payload types exclusively from @chat/shared-contracts.
5. THE App SHALL reference the shared event names from the packages/shared-contracts Dart mirror (generated or manually maintained).
6. WHEN a socket event payload changes incompatibly, THE packages/shared-contracts package SHALL introduce a new versioned event name (e.g., `v2.message.send`) and maintain the old version until all clients are migrated.

---

### Requirement 25: Database Migration Governance

**User Story:** As a backend engineer, I want every database schema change to be accompanied by a rollback script and migration documentation, so that deployments can be safely reverted.

#### Acceptance Criteria

1. THE Backend SHALL use Prisma Migrate for all schema changes; direct SQL DDL modifications without a corresponding Prisma migration file SHALL NOT be permitted.
2. WHEN a new Prisma migration is created, the developer SHALL provide a `rollback.sql` file in the same migration directory that reverses all DDL operations in the forward migration.
3. WHEN a new Prisma migration is created, the developer SHALL provide a `migration-notes.md` file in the same migration directory containing: a summary of changes, the list of affected entities, the data compatibility assessment, and (if applicable) the data compatibility report.
4. WHEN the Backend container starts, THE Backend SHALL run `prisma migrate deploy` to apply all pending migrations before the HTTP server begins accepting requests; IF any migration fails, THE Backend SHALL exit with a non-zero status code.
5. IF a migration introduces any of the following breaking changes — column removal, table removal, type narrowing, adding a NOT NULL constraint to an existing column without a default, or table rename — THEN the `migration-notes.md` SHALL include an explicit data compatibility report describing the impact on existing data and required backfill steps.
6. THE CI pipeline SHALL verify that every migration directory contains both `rollback.sql` and `migration-notes.md` before allowing a merge to the main branch.

---

### Requirement 26: Security Hardening

**User Story:** As a security engineer, I want the app and backend to implement defence-in-depth security controls, so that the system is resistant to common attacks.

#### Acceptance Criteria

1. THE App SHALL implement certificate pinning by validating the server's TLS certificate against a bundled public key hash (SPKI fingerprint) on every HTTPS and WebSocket connection; IF pinning validation fails, THE App SHALL abort the connection and display a "Connection security error" message.
2. THE App SHALL detect rooted (Android) or jailbroken (iOS) devices at launch; IF detected, THE App SHALL display a security warning modal; IF a runtime `blockOnRootedDevice` flag is set to true, THE App SHALL prevent further app usage until the device passes the check.
3. THE Backend SHALL implement nonce-based replay protection: every authenticated REST API request SHALL include a nonce; THE Backend SHALL reject with HTTP 409 and error code REPLAY_DETECTED any request whose nonce has been seen within a 5-minute window stored in Redis.
4. THE Backend SHALL enforce CSRF protection on all state-mutating REST endpoints using the double-submit cookie pattern or a signed CSRF token; requests without a valid CSRF token SHALL be rejected with HTTP 403.
5. THE Backend SHALL set the following HTTP security headers on all responses: `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'self'`, and `Referrer-Policy: no-referrer`.
6. THE App SHALL use flutter_secure_storage for all cryptographic key material, OTP session tokens, JWT tokens, and refresh tokens.
7. THE Backend SHALL use Prisma parameterized queries for all database operations; raw SQL with user-supplied string interpolation SHALL NOT be used.
8. THE Backend SHALL hash refresh tokens with argon2id using a minimum time cost of 2 and memory cost of 65536 KB before storage; plaintext refresh tokens SHALL NOT persist in the database.
9. THE App SHALL use `dart:math`'s `Random.secure()` or an equivalent cryptographically secure RNG for all key generation, nonce creation, and IV generation.
10. THE App SHALL configure the Dio HTTP client and socket_io_client to enforce a minimum TLS version of 1.3; connections that negotiate a lower TLS version SHALL be aborted.

---

### Requirement 27: Mobile UI Design System

**User Story:** As a product designer, I want the app to use a custom design system with a colour token system and bespoke UI components, so that the visual experience is polished and distinctive.

#### Acceptance Criteria

1. THE App SHALL define a colour token system with semantic tokens (e.g., surfacePrimary, onSurface, accent, error) supporting both light and dark themes, switchable via the User's theme Setting.
2. THE App SHALL use the Inter or Manrope font family via google_fonts; system fonts SHALL NOT be used for body or heading text.
3. THE App SHALL render custom chat bubbles with distinct shapes for sent (right-aligned, primary accent) and received (left-aligned, surface colour) messages, with sender name shown in group conversations.
4. THE App SHALL implement micro-interaction animations: send confirmation animation (message bubble scale-in), reaction pop (spring scale), and shared-element transitions between conversation list and chat screen using flutter_animate.
5. THE App SHALL display shimmer loading skeletons for conversation list items and message list items while data is loading.
6. THE App SHALL implement a custom animated bottom navigation bar with icon transition animations.
7. THE App SHALL maintain a sustained 60 FPS during chat list scrolling and message list scrolling, measured via Flutter's SchedulerBinding frame callback.
8. THE App SHALL produce no unnecessary widget rebuilds in the message list as verified by Flutter DevTools rebuild annotations.
9. THE App SHALL display adaptive UI for 2G/3G conditions: reduced image quality previews and a network quality indicator when connection speed is below 500 kbps.
10. THE App SHALL comply with WCAG 2.1 AA contrast ratios for all text on background colour combinations in both light and dark themes.

---

### Requirement 28: Navigation and Routing

**User Story:** As a user, I want smooth navigation between app screens, so that moving between conversations and features feels instant and intuitive.

#### Acceptance Criteria

1. THE App SHALL use go_router for all navigation with typed route definitions.
2. THE App SHALL implement deep link handling for notification taps, navigating to the correct Conversation screen with the correct path parameters.
3. THE App SHALL preserve scroll position in the message list when navigating away and returning to a Conversation.
4. THE App SHALL support the Android back button and iOS swipe-back gesture throughout the navigation stack.
5. THE App SHALL transition between the conversation list and a conversation using a shared-element transition animating the conversation header.

---

### Requirement 29: State Management with Riverpod

**User Story:** As a Flutter developer, I want all state management handled through Riverpod providers with code generation, so that the codebase is predictable, testable, and free of unnecessary rebuilds.

#### Acceptance Criteria

1. THE App SHALL use Riverpod (riverpod_annotation + code generation via build_runner) for all state management and dependency injection; no other state management approach SHALL be introduced.
2. THE App SHALL define provider families for per-conversation state, scoping rebuilds to the affected conversation only.
3. THE App SHALL use AsyncNotifierProvider for all asynchronous data-fetching providers.
4. THE App SHALL invalidate relevant Riverpod providers upon receiving socket events that modify the corresponding data.
5. THE App SHALL use Riverpod's ref.watch selectively to minimise the rebuild scope; providers SHALL NOT expose entire entity objects when only a single field is consumed.
6. THE App SHALL define all providers in dedicated provider files co-located with their feature module.

---

### Requirement 30: Local Encrypted Database (Drift + SQLCipher)

**User Story:** As a user, I want all locally stored messages and keys to be encrypted on-device, so that my data remains private even if the device is compromised.

#### Acceptance Criteria

1. WHEN the App launches and a Drift database does not yet exist, THE App SHALL generate a 256-bit random seed using `Random.secure()`, store it in flutter_secure_storage, and open a new Drift SQLite database encrypted with SQLCipher using a key derived from that seed.
2. WHEN the App launches and a Drift database already exists, THE App SHALL retrieve the seed from flutter_secure_storage and open the existing database with the derived key; IF the key is not found, THE App SHALL display a "Local data unavailable" error and require the User to log in again.
3. THE App SHALL store all decrypted Message plaintext, User profiles, Conversation metadata, and Attachment records exclusively in the Drift database.
4. THE App SHALL store all Signal_Protocol session state and ratchet state exclusively in the Drift database under SQLCipher encryption.
5. WHEN a User logs out, THE App SHALL delete all Drift database records and remove all flutter_secure_storage entries for that Device before the logout operation completes.
6. THE App SHALL use Drift's streaming queries to reactively update the UI; UI updates SHALL reflect database changes within 500 ms of the database write completing.
7. WHEN the App detects that the Drift database schema version is behind the current version at launch, THE App SHALL run all pending Drift stepByStep migrations before opening the database for reads or writes; IF any migration fails, THE App SHALL display a "Database upgrade failed" error and refuse to open the database.

---

### Requirement 31: BullMQ Background Job Processing

**User Story:** As a backend engineer, I want async operations processed via a job queue, so that the request/response cycle is not blocked by heavy or time-sensitive background tasks.

#### Acceptance Criteria

1. THE Backend SHALL use BullMQ with Redis as the queue backend for all background tasks: FCM notification dispatch, media expiry, OneTimePreKey replenishment notifications, and SignedPreKey rotation alerts.
2. THE Backend SHALL configure each BullMQ queue with a dead-letter queue for jobs that fail after 3 retries.
3. THE Backend SHALL implement exponential backoff for job retries: initial delay 1 second, multiplied by 2 per retry.
4. THE Backend SHALL log job failures at ERROR level including the job ID, queue name, attempt number, and error message without logging sensitive payload data.
5. WHEN the Backend processes a media expiry job, THE Backend SHALL delete the MinIO object, mark the Attachment as expired in the database, and emit a media-expired socket event to online Devices in the Conversation.

---

### Requirement 32: Architecture Decision Records

**User Story:** As a team member, I want an ADR for every significant technology choice, so that future engineers understand the reasoning behind architectural decisions.

#### Acceptance Criteria

1. THE project SHALL include ADRs in /docs/architecture for each of the following choices: Prisma ORM, Drift (Flutter SQLite), BullMQ, Socket.io, MinIO, Riverpod, Signal Protocol library selection, coturn, NestJS, PostgreSQL, and Redis.
2. Each ADR SHALL follow the format: Title, Status, Context, Decision, Consequences, Alternatives Considered.
3. Each ADR SHALL include the date of the decision and the author.

---

### Requirement 33: CI/CD Pipeline

**User Story:** As a DevOps engineer, I want an automated CI/CD pipeline, so that every code change is validated, built, and deployable with a single push.

#### Acceptance Criteria

1. THE project SHALL provide GitHub Actions workflows in /infra/ci covering these stages in order: lint, test, build, Docker image build, and deploy.
2. WHEN a pull request is opened, THE pipeline SHALL run lint and test stages and block merging if either fails.
3. WHEN a commit is pushed to the main branch, THE pipeline SHALL build Docker images for the Backend and tag them with the Git commit SHA.
4. THE Docker image for the Backend SHALL be built using a multi-stage Dockerfile with a non-root user and no development dependencies in the final image.
5. THE pipeline SHALL run `flutter analyze` and `flutter test` for the App in the test stage.
6. THE pipeline SHALL fail if TypeScript compilation produces any errors (strict mode, no `any`).

---

### Requirement 34: Docker and Infrastructure

**User Story:** As a developer, I want a docker-compose configuration that spins up the full stack locally, so that I can run the entire system with a single command.

#### Acceptance Criteria

1. THE project SHALL provide a docker-compose.yml in /infra/docker that starts: Backend (NestJS), PostgreSQL 16, Redis 7, MinIO, and coturn.
2. Each service SHALL have a health check configured so dependent services wait for dependencies to be healthy before starting.
3. THE docker-compose.yml SHALL use named volumes for PostgreSQL and MinIO data to persist data across container restarts.
4. THE project SHALL provide a .env.example file at the workspace root with all required environment variable names and placeholder values.
5. THE coturn configuration in /infra/coturn SHALL enable DTLS and disable UDP relay unless using TLS credentials.
6. THE MinIO service SHALL be configured with a dedicated bucket for attachments created on first startup via an init script.

---

### Requirement 35: Code Quality and Linting

**User Story:** As a developer, I want automated lint and format checks enforced by pre-commit hooks, so that all committed code meets the project's quality standards.

#### Acceptance Criteria

1. THE Backend SHALL use ESLint with the @typescript-eslint plugin and Prettier, configured to forbid the `any` type and enforce strict TypeScript.
2. THE Backend SHALL use Husky and lint-staged to run ESLint and Prettier on staged files before every git commit.
3. THE App SHALL use dart format and flutter_lints; all Dart files SHALL pass `flutter analyze` with no warnings.
4. THE Backend SHALL have zero TypeScript compilation errors in strict mode.
5. THE Backend SHALL have zero ESLint errors in the lint stage of CI.
6. THE App SHALL have zero flutter analyze warnings in the CI test stage.

---

### Requirement 36: Documentation

**User Story:** As a developer or operator, I want comprehensive documentation covering architecture, API, socket events, deployment, and sequence diagrams, so that the system is maintainable and operable by any team member.

#### Acceptance Criteria

1. THE project SHALL include a README.md at the workspace root with project overview, prerequisites, local setup instructions, and links to all /docs sub-documents.
2. THE Backend SHALL auto-generate Swagger UI documentation at /api using @nestjs/swagger, with every endpoint documented including request/response schemas.
3. THE project SHALL include an ER diagram in /docs/er-diagrams as a Mermaid diagram covering all Prisma models.
4. THE project SHALL include a system architecture diagram in /docs/architecture using Mermaid or a linked image.
5. THE project SHALL include sequence diagrams in /docs/sequence-diagrams for: X3DH key agreement, message send/receive, WebRTC call setup, offline message delivery, and media upload/download.
6. THE project SHALL include a deployment guide in /docs/deployment covering Docker, environment variables, database migration, and coturn configuration.
7. THE project SHALL include a Socket Events Guide in /docs/socket-events listing all versioned event names, payloads, and error codes.

---

### Requirement 37: Performance Targets

**User Story:** As a user on a mid-range Android or iOS device, I want the app to feel fast and responsive, so that it matches the performance quality of leading messaging applications.

#### Acceptance Criteria

1. THE App SHALL achieve a cold launch time of less than 2 seconds on a reference mid-range device (3 GB RAM, 2 GHz CPU) as measured from process start to first interactive frame.
2. THE App SHALL open a Conversation screen in less than 300 ms from the tap gesture to the first frame rendered with messages visible.
3. THE App SHALL render message send animations with no more than 2 dropped frames per animation sequence, as verified by Flutter's timeline tool.
4. THE App SHALL sustain 60 FPS during 60 continuous seconds of chat list scrolling over a list of at least 200 conversations, with no more than 5 dropped frames per second.
5. THE App SHALL maintain a memory cache of up to 100 MB and a disk cache of up to 500 MB for remote images; repeated views of the same image SHALL serve from cache without a network request.
6. THE App SHALL contain no memory leaks; heap memory SHALL NOT grow more than 20 MB above the post-launch baseline during a 30-minute active session as measured by Flutter DevTools memory profiler.

---

### Requirement 38: Monorepo Structure Compliance

**User Story:** As a developer, I want the repository to follow the defined monorepo structure exactly, so that all team members and CI pipelines can navigate and build the project consistently.

#### Acceptance Criteria

1. THE project SHALL maintain the following top-level directory structure: /apps/mobile, /apps/backend, /packages/shared-contracts, /packages/shared-config, /infra/docker, /infra/coturn, /infra/ci, /docs/architecture, /docs/er-diagrams, /docs/sequence-diagrams, /docs/api, /docs/socket-events, /docs/deployment.
2. THE monorepo SHALL use pnpm workspaces as the package manager for all Node.js packages.
3. THE Backend SHALL import shared packages using the workspace alias `@chat/shared-contracts` and `@chat/shared-config`.
4. THE folder structure SHALL NOT be changed after the initial generation; new modules SHALL be added within the existing structure without reorganising existing folders.
5. THE Backend SHALL follow Clean Architecture layers: domain, application, infrastructure, and presentation, organised within each feature module.

---

### Requirement 39: Scalability and Stateless Backend

**User Story:** As a platform operator, I want the backend to be horizontally scalable, so that I can run multiple instances behind a load balancer to handle growing traffic.

#### Acceptance Criteria

1. THE Backend SHALL be stateless: all session state, presence data, and cache SHALL be stored in Redis, not in application memory.
2. THE Backend SHALL use the @socket.io/redis-adapter to fan-out Socket.io events across all Backend instances.
3. THE Backend SHALL use Redis pub/sub for cross-instance presence updates and typing indicator propagation.
4. THE Backend SHALL configure a Redis connection pool with a minimum of 5 connections and a maximum of 50 connections.
5. THE Backend SHALL implement graceful shutdown: on SIGTERM, the Backend SHALL stop accepting new connections, drain the BullMQ worker, complete in-flight requests within 30 seconds, then exit.

---

### Requirement 40: Testing

**User Story:** As a developer, I want unit and integration tests for backend services and Flutter widgets, so that regressions are caught automatically in CI.

#### Acceptance Criteria

1. THE Backend SHALL include Jest unit tests for all service classes, achieving at least 80% line coverage per service file.
2. THE Backend SHALL include Jest integration tests for all REST API endpoints using a test database.
3. THE App SHALL include Flutter widget tests for all custom UI components in the design system.
4. THE App SHALL include Riverpod provider unit tests using ProviderContainer for all AsyncNotifierProviders.
5. THE Backend's Jest configuration SHALL run in a test environment that mocks Redis and BullMQ to avoid external dependencies in unit tests.
6. WHEN the CI pipeline runs tests, THE Backend tests SHALL complete in under 5 minutes and the App tests SHALL complete in under 10 minutes.

---

### Requirement 41: Message Deletion

**User Story:** As a user, I want to delete messages I have sent, so that I can remove content from a conversation.

#### Acceptance Criteria

1. WHEN a User deletes a Message within 30 minutes of sending, THE App SHALL emit a delete-message event; THE Backend SHALL mark the Message as deleted for all recipients and fan-out a message-deleted event to all Conversation member Devices.
2. WHEN a User deletes a Message after 30 minutes, THE App SHALL only allow "delete for me" — removing the Message from the local Drift database without notifying other participants.
3. WHEN a Message is deleted for everyone, THE App SHALL replace the message bubble content with "This message was deleted" in italic text.
4. WHEN a deleted Message had Attachments, THE Backend SHALL delete the corresponding MinIO objects.
5. THE Backend SHALL restrict delete-for-everyone to the message sender and Conversation ADMINs.

---

### Requirement 42: Adaptive Quality for Low-Bandwidth Networks

**User Story:** As a user on a slow network, I want the app to automatically adapt media quality and retry behaviour, so that I can still use the app on 2G and 3G connections.

#### Acceptance Criteria

1. THE App SHALL monitor network connectivity type (WiFi, 4G/5G, 3G, 2G) using the connectivity_plus package.
2. WHILE the App detects a 2G or 3G connection, THE App SHALL reduce image preview thumbnails to a maximum of 200×200 pixels and 20 KB.
3. WHILE the App detects a 2G or 3G connection, THE App SHALL not auto-download video Attachments; instead, THE App SHALL display a download button with file size.
4. THE App SHALL display a network quality indicator banner when connection speed is below 500 kbps.
5. THE App SHALL increase the HTTP request timeout to 30 seconds on 3G and 60 seconds on 2G connections, compared to the 10-second default on WiFi/4G.

---

### Requirement 43: Pre-Architecture Planning Gate

**User Story:** As a lead engineer, I want a complete architectural blueprint approved before implementation begins, so that all engineering decisions are coherent and nothing needs to be redesigned mid-build.

#### Acceptance Criteria

1. THE project SHALL produce and document the following before any implementation code is written: system architecture diagram, full database ER diagram, complete socket event catalog with payload shapes, full REST API endpoint list with request/response shapes, encryption flow sequence diagrams (X3DH + Double Ratchet + media), WebRTC call signaling sequence diagram, offline sync state machine diagram, monorepo folder tree, Riverpod provider dependency graph, and module dependency graph.
2. THE architecture documents SHALL be stored in the /docs directory following the folder structure defined in Requirement 38.
3. THE architecture documents SHALL be produced as Mermaid diagrams where a visual diagram is required.
4. THE architecture documents SHALL be reviewed before the first implementation task is started.
