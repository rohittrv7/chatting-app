# REST API Guide

All API responses enforce a standard JSON envelope:

### Success Response

```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": { ... },
  "timestamp": "2026-08-01T08:42:16.000Z"
}
```

### Error Response

```json
{
  "success": false,
  "code": "INVALID_OTP",
  "message": "The provided OTP is invalid or expired",
  "details": {}
}
```

## Endpoints Overview

| Method   | Endpoint                            | Auth   | Description                                                  |
| :------- | :---------------------------------- | :----- | :----------------------------------------------------------- |
| `POST`   | `/api/v1/auth/request-otp`          | Public | Request OTP code for phone number                            |
| `POST`   | `/api/v1/auth/verify-otp`           | Public | Verify OTP code & register device                            |
| `POST`   | `/api/v1/auth/refresh`              | Public | Rotate refresh token for access token                        |
| `GET`    | `/api/v1/auth/devices`              | Bearer | List active logged-in devices                                |
| `DELETE` | `/api/v1/auth/devices/:id`          | Bearer | Remote revoke device session                                 |
| `POST`   | `/api/v1/keys/register`             | Bearer | Upload Signal Protocol Identity Key, Signed PreKey, and OPKs |
| `GET`    | `/api/v1/keys/bundle/:user/:device` | Bearer | Fetch X3DH PreKey bundle for target user device              |
| `POST`   | `/api/v1/conversations`             | Bearer | Create 1:1 or Group conversation                             |
| `GET`    | `/api/v1/conversations`             | Bearer | List active user conversations                               |
| `GET`    | `/api/v1/messages/conversation/:id` | Bearer | Fetch paged historical messages                              |
| `POST`   | `/api/v1/media/upload-url`          | Bearer | Get presigned Backblaze B2 S3 URL for client-encrypted blob  |
| `GET`    | `/health`                           | Public | Liveness probe                                               |
| `GET`    | `/health/ready`                     | Public | Readiness probe (Postgres check)                             |
| `GET`    | `/metrics`                          | Public | Prometheus metrics scrape endpoint                           |
