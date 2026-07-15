# Repair Order Approval API

## Purpose

This endpoint records a customer's approval or rejection of a repair order that is waiting at a
customer-approval-required status. It is intended for the Procare Telegram Bot and is protected by
service Basic Auth.

While approval is pending, staff cannot make approval-sensitive changes to the repair order.
Description and comment changes remain available.

## Endpoint

```http
POST /api/v1/telegram/repair-orders/:repair_order_id/approval
Authorization: Basic <base64(username:password)>
Content-Type: application/json
```

`repair_order_id` must be the UUID of an open repair order.

The former `/initial-problems-approval` route is no longer available.

## Authentication

The endpoint uses HTTP Basic Auth with these backend environment variables:

- `TELEGRAM_BOT_BASIC_AUTH_USER`
- `TELEGRAM_BOT_BASIC_AUTH_PASSWORD`

Example header generation:

```text
Authorization: Basic base64(TELEGRAM_BOT_BASIC_AUTH_USER:TELEGRAM_BOT_BASIC_AUTH_PASSWORD)
```

These credentials identify the Telegram Bot service. They are not customer credentials and must
not be exposed to Telegram users or frontend clients.

## Approval lifecycle

A repair order starts waiting for approval when staff moves it into an active repair-order status
whose `needs_customer_approval` setting is `true`. The backend then:

1. Sets the approval state to `pending`.
2. Records the approval-required status.
3. Records the immediately previous repair-order status.
4. Clears any earlier approval/rejection note and timestamps.
5. Enables the staff mutation lock described below.

The approval endpoint accepts a decision only when all of these conditions are true:

- the repair order is open;
- the repair order is linked to a customer;
- its current status record exists and requires customer approval;
- its approval state is `pending`;
- its recorded approval status matches its current status.

## Detecting whether action is required

The Telegram repair-order detail endpoint is:

```http
GET /api/v1/telegram/clients/:client_id/repair-orders/:order_number
```

Its response includes:

```json
{
  "initial_problems_approval": {
    "status": "pending",
    "requires_action": true,
    "note": null
  }
}
```

Call the approval endpoint only when `initial_problems_approval.requires_action` is `true`.
Although the action endpoint is now named generally as `/approval`, the detail response retains
the existing `initial_problems_approval` field name.

## Request body

| Field    | Required                    | Type   | Rules                                                                |
| -------- | --------------------------- | ------ | -------------------------------------------------------------------- |
| `result` | Yes                         | string | Must be `approved` or `rejected`.                                    |
| `note`   | When `result` is `rejected` | string | Must contain non-whitespace text and cannot exceed 4,000 characters. |

Extra request fields are rejected by the global validation policy.

### Approve request

```json
{
  "result": "approved"
}
```

### Reject request

```json
{
  "result": "rejected",
  "note": "Please revise the estimate and use an original display."
}
```

## cURL examples

### Approve

```bash
curl --request POST \
  --url "${API_BASE_URL}/api/v1/telegram/repair-orders/22222222-2222-4222-8222-222222222222/approval" \
  --user "${TELEGRAM_BOT_BASIC_AUTH_USER}:${TELEGRAM_BOT_BASIC_AUTH_PASSWORD}" \
  --header "Content-Type: application/json" \
  --data '{"result":"approved"}'
```

### Reject

```bash
curl --request POST \
  --url "${API_BASE_URL}/api/v1/telegram/repair-orders/22222222-2222-4222-8222-222222222222/approval" \
  --user "${TELEGRAM_BOT_BASIC_AUTH_USER}:${TELEGRAM_BOT_BASIC_AUTH_PASSWORD}" \
  --header "Content-Type: application/json" \
  --data '{"result":"rejected","note":"Please revise the estimate."}'
```

## Successful responses

The endpoint returns HTTP `201 Created`.

### Approved

```json
{
  "result": "approved",
  "repair_order_id": "22222222-2222-4222-8222-222222222222",
  "status_id": "44444444-4444-4444-8444-444444444444"
}
```

Approval keeps the repair order in its current approval-required status and releases the pending
lock so staff can continue working.

### Rejected

```json
{
  "result": "rejected",
  "repair_order_id": "22222222-2222-4222-8222-222222222222",
  "status_id": "33333333-3333-4333-8333-333333333333"
}
```

For a rejection, `status_id` is the previous status to which the repair order was returned.
The backend also:

- stores the trimmed rejection note;
- moves the repair order to the top of its previous status queue;
- creates an inbound customer support comment containing the rejection note;
- records repair-order history;
- notifies assigned staff, or the branch when nobody is assigned;
- invalidates repair-order caches.

## Pending-approval staff lock

When the approval state is `pending`, staff requests that mutate the repair order are rejected with
HTTP `400` and location `repair_order_approval_required`.

The lock covers the main repair-order update and related mutation surfaces, including:

- status changes and queue sorting;
- deletion, branch transfer, taking, and restoring;
- customer, device, problem, and final-problem workflow changes;
- admin assignment;
- pickup, delivery, and rental-phone changes;
- attachment creation/deletion;
- payment registration;
- service-form and warranty-agreement generation.

### Allowed during pending approval

Staff may update only the repair-order description through:

```http
PATCH /api/v1/repair-orders/:repair_order_id
Content-Type: application/json

{
  "description": "Additional customer context."
}
```

The request body must contain only `description`. A mixed body such as `description` plus
`priority`, `status_id`, or any other field is rejected.

All repair-order comment creation, editing, deletion, and read-state endpoints remain available
while approval is pending. A permitted description-only update does not trigger repair-worker
auto-assignment or warranty auto-generation.

## Error responses

Errors use the standard backend structure:

```json
{
  "statusCode": 400,
  "message": "Repair order is not awaiting customer approval",
  "error": "BadRequestException",
  "location": "telegram_initial_problems_approval_not_pending",
  "timestamp": "2026-07-15T06:00:00.000Z",
  "path": "/api/v1/telegram/repair-orders/22222222-2222-4222-8222-222222222222/approval"
}
```

| HTTP | Location                                             | Meaning                                                              |
| ---- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| 400  | `result`                                             | `result` is missing or is not `approved`/`rejected`.                 |
| 400  | `note`                                               | A rejection note is missing, blank, or longer than 4,000 characters. |
| 400  | `repair_order_id`                                    | The repair order is not linked to a customer.                        |
| 400  | `telegram_initial_problems_approval_not_pending`     | The repair order is not currently awaiting approval.                 |
| 400  | `telegram_initial_problems_approval_previous_status` | Rejection cannot restore a valid previous status.                    |
| 401  | `basic_auth_header` / `basic_auth_format`            | Basic Auth is missing or malformed.                                  |
| 401  | `basic_auth_credentials` / `basic_auth_config`       | Credentials are invalid or backend credentials are not configured.   |
| 404  | `repair_order_id`                                    | No open repair order exists with the supplied UUID.                  |

An invalid UUID is rejected with HTTP `400` by parameter validation before approval processing.

## Retry and concurrency behavior

The decision is processed inside a database transaction and the repair-order row is locked while
the decision is applied. This prevents simultaneous approval and rejection requests from both
succeeding.

The endpoint is intentionally not idempotent. After a successful decision, the order is no longer
`pending`; repeating the same request returns HTTP `400` with
`telegram_initial_problems_approval_not_pending`. The Telegram Bot should treat the first `201`
response as final and refresh the repair-order detail before offering the action again.
