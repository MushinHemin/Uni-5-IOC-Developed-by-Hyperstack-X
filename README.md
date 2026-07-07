# Uni 5 Sonoma

Uni 5 Sonoma is a lightweight realtime chat and community app with account login, group chat, private chat, forum posts, admin tools, message recall, image paste/upload, voice messages, and a glass-style responsive web UI.

Current release: **Sonoma 5.5.5 Engagement & Discovery Update**

## Features

- Account registration and login
- Password storage with scrypt hash and salt
- Realtime chat powered by Socket.IO
- Default public group: UniIOC World Channel
- User-created groups with admin-controlled creation code
- Private chat and private message notifications
- Forum MVP with posts, post detail pages, and realtime comments
- Display-name personalization with weekly rename limits and admin approval
- Bulletin mailbox with unread badges, version notices, admin announcements, and rename status messages
- Unified notification center for chat, forum, profile, Star, report, sticker, and announcement activity
- Global search across users, forum content, accessible chat history, announcements, and stickers
- Chat unread counters and per-room read state
- Message Reactions with server-side visibility and banned-user checks
- Sonoma user profiles with bio, profile banner, contact actions, and daily Stars
- Forum report workflow, admin report review center, and basic community bans
- Sonoma sticker system with official stickers, personal sticker uploads, sticker messages, creator applications, and admin review
- Message recall within the configured recall window
- Text, image, pasted image, and voice messages
- Quote, read-aloud, and recall actions from a message context menu
- Admin dashboard for user, room, and message management
- SQLite persistence with JSON compatibility helpers
- macOS/iOS-inspired glass UI, rounded controls, and spatial page transitions
- Uni 5.1.0: smoother GPU-friendly animations, systemized frosted glass styling, and persistent light/dark mode
- Uni 5.2.0: user avatar uploads, light/dark/system theme strategy, and optional message notification sound
- Uni 5.3.0: forum posts, post list/detail views, and realtime comments
- Uni 5.4.0: redesigned post-login home hub, clearer Chat / Forum module navigation, and refined module UI hierarchy
- Uni 5.4.3: display-name identity layer, rename approval workflow, bulletin mailbox, admin announcements, and forum polish
- Sonoma 5.4.5: user profile pages, profile banners, bio editing, daily Stars, and user list sorting
- Sonoma 5.4.6: community safety tools, forum reports, admin review actions, bans, and stability fixes
- Sonoma 5.5.0: official/personal stickers, sticker messages, creator applications, and official sticker review
- Sonoma 5.5.1: sticker panel polish, mobile layout reliability, upload/review feedback, and safer sticker history fallbacks
- Sonoma 5.5.3: PWA foundation, mobile app-style layout, bottom navigation, and API / Socket documentation for Uni 6 planning
- Sonoma 5.5.5: notification center, chat unread state, global discovery search, and message Reactions
- Uni 5.4.1: personalization controls, compact presence status, latency monitoring, forum persistence hardening, CORS configuration, and stability cleanup

## PWA and Native App Preparation

- The web app includes a lightweight PWA manifest at `/manifest.json` for standalone mobile launch experiments.
- Uni intentionally does not register an aggressive service worker in 5.5.3, so private chat/community data and API responses are not cached offline.
- Mobile layouts include safe-area aware spacing and a narrow-screen bottom navigation for Chat, Forum, Notifications, and My.
- Current integration notes for future Uni 6 Nordkapp native clients live in [docs/API.md](docs/API.md).
- Authentication is still based on the current web Socket.IO/session flow; a dedicated token flow should be evaluated before a native production app.

## Release Notes

### Sonoma 5.5.5 Engagement & Discovery Update

Added:

- Added a Sonoma-style notification center for chat messages, forum comments, Stars, report decisions, account restrictions, sticker review updates, and system announcements
- Added persistent unread state for chats with mobile and desktop unread badges
- Added global search across users, forum posts/comments, accessible chat messages, announcements, and stickers
- Added lightweight message Reactions with emoji summary pills and server-side permission checks
- Added a 5.5.5 system announcement for the bulletin mailbox

Improved:

- Connected notification badges to live Socket.IO updates and read-all/read-one actions
- Improved room read-state sync when entering chats, receiving messages, scrolling to the bottom, or opening the new-message button
- Updated API / Socket documentation for notification, unread, search, and Reaction events
- Preserved the Sonoma liquid glass UI style across discovery, notification, and engagement surfaces

### Sonoma 5.5.3 App Foundation Update

Added:

- Added PWA manifest metadata for Uni 5 Sonoma with standalone display and a local SVG app icon
- Added mobile-only Sonoma glass bottom navigation for Chat, Forum, Bulletins, and My
- Added a lightweight Sonoma launch state for mobile/PWA-style entry
- Added `docs/API.md` with current Socket.IO/API notes for future Uni 6 Nordkapp native app planning

Improved:

- Improved mobile app-style layout spacing, safe-area handling, and touch-friendly navigation
- Improved mobile chat spacing so the bottom nav does not cover the input composer
- Improved mobile modal behavior with internal scrolling for settings, profiles, reports, bulletins, and avatar crop flows
- Improved mobile forum, admin, sticker, and profile surfaces with safer overflow handling
- Preserved the Sonoma liquid glass UI style without adding heavy offline caching or service worker behavior

### Sonoma 5.5.1 Sticker Polish & Reliability Update

Improved:

- Optimized the sticker panel open/close behavior, tab highlighting, empty states, and Sonoma glass styling
- Improved mobile sticker layout so the panel, grid, tabs, upload area, and sticker messages stay readable on small screens
- Added clearer upload, delete, creator application, and official submission feedback states
- Improved admin review confirmations for sticker creator applications and official sticker submissions
- Tightened admin-side status checks for approving, rejecting, and removing official sticker submissions

Fixed:

- Added safe placeholder UI when historical sticker images are missing or unavailable
- Hardened sticker message rendering so old text messages and missing sticker references do not break chat history
- Kept banned-user sticker restrictions and admin permission checks enforced on the server
- Preserved the Sonoma liquid glass UI style across sticker panel, sticker messages, and admin review surfaces

### Sonoma 5.5.0 Sticker System Update

Added:

- Added official sticker packs visible to all users
- Added personal sticker uploads, sending, and deletion
- Added persistent sticker messages in chat with Sonoma-style image bubbles
- Added sticker creator applications and creator status tracking
- Added creator-submitted official sticker review workflow
- Added admin review modules for sticker creators and official sticker submissions

Improved:

- Sticker panel uses Uni Sonoma liquid glass styling, rounded cards, soft shadows, and mobile-safe layout
- Banned users are blocked server-side from uploading, sending, applying, or submitting stickers
- Official, personal, and creator sticker data persists in SQLite and stays compatible with old text messages

### Sonoma 5.4.6 Community Safety & Stability Update

Added:

- Added forum post reporting with Sonoma-style report dialog
- Added SQLite-backed report persistence and duplicate-report protection
- Added admin report center with view, dismiss, delete post, ban user, and combined moderation actions
- Added basic community ban fields and enforcement for posting, commenting, Stars, reports, and profile edits

Improved:

- Hardened Star and community actions with server-side permission checks
- Improved profile fallback handling for empty bio and missing banner images
- Refined user list sorting and Star badge consistency
- Preserved the Sonoma liquid glass UI style across new safety surfaces

Fixed:

- Fixed community action bypasses for banned accounts
- Fixed report and moderation status updates across admin and forum views

### Sonoma 5.4.5 Profile & Star Update

Added:

- Added Sonoma-style user profile pages opened from user avatars
- Added profile bio editing and profile banner uploads in Account & Settings
- Added contact actions with private chat entry and voice-call placeholder UI
- Added daily user Stars with server-side SQLite enforcement
- Added user list sorting by display name or Star count

Improved:

- User profile, Star badges, banner previews, and sorting controls reuse Uni's liquid glass UI language
- New profile surfaces support light/dark themes and liquid glass intensity settings
- Online users, lobby users, forum posts, comments, and chat avatars can open user profiles where available

### Uni 5.4.3 Identity & Bulletin Update

Added:

- Added stable display-name identity separate from login accounts
- Added weekly rename limits with automatic approval for free changes
- Added admin approval workflow for rename requests beyond the free window
- Added bulletin mailbox with unread badges and targeted system messages
- Added admin global announcement publishing
- Added forum post/comment deletion controls with server-side permission checks

Improved:

- Forum cards and details now use display names consistently
- Chat, private chat, online lists, settings, and admin views share the same display-name logic
- Rename decisions now notify users through the bulletin mailbox
- Default avatar fallback continues to use the user's display initial

### Uni 5.4.1 Personalization & Presence Update

Added:

- Added unified Account & Settings hub
- Added liquid glass intensity customization
- Added real-time latency monitor
- Added compact connection status card

Improved:

- Merged account and settings into one primary home module
- Simplified the home dashboard layout
- Refined module toolbar actions
- Improved visual personalization controls

Fixed:

- Cleaned temporary `.gitignore` scratch entries
- Improved CORS configuration with `ALLOWED_ORIGINS`
- Verified forum post/comment persistence

### Uni 5.4.1 Stability & Forum Persistence Fix

Fixed:

- Verified and repaired forum post/comment SQLite persistence
- Added stricter forum input validation
- Cleaned temporary `.gitignore` entries
- Hardened Socket.IO CORS configuration
- Improved module navigation edge cases

### Uni 5.4.0 Experience Architecture Update

Added:

- Post-login home hub with primary Chat and Forum module cards
- Secondary Account and Settings entry cards on the home hub
- Clear return-to-home controls in Chat and Forum modules

Improved:

- Chat and Forum are now treated as first-level product modules instead of toolbar items
- Module toolbars are cleaner and more focused
- Forum layout, post list cards, and detail reading area have stronger visual hierarchy
- Home, Chat, Forum, Settings, and Admin continue to share the same glass, rounded, dark-mode-ready design language

### Uni 5.3.0 Forum Update

Added:

- Forum page entry for logged-in users
- Post creation with title, content, author identity, avatar, and creation time
- Reverse-chronological post list with glass-style cards
- Post detail view with full content and author information
- Realtime comment creation and live comment append

Improved:

- SQLite persistence now includes `posts` and `comments` tables
- Forum UI reuses the existing avatar, theme, glass, and spatial page layer systems

### Uni 5.2.0 Profile & Comfort Update

Added:

- User avatar upload, preview, update, and reset-to-default support
- Light / dark / follow-system appearance strategy
- Optional message notification sound with local preference storage

Improved:

- User identity display across chat, online lists, settings, and admin users
- Theme preference persistence and system theme syncing
- Comfort settings inside a glass-style settings panel

Fixes:

- System settings now use a dedicated gear entry instead of the theme shortcut button
- Avatar upload includes a lightweight crop step before upload
- Chat message avatars render beside bubbles in both group and private chats
- Default avatars use a consistent blue background with the user's initial

## Tech Stack

- Node.js
- Express
- Socket.IO
- SQLite via Node's built-in `node:sqlite`
- Vanilla HTML/CSS/JavaScript
- Capacitor project files for future mobile packaging

## Requirements

- Node.js 22+ with `node:sqlite` support
- npm

## Installation

```bash
npm install
```

## Configuration

Copy the example environment file and edit the values:

```bash
cp .env.example .env
```

Available environment variables:

```bash
PORT=3200
ALLOWED_ORIGINS=http://localhost:3200,http://127.0.0.1:3200
ADMIN_ACCOUNT=admin
ADMIN_PASSWORD=replace-with-a-strong-password
ADMIN_USERNAME=Administrator
```

Notes:

- `.env` is ignored by Git and must not be committed.
- Change the admin password before sharing or deploying the app.
- `ALLOWED_ORIGINS` is a comma-separated Socket.IO CORS allowlist.
- When testing with ngrok, add the current ngrok URL to `ALLOWED_ORIGINS` locally, but do not commit real tunnel URLs.
- Do not commit real ngrok URLs, API keys, passwords, user data, chat history, or SQLite database files.

## Running

```bash
npm start
```

Then open:

```text
http://127.0.0.1:3200/
```

If you use a tunnel such as ngrok for testing with friends, start the tunnel separately and do not commit the generated public URL.

## Data Files

Runtime data is stored locally and ignored by Git:

- `users.json`
- `chat-history.json`
- `beluga-chat.sqlite`
- `beluga-chat.sqlite-*`
- `uploads/`

Empty templates are provided:

- `users.example.json`
- `chat-history.example.json`

## Security Notes

- Passwords are not stored as plain text.
- Admin access is checked on the server, not only in the UI.
- Treat this project as a personal / small-group chat app unless you add production hardening such as HTTPS termination, hosted database backups, stronger rate limiting, and deployment monitoring.

## Android / Capacitor Notes

Capacitor files are included for future mobile packaging. The committed `capacitor.config.json` does not include a live tunnel URL. Configure mobile server targets locally when needed, and keep personal tunnel URLs out of Git.
