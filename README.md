# Uni 5

Uni 5 is a lightweight realtime chat and community app with account login, group chat, private chat, forum posts, admin tools, message recall, image paste/upload, voice messages, and a glass-style responsive web UI.

Current release: **Uni 5.4.3 Identity & Bulletin Update**

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
- Uni 5.4.1: personalization controls, compact presence status, latency monitoring, forum persistence hardening, CORS configuration, and stability cleanup

## Release Notes

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
