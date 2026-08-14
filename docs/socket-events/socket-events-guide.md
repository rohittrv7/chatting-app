# Socket Events Catalog

All socket events use the shared catalog enum in `@chat/shared-contracts`.

| Event Enum | Direction | Description | Payload DTO |
| :--- | :--- | :--- | :--- |
| `v1.message.send` | Client $\rightarrow$ Server | Transmit multi-device fanout E2EE ciphertexts | `SendMessageDto` |
| `v1.message.ack` | Server $\rightarrow$ Client | Acknowledge message storage on server | `MessageAckDto` |
| `v1.message.receive` | Server $\rightarrow$ Client | Deliver target device ciphertext | `ReceiveMessageDto` |
| `v1.message.receipt_update` | Both | Update/broadcast message delivery & read receipts | `UpdateReceiptDto` |
| `v1.presence.typing` | Both | Broadcast typing indicator in conversation | `TypingEventDto` |
| `v1.call.offer` | Both | WebRTC SDP Offer | `CallOfferDto` |
| `v1.call.answer` | Both | WebRTC SDP Answer | `CallAnswerDto` |
| `v1.call.ice_candidate` | Both | WebRTC ICE Candidate Exchange | `IceCandidateDto` |
| `v1.call.reject` | Both | Reject incoming call | `CallRejectDto` |
| `v1.call.end` | Both | Terminate active call | `CallEndDto` |
