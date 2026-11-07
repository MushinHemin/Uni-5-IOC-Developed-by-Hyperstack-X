# Uni 5 Sonoma API and Socket Notes

These notes describe the current Uni 5.5.9 Web implementation, including local Phase 04 and Maintenance Batch 02 changes. The maintained platform is Web/PWA. Android/Capacitor is an unmaintained historical project, not a supported release target; its files are retained, with no build or device-validation claim.

## Authentication

- `login`: Socket event with `account` and `password`. Returns login success/error through existing auth events.
- `register`: Socket event with `account`, `password`, and `username`. Creates a user and returns auth state.
- `authSuccess`: returns the public user object and an `apiToken` bound to the current Socket session (no independent fixed TTL).
- `logout`: revokes the Socket-bound API Token, leaves rooms and clears subscriptions; the server responds with `loggedOut`. Account switching uses logout/local reset followed by `login` or `register`; there is no `switch user` server event.
- HTTP helper endpoints that require login accept `Authorization: Bearer <apiToken>`.
- Disconnect, logout, account switching and password reset revoke old credentials. Reconnection requires explicit login; transport connection alone does not authenticate the user.

## Users and Profiles

- `get lobby`: returns rooms and online/private user list data.
- `get user profile`: loads public profile fields such as display name, username, avatar, bio, banner, and Star count.
- `update profile details`: updates the current user's bio via `{bio}`.
- `profile banner upload`: uploads the current user's profile banner.
- `star user`: adds a daily Star with server-side validation.

## Chat

- `join room`: enters a group room and returns recent history.
- `leave room`: leaves the active room.
- `open private chat`: accepts the target user ID and returns `room joined`.
- `get room history`: accepts `{roomId, limit, before:{timestamp,id}}` (optional cursor), returns `room history` and an acknowledgement containing messages and paging metadata.
- `chat message`: sends text messages.
- `chat image`: sends image messages.
- `chat voice`: sends voice messages.
- `chat sticker`: sends sticker messages.
- `recall message`: recalls a message when allowed by server rules.
- `message reaction`: toggles one allowed Reaction for a visible message.
- `reaction:update` / `reaction:updated`: server responses containing `messageId` and viewer-aware Reaction summaries.
- `mark room read`: accepts `{roomId, cursor:{id,timestamp}}`. The server validates identity, active room, membership and the matching stored message, then advances the read cursor monotonically. A room ID alone is rejected.
- `typing`: emits typing state.
- `latency:ping` / `latency:pong`: lightweight round-trip latency probe.
- `unread:update`: emits notification and chat unread counts.

## Notifications and Discovery

- `get notifications`: loads notification-center items for the current user.
- `notifications`: returns notification items and unread count.
- `notification:new`: inserts or updates a notification by ID. An aggregated update retains its ID, advances `createdAt`, and resets read state; clients replace newer content without duplicating the row.
- New notification `metadata.eventType` identifies `forum_comment`, `forum_reply`, `post_like`, `comment_like`, or `message_reaction`. Existing `type` values and historical rows remain valid; legacy classification uses structural metadata/relationships or machine dedupe keys, never titles or display names.
- `mark notification read`: marks one notification as read.
- `mark all notifications read`: marks all current-user notifications as read.
- `search`: searches allowed Uni surfaces using `q`, `scope`, `limit`, and `offset`.
- `search results`: returns grouped discovery results.
- `GET /api/notifications`: HTTP helper for notification-center data.
- `GET /api/notifications/unread-count`: HTTP helper for notification and chat unread counts.
- `POST /api/notifications/:id/read`: marks one notification read.
- `POST /api/notifications/read-all`: marks all notifications read.
- `GET /api/me/notification-preferences`: returns the current user's configurable notification preferences. Missing rows default to enabled.
- `POST /api/me/notification-preferences`: updates one whitelisted configurable preference for the current user. System and safety notifications remain always on.
- `GET /api/search?q=&scope=`: HTTP helper for global search.
- `GET /api/messages/:messageId/reactions`: HTTP helper for Reaction summaries.
- `POST /api/messages/:messageId/reaction`: HTTP helper to toggle a Reaction.
- Configurable notification preference keys currently include `forum_comment`, `forum_reply`, `post_like`, `comment_like`, `star_received`, `sticker_review`, and `creator_result`.
- Always-on notification categories include system announcements, account restrictions, and safety/report processing notices.

## Community Workspace

- `GET /api/me/community-workspace`: returns current-user overview counts, recent posts, recent comments, recent replies, recent favorites, and unread notification count.
- `GET /api/me/posts?sort=latest|updated`: returns only the current user's forum posts. It includes safe text summaries and interaction counts.
- `GET /api/me/comments`: returns only the current user's root comments with their target post title and floor labels when available.
- `GET /api/me/replies`: returns only the current user's replies with target post information and reply floor labels when available.
- `GET /api/me/favorites`: returns only posts favorited by the current user. If a target post is unavailable, the API returns a safe unavailable item instead of leaking content.
- Local draft management is a front-end `localStorage` behavior, not a server API. Drafts are filtered by the current user identity and can be continued or deleted from the Community Workspace.
- The workspace does not expose other users' private notification state, local drafts, or admin review information.

## Forum

- `get forum posts`: retrieves posts with optional `sort` and `filter` payload values. Valid sorts are `latest`, `updated`, `comments`, `likes`, and `favorites`. Valid filters are `all`, `mine`, `favorites`, `has_images`, and `edited`.
- `GET /api/forum/posts?sort=&filter=&limit=&offset=`: HTTP helper for the same forum list behavior. Sort/filter values are server-side whitelisted and SQL is parameterized.
- `get forum post`: retrieves a post detail and comments.
- `upload post image`: accepts `{base64: ticket, draftToken}` after HTTP upload. The validated image is stored under `/uploads/post-images/` and returned through `post image uploaded`. Small legacy data URLs still pass the same validation; large files must use HTTP.
- `create forum post`: creates a post with title, plain-text content, and optional sanitized `contentHtml`.
- `update forum post`: edits a post when the current user is the author or an admin. Banned users are rejected server-side. The server re-sanitizes `contentHtml`, updates `content_text`, `content_format`, `updated_at`, and `edited_at`.
- `create forum comment`: creates a root comment or a one-level reply when `parentCommentId` is provided.
- `toggle post like`: toggles the current user's like for one post.
- `toggle post favorite`: toggles the current user's favorite state for one post.
- `toggle comment like`: toggles the current user's like for one comment or reply.
- `forum post interaction`: returns updated post interaction state after like/favorite changes.
- `forum comment interaction`: returns updated comment interaction state after comment-like changes.
- `delete forum post` / `delete forum comment`: existing moderation/owner flows.
- `report forum post`: creates a report for admin review.
- Forum post payloads include `content`, `contentHtml`, `contentText`, `contentFormat`, `likeCount`, `favoriteCount`, `likedByMe`, and `favoritedByMe`.
- Edited forum post payloads include `updatedAt`, `editedAt`, and `isEdited`.
- Forum comment payloads include `parentCommentId`, `floorNumber`, `replyNumber`, `floorLabel`, `likeCount`, and `likedByMe`.
- Rich text is sanitized server-side with an allowlist for text formatting, links, lists, quotes, code, and uploaded post images. Dangerous tags, event attributes, unsafe protocols, control-character protocol tricks, SVG/math/script/style content, and arbitrary style injection are stripped.
- Post image uploads may include a front-end `draftToken`; published or edited posts bind only referenced image URLs to the post. Removed images are unbound rather than immediately deleted.
- Forum drafts are a front-end `localStorage` behavior, not a server API. Draft keys include Uni, mode, post id when editing, and current user identity to avoid cross-user draft reuse.
- Like/favorite/comment-like/reply actions are guarded in the client with pending states and remain validated server-side for login and banned-user restrictions.
- Global search uses safe plain-text post content (`content_text`) and comment text rather than raw rich HTML.
- Replies and selected forum engagement events feed the notification center without notifying the actor about their own action.
- Forum sorting and private filters (`mine`, `favorites`) require login. Invalid sort/filter values receive controlled errors; omitted values use defaults.
- User profile community summaries are served through `GET /api/users/:id/community-summary`, returning public counts and recent public posts. The viewed user's favorites count is only included for self.

## Bulletins

- `get bulletins`: loads the current user's mailbox.
- `mark bulletin read`: marks one bulletin as read.
- `mark all bulletins read`: marks all mailbox items as read.
- `admin publish bulletin`: admin-only bulletin publishing.
- System announcements are also mirrored into the notification center.

## Stickers

- `get stickers`: loads official, personal, creator, and submission data.
- `upload sticker`: uploads a personal sticker.
- `delete sticker`: deletes a personal sticker with server ownership checks.
- `apply sticker creator`: sends a creator application.
- `submit official sticker`: creator-only official sticker submission.

## Admin

- `admin get dashboard`: loads admin dashboard data.
- `admin decide rename`: reviews display-name requests with `{requestId, status: "approved"|"rejected", note}`.
- `admin handle report`: accepts `{reportId, action, note}`; actions include `view`, `delete_post`, `ban_user`, `delete_and_ban`, and dismissal.
- `admin decide sticker creator`: approves or rejects creator applications with `{requestId, status: "approved"|"rejected", note}`.
- `admin decide sticker submission`: accepts `{stickerId, action: "approve"|"reject"|"remove", note}` for official sticker submissions.
- `admin get dashboard`: includes a maintenance section with current version, Node environment, SQLite/table status, weak-admin-password risk state, and post-image storage/orphan statistics.
- `admin cleanup post images`: admin-only maintenance that rechecks references and quarantines eligible unbound images after a 24-hour grace period. It retains recovery metadata and does not permanently delete files.
- Admin permission is enforced server-side; clients must never rely on UI hiding alone.

## Media transport

- `POST /api/media`: authenticated raw binary body, `Content-Type` and `X-Uni-Media-Event` headers; returns a 120-second session/purpose/room-bound ticket. Pass the ticket as the existing event's `base64` field. Chat retries retain `clientMessageId`.
- Image/banner/post maximum: 5 MiB; avatar/sticker: 2 MiB; voice: 3 MiB. At most two concurrent uploads/decodes; errors are explicit. The Socket inbound limit remains bounded; do not send large Base64 payloads directly.
- See [Phase 04 protocol and resource limits](COMMUNICATION-5.5.9.md) for image decoding, audio codecs, cancellation and session revocation.

## App Safety Notes

- Do not cache private Socket.IO payloads or API responses in a service worker.
- Do not store passwords, admin secrets, or private user data in `localStorage`.
- The current web client stores UI preferences such as theme, sound, and glass intensity locally.
- Ngrok or production origins should be configured through `ALLOWED_ORIGINS` in local environment files, never committed.
