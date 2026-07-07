# Uni 5 Sonoma API and Socket Notes

These notes document the current Web implementation for future Uni 6 Nordkapp native app planning. Uni 5 currently relies primarily on Socket.IO events and the existing web session model; token-based native authentication is a future standardization item.

## Authentication

- `login`: Socket event with `account` and `password`. Returns login success/error through existing auth events.
- `register`: Socket event with `account`, `password`, and `username`. Creates a user and returns auth state.
- `authSuccess`: returns the public user object and a short-lived `apiToken` for the current web session.
- `switch user` / local client reset: the web client clears in-memory user state and returns to the auth view.
- HTTP helper endpoints that require login accept `Authorization: Bearer <apiToken>`.
- Current session is still primarily Socket.IO-user state; future native clients should evaluate a dedicated long-lived token flow.

## Users and Profiles

- `get lobby`: returns rooms and online/private user list data.
- `get user profile`: loads public profile fields such as display name, username, avatar, bio, banner, and Star count.
- `update profile bio`: updates the current user's bio.
- `upload profile banner`: uploads the current user's profile banner.
- `star user`: adds a daily Star with server-side validation.

## Chat

- `join room`: enters a group room and returns recent history.
- `leave room`: leaves the active room.
- `chat message`: sends text messages.
- `chat image`: sends image messages.
- `chat voice`: sends voice messages.
- `chat sticker`: sends sticker messages.
- `recall message`: recalls a message when allowed by server rules.
- `message reaction`: toggles one allowed Reaction for a visible message.
- `reaction:update` / `reaction:updated`: server responses containing `messageId` and viewer-aware Reaction summaries.
- `mark room read`: records read state for the current room and updates unread counters.
- `typing`: emits typing state.
- `latency:ping` / `latency:pong`: lightweight round-trip latency probe.
- `unread:update`: emits notification and chat unread counts.

## Notifications and Discovery

- `get notifications`: loads notification-center items for the current user.
- `notifications`: returns notification items and unread count.
- `notification:new`: live notification pushed to connected user sockets.
- `mark notification read`: marks one notification as read.
- `mark all notifications read`: marks all current-user notifications as read.
- `search`: searches allowed Uni surfaces using `q`, `scope`, `limit`, and `offset`.
- `search results`: returns grouped discovery results.
- `GET /api/notifications`: HTTP helper for notification-center data.
- `GET /api/notifications/unread-count`: HTTP helper for notification and chat unread counts.
- `POST /api/notifications/:id/read`: marks one notification read.
- `POST /api/notifications/read-all`: marks all notifications read.
- `GET /api/search?q=&scope=`: HTTP helper for global search.
- `GET /api/messages/:messageId/reactions`: HTTP helper for Reaction summaries.
- `POST /api/messages/:messageId/reaction`: HTTP helper to toggle a Reaction.

## Forum

- `get forum posts`: retrieves posts sorted by newest first.
- `get forum post`: retrieves a post detail and comments.
- `upload post image`: uploads a post-editor image from a data URL. Server validates image type and max size, stores it under `/uploads/post-images/`, and returns `post image uploaded`.
- `create forum post`: creates a post with title, plain-text content, and optional sanitized `contentHtml`.
- `create forum comment`: creates a root comment or a one-level reply when `parentCommentId` is provided.
- `toggle post like`: toggles the current user's like for one post.
- `toggle post favorite`: toggles the current user's favorite state for one post.
- `toggle comment like`: toggles the current user's like for one comment or reply.
- `forum post interaction`: returns updated post interaction state after like/favorite changes.
- `forum comment interaction`: returns updated comment interaction state after comment-like changes.
- `delete forum post` / `delete forum comment`: existing moderation/owner flows.
- `report forum post`: creates a report for admin review.
- Forum post payloads include `content`, `contentHtml`, `contentText`, `contentFormat`, `likeCount`, `favoriteCount`, `likedByMe`, and `favoritedByMe`.
- Forum comment payloads include `parentCommentId`, `floorNumber`, `replyNumber`, `floorLabel`, `likeCount`, and `likedByMe`.
- Rich text is sanitized server-side with an allowlist for text formatting, links, lists, quotes, code, and uploaded post images. Dangerous tags, event attributes, unsafe protocols, and arbitrary style injection are stripped.
- Global search uses safe plain-text post content (`content_text`) and comment text rather than raw rich HTML.
- Replies and selected forum engagement events feed the notification center without notifying the actor about their own action.

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

- `admin get data`: loads admin dashboard data.
- `admin approve rename` / `admin reject rename`: review display-name requests.
- `admin review report`: dismiss, delete, ban, or combined forum report actions.
- `admin review sticker creator`: approve or reject creator applications.
- `admin review sticker submission`: approve, reject, or remove official sticker submissions.
- Admin permission is enforced server-side; native clients should never rely on UI hiding alone.

## App Safety Notes

- Do not cache private Socket.IO payloads or API responses in a service worker.
- Do not store passwords, admin secrets, or private user data in `localStorage`.
- The current web client stores UI preferences such as theme, sound, and glass intensity locally.
- Ngrok or production origins should be configured through `ALLOWED_ORIGINS` in local environment files, never committed.
