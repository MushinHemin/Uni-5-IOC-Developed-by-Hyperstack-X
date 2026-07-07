# Uni 5 Sonoma API and Socket Notes

These notes document the current Web implementation for future Uni 6 Nordkapp native app planning. Uni 5 currently relies primarily on Socket.IO events and the existing web session model; token-based native authentication is a future standardization item.

## Authentication

- `login`: Socket event with `account` and `password`. Returns login success/error through existing auth events.
- `register`: Socket event with `account`, `password`, and `username`. Creates a user and returns auth state.
- `switch user` / local client reset: the web client clears in-memory user state and returns to the auth view.
- Current session is Socket.IO-user state, not a native token contract. Future native clients should evaluate a dedicated token flow.

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
- `typing`: emits typing state.
- `latency:ping` / `latency:pong`: lightweight round-trip latency probe.

## Forum

- `get forum posts`: retrieves posts sorted by newest first.
- `get forum post`: retrieves a post detail and comments.
- `create forum post`: creates a post with title and content validation.
- `create forum comment`: creates a comment for a post.
- `delete forum post` / `delete forum comment`: existing moderation/owner flows.
- `report forum post`: creates a report for admin review.

## Bulletins

- `get bulletins`: loads the current user's mailbox.
- `mark bulletin read`: marks one bulletin as read.
- `mark all bulletins read`: marks all mailbox items as read.
- `admin publish bulletin`: admin-only bulletin publishing.

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
