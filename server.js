const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

loadDotEnv();

const app = express();
const server = http.createServer(app);
const APP_PORT = process.env.PORT || 3000;
const DEFAULT_ALLOWED_ORIGINS = Array.from(new Set([
  'http://localhost:3200',
  'http://127.0.0.1:3200',
  `http://localhost:${APP_PORT}`,
  `http://127.0.0.1:${APP_PORT}`
]));
const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin not allowed by Uni 5 CORS policy'));
    }
  }
});

const DATA_FILE = path.join(__dirname, 'chat-history.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const DB_FILE = path.join(__dirname, 'beluga-chat.sqlite');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const AVATAR_UPLOAD_DIR = path.join(UPLOADS_DIR, 'avatars');
const BANNER_UPLOAD_DIR = path.join(UPLOADS_DIR, 'banners');
const STICKER_UPLOAD_DIR = path.join(UPLOADS_DIR, 'stickers');
const JSON_FILE_MODE = 0o600;
const MAX_MESSAGE_LENGTH = 1000;
const MAX_POST_TITLE_LENGTH = 80;
const MAX_POST_CONTENT_LENGTH = 3000;
const MAX_COMMENT_LENGTH = 1000;
const MAX_USERNAME_LENGTH = 20;
const MIN_DISPLAY_NAME_LENGTH = 2;
const MAX_DISPLAY_NAME_LENGTH = 20;
const RENAME_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const RENAME_FREE_LIMIT = 3;
const MAX_ACCOUNT_LENGTH = 24;
const MIN_PASSWORD_LENGTH = 6;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const MAX_BANNER_BYTES = 5 * 1024 * 1024;
const MAX_STICKER_BYTES = 2 * 1024 * 1024;
const MAX_PERSONAL_STICKERS = 50;
const MAX_VOICE_BYTES = 3 * 1024 * 1024;
const MAX_HISTORY_MESSAGES = 300;
const MAX_FORUM_POSTS = 120;
const TYPING_TIMEOUT_MS = 3000;
const AUTH_WINDOW_MS = 60 * 1000;
const AUTH_MAX_ATTEMPTS = 8;
const ADMIN_ACCOUNT = cleanEnv(process.env.ADMIN_ACCOUNT) || 'admin';
const ADMIN_PASSWORD = cleanEnv(process.env.ADMIN_PASSWORD) || 'change-me-admin-password';
const ADMIN_USERNAME = cleanEnv(process.env.ADMIN_USERNAME) || 'Administrator';
const DEFAULT_ROOM_ID = 'club-91';
const DEFAULT_ROOM_NAME = 'UniIOC World Channel';
const RECALL_WINDOW_MS = 2 * 60 * 1000;
const GROUP_CODE_WINDOW_MS = 10 * 60 * 1000;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const ALLOWED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_AUDIO_TYPES = new Set(['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav']);
const ANNOUNCEMENT_TYPES = new Set(['system', 'update', 'admin', 'rename', 'status']);
const ANNOUNCEMENT_PRIORITIES = new Set(['low', 'normal', 'high']);
const REPORT_REASONS = new Set(['spam', 'abuse', 'sexual', 'danger', 'other']);
const REPORT_STATUSES = new Set(['pending', 'dismissed', 'post_deleted', 'user_banned']);
const STICKER_TYPES = new Set(['official', 'personal', 'creator_submission']);
const STICKER_STATUSES = new Set(['active', 'pending', 'approved', 'rejected', 'removed']);
const CREATOR_REQUEST_STATUSES = new Set(['pending', 'approved', 'rejected']);
const IMAGE_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
};
let db;

warnIfDefaultAdminPassword();

function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const equalAt = trimmed.indexOf('=');
    if (equalAt === -1) return;
    const key = trimmed.slice(0, equalAt).trim();
    let value = trimmed.slice(equalAt + 1).trim();
    if (!key || process.env[key] !== undefined) return;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  });
}

function cleanEnv(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseAllowedOrigins(value) {
  const configured = cleanEnv(value)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return configured.length > 0 ? configured : DEFAULT_ALLOWED_ORIGINS;
}

function warnIfDefaultAdminPassword() {
  const configuredPassword = cleanEnv(process.env.ADMIN_PASSWORD);
  if (!configuredPassword || configuredPassword === 'change-me-admin-password' || configuredPassword === 'mushin') {
    console.warn('[Uni 5 security] ADMIN_PASSWORD is missing or weak. Set a strong ADMIN_PASSWORD in .env before sharing or deploying.');
  }
}

function atomicWriteJsonSync(filePath, value) {
  const dir = path.dirname(filePath);
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), { mode: JSON_FILE_MODE });
  fs.renameSync(tempPath, filePath);
}

async function atomicWriteJson(filePath, value) {
  const dir = path.dirname(filePath);
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`);
  await fs.promises.writeFile(tempPath, JSON.stringify(value, null, 2), { mode: JSON_FILE_MODE });
  await fs.promises.rename(tempPath, filePath);
}

function backupBadJson(filePath) {
  if (!fs.existsSync(filePath)) return;
  const backupPath = `${filePath}.bad-${Date.now()}`;
  try {
    fs.renameSync(filePath, backupPath);
    console.error(`已备份损坏数据文件: ${backupPath}`);
  } catch (error) {
    console.error(`备份损坏数据文件失败: ${error.message}`);
  }
}

function readJsonArray(filePath, label) {
  try {
    if (!fs.existsSync(filePath)) {
      atomicWriteJsonSync(filePath, []);
      return [];
    }

    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) {
      atomicWriteJsonSync(filePath, []);
      return [];
    }

    const data = JSON.parse(raw);
    if (!Array.isArray(data)) {
      backupBadJson(filePath);
      atomicWriteJsonSync(filePath, []);
      return [];
    }

    return data;
  } catch (error) {
    console.error(`读取${label}失败:`, error.message);
    backupBadJson(filePath);
    atomicWriteJsonSync(filePath, []);
    return [];
  }
}

function loadHistory() {
  const rows = db.prepare(`
    SELECT * FROM (
      SELECT * FROM messages ORDER BY created_at DESC LIMIT ?
    ) ORDER BY created_at ASC
  `).all(MAX_HISTORY_MESSAGES);
  if (rows.length > 0) return rows.map(rowToMessage).filter(Boolean);

  const history = trimHistory(readJsonArray(DATA_FILE, '聊天记录').map(normalizeMessage).filter(Boolean));
  history.forEach(upsertMessage);
  return history;
}

let saveQueue = Promise.resolve();
let userSaveQueue = Promise.resolve();

function loadUsers() {
  const rows = db.prepare('SELECT * FROM users ORDER BY created_at ASC').all();
  if (rows.length > 0) return rows.map(rowToUser).filter(Boolean);

  const migratedUsers = readJsonArray(USERS_FILE, '用户数据').map(normalizeUser).filter(Boolean);
  migratedUsers.forEach(upsertUser);
  return migratedUsers;
}

function loadRooms() {
  const rows = db.prepare('SELECT * FROM rooms ORDER BY created_at ASC').all();
  return rows.map(rowToRoom).filter(Boolean);
}

function saveHistory(messages) {
  try {
    trimHistory(messages).forEach(upsertMessage);
  } catch (error) {
    console.error('保存聊天记录失败:', error.message);
  }
}

function saveUsers() {
  try {
    users.forEach(upsertUser);
  } catch (error) {
    console.error('保存用户数据失败:', error.message);
  }
}

function cleanText(value, maxLength = MAX_MESSAGE_LENGTH) {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().slice(0, maxLength);
}

function cleanUsername(value) {
  return cleanText(value, MAX_USERNAME_LENGTH).replace(/\s+/g, ' ');
}

function cleanDisplayName(value) {
  const name = cleanText(value, MAX_DISPLAY_NAME_LENGTH)
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ');
  if (name.length < MIN_DISPLAY_NAME_LENGTH) return '';
  return name;
}

function cleanAccount(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, MAX_ACCOUNT_LENGTH);
}

function cleanRoomName(value) {
  return cleanText(value, 28).replace(/\s+/g, ' ');
}

function cleanRoomId(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 80);
}

function cleanForumId(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 80);
}

function cleanPostTitle(value) {
  return cleanText(value, MAX_POST_TITLE_LENGTH).replace(/\s+/g, ' ');
}

function cleanPostContent(value) {
  return cleanText(value, MAX_POST_CONTENT_LENGTH);
}

function cleanCommentContent(value) {
  return cleanText(value, MAX_COMMENT_LENGTH);
}

function cleanBio(value) {
  return cleanText(value, 200);
}

function cleanReportReason(value) {
  const reason = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return REPORT_REASONS.has(reason) ? reason : '';
}

function cleanReportDetails(value) {
  return cleanText(value, 200);
}

function cleanAdminNote(value) {
  return cleanText(value, 240);
}

function cleanStickerTitle(value) {
  return cleanText(value, 30).replace(/\s+/g, ' ');
}

function cleanStickerDescription(value) {
  return cleanText(value, 120);
}

function cleanCreatorReason(value) {
  return cleanText(value, 300);
}

function cleanCreatorPortfolio(value) {
  return cleanText(value, 300);
}

function cleanStickerStatus(value, fallback = 'pending') {
  const status = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return STICKER_STATUSES.has(status) ? status : fallback;
}

function makeAvatar(name) {
  return (cleanUsername(name) || '?').slice(0, 1).toUpperCase();
}

function displayNameOf(userOrName) {
  if (!userOrName) return '匿名';
  if (typeof userOrName === 'string') return cleanDisplayName(userOrName) || cleanUsername(userOrName) || '匿名';
  return cleanDisplayName(userOrName.displayName || userOrName.display_name || userOrName.username) || cleanUsername(userOrName.username) || '匿名';
}

function userById(userId) {
  return users.find((user) => user.id === userId) || null;
}

function cleanAvatar(value, fallbackName = '') {
  if (typeof value !== 'string') return makeAvatar(fallbackName);
  const avatar = value.trim();
  if (/^\/uploads\/avatars\/[a-zA-Z0-9_.-]+\.(jpg|png|webp)$/.test(avatar)) return avatar;
  return cleanText(avatar, 4) || makeAvatar(fallbackName);
}

function cleanProfileBanner(value) {
  if (typeof value !== 'string') return '';
  const banner = value.trim();
  if (/^\/uploads\/banners\/[a-zA-Z0-9_.-]+\.(jpg|png|webp|gif)$/.test(banner)) return banner;
  return '';
}

function isUploadedAvatar(value) {
  return typeof value === 'string' && value.startsWith('/uploads/avatars/');
}

function isUploadedProfileBanner(value) {
  return typeof value === 'string' && value.startsWith('/uploads/banners/');
}

function isUploadedSticker(value) {
  return typeof value === 'string' && value.startsWith('/uploads/stickers/');
}

function avatarFilePath(avatarUrl) {
  if (!isUploadedAvatar(avatarUrl)) return '';
  const fileName = path.basename(avatarUrl);
  return path.join(AVATAR_UPLOAD_DIR, fileName);
}

function bannerFilePath(bannerUrl) {
  if (!isUploadedProfileBanner(bannerUrl)) return '';
  const fileName = path.basename(bannerUrl);
  return path.join(BANNER_UPLOAD_DIR, fileName);
}

function stickerFilePath(stickerUrl) {
  if (!isUploadedSticker(stickerUrl)) return '';
  const fileName = path.basename(stickerUrl);
  return path.join(STICKER_UPLOAD_DIR, fileName);
}

function stickerSvgDataUri(label, fill, accent = '#ffffff') {
  const text = String(label || 'U').slice(0, 2).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="${fill}"/><stop offset="1" stop-color="#7dd3fc"/></linearGradient></defs><rect width="160" height="160" rx="42" fill="url(#g)"/><circle cx="116" cy="40" r="18" fill="${accent}" opacity=".36"/><text x="80" y="96" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="46" font-weight="800" fill="${accent}">${text}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const DEFAULT_OFFICIAL_STICKERS = [
  { id: 'official:sonoma-hi', title: 'Hi', description: 'Sonoma greeting', url: stickerSvgDataUri('Hi', '#3b82f6') },
  { id: 'official:sonoma-ok', title: 'OK', description: 'All good', url: stickerSvgDataUri('OK', '#10b981') },
  { id: 'official:sonoma-wow', title: 'Wow', description: 'Tiny sparkle', url: stickerSvgDataUri('✨', '#8b5cf6') },
  { id: 'official:sonoma-love', title: 'Love', description: 'Warm reply', url: stickerSvgDataUri('♡', '#fb7185') },
  { id: 'official:sonoma-lol', title: 'LOL', description: 'Light laugh', url: stickerSvgDataUri('哈', '#f59e0b') },
  { id: 'official:sonoma-uni', title: 'Uni', description: 'Uni Sonoma', url: stickerSvgDataUri('U5', '#0ea5e9') }
];

function isPublicStickerUrl(value) {
  if (typeof value !== 'string') return false;
  const url = value.trim();
  if (/^\/uploads\/stickers\/[a-zA-Z0-9_.-]+\.(jpg|jpeg|png|webp|gif)$/.test(url)) return true;
  return url.startsWith('data:image/svg+xml;utf8,');
}

function normalizeUser(user) {
  if (!user || typeof user !== 'object') return null;
  const account = cleanAccount(user.account);
  const username = cleanUsername(user.username) || account;
  const displayName = cleanDisplayName(user.displayName || user.display_name || username) || username;
  const passwordHash = typeof user.passwordHash === 'string' ? user.passwordHash : '';
  if (!user.id || !account || !passwordHash.includes(':')) return null;
  return {
    id: String(user.id),
    account,
    username,
    displayName,
    avatar: cleanAvatar(user.avatar, username),
    bio: cleanBio(user.bio),
    profileBanner: cleanProfileBanner(user.profileBanner || user.profile_banner),
    passwordHash,
    createdAt: Number.isNaN(Date.parse(user.createdAt)) ? new Date().toISOString() : user.createdAt,
    lastIp: typeof user.lastIp === 'string' ? user.lastIp : '',
    lastLoginAt: Number.isNaN(Date.parse(user.lastLoginAt)) ? '' : user.lastLoginAt,
    isBanned: Boolean(user.isBanned || user.is_banned),
    bannedAt: Number.isNaN(Date.parse(user.bannedAt || user.banned_at)) ? '' : (user.bannedAt || user.banned_at),
    bannedReason: cleanText(user.bannedReason || user.banned_reason, 240),
    isStickerCreator: Boolean(user.isStickerCreator || user.is_sticker_creator),
    stickerCreatorStatus: CREATOR_REQUEST_STATUSES.has(String(user.stickerCreatorStatus || user.sticker_creator_status || '').toLowerCase())
      ? String(user.stickerCreatorStatus || user.sticker_creator_status).toLowerCase()
      : ''
  };
}

function normalizeMessage(message) {
  if (!message || typeof message !== 'object') return null;

  const username = cleanUsername(message.username) || '匿名';
  const content = typeof message.content === 'string'
    ? message.content
    : typeof message.message === 'string'
      ? message.message
      : '';
  const type = ['image', 'voice', 'sticker', 'recalled'].includes(message.type) ? message.type : 'text';
  const timestamp = Number.isNaN(Date.parse(message.timestamp))
    ? new Date().toISOString()
    : message.timestamp;
  const recalled = Boolean(message.recalled);
  const roomId = cleanRoomId(message.roomId || message.room_id || DEFAULT_ROOM_ID) || DEFAULT_ROOM_ID;

  if (recalled) {
    return {
      id: message.id || crypto.randomUUID(),
      roomId,
      type: 'recalled',
      userId: message.userId || null,
      username,
      avatar: message.avatar || makeAvatar(username),
      content: '',
      stickerId: '',
      timestamp,
      recalled: true
    };
  }

  if (type === 'image') {
    if (!isValidImageData(content)) return null;
    return {
      id: message.id || crypto.randomUUID(),
      roomId,
      type,
      userId: message.userId || null,
      username,
      avatar: message.avatar || makeAvatar(username),
      content,
      stickerId: '',
      timestamp,
      recalled: false
    };
  }

  if (type === 'voice') {
    if (!isValidVoiceData(content)) return null;
    return {
      id: message.id || crypto.randomUUID(),
      roomId,
      type,
      userId: message.userId || null,
      username,
      avatar: message.avatar || makeAvatar(username),
      content,
      stickerId: '',
      duration: Number.isFinite(Number(message.duration)) ? Number(message.duration) : 0,
      timestamp,
      recalled: false
    };
  }

  if (type === 'sticker') {
    const stickerId = cleanForumId(message.stickerId || message.sticker_id || '');
    const sticker = stickerId ? stickerById(stickerId) : null;
    const stickerUrl = sticker ? sticker.url : content;
    if (!stickerUrl || !isPublicStickerUrl(stickerUrl)) return null;
    return {
      id: message.id || crypto.randomUUID(),
      roomId,
      type,
      userId: message.userId || null,
      username,
      avatar: message.avatar || makeAvatar(username),
      content: stickerUrl,
      stickerId,
      timestamp,
      recalled: false
    };
  }

  const text = cleanText(content);
  if (!text) return null;
  return {
    id: message.id || crypto.randomUUID(),
    roomId,
    type: 'text',
    userId: message.userId || null,
    username,
    avatar: message.avatar || makeAvatar(username),
    content: text,
    stickerId: '',
    timestamp,
    recalled: false
  };
}

function broadcastOnlineUsers() {
  const list = Array.from(onlineUsers.values()).map(publicUser);
  io.emit('onlineUsers', { count: list.length, users: list });
  broadcastLobby();
}

function trimHistory(history) {
  return history.slice(-MAX_HISTORY_MESSAGES);
}

function todayStarDate() {
  return new Date().toISOString().slice(0, 10);
}

function starCountForUser(userId) {
  if (!userId) return 0;
  const row = db.prepare('SELECT COUNT(*) AS count FROM user_stars WHERE to_user_id = ?').get(userId);
  return Number(row && row.count ? row.count : 0);
}

function todaysStarForUser(userId) {
  if (!userId) return null;
  return db.prepare(`
    SELECT * FROM user_stars
    WHERE from_user_id = ? AND star_date = ?
    LIMIT 1
  `).get(userId, todayStarDate()) || null;
}

function publicUser(user) {
  const displayName = cleanDisplayName(user.displayName || user.username) || user.username;
  return {
    id: user.id,
    username: user.username,
    displayName,
    avatar: user.avatar || makeAvatar(displayName),
    bio: cleanBio(user.bio),
    profileBanner: cleanProfileBanner(user.profileBanner),
    starCount: starCountForUser(user.id),
    isAdmin: isAdminUser(user),
    isBanned: Boolean(user.isBanned),
    isStickerCreator: Boolean(user.isStickerCreator),
    stickerCreatorStatus: user.stickerCreatorStatus || ''
  };
}

function privateUser(user) {
  const displayName = cleanDisplayName(user.displayName || user.username) || user.username;
  return {
    id: user.id,
    account: user.account,
    username: user.username,
    displayName,
    avatar: user.avatar || makeAvatar(displayName),
    bio: cleanBio(user.bio),
    profileBanner: cleanProfileBanner(user.profileBanner),
    passwordHash: user.passwordHash,
    createdAt: user.createdAt,
    lastIp: user.lastIp || '',
    lastLoginAt: user.lastLoginAt || '',
    isStickerCreator: Boolean(user.isStickerCreator),
    stickerCreatorStatus: user.stickerCreatorStatus || '',
    isBanned: Boolean(user.isBanned),
    bannedAt: user.bannedAt || '',
    bannedReason: user.bannedReason || ''
  };
}

function publicProfile(user, viewer = null) {
  if (!user) return null;
  const starCount = starCountForUser(user.id);
  const todaysStar = viewer ? todaysStarForUser(viewer.id) : null;
  return {
    ...publicUser(user),
    bio: cleanBio(user.bio),
    profileBanner: cleanProfileBanner(user.profileBanner),
    starCount,
    isSelf: Boolean(viewer && viewer.id === user.id),
    starredToday: Boolean(todaysStar && todaysStar.to_user_id === user.id),
    viewerHasStarredToday: Boolean(todaysStar),
    viewerStarredUserId: todaysStar ? todaysStar.to_user_id : ''
  };
}

function initDatabase() {
  db = new DatabaseSync(DB_FILE);
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      account TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      avatar TEXT NOT NULL,
      bio TEXT NOT NULL DEFAULT '',
      profile_banner TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_ip TEXT NOT NULL DEFAULT '',
      last_login_at TEXT NOT NULL DEFAULT '',
      is_banned INTEGER NOT NULL DEFAULT 0,
      banned_at TEXT NOT NULL DEFAULT '',
      banned_reason TEXT NOT NULL DEFAULT '',
      is_sticker_creator INTEGER NOT NULL DEFAULT 0,
      sticker_creator_status TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL DEFAULT 'club-91',
      type TEXT NOT NULL,
      user_id TEXT,
      username TEXT NOT NULL,
      avatar TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      sticker_id TEXT NOT NULL DEFAULT '',
      duration REAL NOT NULL DEFAULT 0,
      recalled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'group',
      created_by TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS room_members (
      room_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      joined_at TEXT NOT NULL,
      PRIMARY KEY (room_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      avatar TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      avatar TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rename_history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      old_display_name TEXT,
      new_display_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      approved_by TEXT,
      approval_status TEXT NOT NULL DEFAULT 'auto_approved',
      decided_at TEXT
    );

    CREATE TABLE IF NOT EXISTS rename_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      old_display_name TEXT,
      new_display_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      reason TEXT,
      created_at TEXT NOT NULL,
      decided_by TEXT,
      decided_at TEXT,
      decision_note TEXT
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      target_user_id TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'normal'
    );

    CREATE TABLE IF NOT EXISTS announcement_reads (
      announcement_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      read_at TEXT NOT NULL,
      PRIMARY KEY (announcement_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS user_stars (
      id TEXT PRIMARY KEY,
      from_user_id TEXT NOT NULL,
      to_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      star_date TEXT NOT NULL,
      UNIQUE(from_user_id, star_date)
    );

    CREATE TABLE IF NOT EXISTS post_reports (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      reporter_user_id TEXT NOT NULL,
      reported_user_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      admin_user_id TEXT NOT NULL DEFAULT '',
      admin_note TEXT NOT NULL DEFAULT '',
      action_taken TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      reviewed_at TEXT NOT NULL DEFAULT '',
      UNIQUE(post_id, reporter_user_id)
    );

    CREATE TABLE IF NOT EXISTS stickers (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL DEFAULT '',
      filename TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL,
      original_name TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT '',
      size_bytes INTEGER NOT NULL DEFAULT 0,
      sticker_type TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      reviewed_at TEXT NOT NULL DEFAULT '',
      reviewed_by TEXT NOT NULL DEFAULT '',
      admin_note TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS sticker_creator_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      portfolio_note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      admin_user_id TEXT NOT NULL DEFAULT '',
      admin_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      reviewed_at TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);
    CREATE INDEX IF NOT EXISTS idx_room_members_user_id ON room_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at);
    CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
    CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id);
    CREATE INDEX IF NOT EXISTS idx_comments_created_at ON comments(created_at);
    CREATE INDEX IF NOT EXISTS idx_comments_user_id ON comments(user_id);
    CREATE INDEX IF NOT EXISTS idx_rename_history_user_created ON rename_history(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_rename_requests_status_created ON rename_requests(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_rename_requests_user_created ON rename_requests(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_announcements_target_created ON announcements(target_user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_announcements_created_at ON announcements(created_at);
    CREATE INDEX IF NOT EXISTS idx_user_stars_to_user_id ON user_stars(to_user_id);
    CREATE INDEX IF NOT EXISTS idx_user_stars_star_date ON user_stars(star_date);
    CREATE INDEX IF NOT EXISTS idx_post_reports_status_created ON post_reports(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_post_reports_post_id ON post_reports(post_id);
    CREATE INDEX IF NOT EXISTS idx_post_reports_reported_user_id ON post_reports(reported_user_id);
    CREATE INDEX IF NOT EXISTS idx_stickers_owner_type_status ON stickers(owner_user_id, sticker_type, status);
    CREATE INDEX IF NOT EXISTS idx_stickers_type_status_created ON stickers(sticker_type, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_sticker_creator_requests_user_created ON sticker_creator_requests(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_sticker_creator_requests_status_created ON sticker_creator_requests(status, created_at);
  `);
  migrateForumTables();
  ensureColumn('users', 'display_name', "TEXT NOT NULL DEFAULT ''");
  db.prepare("UPDATE users SET display_name = username WHERE display_name IS NULL OR TRIM(display_name) = ''").run();
  ensureColumn('users', 'last_ip', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('users', 'last_login_at', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('users', 'bio', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('users', 'profile_banner', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('users', 'is_banned', "INTEGER NOT NULL DEFAULT 0");
  ensureColumn('users', 'banned_at', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('users', 'banned_reason', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('users', 'is_sticker_creator', "INTEGER NOT NULL DEFAULT 0");
  ensureColumn('users', 'sticker_creator_status', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('messages', 'room_id', `TEXT NOT NULL DEFAULT '${DEFAULT_ROOM_ID}'`);
  ensureColumn('messages', 'sticker_id', "TEXT NOT NULL DEFAULT ''");
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages(room_id)');
  ensureOfficialStickers();
  ensureDefaultRoom();
  ensureSystemAnnouncements();
}

function migrateForumTables() {
  migrateForumTable({
    tableName: 'posts',
    legacyIdColumn: 'post_id',
    columnsSql: `
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      avatar TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    `,
    copySql: (legacyTable) => `
      INSERT OR IGNORE INTO posts (id, user_id, username, avatar, title, content, created_at)
      SELECT post_id, user_id, username, avatar, title, content, created_at FROM ${legacyTable}
      WHERE post_id IS NOT NULL AND TRIM(post_id) != ''
    `
  });

  migrateForumTable({
    tableName: 'comments',
    legacyIdColumn: 'comment_id',
    columnsSql: `
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      avatar TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    `,
    copySql: (legacyTable) => `
      INSERT OR IGNORE INTO comments (id, post_id, user_id, username, avatar, content, created_at)
      SELECT comment_id, post_id, user_id, username, avatar, content, created_at FROM ${legacyTable}
      WHERE comment_id IS NOT NULL AND TRIM(comment_id) != ''
    `
  });

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at);
    CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
    CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id);
    CREATE INDEX IF NOT EXISTS idx_comments_created_at ON comments(created_at);
    CREATE INDEX IF NOT EXISTS idx_comments_user_id ON comments(user_id);
  `);
}

function migrateForumTable({ tableName, legacyIdColumn, columnsSql, copySql }) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const hasId = columns.some((column) => column.name === 'id');
  const hasLegacyId = columns.some((column) => column.name === legacyIdColumn);
  if (hasId || !hasLegacyId) return;

  const legacyTable = `${tableName}_legacy_${Date.now()}`;
  db.exec('BEGIN');
  try {
    db.exec(`ALTER TABLE ${tableName} RENAME TO ${legacyTable}`);
    db.exec(`CREATE TABLE ${tableName} (${columnsSql})`);
    db.exec(copySql(legacyTable));
    db.exec(`DROP TABLE ${legacyTable}`);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function ensureColumn(tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (columns.some((column) => column.name === columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

function rowToUser(row) {
  if (!row) return null;
  return normalizeUser({
    id: row.id,
    account: row.account,
    username: row.username,
    displayName: row.display_name,
    avatar: row.avatar,
    bio: row.bio,
    profileBanner: row.profile_banner,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    lastIp: row.last_ip,
    lastLoginAt: row.last_login_at,
    isBanned: Boolean(row.is_banned),
    bannedAt: row.banned_at,
    bannedReason: row.banned_reason,
    isStickerCreator: Boolean(row.is_sticker_creator),
    stickerCreatorStatus: row.sticker_creator_status
  });
}

function rowToRoom(row) {
  if (!row) return null;
  const id = cleanRoomId(row.id);
  const name = cleanRoomName(row.name);
  const type = row.type === 'private' ? 'private' : 'group';
  if (!id || !name) return null;
  return {
    id,
    name,
    type,
    createdBy: row.created_by || '',
    createdAt: row.created_at || new Date().toISOString()
  };
}

function rowToMessage(row) {
  if (!row) return null;
  return normalizeMessage({
    id: row.id,
    roomId: row.room_id,
    type: row.recalled ? 'recalled' : row.type,
    userId: row.user_id,
    username: row.username,
    avatar: row.avatar,
    content: row.content,
    stickerId: row.sticker_id,
    duration: row.duration,
    timestamp: row.created_at,
    recalled: Boolean(row.recalled)
  });
}

function rowToPost(row) {
  if (!row) return null;
  const postId = cleanForumId(row.id || row.post_id);
  const title = cleanPostTitle(row.title);
  const content = cleanPostContent(row.content);
  if (!postId || !title || !content) return null;
  return {
    id: postId,
    postId,
    userId: String(row.user_id || ''),
    username: cleanUsername(row.username) || '匿名',
    avatar: cleanAvatar(row.avatar, row.username),
    title,
    content,
    createdAt: Number.isNaN(Date.parse(row.created_at)) ? new Date().toISOString() : row.created_at,
    commentCount: Number(row.comment_count || 0)
  };
}

function rowToComment(row) {
  if (!row) return null;
  const commentId = cleanForumId(row.id || row.comment_id);
  const postId = cleanForumId(row.post_id);
  const content = cleanCommentContent(row.content);
  if (!commentId || !postId || !content) return null;
  return {
    id: commentId,
    commentId,
    postId,
    userId: String(row.user_id || ''),
    username: cleanUsername(row.username) || '匿名',
    avatar: cleanAvatar(row.avatar, row.username),
    content,
    createdAt: Number.isNaN(Date.parse(row.created_at)) ? new Date().toISOString() : row.created_at
  };
}

function rowToSticker(row) {
  if (!row) return null;
  const id = cleanForumId(row.id);
  const type = STICKER_TYPES.has(row.sticker_type) ? row.sticker_type : 'personal';
  const status = cleanStickerStatus(row.status, type === 'personal' ? 'active' : 'pending');
  const title = cleanStickerTitle(row.title) || (type === 'official' ? '官方表情' : '表情包');
  const url = typeof row.url === 'string' ? row.url.trim() : '';
  if (!id || !isPublicStickerUrl(url)) return null;
  return {
    id,
    ownerUserId: row.owner_user_id || '',
    filename: row.filename || '',
    url,
    originalName: row.original_name || '',
    mimeType: row.mime_type || '',
    sizeBytes: Number(row.size_bytes) || 0,
    stickerType: type,
    status,
    title,
    description: cleanStickerDescription(row.description),
    createdAt: Number.isNaN(Date.parse(row.created_at)) ? new Date().toISOString() : row.created_at,
    reviewedAt: Number.isNaN(Date.parse(row.reviewed_at)) ? '' : row.reviewed_at,
    reviewedBy: row.reviewed_by || '',
    adminNote: cleanAdminNote(row.admin_note)
  };
}

function publicSticker(rowOrSticker) {
  const sticker = rowOrSticker && rowOrSticker.stickerType ? rowOrSticker : rowToSticker(rowOrSticker);
  if (!sticker) return null;
  const owner = sticker.ownerUserId ? userById(sticker.ownerUserId) : null;
  return {
    id: sticker.id,
    ownerUserId: sticker.ownerUserId,
    ownerName: owner ? displayNameOf(owner) : sticker.stickerType === 'official' ? 'Uni 官方' : '',
    url: sticker.url,
    title: sticker.title,
    description: sticker.description,
    stickerType: sticker.stickerType,
    source: sticker.stickerType === 'creator_submission' ? 'creator' : sticker.stickerType,
    status: sticker.status,
    createdAt: sticker.createdAt,
    reviewedAt: sticker.reviewedAt,
    adminNote: sticker.adminNote
  };
}

function upsertUser(user) {
  db.prepare(`
    INSERT INTO users (id, account, username, display_name, avatar, bio, profile_banner, password_hash, created_at, last_ip, last_login_at, is_banned, banned_at, banned_reason, is_sticker_creator, sticker_creator_status)
    VALUES (@id, @account, @username, @displayName, @avatar, @bio, @profileBanner, @passwordHash, @createdAt, @lastIp, @lastLoginAt, @isBanned, @bannedAt, @bannedReason, @isStickerCreator, @stickerCreatorStatus)
    ON CONFLICT(id) DO UPDATE SET
      account = excluded.account,
      username = excluded.username,
      display_name = excluded.display_name,
      avatar = excluded.avatar,
      bio = excluded.bio,
      profile_banner = excluded.profile_banner,
      password_hash = excluded.password_hash,
      created_at = excluded.created_at,
      last_ip = excluded.last_ip,
      last_login_at = excluded.last_login_at,
      is_banned = excluded.is_banned,
      banned_at = excluded.banned_at,
      banned_reason = excluded.banned_reason,
      is_sticker_creator = excluded.is_sticker_creator,
      sticker_creator_status = excluded.sticker_creator_status
  `).run({
    id: user.id,
    account: user.account,
    username: user.username,
    displayName: user.displayName || user.username,
    avatar: user.avatar || makeAvatar(user.displayName || user.username),
    bio: cleanBio(user.bio),
    profileBanner: cleanProfileBanner(user.profileBanner),
    passwordHash: user.passwordHash,
    createdAt: user.createdAt,
    lastIp: user.lastIp || '',
    lastLoginAt: user.lastLoginAt || '',
    isBanned: user.isBanned ? 1 : 0,
    bannedAt: user.bannedAt || '',
    bannedReason: user.bannedReason || '',
    isStickerCreator: user.isStickerCreator ? 1 : 0,
    stickerCreatorStatus: user.stickerCreatorStatus || ''
  });
}

function upsertRoom(room) {
  db.prepare(`
    INSERT INTO rooms (id, name, type, created_by, created_at)
    VALUES (@id, @name, @type, @createdBy, @createdAt)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      type = excluded.type,
      created_by = excluded.created_by,
      created_at = excluded.created_at
  `).run(room);
}

function ensureDefaultRoom() {
  db.prepare(`
    INSERT INTO rooms (id, name, type, created_by, created_at)
    VALUES (?, ?, 'group', '', ?)
    ON CONFLICT(id) DO NOTHING
  `).run(DEFAULT_ROOM_ID, DEFAULT_ROOM_NAME, new Date().toISOString());
  db.prepare('UPDATE rooms SET name = ? WHERE id = ?').run(DEFAULT_ROOM_NAME, DEFAULT_ROOM_ID);
  db.prepare('UPDATE messages SET room_id = ? WHERE room_id IS NULL OR room_id = ?').run(DEFAULT_ROOM_ID, '');
}

function upsertMessage(message) {
  const payload = publicMessage(message);
  if (!payload) return;
  db.prepare(`
    INSERT INTO messages (id, room_id, type, user_id, username, avatar, content, sticker_id, duration, recalled, created_at)
    VALUES (@id, @roomId, @type, @userId, @username, @avatar, @content, @stickerId, @duration, @recalled, @timestamp)
    ON CONFLICT(id) DO UPDATE SET
      room_id = excluded.room_id,
      type = excluded.type,
      user_id = excluded.user_id,
      username = excluded.username,
      avatar = excluded.avatar,
      content = excluded.content,
      sticker_id = excluded.sticker_id,
      duration = excluded.duration,
      recalled = excluded.recalled,
      created_at = excluded.created_at
  `).run({
    ...payload,
    stickerId: payload.stickerId || '',
    recalled: payload.recalled ? 1 : 0
  });
}

function publicMessage(message) {
  if (!message) return null;
  const currentUser = userById(message.userId);
  const displayName = currentUser ? displayNameOf(currentUser) : displayNameOf(message.username);
  if (!message.recalled) {
    return {
      id: message.id,
      roomId: message.roomId || DEFAULT_ROOM_ID,
      type: message.type,
      userId: message.userId,
      username: displayName,
      displayName,
      avatar: message.avatar || makeAvatar(displayName),
      content: message.content,
      stickerId: message.stickerId || '',
      duration: message.duration || 0,
      timestamp: message.timestamp,
      recalled: false
    };
  }

  return {
    id: message.id,
    roomId: message.roomId || DEFAULT_ROOM_ID,
    type: 'recalled',
    userId: message.userId,
    username: displayName,
    displayName,
    avatar: message.avatar,
    content: '',
    stickerId: '',
    duration: 0,
    timestamp: message.timestamp,
    recalled: true
  };
}

function publicForumPost(post) {
  if (!post) return null;
  const currentUser = userById(post.userId);
  const displayName = currentUser ? displayNameOf(currentUser) : displayNameOf(post.username);
  return {
    id: post.id || post.postId,
    postId: post.postId,
    userId: post.userId,
    username: displayName,
    displayName,
    avatar: post.avatar || makeAvatar(displayName),
    starCount: currentUser ? starCountForUser(currentUser.id) : starCountForUser(post.userId),
    title: post.title,
    content: post.content,
    createdAt: post.createdAt,
    commentCount: Number(post.commentCount || 0)
  };
}

function publicForumComment(comment) {
  if (!comment) return null;
  const currentUser = userById(comment.userId);
  const displayName = currentUser ? displayNameOf(currentUser) : displayNameOf(comment.username);
  return {
    id: comment.id || comment.commentId,
    commentId: comment.commentId,
    postId: comment.postId,
    userId: comment.userId,
    username: displayName,
    displayName,
    avatar: comment.avatar || makeAvatar(displayName),
    starCount: currentUser ? starCountForUser(currentUser.id) : starCountForUser(comment.userId),
    content: comment.content,
    createdAt: comment.createdAt
  };
}

function listForumPosts() {
  return db.prepare(`
    SELECT posts.*, COUNT(comments.id) AS comment_count
    FROM posts
    LEFT JOIN comments ON comments.post_id = posts.id
    GROUP BY posts.id
    ORDER BY posts.created_at DESC
    LIMIT ?
  `).all(MAX_FORUM_POSTS).map(rowToPost).filter(Boolean).map(publicForumPost);
}

function getForumPost(postIdValue) {
  const postId = cleanForumId(postIdValue);
  if (!postId) return null;
  const row = db.prepare(`
    SELECT posts.*, COUNT(comments.id) AS comment_count
    FROM posts
    LEFT JOIN comments ON comments.post_id = posts.id
    WHERE posts.id = ?
    GROUP BY posts.id
  `).get(postId);
  return publicForumPost(rowToPost(row));
}

function listForumComments(postIdValue) {
  const postId = cleanForumId(postIdValue);
  if (!postId) return [];
  return db.prepare(`
    SELECT * FROM comments
    WHERE post_id = ?
    ORDER BY created_at ASC
  `).all(postId).map(rowToComment).filter(Boolean).map(publicForumComment);
}

function insertForumPost(post) {
  db.prepare(`
    INSERT INTO posts (id, user_id, username, avatar, title, content, created_at)
    VALUES (@postId, @userId, @username, @avatar, @title, @content, @createdAt)
  `).run(post);
}

function insertForumComment(comment) {
  db.prepare(`
    INSERT INTO comments (id, post_id, user_id, username, avatar, content, created_at)
    VALUES (@commentId, @postId, @userId, @username, @avatar, @content, @createdAt)
  `).run(comment);
}

function rawForumPost(postId) {
  const id = cleanForumId(postId);
  if (!id) return null;
  return db.prepare('SELECT * FROM posts WHERE id = ?').get(id) || null;
}

function rawForumComment(commentId) {
  const id = cleanForumId(commentId);
  if (!id) return null;
  return db.prepare('SELECT * FROM comments WHERE id = ?').get(id) || null;
}

function reportReasonLabel(reason) {
  return {
    spam: '垃圾广告',
    abuse: '辱骂 / 攻击',
    sexual: '色情或不适内容',
    danger: '违法 / 危险内容',
    other: '其他'
  }[reason] || '其他';
}

function publicPostReport(row) {
  if (!row) return null;
  const post = rawForumPost(row.post_id);
  const reporter = userById(row.reporter_user_id);
  const reported = userById(row.reported_user_id);
  return {
    id: row.id,
    postId: row.post_id,
    postTitle: post ? cleanPostTitle(post.title) : '原帖已删除',
    postContent: post ? cleanPostContent(post.content) : '',
    reporterUserId: row.reporter_user_id,
    reporterName: reporter ? displayNameOf(reporter) : '未知用户',
    reportedUserId: row.reported_user_id,
    reportedName: reported ? displayNameOf(reported) : '未知用户',
    reason: row.reason,
    reasonLabel: reportReasonLabel(row.reason),
    details: row.details || '',
    status: REPORT_STATUSES.has(row.status) ? row.status : 'pending',
    adminUserId: row.admin_user_id || '',
    adminNote: row.admin_note || '',
    actionTaken: row.action_taken || '',
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at || '',
    postExists: Boolean(post)
  };
}

function listPostReports() {
  return db.prepare(`
    SELECT * FROM post_reports
    ORDER BY
      CASE status WHEN 'pending' THEN 0 ELSE 1 END,
      created_at DESC
    LIMIT 120
  `).all().map(publicPostReport).filter(Boolean);
}

function updateReportStatus(reportId, status, adminUserId, note = '', actionTaken = '') {
  db.prepare(`
    UPDATE post_reports
    SET status = ?, admin_user_id = ?, admin_note = ?, action_taken = ?, reviewed_at = ?
    WHERE id = ?
  `).run(status, adminUserId, cleanAdminNote(note), actionTaken, new Date().toISOString(), reportId);
}

function ensureOfficialStickers() {
  const createdAt = new Date().toISOString();
  DEFAULT_OFFICIAL_STICKERS.forEach((sticker) => {
    db.prepare(`
      INSERT INTO stickers (id, owner_user_id, filename, url, original_name, mime_type, size_bytes, sticker_type, status, title, description, created_at, reviewed_at, reviewed_by, admin_note)
      VALUES (@id, '', '', @url, @title, 'image/svg+xml', 0, 'official', 'active', @title, @description, @createdAt, '', '', '')
      ON CONFLICT(id) DO UPDATE SET
        url = excluded.url,
        sticker_type = 'official',
        status = CASE WHEN stickers.status = 'removed' THEN stickers.status ELSE 'active' END,
        title = excluded.title,
        description = excluded.description
    `).run({ ...sticker, createdAt });
  });
}

function stickerById(stickerIdValue) {
  const stickerId = cleanForumId(stickerIdValue);
  if (!stickerId) return null;
  return rowToSticker(db.prepare('SELECT * FROM stickers WHERE id = ?').get(stickerId));
}

function isStickerSendable(sticker, userId) {
  if (!sticker) return false;
  if (sticker.stickerType === 'personal') return sticker.status === 'active' && sticker.ownerUserId === userId;
  if (sticker.stickerType === 'official') return sticker.status === 'active';
  return sticker.stickerType === 'creator_submission' && sticker.status === 'approved';
}

function personalStickerCount(userId) {
  return Number(db.prepare(`
    SELECT COUNT(*) AS count FROM stickers
    WHERE owner_user_id = ? AND sticker_type = 'personal' AND status = 'active'
  `).get(userId).count || 0);
}

function listStickersForUser(userId) {
  const official = db.prepare(`
    SELECT * FROM stickers
    WHERE (sticker_type = 'official' AND status = 'active')
       OR (sticker_type = 'creator_submission' AND status = 'approved')
    ORDER BY created_at ASC
  `).all().map(rowToSticker).filter(Boolean).map(publicSticker);
  const personal = db.prepare(`
    SELECT * FROM stickers
    WHERE owner_user_id = ? AND sticker_type = 'personal' AND status = 'active'
    ORDER BY created_at DESC
  `).all(userId).map(rowToSticker).filter(Boolean).map(publicSticker);
  const submissions = db.prepare(`
    SELECT * FROM stickers
    WHERE owner_user_id = ? AND sticker_type = 'creator_submission'
    ORDER BY created_at DESC
    LIMIT 40
  `).all(userId).map(rowToSticker).filter(Boolean).map(publicSticker);
  return {
    official,
    personal,
    submissions,
    creator: creatorStatusForUser(userId)
  };
}

function latestCreatorRequest(userId) {
  return db.prepare(`
    SELECT * FROM sticker_creator_requests
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(userId) || null;
}

function publicCreatorRequest(row) {
  if (!row) return null;
  const user = userById(row.user_id);
  return {
    id: row.id,
    userId: row.user_id,
    displayName: user ? displayNameOf(user) : '未知用户',
    username: user ? user.username : '',
    avatar: user ? user.avatar : makeAvatar('U'),
    reason: cleanCreatorReason(row.reason),
    portfolioNote: cleanCreatorPortfolio(row.portfolio_note),
    status: CREATOR_REQUEST_STATUSES.has(row.status) ? row.status : 'pending',
    adminUserId: row.admin_user_id || '',
    adminNote: cleanAdminNote(row.admin_note),
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at || ''
  };
}

function creatorStatusForUser(userId) {
  const user = userById(userId);
  const request = publicCreatorRequest(latestCreatorRequest(userId));
  return {
    isCreator: Boolean(user && user.isStickerCreator),
    status: user && user.isStickerCreator ? 'approved' : request ? request.status : '',
    request
  };
}

function listCreatorRequests() {
  return db.prepare(`
    SELECT * FROM sticker_creator_requests
    ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC
    LIMIT 120
  `).all().map(publicCreatorRequest).filter(Boolean);
}

function listStickerSubmissions() {
  return db.prepare(`
    SELECT * FROM stickers
    WHERE sticker_type = 'creator_submission'
    ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, created_at DESC
    LIMIT 120
  `).all().map(rowToSticker).filter(Boolean).map(publicSticker);
}

function saveStickerUpload(user, dataUrl, { title = '', description = '', stickerType = 'personal', originalName = '' } = {}) {
  const parsed = parseDataUrl(dataUrl, ALLOWED_IMAGE_TYPES, MAX_STICKER_BYTES);
  if (!parsed) return { error: '表情包仅支持 JPG、PNG、GIF、WebP，最大 2MB' };
  const cleanType = STICKER_TYPES.has(stickerType) ? stickerType : 'personal';
  fs.mkdirSync(STICKER_UPLOAD_DIR, { recursive: true });
  const ext = IMAGE_EXTENSIONS[parsed.mime] || 'png';
  const id = `sticker:${crypto.randomUUID()}`;
  const fileName = `${cleanType}_${crypto.randomUUID().replace(/-/g, '')}.${ext}`;
  const filePath = path.join(STICKER_UPLOAD_DIR, fileName);
  fs.writeFileSync(filePath, parsed.buffer, { mode: 0o600 });
  const now = new Date().toISOString();
  const sticker = {
    id,
    ownerUserId: user.id,
    filename: fileName,
    url: `/uploads/stickers/${fileName}`,
    originalName: cleanText(originalName, 80),
    mimeType: parsed.mime,
    sizeBytes: parsed.buffer.length,
    stickerType: cleanType,
    status: cleanType === 'creator_submission' ? 'pending' : 'active',
    title: cleanStickerTitle(title) || '我的表情',
    description: cleanStickerDescription(description),
    createdAt: now,
    reviewedAt: '',
    reviewedBy: '',
    adminNote: ''
  };
  db.prepare(`
    INSERT INTO stickers (id, owner_user_id, filename, url, original_name, mime_type, size_bytes, sticker_type, status, title, description, created_at, reviewed_at, reviewed_by, admin_note)
    VALUES (@id, @ownerUserId, @filename, @url, @originalName, @mimeType, @sizeBytes, @stickerType, @status, @title, @description, @createdAt, @reviewedAt, @reviewedBy, @adminNote)
  `).run(sticker);
  return { sticker: publicSticker(sticker) };
}

function deleteStickerFile(sticker) {
  if (!sticker || !isUploadedSticker(sticker.url)) return;
  const filePath = stickerFilePath(sticker.url);
  if (!filePath.startsWith(STICKER_UPLOAD_DIR)) return;
  fs.promises.unlink(filePath).catch(() => {});
}

function deleteForumPostById(postId) {
  const id = cleanForumId(postId);
  if (!id) return false;
  const post = rawForumPost(id);
  if (!post) return false;
  db.prepare('DELETE FROM comments WHERE post_id = ?').run(id);
  db.prepare('DELETE FROM posts WHERE id = ?').run(id);
  io.to(forumPostChannel(id)).emit('forum post deleted', { postId: id });
  broadcastForumPosts();
  return true;
}

function banUser(user, reason = '') {
  if (!user || isAdminUser(user)) return false;
  user.isBanned = true;
  user.bannedAt = new Date().toISOString();
  user.bannedReason = cleanAdminNote(reason) || '违反社区规则';
  saveUsers();
  socketsForUser(user.id).forEach((connectedSocket) => {
    connectedSocket.user = user;
    connectedSocket.emit('profile updated', { user: publicUser(user) });
    connectedSocket.emit('forum error', '你的账号已被限制使用社区功能');
  });
  broadcastOnlineUsers();
  broadcastAdminDashboards();
  return true;
}

function forumPostChannel(postId) {
  return `forum:${postId}`;
}

function emitForumPosts(socket) {
  socket.emit('forum posts', { posts: listForumPosts() });
}

function broadcastForumPosts() {
  io.emit('forum posts', { posts: listForumPosts() });
}

function broadcastForumPostDetail(postId) {
  const post = getForumPost(postId);
  if (!post) return;
  io.to(forumPostChannel(postId)).emit('forum post detail', {
    post,
    comments: listForumComments(postId)
  });
}

function renameWindowStart() {
  return new Date(Date.now() - RENAME_WINDOW_MS).toISOString();
}

function recentRenameCount(userId) {
  return Number(db.prepare(`
    SELECT COUNT(*) AS count FROM rename_history
    WHERE user_id = ? AND created_at >= ? AND approval_status IN ('auto_approved', 'approved')
  `).get(userId, renameWindowStart()).count || 0);
}

function latestRenameRequest(userId) {
  const row = db.prepare(`
    SELECT * FROM rename_requests
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(userId);
  return row ? publicRenameRequest(row) : null;
}

function pendingRenameRequest(userId) {
  const row = db.prepare(`
    SELECT * FROM rename_requests
    WHERE user_id = ? AND status = 'pending'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(userId);
  return row ? publicRenameRequest(row) : null;
}

function publicRenameRequest(row) {
  if (!row) return null;
  const user = userById(row.user_id);
  return {
    id: row.id,
    userId: row.user_id,
    account: user ? user.account : '',
    username: user ? user.username : '',
    displayName: user ? displayNameOf(user) : row.old_display_name || '',
    oldDisplayName: row.old_display_name || '',
    newDisplayName: row.new_display_name,
    status: row.status,
    reason: row.reason || '',
    createdAt: row.created_at,
    decidedBy: row.decided_by || '',
    decidedAt: row.decided_at || '',
    decisionNote: row.decision_note || '',
    recentCount: recentRenameCount(row.user_id)
  };
}

function renameStatusForUser(user) {
  const used = recentRenameCount(user.id);
  return {
    used,
    remaining: Math.max(0, RENAME_FREE_LIMIT - used),
    limit: RENAME_FREE_LIMIT,
    windowDays: 7,
    latest: latestRenameRequest(user.id),
    pending: pendingRenameRequest(user.id)
  };
}

function emitRenameStatus(socket) {
  if (!socket.user) return;
  socket.emit('rename status', renameStatusForUser(socket.user));
}

function listPendingRenameRequests() {
  return db.prepare(`
    SELECT * FROM rename_requests
    WHERE status = 'pending'
    ORDER BY created_at ASC
  `).all().map(publicRenameRequest).filter(Boolean);
}

function insertRenameHistory({ userId, oldDisplayName, newDisplayName, approvedBy = '', approvalStatus = 'auto_approved' }) {
  db.prepare(`
    INSERT INTO rename_history (id, user_id, old_display_name, new_display_name, created_at, approved_by, approval_status, decided_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `rename:${crypto.randomUUID()}`,
    userId,
    oldDisplayName || '',
    newDisplayName,
    new Date().toISOString(),
    approvedBy || '',
    approvalStatus,
    new Date().toISOString()
  );
}

function applyDisplayName(user, newDisplayName, { approvedBy = '', approvalStatus = 'auto_approved' } = {}) {
  const oldDisplayName = displayNameOf(user);
  user.displayName = newDisplayName;
  if (!isUploadedAvatar(user.avatar)) user.avatar = makeAvatar(newDisplayName);
  insertRenameHistory({ userId: user.id, oldDisplayName, newDisplayName, approvedBy, approvalStatus });
  saveUsers();
  socketsForUser(user.id).forEach((connectedSocket) => {
    connectedSocket.user = user;
    onlineUsers.set(connectedSocket.id, user);
    connectedSocket.emit('profile updated', { user: publicUser(user) });
    connectedSocket.emit('rename status', renameStatusForUser(user));
  });
  broadcastOnlineUsers();
  refreshOpenRooms();
  broadcastForumPosts();
  broadcastAdminDashboards();
  return { oldDisplayName, newDisplayName };
}

function createRenameRequest(user, newDisplayName, reason = '超过 7 天内 3 次免费改名限制') {
  const id = `rename-request:${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO rename_requests (id, user_id, old_display_name, new_display_name, status, reason, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?)
  `).run(id, user.id, displayNameOf(user), newDisplayName, reason, new Date().toISOString());
  return publicRenameRequest(db.prepare('SELECT * FROM rename_requests WHERE id = ?').get(id));
}

function cleanAnnouncementType(value) {
  const type = typeof value === 'string' ? value.trim().toLowerCase() : 'admin';
  return ANNOUNCEMENT_TYPES.has(type) ? type : 'admin';
}

function cleanAnnouncementPriority(value) {
  const priority = typeof value === 'string' ? value.trim().toLowerCase() : 'normal';
  return ANNOUNCEMENT_PRIORITIES.has(priority) ? priority : 'normal';
}

function createAnnouncement({ type = 'admin', title, content, targetUserId = '', createdBy = '', priority = 'normal', id = '' }) {
  const cleanTitle = cleanText(title, 90).replace(/\s+/g, ' ');
  const cleanContent = cleanText(content, 1200);
  if (!cleanTitle || !cleanContent) return null;
  const announcement = {
    id: id || `announcement:${crypto.randomUUID()}`,
    type: cleanAnnouncementType(type),
    title: cleanTitle,
    content: cleanContent,
    targetUserId: targetUserId || '',
    createdBy: createdBy || '',
    createdAt: new Date().toISOString(),
    priority: cleanAnnouncementPriority(priority)
  };
  db.prepare(`
    INSERT OR IGNORE INTO announcements (id, type, title, content, target_user_id, created_by, created_at, priority)
    VALUES (@id, @type, @title, @content, @targetUserId, @createdBy, @createdAt, @priority)
  `).run(announcement);
  broadcastBulletinUpdates(announcement.targetUserId);
  return announcement;
}

function rowToAnnouncement(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    content: row.content,
    targetUserId: row.target_user_id || '',
    createdBy: row.created_by || '',
    createdAt: row.created_at,
    priority: row.priority || 'normal',
    read: Boolean(row.read_at),
    readAt: row.read_at || ''
  };
}

function listAnnouncementsForUser(userId) {
  return db.prepare(`
    SELECT announcements.*, announcement_reads.read_at
    FROM announcements
    LEFT JOIN announcement_reads
      ON announcement_reads.announcement_id = announcements.id
      AND announcement_reads.user_id = ?
    WHERE announcements.target_user_id = '' OR announcements.target_user_id IS NULL OR announcements.target_user_id = ?
    ORDER BY announcements.created_at DESC
    LIMIT 80
  `).all(userId, userId).map(rowToAnnouncement).filter(Boolean);
}

function unreadAnnouncementCount(userId) {
  return Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM announcements
    LEFT JOIN announcement_reads
      ON announcement_reads.announcement_id = announcements.id
      AND announcement_reads.user_id = ?
    WHERE (announcements.target_user_id = '' OR announcements.target_user_id IS NULL OR announcements.target_user_id = ?)
      AND announcement_reads.read_at IS NULL
  `).get(userId, userId).count || 0);
}

function emitBulletins(socket) {
  if (!socket.user) return;
  socket.emit('bulletins', {
    items: listAnnouncementsForUser(socket.user.id),
    unreadCount: unreadAnnouncementCount(socket.user.id)
  });
}

function broadcastBulletinUpdates(targetUserId = '') {
  io.sockets.sockets.forEach((connectedSocket) => {
    if (!connectedSocket.user) return;
    if (targetUserId && connectedSocket.user.id !== targetUserId) return;
    connectedSocket.emit('bulletins updated', { unreadCount: unreadAnnouncementCount(connectedSocket.user.id) });
  });
}

function ensureSystemAnnouncements() {
  createAnnouncement({
    id: 'update:5.5.3',
    type: 'update',
    title: 'Sonoma 5.5.3 已上线',
    content: '新增 PWA 基础配置、移动端底部导航雏形、App 化布局优化，并整理 API / Socket 文档，为 Uni 6 Nordkapp 做准备。',
    priority: 'high'
  });
  createAnnouncement({
    id: 'update:5.5.1',
    type: 'update',
    title: 'Sonoma 5.5.1 已上线',
    content: '优化表情包面板、移动端布局、上传与审核反馈，并增强历史表情包消息的可靠显示。',
    priority: 'high'
  });
  createAnnouncement({
    id: 'update:5.5.0',
    type: 'update',
    title: 'Sonoma 5.5.0 已上线',
    content: '新增官方表情包、个人表情包上传与发送、表情包创作者申请，以及管理员官方表情包审核。',
    priority: 'high'
  });
  createAnnouncement({
    id: 'update:5.4.6',
    type: 'update',
    title: 'Sonoma 5.4.6 已上线',
    content: '新增论坛举报、管理员举报中心、基础封禁系统，并修复用户主页、Star 和移动端社区体验稳定性。',
    priority: 'high'
  });
  createAnnouncement({
    id: 'update:5.4.5',
    type: 'update',
    title: 'Sonoma 5.4.5 已上线',
    content: '新增用户主页、个人简介、主页背景图、联系方式区域、每日 Star，以及用户列表排序。',
    priority: 'high'
  });
  createAnnouncement({
    id: 'update:5.4.3',
    type: 'update',
    title: 'Uni 5.4.3 已上线',
    content: '新增展示昵称修改、每周改名限制、管理员审核、公告信箱，以及论坛基础体验优化。',
    priority: 'high'
  });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = String(storedHash || '').split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, 'hex');
  return stored.length === candidate.length && crypto.timingSafeEqual(stored, candidate);
}

const authAttempts = new Map();

function authLimitKey(socket) {
  return socket.handshake.address || socket.id;
}

function checkAuthLimit(socket) {
  const key = authLimitKey(socket);
  const now = Date.now();
  const record = authAttempts.get(key) || { count: 0, resetAt: now + AUTH_WINDOW_MS };

  if (record.resetAt <= now) {
    record.count = 0;
    record.resetAt = now + AUTH_WINDOW_MS;
  }

  record.count += 1;
  authAttempts.set(key, record);
  return record.count <= AUTH_MAX_ATTEMPTS;
}

function clearAuthLimit(socket) {
  authAttempts.delete(authLimitKey(socket));
}

function findUserByAccount(account) {
  return users.find((user) => user.account === account);
}

function findRoom(roomId) {
  return rooms.find((room) => room.id === roomId && room.type === 'group');
}

function isAdminUser(user) {
  return Boolean(user && user.account === ADMIN_ACCOUNT);
}

function getClientIp(socket) {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = socket.handshake.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) return realIp.trim();
  return socket.handshake.address || '';
}

function recordLogin(socket, user) {
  user.lastIp = getClientIp(socket);
  user.lastLoginAt = new Date().toISOString();
  saveUsers();
}

function bindUser(socket, user) {
  socket.user = user;
  onlineUsers.set(socket.id, user);
}

function syncUserAvatar(user, avatar) {
  user.avatar = avatar || makeAvatar(displayNameOf(user));
  socketsForUser(user.id).forEach((connectedSocket) => {
    connectedSocket.user = user;
    onlineUsers.set(connectedSocket.id, user);
    connectedSocket.emit('profile updated', { user: publicUser(user) });
  });
  messages = messages.map((message) => (
    message.userId === user.id ? { ...message, avatar: user.avatar } : message
  ));
  saveUsers();
  try {
    db.prepare('UPDATE messages SET avatar = ? WHERE user_id = ?').run(user.avatar, user.id);
    db.prepare('UPDATE posts SET avatar = ? WHERE user_id = ?').run(user.avatar, user.id);
    db.prepare('UPDATE comments SET avatar = ? WHERE user_id = ?').run(user.avatar, user.id);
  } catch (error) {
    console.error('同步头像到历史内容失败:', error.message);
  }
  refreshOpenRooms();
  broadcastOnlineUsers();
  broadcastForumPosts();
  broadcastAdminDashboards();
}

function deleteAvatarFile(avatarUrl) {
  if (!isUploadedAvatar(avatarUrl)) return;
  const filePath = avatarFilePath(avatarUrl);
  if (!filePath.startsWith(AVATAR_UPLOAD_DIR)) return;
  fs.promises.unlink(filePath).catch(() => {});
}

function saveAvatarUpload(user, dataUrl) {
  const parsed = parseAvatarData(dataUrl);
  if (!parsed) return { error: '头像仅支持 JPG、PNG、WebP，最大 2MB' };

  fs.mkdirSync(AVATAR_UPLOAD_DIR, { recursive: true });
  const ext = IMAGE_EXTENSIONS[parsed.mime] || 'png';
  const fileName = `avatar_${user.id}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const filePath = path.join(AVATAR_UPLOAD_DIR, fileName);
  fs.writeFileSync(filePath, parsed.buffer, { mode: 0o600 });
  return { avatar: `/uploads/avatars/${fileName}` };
}

function saveProfileBannerUpload(user, dataUrl) {
  const parsed = parseDataUrl(dataUrl, ALLOWED_IMAGE_TYPES, MAX_BANNER_BYTES);
  if (!parsed) return { error: '主页背景图仅支持 JPG、PNG、GIF、WebP，最大 5MB' };

  fs.mkdirSync(BANNER_UPLOAD_DIR, { recursive: true });
  const ext = IMAGE_EXTENSIONS[parsed.mime] || 'png';
  const fileName = `banner_${user.id}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const filePath = path.join(BANNER_UPLOAD_DIR, fileName);
  fs.writeFileSync(filePath, parsed.buffer, { mode: 0o600 });
  return { profileBanner: `/uploads/banners/${fileName}` };
}

function deleteBannerFile(bannerUrl) {
  if (!isUploadedProfileBanner(bannerUrl)) return;
  const filePath = bannerFilePath(bannerUrl);
  if (!filePath.startsWith(BANNER_UPLOAD_DIR)) return;
  fs.promises.unlink(filePath).catch(() => {});
}

function syncUserProfile(user, changes = {}) {
  if (Object.prototype.hasOwnProperty.call(changes, 'bio')) {
    user.bio = cleanBio(changes.bio);
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'profileBanner')) {
    user.profileBanner = cleanProfileBanner(changes.profileBanner);
  }
  saveUsers();
  socketsForUser(user.id).forEach((connectedSocket) => {
    connectedSocket.user = user;
    onlineUsers.set(connectedSocket.id, user);
    connectedSocket.emit('profile updated', { user: publicUser(user) });
  });
  broadcastOnlineUsers();
  broadcastForumPosts();
  broadcastAdminDashboards();
}

function roomChannel(roomId) {
  return `room:${roomId}`;
}

function privateRoomId(userIdA, userIdB) {
  return `dm:${[userIdA, userIdB].sort().join(':')}`;
}

function privateRoomName(userA, userB) {
  return `${displayNameOf(userA)} 和 ${displayNameOf(userB)}`;
}

function privateRoomUsers(roomId) {
  if (typeof roomId !== 'string' || !roomId.startsWith('dm:')) return [];
  return roomId.slice(3).split(':').filter(Boolean);
}

function socketsForUser(userId) {
  return Array.from(io.sockets.sockets.values()).filter((connectedSocket) => (
    connectedSocket.user && connectedSocket.user.id === userId
  ));
}

function notifyPrivateRecipients(message) {
  const ids = privateRoomUsers(message.roomId);
  if (ids.length !== 2) return;
  const targetId = ids.find((id) => id !== message.userId);
  if (!targetId) return;
  const target = users.find((user) => user.id === targetId);
  if (!target) return;

  socketsForUser(targetId).forEach((targetSocket) => {
    if (targetSocket.currentRoomId === message.roomId) return;
    targetSocket.emit('private notification', {
      room: {
        id: message.roomId,
        name: privateRoomName(messageUser(message), target),
        type: 'private',
        targetUserId: message.userId
      },
      from: {
        id: message.userId,
        username: displayNameOf(messageUser(message)),
        displayName: displayNameOf(messageUser(message)),
        avatar: message.avatar
      },
      message: publicMessage(message)
    });
  });
}

function messageUser(message) {
  return users.find((user) => user.id === message.userId) || {
    id: message.userId,
    username: message.username,
    displayName: message.displayName || message.username,
    avatar: message.avatar
  };
}

function leaveCurrentRoom(socket) {
  if (!socket.currentRoomId) return;
  socket.leave(roomChannel(socket.currentRoomId));
  clearTyping(socket);
}

function joinSocketRoom(socket, roomId) {
  leaveCurrentRoom(socket);
  socket.currentRoomId = roomId;
  socket.join(roomChannel(roomId));
}

function ensureRoomMember(roomId, userId) {
  db.prepare(`
    INSERT INTO room_members (room_id, user_id, joined_at)
    VALUES (?, ?, ?)
    ON CONFLICT(room_id, user_id) DO NOTHING
  `).run(roomId, userId, new Date().toISOString());
}

function groupMemberCount(roomId) {
  return db.prepare('SELECT COUNT(*) AS count FROM room_members WHERE room_id = ?').get(roomId).count || 0;
}

function groupOnlineCount(roomId) {
  const onlineIds = new Set();
  io.sockets.sockets.forEach((connectedSocket) => {
    if (connectedSocket.user && connectedSocket.currentRoomId === roomId) {
      onlineIds.add(connectedSocket.user.id);
    }
  });
  return onlineIds.size;
}

function messagesForRoom(roomId) {
  return messages
    .filter((message) => message.roomId === roomId)
    .slice(-MAX_HISTORY_MESSAGES)
    .map(publicMessage)
    .filter(Boolean);
}

function publicRoom(room) {
  return {
    id: room.id,
    name: room.name,
    type: room.type,
    joinedCount: groupMemberCount(room.id),
    onlineCount: groupOnlineCount(room.id),
    createdAt: room.createdAt
  };
}

function publicOnlineUsers() {
  const seen = new Map();
  Array.from(onlineUsers.values()).forEach((user) => {
    seen.set(user.id, publicUser(user));
  });
  return Array.from(seen.values());
}

function buildLobbyPayload() {
  return {
    rooms: rooms.filter((room) => room.type === 'group').map(publicRoom),
    users: publicOnlineUsers()
  };
}

function emitLobby(socket) {
  socket.emit('lobby', buildLobbyPayload());
}

function broadcastLobby() {
  io.emit('lobby', buildLobbyPayload());
}

function refreshOpenRooms() {
  io.sockets.sockets.forEach((connectedSocket) => {
    if (connectedSocket.currentRoomId) {
      connectedSocket.emit('history', messagesForRoom(connectedSocket.currentRoomId));
    }
  });
}

function ensureAdminUser() {
  const existing = findUserByAccount(ADMIN_ACCOUNT);
  if (existing) {
    let changed = false;
    if (existing.username !== ADMIN_USERNAME) {
      existing.username = ADMIN_USERNAME;
      existing.displayName = existing.displayName || ADMIN_USERNAME;
      if (!isUploadedAvatar(existing.avatar)) existing.avatar = makeAvatar(ADMIN_USERNAME);
      changed = true;
    }
    if (!verifyPassword(ADMIN_PASSWORD, existing.passwordHash)) {
      existing.passwordHash = hashPassword(ADMIN_PASSWORD);
      changed = true;
    }
    if (changed) saveUsers();
    return;
  }

  const admin = {
    id: crypto.randomUUID(),
    account: ADMIN_ACCOUNT,
    username: ADMIN_USERNAME,
    displayName: ADMIN_USERNAME,
    avatar: makeAvatar(ADMIN_USERNAME),
    bio: '',
    profileBanner: '',
    passwordHash: hashPassword(ADMIN_PASSWORD),
    createdAt: new Date().toISOString(),
    lastIp: '',
    lastLoginAt: '',
    isStickerCreator: false,
    stickerCreatorStatus: ''
  };
  users.push(admin);
  saveUsers();
}

function validateAuthPayload(payload, isRegister = false) {
  const account = cleanAccount(payload && payload.account);
  const password = typeof (payload && payload.password) === 'string' ? payload.password : '';
  const username = cleanUsername(payload && payload.username) || account;
  if (!account) return { error: '账号只能用英文、数字、下划线' };
  if (password.length < MIN_PASSWORD_LENGTH) return { error: `密码至少 ${MIN_PASSWORD_LENGTH} 位` };
  if (isRegister && !username) return { error: '请输入昵称' };
  return { account, password, username };
}

function requireAuth(socket, action = '操作') {
  if (socket.user) return true;
  socket.emit('authError', `请先登录后再${action}`);
  return false;
}

function requireCommunityAccess(socket, action = '使用社区功能') {
  if (!requireAuth(socket, action)) return false;
  if (!socket.user.isBanned) return true;
  const message = '你的账号已被限制使用社区功能';
  socket.emit('forum error', message);
  socket.emit('profileError', message);
  socket.emit('sticker error', message);
  socket.emit('messageError', message);
  return false;
}

function requireAdmin(socket, action = '管理后台') {
  if (!requireAuth(socket, action)) return false;
  if (isAdminUser(socket.user)) return true;
  socket.emit('admin error', '没有管理员权限');
  return false;
}

function adminUserPayload(user) {
  const userMessages = messages.filter((message) => message.userId === user.id);
  return {
    id: user.id,
    account: user.account,
    username: user.username,
    displayName: displayNameOf(user),
    avatar: user.avatar || makeAvatar(displayNameOf(user)),
    bio: cleanBio(user.bio),
    profileBanner: cleanProfileBanner(user.profileBanner),
    starCount: starCountForUser(user.id),
    isAdmin: isAdminUser(user),
    createdAt: user.createdAt,
    lastIp: user.lastIp || '',
    lastLoginAt: user.lastLoginAt || '',
    isBanned: Boolean(user.isBanned),
    bannedAt: user.bannedAt || '',
    bannedReason: user.bannedReason || '',
    isStickerCreator: Boolean(user.isStickerCreator),
    stickerCreatorStatus: user.stickerCreatorStatus || '',
    online: Array.from(onlineUsers.values()).some((onlineUser) => onlineUser.id === user.id),
    messageCount: userMessages.length,
    passwordStoredAs: 'scrypt hash + salt'
  };
}

function adminMessagePayload(message) {
  const payload = publicMessage(message);
  if (!payload) return null;
  return {
    ...payload,
    account: users.find((user) => user.id === payload.userId)?.account || ''
  };
}

function buildAdminDashboard() {
  return {
    users: users.map(adminUserPayload),
    messages: messages.map(adminMessagePayload).filter(Boolean),
    rooms: rooms.filter((room) => room.type === 'group').map(publicRoom),
    groupCode: groupCodeInfo(),
    messageCount: messages.length,
    onlineCount: onlineUsers.size,
    renameRequests: listPendingRenameRequests(),
    postReports: listPostReports(),
    stickerCreatorRequests: listCreatorRequests(),
    stickerSubmissions: listStickerSubmissions()
  };
}

function emitAdminDashboard(socket) {
  socket.emit('admin dashboard', buildAdminDashboard());
}

function groupCodeInfo(now = Date.now()) {
  const bucket = Math.floor(now / GROUP_CODE_WINDOW_MS);
  const hash = crypto.createHash('sha256').update(`beluga:${bucket}:${ADMIN_ACCOUNT}`).digest('hex');
  const digits = hash.replace(/\D/g, '').padEnd(6, '0').slice(0, 6);
  return {
    code: digits,
    expiresAt: new Date((bucket + 1) * GROUP_CODE_WINDOW_MS).toISOString()
  };
}

function isValidGroupCode(code) {
  return String(code || '').trim() === groupCodeInfo().code;
}

function broadcastAdminDashboards() {
  io.sockets.sockets.forEach((connectedSocket) => {
    if (connectedSocket.user && isAdminUser(connectedSocket.user)) {
      emitAdminDashboard(connectedSocket);
    }
  });
}

function parseDataUrl(value, allowedTypes, maxBytes) {
  if (typeof value !== 'string') return false;
  const match = value.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return false;
  const mime = match[1].toLowerCase();
  if (!allowedTypes.has(mime)) return false;

  const base64 = match[2].replace(/\s/g, '');
  if (!base64 || base64.length % 4 !== 0) return false;

  try {
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length > maxBytes) return false;
    return { mime, buffer };
  } catch (error) {
    return false;
  }
}

function isValidImageData(value) {
  return Boolean(parseDataUrl(value, ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES));
}

function parseAvatarData(value) {
  return parseDataUrl(value, ALLOWED_AVATAR_TYPES, MAX_AVATAR_BYTES);
}

function isValidVoiceData(value) {
  if (typeof value !== 'string') return false;
  const match = value.match(/^data:(audio\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
  if (!match || !ALLOWED_AUDIO_TYPES.has(match[1].toLowerCase())) return false;

  const base64 = match[2].replace(/\s/g, '');
  if (!base64 || base64.length % 4 !== 0) return false;

  try {
    return Buffer.byteLength(base64, 'base64') <= MAX_VOICE_BYTES;
  } catch (error) {
    return false;
  }
}

initDatabase();
let messages = loadHistory();
let users = loadUsers();
ensureAdminUser();
let rooms = loadRooms();
const onlineUsers = new Map();
const typingTimers = new Map();

fs.mkdirSync(AVATAR_UPLOAD_DIR, { recursive: true });
fs.mkdirSync(BANNER_UPLOAD_DIR, { recursive: true });
fs.mkdirSync(STICKER_UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  socket.emit('onlineUsers', { count: onlineUsers.size, users: Array.from(onlineUsers.values()).map(publicUser) });
  emitLobby(socket);

  socket.on('latency:ping', (sentAt) => {
    socket.emit('latency:pong', sentAt);
  });

  socket.on('register', (payload) => {
    if (!checkAuthLimit(socket)) {
      socket.emit('authError', '尝试次数太多了，请稍后再试');
      return;
    }

    const input = validateAuthPayload(payload, true);
    if (input.error) {
      socket.emit('authError', input.error);
      return;
    }

    if (findUserByAccount(input.account)) {
      socket.emit('authError', '这个账号已经被注册了');
      return;
    }

    const user = {
      id: crypto.randomUUID(),
      account: input.account,
      username: input.username,
      displayName: input.username,
      avatar: makeAvatar(input.username),
      bio: '',
      profileBanner: '',
      passwordHash: hashPassword(input.password),
      createdAt: new Date().toISOString(),
      lastIp: '',
      lastLoginAt: '',
      isStickerCreator: false,
      stickerCreatorStatus: ''
    };
    users.push(user);
    recordLogin(socket, user);
    bindUser(socket, user);
    clearAuthLimit(socket);
    socket.emit('authSuccess', { user: publicUser(user) });
    emitRenameStatus(socket);
    emitBulletins(socket);
    emitLobby(socket);
    broadcastOnlineUsers();
    broadcastAdminDashboards();
  });

  socket.on('login', (payload) => {
    if (!checkAuthLimit(socket)) {
      socket.emit('authError', '尝试次数太多了，请稍后再试');
      return;
    }

    const input = validateAuthPayload(payload);
    if (input.error) {
      socket.emit('authError', input.error);
      return;
    }

    const user = findUserByAccount(input.account);
    if (!user || !verifyPassword(input.password, user.passwordHash)) {
      socket.emit('authError', '账号或密码不对');
      return;
    }

    recordLogin(socket, user);
    bindUser(socket, user);
    clearAuthLimit(socket);
    socket.emit('authSuccess', { user: publicUser(user) });
    emitRenameStatus(socket);
    emitBulletins(socket);
    emitLobby(socket);
    broadcastOnlineUsers();
    broadcastAdminDashboards();
  });

  socket.on('get lobby', () => {
    if (!requireAuth(socket, '查看聊天列表')) return;
    emitLobby(socket);
  });

  socket.on('get stickers', () => {
    if (!requireAuth(socket, '查看表情包')) return;
    socket.emit('stickers', listStickersForUser(socket.user.id));
  });

  socket.on('upload sticker', (payload) => {
    if (!requireCommunityAccess(socket, '上传表情包')) return;
    if (personalStickerCount(socket.user.id) >= MAX_PERSONAL_STICKERS) {
      socket.emit('sticker error', `个人表情包最多保存 ${MAX_PERSONAL_STICKERS} 个`);
      return;
    }
    const base64 = payload && typeof payload.base64 === 'string' ? payload.base64 : '';
    const result = saveStickerUpload(socket.user, base64, {
      stickerType: 'personal',
      title: payload && payload.title,
      originalName: payload && payload.name
    });
    if (result.error) {
      socket.emit('sticker error', result.error);
      return;
    }
    socket.emit('sticker notice', '表情包已上传');
    socket.emit('stickers', listStickersForUser(socket.user.id));
  });

  socket.on('delete sticker', (stickerIdValue) => {
    if (!requireCommunityAccess(socket, '删除表情包')) return;
    const sticker = stickerById(stickerIdValue);
    if (!sticker || sticker.stickerType !== 'personal' || sticker.ownerUserId !== socket.user.id || sticker.status !== 'active') {
      socket.emit('sticker error', '只能删除自己的个人表情包');
      return;
    }
    db.prepare("UPDATE stickers SET status = 'removed', reviewed_at = ? WHERE id = ?").run(new Date().toISOString(), sticker.id);
    deleteStickerFile(sticker);
    socket.emit('sticker notice', '表情包已删除');
    socket.emit('stickers', listStickersForUser(socket.user.id));
  });

  socket.on('apply sticker creator', (payload) => {
    if (!requireCommunityAccess(socket, '申请表情包创作者')) return;
    const reason = cleanCreatorReason(payload && payload.reason);
    const portfolioNote = cleanCreatorPortfolio(payload && payload.portfolioNote);
    if (!reason) {
      socket.emit('sticker error', '请填写申请理由');
      return;
    }
    if (socket.user.isStickerCreator) {
      socket.emit('sticker error', '你已经是表情包创作者');
      return;
    }
    const latest = latestCreatorRequest(socket.user.id);
    if (latest && latest.status === 'pending') {
      socket.emit('sticker error', '申请正在审核中');
      return;
    }
    const id = `creator-request:${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO sticker_creator_requests (id, user_id, reason, portfolio_note, status, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `).run(id, socket.user.id, reason, portfolioNote, new Date().toISOString());
    socket.user.stickerCreatorStatus = 'pending';
    saveUsers();
    socket.emit('sticker notice', '创作者申请已提交');
    socket.emit('stickers', listStickersForUser(socket.user.id));
    broadcastAdminDashboards();
  });

  socket.on('submit official sticker', (payload) => {
    if (!requireCommunityAccess(socket, '提交官方表情包')) return;
    if (!socket.user.isStickerCreator) {
      socket.emit('sticker error', '需要通过创作者审核后才能提交官方表情包');
      return;
    }
    const title = cleanStickerTitle(payload && payload.title);
    if (!title) {
      socket.emit('sticker error', '请输入表情包名称');
      return;
    }
    const base64 = payload && typeof payload.base64 === 'string' ? payload.base64 : '';
    const result = saveStickerUpload(socket.user, base64, {
      stickerType: 'creator_submission',
      title,
      description: payload && payload.description,
      originalName: payload && payload.name
    });
    if (result.error) {
      socket.emit('sticker error', result.error);
      return;
    }
    socket.emit('sticker notice', '官方表情包已提交审核');
    socket.emit('stickers', listStickersForUser(socket.user.id));
    broadcastAdminDashboards();
  });

  socket.on('get forum posts', () => {
    if (!requireAuth(socket, '查看论坛')) return;
    emitForumPosts(socket);
  });

  socket.on('create forum post', (payload) => {
    if (!requireCommunityAccess(socket, '发帖')) return;
    const title = cleanPostTitle(payload && payload.title);
    const content = cleanPostContent(payload && payload.content);
    if (!title) {
      socket.emit('forum error', '请输入帖子标题');
      return;
    }
    if (!content) {
      socket.emit('forum error', '请输入帖子正文');
      return;
    }

    const post = {
      postId: `post:${crypto.randomUUID()}`,
      userId: socket.user.id,
      username: displayNameOf(socket.user),
      avatar: socket.user.avatar || makeAvatar(displayNameOf(socket.user)),
      title,
      content,
      createdAt: new Date().toISOString()
    };
    try {
      insertForumPost(post);
    } catch (error) {
      socket.emit('forum error', '发帖失败，请稍后再试');
      return;
    }
    const publicPost = publicForumPost({ ...post, commentCount: 0 });
    socket.emit('forum post created', { post: publicPost, comments: [] });
    broadcastForumPosts();
  });

  socket.on('get forum post', (postIdValue) => {
    if (!requireAuth(socket, '查看帖子')) return;
    const postId = cleanForumId(postIdValue);
    const post = getForumPost(postId);
    if (!post) {
      socket.emit('forum error', '帖子不存在');
      return;
    }
    if (socket.currentForumPostId && socket.currentForumPostId !== postId) {
      socket.leave(forumPostChannel(socket.currentForumPostId));
    }
    socket.currentForumPostId = postId;
    socket.join(forumPostChannel(postId));
    socket.emit('forum post detail', { post, comments: listForumComments(postId) });
  });

  socket.on('create forum comment', (payload) => {
    if (!requireCommunityAccess(socket, '评论')) return;
    const postId = cleanForumId(payload && payload.postId);
    const content = cleanCommentContent(payload && payload.content);
    if (!postId || !getForumPost(postId)) {
      socket.emit('forum error', '帖子不存在');
      return;
    }
    if (!content) {
      socket.emit('forum error', '请输入评论内容');
      return;
    }

    const comment = {
      commentId: `comment:${crypto.randomUUID()}`,
      postId,
      userId: socket.user.id,
      username: displayNameOf(socket.user),
      avatar: socket.user.avatar || makeAvatar(displayNameOf(socket.user)),
      content,
      createdAt: new Date().toISOString()
    };
    try {
      insertForumComment(comment);
    } catch (error) {
      socket.emit('forum error', '评论失败，请稍后再试');
      return;
    }
    io.to(forumPostChannel(postId)).emit('forum comment created', { comment: publicForumComment(comment) });
    broadcastForumPosts();
  });

  socket.on('delete forum post', (postIdValue) => {
    if (!requireAuth(socket, '删除帖子')) return;
    const postId = cleanForumId(postIdValue);
    const post = rawForumPost(postId);
    if (!post) {
      socket.emit('forum error', '帖子不存在');
      return;
    }
    if (post.user_id !== socket.user.id && !isAdminUser(socket.user)) {
      socket.emit('forum error', '只能删除自己的帖子');
      return;
    }
    try {
      deleteForumPostById(postId);
    } catch (error) {
      socket.emit('forum error', '删除帖子失败');
      return;
    }
    broadcastAdminDashboards();
  });

  socket.on('delete forum comment', (commentIdValue) => {
    if (!requireAuth(socket, '删除评论')) return;
    const commentId = cleanForumId(commentIdValue);
    const comment = rawForumComment(commentId);
    if (!comment) {
      socket.emit('forum error', '评论不存在');
      return;
    }
    if (comment.user_id !== socket.user.id && !isAdminUser(socket.user)) {
      socket.emit('forum error', '只能删除自己的评论');
      return;
    }
    try {
      db.prepare('DELETE FROM comments WHERE id = ?').run(commentId);
    } catch (error) {
      socket.emit('forum error', '删除评论失败');
      return;
    }
    io.to(forumPostChannel(comment.post_id)).emit('forum comment deleted', {
      postId: comment.post_id,
      commentId
    });
    broadcastForumPostDetail(comment.post_id);
    broadcastForumPosts();
    broadcastAdminDashboards();
  });

  socket.on('report forum post', (payload) => {
    if (!requireCommunityAccess(socket, '举报帖子')) return;
    const postId = cleanForumId(payload && payload.postId);
    const reason = cleanReportReason(payload && payload.reason);
    const details = cleanReportDetails(payload && payload.details);
    const post = rawForumPost(postId);
    if (!post) {
      socket.emit('forum error', '帖子不存在');
      return;
    }
    if (post.user_id === socket.user.id) {
      socket.emit('forum error', '不能举报自己的帖子');
      return;
    }
    if (!reason) {
      socket.emit('forum error', '请选择举报原因');
      return;
    }
    try {
      db.prepare(`
        INSERT INTO post_reports (id, post_id, reporter_user_id, reported_user_id, reason, details, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
      `).run(
        `report:${crypto.randomUUID()}`,
        postId,
        socket.user.id,
        post.user_id,
        reason,
        details,
        new Date().toISOString()
      );
    } catch (error) {
      socket.emit('forum error', '你已经举报过该帖子了');
      return;
    }
    socket.emit('forum notice', '举报已提交，管理员会尽快处理');
    broadcastAdminDashboards();
  });

  socket.on('get user profile', (userIdValue) => {
    if (!requireAuth(socket, '查看用户主页')) return;
    const userId = typeof userIdValue === 'string' ? userIdValue.trim() : '';
    const user = users.find((item) => item.id === userId);
    if (!user) {
      socket.emit('profileError', '用户不存在');
      return;
    }
    socket.emit('user profile', { profile: publicProfile(user, socket.user) });
  });

  socket.on('star user', (userIdValue) => {
    if (!requireCommunityAccess(socket, '点 Star')) return;
    const userId = typeof userIdValue === 'string' ? userIdValue.trim() : '';
    const target = users.find((item) => item.id === userId);
    if (!target) {
      socket.emit('profileError', '用户不存在');
      return;
    }
    if (target.id === socket.user.id) {
      socket.emit('profileError', '不能给自己点 Star');
      return;
    }

    const todaysStar = todaysStarForUser(socket.user.id);
    if (todaysStar) {
      socket.emit('profileError', todaysStar.to_user_id === target.id
        ? '你今天已经给这位用户点过 Star 了。'
        : '你今天已经点过 Star 了，明天再来吧。');
      socket.emit('user profile', { profile: publicProfile(target, socket.user) });
      return;
    }

    try {
      db.prepare(`
        INSERT INTO user_stars (id, from_user_id, to_user_id, created_at, star_date)
        VALUES (?, ?, ?, ?, ?)
      `).run(`star:${crypto.randomUUID()}`, socket.user.id, target.id, new Date().toISOString(), todayStarDate());
    } catch (error) {
      socket.emit('profileError', '你今天已经点过 Star 了，明天再来吧。');
      socket.emit('user profile', { profile: publicProfile(target, socket.user) });
      return;
    }

    socket.emit('profileNotice', `已为 ${displayNameOf(target)} 点亮 Star`);
    socket.emit('user profile', { profile: publicProfile(target, socket.user) });
    broadcastOnlineUsers();
    broadcastForumPosts();
    broadcastAdminDashboards();
  });

  socket.on('update profile details', (payload) => {
    if (!requireCommunityAccess(socket, '更新个人主页')) return;
    const bio = cleanBio(payload && payload.bio);
    syncUserProfile(socket.user, { bio });
    socket.emit('profileNotice', '个人简介已保存');
    socket.emit('user profile', { profile: publicProfile(socket.user, socket.user) });
  });

  socket.on('profile banner upload', (payload) => {
    if (!requireCommunityAccess(socket, '上传主页背景')) return;
    const base64 = payload && typeof payload.base64 === 'string' ? payload.base64 : '';
    const previousBanner = socket.user.profileBanner;
    const result = saveProfileBannerUpload(socket.user, base64);
    if (result.error) {
      socket.emit('profileError', result.error);
      return;
    }
    syncUserProfile(socket.user, { profileBanner: result.profileBanner });
    deleteBannerFile(previousBanner);
    socket.emit('profileNotice', '主页背景已更新');
    socket.emit('user profile', { profile: publicProfile(socket.user, socket.user) });
  });

  socket.on('profile banner reset', () => {
    if (!requireCommunityAccess(socket, '恢复主页背景')) return;
    const previousBanner = socket.user.profileBanner;
    syncUserProfile(socket.user, { profileBanner: '' });
    deleteBannerFile(previousBanner);
    socket.emit('profileNotice', '主页背景已恢复默认');
    socket.emit('user profile', { profile: publicProfile(socket.user, socket.user) });
  });

  socket.on('avatar upload', (payload) => {
    if (!requireCommunityAccess(socket, '修改头像')) return;
    const base64 = payload && typeof payload.base64 === 'string' ? payload.base64 : '';
    const previousAvatar = socket.user.avatar;
    const result = saveAvatarUpload(socket.user, base64);
    if (result.error) {
      socket.emit('profileError', result.error);
      return;
    }
    syncUserAvatar(socket.user, result.avatar);
    deleteAvatarFile(previousAvatar);
    socket.emit('profileNotice', '头像已更新');
  });

  socket.on('avatar reset', () => {
    if (!requireCommunityAccess(socket, '恢复默认头像')) return;
    const previousAvatar = socket.user.avatar;
    syncUserAvatar(socket.user, makeAvatar(displayNameOf(socket.user)));
    deleteAvatarFile(previousAvatar);
    socket.emit('profileNotice', '已恢复默认头像');
  });

  socket.on('get rename status', () => {
    if (!requireAuth(socket, '查看昵称状态')) return;
    emitRenameStatus(socket);
  });

  socket.on('rename display name', (payload) => {
    if (!requireCommunityAccess(socket, '修改昵称')) return;
    const newDisplayName = cleanDisplayName(payload && payload.displayName);
    if (!newDisplayName) {
      socket.emit('rename result', { status: 'error', message: `昵称需要 ${MIN_DISPLAY_NAME_LENGTH}-${MAX_DISPLAY_NAME_LENGTH} 个字符` });
      return;
    }
    if (newDisplayName === displayNameOf(socket.user)) {
      socket.emit('rename result', { status: 'error', message: '新昵称不能和当前昵称一样' });
      return;
    }
    if (isAdminUser(socket.user)) {
      const result = applyDisplayName(socket.user, newDisplayName, { approvalStatus: 'approved' });
      io.emit('system', { type: 'rename', previousUsername: result.oldDisplayName, username: result.newDisplayName });
      socket.emit('rename result', { status: 'approved', message: '管理员昵称已直接更新', displayName: result.newDisplayName });
      emitBulletins(socket);
      return;
    }
    if (pendingRenameRequest(socket.user.id)) {
      socket.emit('rename result', { status: 'pending', message: '你已经有一个待审核的改名申请' });
      emitRenameStatus(socket);
      return;
    }

    const used = recentRenameCount(socket.user.id);
    if (used < RENAME_FREE_LIMIT) {
      const result = applyDisplayName(socket.user, newDisplayName, { approvalStatus: 'auto_approved' });
      io.emit('system', { type: 'rename', previousUsername: result.oldDisplayName, username: result.newDisplayName });
      socket.emit('rename result', { status: 'approved', message: '昵称已更新', displayName: result.newDisplayName });
      emitBulletins(socket);
      return;
    }

    const request = createRenameRequest(socket.user, newDisplayName);
    socket.emit('rename result', { status: 'pending', message: '已提交管理员审核', request });
    emitRenameStatus(socket);
    broadcastAdminDashboards();
  });

  socket.on('get bulletins', () => {
    if (!requireAuth(socket, '查看公告')) return;
    emitBulletins(socket);
  });

  socket.on('mark bulletin read', (announcementId) => {
    if (!requireAuth(socket, '标记公告')) return;
    const id = typeof announcementId === 'string' ? announcementId : '';
    if (!id) return;
    db.prepare(`
      INSERT INTO announcement_reads (announcement_id, user_id, read_at)
      VALUES (?, ?, ?)
      ON CONFLICT(announcement_id, user_id) DO UPDATE SET read_at = excluded.read_at
    `).run(id, socket.user.id, new Date().toISOString());
    emitBulletins(socket);
  });

  socket.on('mark all bulletins read', () => {
    if (!requireAuth(socket, '标记公告')) return;
    const now = new Date().toISOString();
    listAnnouncementsForUser(socket.user.id).forEach((announcement) => {
      db.prepare(`
        INSERT INTO announcement_reads (announcement_id, user_id, read_at)
        VALUES (?, ?, ?)
        ON CONFLICT(announcement_id, user_id) DO UPDATE SET read_at = excluded.read_at
      `).run(announcement.id, socket.user.id, now);
    });
    emitBulletins(socket);
  });

  socket.on('join room', (roomIdValue) => {
    if (!requireAuth(socket, '进入聊天组')) return;
    const roomId = cleanRoomId(roomIdValue);
    const room = findRoom(roomId);
    if (!room) {
      socket.emit('messageError', '聊天组不存在');
      return;
    }

    joinSocketRoom(socket, room.id);
    ensureRoomMember(room.id, socket.user.id);
    socket.emit('room joined', { room: publicRoom(room), messages: messagesForRoom(room.id) });
    io.to(roomChannel(room.id)).emit('system', { type: 'join', username: displayNameOf(socket.user), roomId: room.id });
    broadcastLobby();
    broadcastAdminDashboards();
  });

  socket.on('open private chat', (targetUserId) => {
    if (!requireAuth(socket, '私聊')) return;
    const target = users.find((user) => user.id === targetUserId);
    if (!target || target.id === socket.user.id) {
      socket.emit('messageError', '无法打开这个私聊');
      return;
    }

    const roomId = privateRoomId(socket.user.id, target.id);
    joinSocketRoom(socket, roomId);
    socket.emit('room joined', {
      room: {
        id: roomId,
        name: privateRoomName(socket.user, target),
        type: 'private',
        targetUserId: target.id,
        joinedCount: 2,
        onlineCount: [socket.user.id, target.id].filter((id) => publicOnlineUsers().some((user) => user.id === id)).length
      },
      messages: messagesForRoom(roomId)
    });
  });

  socket.on('create room', (payload) => {
    if (!requireAuth(socket, '创建聊天组')) return;
    const name = cleanRoomName(payload && payload.name);
    const code = payload && payload.code;
    const isAdmin = isAdminUser(socket.user);
    if (!name) {
      socket.emit('messageError', '请输入聊天组名称');
      return;
    }
    if (!isAdmin && !isValidGroupCode(code)) {
      socket.emit('messageError', '建组码不正确或已过期');
      return;
    }

    const id = `group:${crypto.randomUUID()}`;
    const room = {
      id,
      name,
      type: 'group',
      createdBy: socket.user.id,
      createdAt: new Date().toISOString()
    };
    rooms.push(room);
    upsertRoom(room);
    ensureRoomMember(room.id, socket.user.id);
    joinSocketRoom(socket, room.id);
    socket.emit('room created', { room: publicRoom(room) });
    socket.emit('room joined', { room: publicRoom(room), messages: messagesForRoom(room.id) });
    broadcastLobby();
    broadcastAdminDashboards();
  });

  socket.on('leave room', () => {
    if (!requireAuth(socket, '返回')) return;
    leaveCurrentRoom(socket);
    socket.currentRoomId = '';
    emitLobby(socket);
    broadcastLobby();
  });

  socket.on('logout', () => {
    if (!socket.user) {
      socket.emit('loggedOut');
      return;
    }

    const roomId = socket.currentRoomId;
    const username = displayNameOf(socket.user);
    clearTyping(socket);
    if (roomId) {
      socket.leave(roomChannel(roomId));
      io.to(roomChannel(roomId)).emit('system', { type: 'leave', username, roomId });
    }
    socket.currentRoomId = '';
    socket.user = null;
    onlineUsers.delete(socket.id);
    socket.emit('loggedOut');
    emitLobby(socket);
    broadcastOnlineUsers();
    broadcastAdminDashboards();
  });

  socket.on('chat message', (msg) => {
    const content = cleanText(msg);
    if (!requireAuth(socket, '发消息') || !content) return;
    if (!socket.currentRoomId) {
      socket.emit('messageError', '请先选择聊天组或私聊');
      return;
    }
    clearTyping(socket);
    const data = {
      id: crypto.randomUUID(),
      roomId: socket.currentRoomId,
      type: 'text',
      userId: socket.user.id,
      username: displayNameOf(socket.user),
      avatar: socket.user.avatar || makeAvatar(displayNameOf(socket.user)),
      content,
      timestamp: new Date().toISOString(),
      recalled: false
    };
    messages = trimHistory([...messages, data]);
    saveHistory(messages);
    io.to(roomChannel(socket.currentRoomId)).emit('chat message', data);
    notifyPrivateRecipients(data);
    broadcastAdminDashboards();
  });

  socket.on('chat image', (data) => {
    const base64 = data && typeof data.base64 === 'string' ? data.base64 : '';
    if (!requireAuth(socket, '发图片')) return;
    if (!socket.currentRoomId) {
      socket.emit('messageError', '请先选择聊天组或私聊');
      return;
    }
    if (!isValidImageData(base64)) {
      socket.emit('messageError', '图片格式不支持或超过 5MB');
      return;
    }
    clearTyping(socket);
    const imageData = {
      id: crypto.randomUUID(),
      roomId: socket.currentRoomId,
      type: 'image',
      userId: socket.user.id,
      username: displayNameOf(socket.user),
      avatar: socket.user.avatar || makeAvatar(displayNameOf(socket.user)),
      content: base64,
      timestamp: new Date().toISOString(),
      recalled: false
    };
    messages = trimHistory([...messages, imageData]);
    saveHistory(messages);
    io.to(roomChannel(socket.currentRoomId)).emit('chat message', imageData);
    notifyPrivateRecipients(imageData);
    broadcastAdminDashboards();
  });

  socket.on('chat voice', (data) => {
    const base64 = data && typeof data.base64 === 'string' ? data.base64 : '';
    const duration = Number(data && data.duration);
    if (!requireAuth(socket, '发语音')) return;
    if (!socket.currentRoomId) {
      socket.emit('messageError', '请先选择聊天组或私聊');
      return;
    }
    if (!isValidVoiceData(base64)) {
      socket.emit('messageError', '语音格式不支持或超过 3MB');
      return;
    }
    clearTyping(socket);
    const voiceData = {
      id: crypto.randomUUID(),
      roomId: socket.currentRoomId,
      type: 'voice',
      userId: socket.user.id,
      username: displayNameOf(socket.user),
      avatar: socket.user.avatar || makeAvatar(displayNameOf(socket.user)),
      content: base64,
      duration: Number.isFinite(duration) ? Math.max(0, Math.round(duration)) : 0,
      timestamp: new Date().toISOString(),
      recalled: false
    };
    messages = trimHistory([...messages, voiceData]);
    saveHistory(messages);
    io.to(roomChannel(socket.currentRoomId)).emit('chat message', voiceData);
    notifyPrivateRecipients(voiceData);
    broadcastAdminDashboards();
  });

  socket.on('chat sticker', (payload) => {
    if (!requireCommunityAccess(socket, '发送表情包')) return;
    if (!socket.currentRoomId) {
      socket.emit('messageError', '请先选择聊天组或私聊');
      return;
    }
    const sticker = stickerById(payload && payload.stickerId);
    if (!isStickerSendable(sticker, socket.user.id)) {
      socket.emit('messageError', '这个表情包不可发送');
      return;
    }
    clearTyping(socket);
    const stickerData = {
      id: crypto.randomUUID(),
      roomId: socket.currentRoomId,
      type: 'sticker',
      userId: socket.user.id,
      username: displayNameOf(socket.user),
      avatar: socket.user.avatar || makeAvatar(displayNameOf(socket.user)),
      content: sticker.url,
      stickerId: sticker.id,
      timestamp: new Date().toISOString(),
      recalled: false
    };
    messages = trimHistory([...messages, stickerData]);
    saveHistory(messages);
    io.to(roomChannel(socket.currentRoomId)).emit('chat message', stickerData);
    notifyPrivateRecipients(stickerData);
    broadcastAdminDashboards();
  });

  socket.on('recall message', (messageId) => {
    if (!requireAuth(socket, '撤回消息') || typeof messageId !== 'string') return;
    const message = messages.find((item) => item.id === messageId);
    if (!message || message.userId !== socket.user.id || message.recalled || message.roomId !== socket.currentRoomId) {
      socket.emit('messageError', '只能撤回自己发出的消息');
      return;
    }
    if (Date.now() - new Date(message.timestamp).getTime() > RECALL_WINDOW_MS) {
      socket.emit('messageError', '消息超过 2 分钟后不可撤回');
      return;
    }

    message.recalled = true;
    message.content = '';
    saveHistory(messages);
    io.to(roomChannel(message.roomId)).emit('message recalled', publicMessage(message));
    broadcastAdminDashboards();
  });

  socket.on('admin get dashboard', () => {
    if (!requireAdmin(socket)) return;
    emitAdminDashboard(socket);
  });

  socket.on('admin decide rename', (payload) => {
    if (!requireAdmin(socket)) return;
    const requestId = payload && typeof payload.requestId === 'string' ? payload.requestId : '';
    const decision = payload && payload.status === 'rejected' ? 'rejected' : 'approved';
    const note = cleanText(payload && payload.note, 240);
    const request = db.prepare('SELECT * FROM rename_requests WHERE id = ? AND status = ?').get(requestId, 'pending');
    if (!request) {
      socket.emit('admin error', '改名申请不存在或已处理');
      return;
    }
    const user = userById(request.user_id);
    if (!user) {
      socket.emit('admin error', '申请用户不存在');
      return;
    }
    const decidedAt = new Date().toISOString();
    try {
      db.prepare(`
        UPDATE rename_requests
        SET status = ?, decided_by = ?, decided_at = ?, decision_note = ?
        WHERE id = ?
      `).run(decision, socket.user.id, decidedAt, note, requestId);
      if (decision === 'approved') {
        const result = applyDisplayName(user, request.new_display_name, {
          approvedBy: socket.user.id,
          approvalStatus: 'approved'
        });
        io.emit('system', { type: 'rename', previousUsername: result.oldDisplayName, username: result.newDisplayName });
        createAnnouncement({
          type: 'rename',
          title: '改名申请已通过',
          content: `你的展示昵称已更新为「${result.newDisplayName}」。${note ? `管理员备注：${note}` : ''}`,
          targetUserId: user.id,
          createdBy: socket.user.id,
          priority: 'high'
        });
      } else {
        createAnnouncement({
          type: 'rename',
          title: '改名申请未通过',
          content: `你申请的展示昵称「${request.new_display_name}」未通过审核。${note ? `管理员备注：${note}` : ''}`,
          targetUserId: user.id,
          createdBy: socket.user.id,
          priority: 'normal'
        });
      }
    } catch (error) {
      socket.emit('admin error', '处理改名申请失败');
      return;
    }
    socketsForUser(user.id).forEach((connectedSocket) => {
      emitRenameStatus(connectedSocket);
      emitBulletins(connectedSocket);
    });
    socket.emit('admin notice', decision === 'approved' ? '已通过改名申请' : '已拒绝改名申请');
    broadcastAdminDashboards();
  });

  socket.on('admin publish bulletin', (payload) => {
    if (!requireAdmin(socket)) return;
    const announcement = createAnnouncement({
      type: payload && payload.type,
      title: payload && payload.title,
      content: payload && payload.content,
      priority: payload && payload.priority,
      createdBy: socket.user.id
    });
    if (!announcement) {
      socket.emit('admin error', '公告标题和内容不能为空');
      return;
    }
    socket.emit('admin notice', '公告已发布');
    broadcastAdminDashboards();
  });

  socket.on('admin handle report', (payload) => {
    if (!requireAdmin(socket)) return;
    const reportId = payload && typeof payload.reportId === 'string' ? payload.reportId : '';
    const action = payload && typeof payload.action === 'string' ? payload.action : '';
    const note = cleanAdminNote(payload && payload.note);
    const report = db.prepare('SELECT * FROM post_reports WHERE id = ?').get(reportId);
    if (!report) {
      socket.emit('admin error', '举报不存在');
      return;
    }
    const post = rawForumPost(report.post_id);
    const reportedUser = userById(report.reported_user_id);
    let status = 'dismissed';
    let actionTaken = 'dismissed';

    try {
      if (action === 'view') {
        socket.emit('admin open reported post', {
          postId: report.post_id,
          post: post ? publicForumPost(rowToPost({ ...post, comment_count: 0 })) : null,
          comments: post ? listForumComments(report.post_id) : []
        });
        return;
      }

      if (action === 'delete_post' || action === 'delete_and_ban') {
        deleteForumPostById(report.post_id);
        status = 'post_deleted';
        actionTaken = 'post_deleted';
      }

      if (action === 'ban_user' || action === 'delete_and_ban') {
        if (!reportedUser) {
          socket.emit('admin error', '被举报用户不存在');
          return;
        }
        if (!banUser(reportedUser, note || reportReasonLabel(report.reason))) {
          socket.emit('admin error', '不能封禁该用户');
          return;
        }
        status = 'user_banned';
        actionTaken = action === 'delete_and_ban' ? 'post_deleted,user_banned' : 'user_banned';
      }

      if (!['dismiss', 'delete_post', 'ban_user', 'delete_and_ban'].includes(action)) {
        socket.emit('admin error', '请选择有效处理方式');
        return;
      }

      updateReportStatus(reportId, status, socket.user.id, note, actionTaken);
    } catch (error) {
      socket.emit('admin error', '处理举报失败');
      return;
    }

    socket.emit('admin notice', '举报已处理');
    broadcastAdminDashboards();
  });

  socket.on('admin decide sticker creator', (payload) => {
    if (!requireAdmin(socket)) return;
    const requestId = payload && typeof payload.requestId === 'string' ? payload.requestId : '';
    const decision = payload && payload.status === 'rejected' ? 'rejected' : 'approved';
    const note = cleanAdminNote(payload && payload.note);
    const request = db.prepare('SELECT * FROM sticker_creator_requests WHERE id = ?').get(requestId);
    if (!request) {
      socket.emit('admin error', '创作者申请不存在');
      return;
    }
    if (request.status !== 'pending') {
      socket.emit('admin error', '这个创作者申请已经处理过');
      return;
    }
    const user = userById(request.user_id);
    if (!user) {
      socket.emit('admin error', '申请用户不存在');
      return;
    }
    const reviewedAt = new Date().toISOString();
    db.prepare(`
      UPDATE sticker_creator_requests
      SET status = ?, admin_user_id = ?, admin_note = ?, reviewed_at = ?
      WHERE id = ?
    `).run(decision, socket.user.id, note, reviewedAt, requestId);
    user.isStickerCreator = decision === 'approved';
    user.stickerCreatorStatus = decision;
    saveUsers();
    createAnnouncement({
      type: 'admin',
      title: decision === 'approved' ? '表情包创作者申请已通过' : '表情包创作者申请未通过',
      content: decision === 'approved'
        ? `你现在可以提交官方表情包审核了。${note ? `管理员备注：${note}` : ''}`
        : `你的表情包创作者申请未通过。${note ? `管理员备注：${note}` : ''}`,
      targetUserId: user.id,
      createdBy: socket.user.id,
      priority: decision === 'approved' ? 'high' : 'normal'
    });
    socketsForUser(user.id).forEach((connectedSocket) => {
      connectedSocket.user = user;
      connectedSocket.emit('profile updated', { user: publicUser(user) });
      connectedSocket.emit('stickers', listStickersForUser(user.id));
      emitBulletins(connectedSocket);
    });
    socket.emit('admin notice', decision === 'approved' ? '已通过创作者申请' : '已拒绝创作者申请');
    broadcastOnlineUsers();
    broadcastAdminDashboards();
  });

  socket.on('admin decide sticker submission', (payload) => {
    if (!requireAdmin(socket)) return;
    const stickerId = payload && typeof payload.stickerId === 'string' ? payload.stickerId : '';
    const action = payload && typeof payload.action === 'string' ? payload.action : '';
    const note = cleanAdminNote(payload && payload.note);
    const sticker = stickerById(stickerId);
    if (!sticker || sticker.stickerType !== 'creator_submission') {
      socket.emit('admin error', '表情包提交不存在');
      return;
    }
    if ((action === 'approve' || action === 'reject') && sticker.status !== 'pending') {
      socket.emit('admin error', '这个表情包提交已经处理过');
      return;
    }
    if (action === 'remove' && sticker.status !== 'approved') {
      socket.emit('admin error', '只能下架已通过的官方表情包');
      return;
    }
    const status = action === 'approve' ? 'approved' : action === 'remove' ? 'removed' : 'rejected';
    db.prepare(`
      UPDATE stickers
      SET status = ?, reviewed_at = ?, reviewed_by = ?, admin_note = ?
      WHERE id = ?
    `).run(status, new Date().toISOString(), socket.user.id, note, sticker.id);
    if (status === 'removed') deleteStickerFile(sticker);
    const owner = userById(sticker.ownerUserId);
    if (owner) {
      createAnnouncement({
        type: 'admin',
        title: status === 'approved' ? '官方表情包已通过审核' : status === 'removed' ? '官方表情包已下架' : '官方表情包未通过审核',
        content: `「${sticker.title}」${status === 'approved' ? '已进入官方表情包库。' : status === 'removed' ? '已被管理员下架。' : '未通过审核。'}${note ? `管理员备注：${note}` : ''}`,
        targetUserId: owner.id,
        createdBy: socket.user.id,
        priority: status === 'approved' ? 'high' : 'normal'
      });
      socketsForUser(owner.id).forEach((connectedSocket) => {
        connectedSocket.emit('stickers', listStickersForUser(owner.id));
        emitBulletins(connectedSocket);
      });
    }
    io.sockets.sockets.forEach((connectedSocket) => {
      if (connectedSocket.user) connectedSocket.emit('stickers', listStickersForUser(connectedSocket.user.id));
    });
    socket.emit('admin notice', status === 'approved' ? '已通过官方表情包' : status === 'removed' ? '已下架官方表情包' : '已拒绝官方表情包');
    broadcastAdminDashboards();
  });

  socket.on('admin clear history', () => {
    if (!requireAdmin(socket)) return;
    messages = [];
    try {
      db.exec('DELETE FROM messages');
    } catch (error) {
      socket.emit('admin error', '清空聊天记录失败');
      return;
    }
    refreshOpenRooms();
    broadcastAdminDashboards();
  });

  socket.on('admin update username', (payload) => {
    if (!requireAdmin(socket)) return;
    const userId = payload && typeof payload.userId === 'string' ? payload.userId : '';
    const displayName = cleanDisplayName(payload && payload.username);
    if (!userId || !displayName) {
      socket.emit('admin error', '请输入有效昵称');
      return;
    }

    const user = users.find((item) => item.id === userId);
    if (!user) {
      socket.emit('admin error', '用户不存在');
      return;
    }

    try {
      const result = applyDisplayName(user, displayName, {
        approvedBy: socket.user.id,
        approvalStatus: 'approved'
      });
      createAnnouncement({
        type: 'admin',
        title: '展示昵称已由管理员更新',
        content: `你的展示昵称已从「${result.oldDisplayName}」更新为「${result.newDisplayName}」。`,
        targetUserId: user.id,
        createdBy: socket.user.id,
        priority: 'normal'
      });
      io.emit('system', { type: 'rename', previousUsername: result.oldDisplayName, username: result.newDisplayName });
    } catch (error) {
      socket.emit('admin error', '修改昵称失败');
      return;
    }
    socket.emit('admin notice', '展示昵称已更新');
    broadcastAdminDashboards();
  });

  socket.on('admin reset password', (payload) => {
    if (!requireAdmin(socket)) return;
    const userId = payload && typeof payload.userId === 'string' ? payload.userId : '';
    const password = typeof (payload && payload.password) === 'string' ? payload.password : '';
    if (!userId || password.length < MIN_PASSWORD_LENGTH) {
      socket.emit('admin error', `密码至少 ${MIN_PASSWORD_LENGTH} 位`);
      return;
    }

    const user = users.find((item) => item.id === userId);
    if (!user) {
      socket.emit('admin error', '用户不存在');
      return;
    }

    user.passwordHash = hashPassword(password);
    saveUsers();
    socket.emit('admin notice', `已重置 ${user.username} 的密码`);
    broadcastAdminDashboards();
  });

  socket.on('admin delete room', (roomIdValue) => {
    if (!requireAdmin(socket)) return;
    const roomId = cleanRoomId(roomIdValue);
    if (!roomId || roomId === DEFAULT_ROOM_ID) {
      socket.emit('admin error', '默认群组不能删除');
      return;
    }
    const room = rooms.find((item) => item.id === roomId && item.type === 'group');
    if (!room) {
      socket.emit('admin error', '群组不存在');
      return;
    }

    try {
      db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);
      db.prepare('DELETE FROM room_members WHERE room_id = ?').run(roomId);
      db.prepare('DELETE FROM messages WHERE room_id = ?').run(roomId);
    } catch (error) {
      socket.emit('admin error', '删除群组失败');
      return;
    }
    rooms = rooms.filter((item) => item.id !== roomId);
    messages = messages.filter((message) => message.roomId !== roomId);

    io.sockets.sockets.forEach((connectedSocket) => {
      if (connectedSocket.currentRoomId !== roomId) return;
      connectedSocket.leave(roomChannel(roomId));
      connectedSocket.currentRoomId = '';
      connectedSocket.emit('room deleted', { roomId, name: room.name });
      emitLobby(connectedSocket);
    });
    socket.emit('admin notice', `已删除群组 ${room.name}`);
    broadcastLobby();
    broadcastAdminDashboards();
  });

  socket.on('typing', (isTyping) => {
    if (!socket.user || !socket.currentRoomId) return;

    if (isTyping) {
      socket.to(roomChannel(socket.currentRoomId)).emit('typing', { username: displayNameOf(socket.user), isTyping: true, roomId: socket.currentRoomId });
      clearTimeout(typingTimers.get(socket.id));
      typingTimers.set(socket.id, setTimeout(() => clearTyping(socket), TYPING_TIMEOUT_MS));
      return;
    }

    clearTyping(socket);
  });

  socket.on('disconnect', () => {
    if (socket.user) {
      const roomId = socket.currentRoomId;
      clearTyping(socket);
      if (roomId) io.to(roomChannel(roomId)).emit('system', { type: 'leave', username: displayNameOf(socket.user), roomId });
      onlineUsers.delete(socket.id);
      broadcastOnlineUsers();
      broadcastAdminDashboards();
    }
  });
});

function clearTyping(socket) {
  clearTimeout(typingTimers.get(socket.id));
  typingTimers.delete(socket.id);
  if (socket.user && socket.currentRoomId) {
    socket.to(roomChannel(socket.currentRoomId)).emit('typing', { username: displayNameOf(socket.user), isTyping: false, roomId: socket.currentRoomId });
  }
}

server.listen(APP_PORT, () => {
  console.log(`Uni 5 已启动 -> 端口 ${APP_PORT}`);
});
