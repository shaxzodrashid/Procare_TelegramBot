# Telegram Client Support Comment API

## Purpose

The Telegram bot uses this endpoint to register a support message or comment from a client on a
specific repair order. The comment is posted through the trusted bot service on behalf of the
Telegram user.

A comment must contain either text, at least one photo, or both. The endpoint also supports
replying to an existing comment, repair-history action, or phone-call recording on the same repair
order.

## Endpoint

```http
POST /api/v1/repair-orders/register-comment/{repair_order_id}
Content-Type: multipart/form-data
Authorization: Basic <base64(username:password)>
```

The Basic Auth credentials authenticate the trusted Telegram bot service, not the Telegram user.

## Path Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `repair_order_id` | UUID | Yes | The UUID identifying the repair order. |

## Request Body (multipart/form-data)

| Field | Type | Required | Constraints | Description |
| --- | --- | --- | --- | --- |
| `text` | String | Conditional | Max 4 000 characters | Trimmed comment content. Either `text` or at least one `photos` file must be supplied. |
| `reply_target_type` | String | Conditional | Enum: `comment`, `history`, `audio` | The type of item being replied to. Must be provided together with `reply_target_id`. |
| `reply_target_id` | UUID | Conditional | — | The UUID of the specific comment, history action, or phone call being replied to. Must be provided together with `reply_target_type`. |
| `photos` | File | Conditional | Max 5 files, 5 MB per file; JPEG, PNG, or WebP | Images to attach to the comment. |

### Field rules

- **Content requirement**: At least one of `text` or `photos` must be present. Both may be sent
  together.
- **Reply pairing**: `reply_target_type` and `reply_target_id` must always be provided together.
  Sending one without the other is a `400` error.
- **Reply scope**: The referenced reply target must belong to the same repair order identified by
  `repair_order_id`.

## Successful Response

HTTP `200 OK`

```json
{
  "comment": {
    "item_type": "message",
    "id": "uuid-string",
    "comment_type": "support",
    "author_type": "user",
    "direction": "inbound",
    "text": "trimmed text content",
    "author": {
      "id": "uuid-string",
      "display_name": "Client Name",
      "username": "client_username"
    },
    "reply": {
      "target_type": "comment",
      "target_id": "uuid-string",
      "snapshot": {
        "item_type": "message",
        "comment_type": "manual",
        "author_type": "admin",
        "author_display_name": "Admin Name",
        "text": "Original message being replied to"
      }
    },
    "photos": [
      {
        "id": "uuid-string",
        "original_name": "filename.jpg",
        "mime_type": "image/jpeg",
        "urls": {
          "small": "https://storage.url/...",
          "medium": "https://storage.url/...",
          "large": "https://storage.url/..."
        }
      }
    ],
    "is_editable": false,
    "is_deletable": false,
    "is_edited": false,
    "is_read": false,
    "created_at": "ISO-string",
    "updated_at": "ISO-string"
  },
  "created": true
}
```

### Response field notes

- `reply` is `null` when the comment is not a reply to another item.
- `photos` is an empty array `[]` when no images are attached.
- `created` is `true` when a new comment was inserted and `false` when an existing comment was
  returned via deduplication (see [Idempotency & Deduplication](#idempotency--deduplication)).

## Idempotency & Deduplication

To prevent duplicate comments from network retries or bot double-posting, the backend calculates a
unique fingerprint for each request based on:

- `repair_order_id`
- `text`
- Reply targets (`reply_target_type`, `reply_target_id`)
- Hashes of uploaded photos

If an identical fingerprint is received within **60 seconds** of a successfully created comment,
the backend returns the existing comment response with `"created": false` instead of inserting a
duplicate.

## Replying to a Specific Comment

To register the new support message as a reply to an existing comment on the same repair order,
include both reply fields in the multipart body:

- `reply_target_type`: one of `comment`, `history`, `audio`
- `reply_target_id`: the UUID of the item being replied to

The backend validates that the target belongs to the repair order identified by `repair_order_id`.
If the target is missing or belongs to a different repair order, the request returns
`400 Bad Request` with location `reply_target_id`.

## Error Responses

Errors follow the standard CRM error envelope:

```json
{
  "statusCode": 400,
  "message": "Human-readable message",
  "error": "Machine-readable error category",
  "location": "field_or_failure_location",
  "timestamp": "2026-07-02T10:00:00.000Z",
  "path": "/api/v1/repair-orders/register-comment/{repair_order_id}"
}
```

### 400 Bad Request

| Location | Message | Condition |
| --- | --- | --- |
| `text` | Text or at least one photo is required | Neither `text` nor any `photos` were provided. |
| `reply_target` | reply_target_type and reply_target_id must be provided together | Only one of the two reply fields was sent. |
| `reply_target_id` | Reply target was not found in this repair order | The referenced reply target does not exist within the scope of this repair order. |
| `photos` | A maximum of 5 photos is allowed | More than 5 files were uploaded in `photos`. |
| `photos` | Only JPEG, PNG, and WebP photos are allowed | An uploaded file has an unsupported MIME type. |
| `photos` | Each photo must be 5 MB or smaller | An uploaded file exceeds the 5 MB size limit. |
| `photos` | Invalid image file | An uploaded file is not a valid image. |
| `repair_order_id` | Repair order is not linked to a client | The repair order exists but has no associated client (`user_id` is null). |

### 401 Unauthorized

| Location | Condition |
| --- | --- |
| `basic_auth_header` | Authorization header is missing. |
| `basic_auth_format` | Authorization header is malformed. |
| `basic_auth_config` | Server-side Basic Auth credentials are not configured. |
| `basic_auth_credentials` | Supplied credentials do not match the configured values. |

### 404 Not Found

| Location | Message | Condition |
| --- | --- | --- |
| `repair_order_id` | Order not found | No repair order exists with the given UUID. |

## Response Summary

| HTTP status | Meaning | Bot action |
| --- | --- | --- |
| `200` | Comment registered (or deduplicated) | Persist the comment mapping locally and confirm to the user |
| `400` | Validation failure (see table above) | Show a localized validation message to the user |
| `401` | Missing, malformed, or incorrect Basic Auth | Do not retry until credentials are fixed |
| `404` | Repair order not found | Show a "not found" message to the user |
| `500` | Unexpected API or database failure | Treat as temporarily unavailable |
| `503` | CRM API is in maintenance mode | Show maintenance message and retry later |

## Side Effects

- **Photo processing**: Creates 3 scaled/optimized variants for each uploaded photo:
  - `small` — 240 px width, quality 72
  - `medium` — 900 px width, quality 82
  - `large` — 1 600 px width, quality 88
  
  All variants are uploaded to storage; URLs are returned in the response.

- **Admin notification**: If admins are assigned to the repair order, they receive a notification
  via the notification service with event type `support_message_received`. If no admins are
  assigned, the notification is sent to the entire branch (`branch_id`).

## Privacy Requirements

- Never log the Basic Auth password, authorization header, or complete photo URLs.
- Do not cache or persist comment response bodies beyond what is needed for the local
  support-message store mapping.
- Keep uploaded photo data in transit only; the bot should not store original photo files locally.
