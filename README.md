# Basic Scrum Board

A collaborative, single-page Next.js scrum board with a kawaii doomsday-prepper
mascot. Create tickets, edit descriptions, move work through **To Do**, **In
Progress**, and **Done**, and delete finished work. Your successful changes appear
immediately; other collaborators' changes are fetched every 30 seconds.

## Run locally

Requires Node.js 20.9+ and npm.

```sh
npm ci
cp .env.example .env.local
# Set BLOB_READ_WRITE_TOKEN in .env.local (see below).
npm run dev
```

Open http://localhost:3000. Without a storage token the UI still loads, but API
requests return a helpful 503 error; no data is silently stored in memory or lost
on restart.

### Vercel Blob and deployment

1. Import this repository into Vercel as a Next.js project.
2. Create a **private** Vercel Blob store under Storage and connect it to the
   project. Set its `BLOB_READ_WRITE_TOKEN` for the desired environments.
3. For local development, copy that token into `.env.local`. Never prefix it with
   `NEXT_PUBLIC_` or commit it. Use a separate store for development/preview if
   those environments should not share production tickets.
4. Deploy. Vercel runs `npm run build`; no persistent local filesystem is needed.

The server stores the board in `scrum-board/board.json`. Reads bypass Blob's CDN
cache. Conditional ETag writes retry concurrent changes, including first-board
creation, so simultaneous creates get distinct incremental IDs. IDs start at 1
and are never reused after deletion. Stale ticket edits return 409 rather than
overwriting someone else's work. This small-board design rewrites one JSON
document per change (maximum 5,000 active tickets); it is not intended as a
high-throughput issue tracker. Polling and writes incur Blob usage charges.

## API

Click **api-spec** in the page footer for the interactive documentation popup.
Responses and errors use JSON (except successful deletion); responses are not
cached.

| Method | Endpoint | Result |
| --- | --- | --- |
| GET | `/api/tickets` | `{ "tickets": [...] }` |
| POST | `/api/tickets` | Create `{ "title": "...", "description": "..." }`; returns 201 `{ "ticket": ... }` |
| GET | `/api/tickets/1` | Returns `{ "ticket": ... }` or 404 |
| PATCH | `/api/tickets/1` | Update title, description and/or status; include the current `updatedAt`; returns `{ "ticket": ... }` |
| DELETE | `/api/tickets/1` | Returns 204, or 404 if absent |

POST/PATCH require `Content-Type: application/json`. Titles are trimmed and must
contain 1–160 characters; descriptions are optional on creation and limited to
10,000 characters. Status is `todo`, `in-progress`, or `done`. Each ticket has
`id`, `title`, `description`, `status`, `createdAt`, and `updatedAt` (UTC ISO dates).
Unknown fields are rejected; request bodies are limited to 64 KiB.

```sh
curl -X POST http://localhost:3000/api/tickets \
  -H 'Content-Type: application/json' \
  -d '{"title":"Pack the emergency kit","description":"Snacks first."}'
```

Errors have the shape `{ "error": "message" }`: 400 invalid input, 403 cross-origin
write, 404 missing ticket, 409 stale edit/contention/capacity, 413 oversized body,
415 unsupported media type, and 503 unavailable storage.

## Security and accessibility

This is an intentionally **shared, unauthenticated board**: anyone who can access
the deployment can read, create, edit, and delete tickets through the page or API.
Do not store secrets or personal data. Use Vercel Deployment Protection (including
API routes) or add authentication and durable rate limiting before exposing
sensitive work or a publicly advertised deployment. Origin checks prevent
cross-site browser writes, not direct API clients or abuse.

Blob credentials stay on the server; the Blob itself is private. User content is
rendered as text, not HTML. Inputs are validated server-side and storage failures
do not disclose credentials. Dialogs use native modal focus trapping and Escape
handling; forms have labels and keyboard-accessible controls.

## Checks

```sh
npm run lint
npm run build
npm start
```

There was no existing automated test suite in the repository. For a smoke test
with a connected store, open two browser windows, create a ticket in one, verify
it appears in the other within 30 seconds, edit its status, reload to verify
persistence, then delete it. Edit the same ticket in both windows to verify the
second stale save receives a conflict.

The Zod override in `package.json` patches an advisory in a transitive Vercel SDK
dependency; retain it until that dependency updates its pinned version.
