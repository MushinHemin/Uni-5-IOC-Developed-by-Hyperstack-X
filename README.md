# Uni 5

Uni 5 is a lightweight realtime chat app with account login, group chat, private chat, admin tools, message recall, image paste/upload, voice messages, and a glass-style responsive web UI.

## Features

- Account registration and login
- Password storage with scrypt hash and salt
- Realtime chat powered by Socket.IO
- Default public group: UniIOC World Channel
- User-created groups with admin-controlled creation code
- Private chat and private message notifications
- Message recall within the configured recall window
- Text, image, pasted image, and voice messages
- Quote, read-aloud, and recall actions from a message context menu
- Admin dashboard for user, room, and message management
- SQLite persistence with JSON compatibility helpers
- macOS/iOS-inspired glass UI, rounded controls, and spatial page transitions

## Tech Stack

- Node.js
- Express
- Socket.IO
- SQLite via Node's built-in `node:sqlite`
- Vanilla HTML/CSS/JavaScript
- Capacitor project files for future mobile packaging

## Requirements

- Node.js with `node:sqlite` support
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
ADMIN_ACCOUNT=admin
ADMIN_PASSWORD=replace-with-a-strong-password
ADMIN_USERNAME=Administrator
```

Notes:

- `.env` is ignored by Git and must not be committed.
- Change the admin password before sharing or deploying the app.
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
