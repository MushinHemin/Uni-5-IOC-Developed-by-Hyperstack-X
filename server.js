const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
sharp.cache(false);
sharp.concurrency(1);
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
app.use(express.json({ limit: '1mb', inflate: false }));

const DATA_FILE = path.join(__dirname, 'chat-history.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const DB_FILE = path.join(__dirname, 'beluga-chat.sqlite');
const PACKAGE_VERSION = require('./package.json').version;
const SERVER_STARTED_AT = new Date().toISOString();
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const AVATAR_UPLOAD_DIR = path.join(UPLOADS_DIR, 'avatars');
const BANNER_UPLOAD_DIR = path.join(UPLOADS_DIR, 'banners');
const STICKER_UPLOAD_DIR = path.join(UPLOADS_DIR, 'stickers');
const POST_IMAGE_UPLOAD_DIR = path.join(UPLOADS_DIR, 'post-images');
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
const MAX_POST_IMAGES = 9;
const MAX_PERSONAL_STICKERS = 50;
const MAX_VOICE_BYTES = 3 * 1024 * 1024;
const MAX_HISTORY_MESSAGES = 300;
const MAX_FORUM_POSTS = 120;
const TYPING_TIMEOUT_MS = 3000;
const AUTH_WINDOW_MS = 60 * 1000;
const AUTH_MAX_ATTEMPTS = 8;
const ADMIN_ACCOUNT = cleanEnv(process.env.ADMIN_ACCOUNT) || 'admin';
const ADMIN_PASSWORD = cleanEnv(process.env.ADMIN_PASSWORD);
const ADMIN_USERNAME = cleanEnv(process.env.ADMIN_USERNAME) || 'Administrator';
const DEFAULT_ROOM_ID = 'club-91';
const DEFAULT_ROOM_NAME = 'UniIOC World Channel';
const RECALL_WINDOW_MS = 2 * 60 * 1000;
const GROUP_CODE_WINDOW_MS = 10 * 60 * 1000;
let currentGroupInvite = null;
let transactionSequence = 0;
const groupInviteAttempts = new Map();
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
const NOTIFICATION_TYPES = new Set([
  'chat_message',
  'forum_comment',
  'star_received',
  'report_resolved',
  'creator_request_result',
  'sticker_submission_result',
  'announcement',
  'account_restricted',
  'reaction_received'
]);
const SEARCH_SCOPES = new Set(['all', 'users', 'posts', 'messages', 'announcements', 'stickers']);
const ALLOWED_REACTIONS = new Set(['👍', '❤️', '😂', '😭', '⭐', '🎉']);
const NOTIFICATION_PREFERENCE_KEYS = new Set([
  'forum_comment',
  'forum_reply',
  'post_like',
  'comment_like',
  'star_received',
  'sticker_review',
  'creator_result'
]);
const ALWAYS_ON_NOTIFICATION_TYPES = new Set(['announcement', 'account_restricted', 'report_resolved']);
const IMAGE_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
};
let db;
const apiSessions = new Map();
let notificationsReady = false;

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

function isStrongBootstrapPassword(password) {
  return typeof password === 'string' && password.length >= 12 &&
    !['change-me-admin-password', 'replace-with-a-strong-password'].includes(password);
}

function warnIfDefaultAdminPassword() {
  if (!isStrongBootstrapPassword(ADMIN_PASSWORD)) {
    console.warn('[Uni 5 security] No strong bootstrap password configured; existing administrator credentials are preserved. New administrator creation will be refused.');
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

function transaction(operation) {
  const name = `uni_${++transactionSequence}`;
  db.exec(`SAVEPOINT ${name}`);
  try { const result = operation(); db.exec(`RELEASE ${name}`); return result; }
  catch (error) { db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`); throw error; }
}

function importLegacyOnce(key, table, file, normalize, save) {
  if (db.prepare('SELECT 1 FROM data_migrations WHERE name=?').get(key)) return;
  transaction(() => {
    const existing = db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
    let imported = 0;
    if (!existing && fs.existsSync(file)) {
      // Never rewrite malformed source JSON or silently discard invalid records.
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(raw)) throw new Error('Legacy import requires an array');
      const seen = new Set();
      for (const record of raw) {
        const value = normalize(record);
        if (!value || seen.has(value.id)) throw new Error('Legacy import contains invalid/duplicate records; source retained');
        seen.add(value.id); save(value); imported++;
      }
    }
    db.prepare('INSERT INTO data_migrations(name,details,completed_at) VALUES(?,?,?)')
      .run(key, JSON.stringify({ existing, imported }), new Date().toISOString());
  });
}

function loadHistory() {
  importLegacyOnce('legacy-messages-v1', 'messages', DATA_FILE, normalizeMessage, upsertMessage);
  return db.prepare('SELECT * FROM (SELECT * FROM messages ORDER BY created_at DESC,id DESC LIMIT ?) ORDER BY created_at,id')
    .all(MAX_HISTORY_MESSAGES).map(rowToMessage).filter(Boolean);
}

let saveQueue = Promise.resolve();
let userSaveQueue = Promise.resolve();

function loadUsers() {
  importLegacyOnce('legacy-users-v1', 'users', USERS_FILE, normalizeUser, upsertUser);
  return db.prepare('SELECT * FROM users ORDER BY created_at').all().map(rowToUser).filter(Boolean);
}

function loadRooms() {
  const rows = db.prepare('SELECT * FROM rooms ORDER BY created_at ASC').all();
  return rows.map(rowToRoom).filter(Boolean);
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

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripHtml(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function isSafeLink(value) {
  if (typeof value !== 'string') return false;
  const href = value.trim().replace(/[\u0000-\u001f\u007f\s]+/g, '');
  if (!href) return false;
  if (/^(javascript|vbscript|data):/i.test(href)) return false;
  if (href.startsWith('/')) return !href.startsWith('//') && !/^\/uploads\/(?!post-images\/)/i.test(href);
  return /^https?:\/\//i.test(href);
}

function isSafePostImageUrl(value) {
  return typeof value === 'string' && /^\/uploads\/post-images\/[a-zA-Z0-9_.-]+\.(jpg|jpeg|png|webp|gif)$/.test(value.trim());
}

function sanitizeRichHtml(value) {
  const raw = typeof value === 'string' ? value.slice(0, 60000) : '';
  if (!raw.trim()) return '';
  const blocked = raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\s*(script|style|iframe|object|embed|form|svg|math)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\/?(script|style|iframe|object|embed|form|input|button|textarea|select|option|video|audio|svg|math|link|meta|base)[^>]*>/gi, '');
  const allowed = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'a', 'img']);
  return blocked.replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (match, tagName, attrText = '') => {
    const tag = String(tagName || '').toLowerCase();
    if (!allowed.has(tag)) return '';
    if (tag === 'br') return '<br>';
    if (match.startsWith('</')) return `</${tag}>`;
    if (tag === 'a') {
      const hrefMatch = String(attrText).match(/\shref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const href = hrefMatch ? (hrefMatch[2] || hrefMatch[3] || hrefMatch[4] || '').trim().replace(/[\u0000-\u001f\u007f\s]+/g, '') : '';
      if (!isSafeLink(href)) return '<a>';
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">`;
    }
    if (tag === 'img') {
      const srcMatch = String(attrText).match(/\ssrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const altMatch = String(attrText).match(/\salt\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const src = srcMatch ? (srcMatch[2] || srcMatch[3] || srcMatch[4] || '').trim() : '';
      const alt = altMatch ? cleanText(altMatch[2] || altMatch[3] || altMatch[4] || '', 120) : '';
      if (!isSafePostImageUrl(src)) return '';
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async">`;
    }
    return `<${tag}>`;
  });
}

function richHtmlToText(html, fallback = '') {
  return cleanPostContent(stripHtml(html) || fallback);
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

function cleanSearchQuery(value) {
  return cleanText(value, 100).replace(/\s+/g, ' ');
}

function cleanSearchScope(value) {
  const scope = typeof value === 'string' ? value.trim().toLowerCase() : 'all';
  return SEARCH_SCOPES.has(scope) ? scope : 'all';
}

function cleanNotificationType(value) {
  const type = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return NOTIFICATION_TYPES.has(type) ? type : 'announcement';
}

function cleanTargetType(value) {
  return cleanText(value, 40).replace(/[^a-zA-Z0-9:_-]/g, '');
}

function cleanReaction(value) {
  return ALLOWED_REACTIONS.has(value) ? value : '';
}

function safeJsonParse(value, fallback = {}) {
  if (!value || typeof value !== 'string') return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (error) {
    return fallback;
  }
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value && typeof value === 'object' ? value : {});
  } catch (error) {
    return '{}';
  }
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

function isUploadedPostImage(value) {
  return typeof value === 'string' && value.startsWith('/uploads/post-images/');
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

function postImageFilePath(imageUrl) {
  if (!isUploadedPostImage(imageUrl)) return '';
  const fileName = path.basename(imageUrl);
  return path.join(POST_IMAGE_UPLOAD_DIR, fileName);
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
    if (!parseStoredMediaData(content, ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, true)) return null;
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
    if (!parseStoredMediaData(content, ALLOWED_AUDIO_TYPES, MAX_VOICE_BYTES, true)) return null;
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

  const text = content;
  if (!text.trim()) return null;
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
      content_html TEXT NOT NULL DEFAULT '',
	      content_text TEXT NOT NULL DEFAULT '',
	      content_format TEXT NOT NULL DEFAULT 'plain',
	      created_at TEXT NOT NULL,
	      updated_at TEXT NOT NULL DEFAULT '',
	      edited_at TEXT NOT NULL DEFAULT ''
	    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      avatar TEXT NOT NULL,
      content TEXT NOT NULL,
      parent_comment_id TEXT NOT NULL DEFAULT '',
      floor_number INTEGER NOT NULL DEFAULT 0,
      reply_number INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS post_images (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL DEFAULT '',
      user_id TEXT NOT NULL,
      url TEXT NOT NULL,
	      filename TEXT NOT NULL,
	      mime_type TEXT NOT NULL,
	      size_bytes INTEGER NOT NULL DEFAULT 0,
	      draft_token TEXT NOT NULL DEFAULT '',
	      is_bound INTEGER NOT NULL DEFAULT 0,
	      updated_at TEXT NOT NULL DEFAULT '',
	      created_at TEXT NOT NULL
	    );

    CREATE TABLE IF NOT EXISTS post_likes (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(post_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS post_favorites (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(post_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS comment_likes (
      id TEXT PRIMARY KEY,
      comment_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(comment_id, user_id)
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

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      actor_user_id TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      target_type TEXT NOT NULL DEFAULT '',
      target_id TEXT NOT NULL DEFAULT '',
      target_url TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      read_at TEXT NOT NULL DEFAULT '',
      dedupe_key TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS chat_read_states (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      last_read_message_id TEXT NOT NULL DEFAULT '',
      last_read_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, scope, conversation_id)
    );

    CREATE TABLE IF NOT EXISTS message_reactions (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      reaction TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(message_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS user_notification_preferences (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      preference_key TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, preference_key)
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
    CREATE INDEX IF NOT EXISTS idx_notifications_user_read_created ON notifications(user_id, is_read, created_at);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_user_dedupe ON notifications(user_id, dedupe_key) WHERE dedupe_key != '';
    CREATE INDEX IF NOT EXISTS idx_chat_read_states_user_scope ON chat_read_states(user_id, scope, conversation_id);
    CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON message_reactions(message_id);
    CREATE INDEX IF NOT EXISTS idx_message_reactions_user ON message_reactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_notification_preferences_user ON user_notification_preferences(user_id);
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
	  ensureColumn('posts', 'content_html', "TEXT NOT NULL DEFAULT ''");
	  ensureColumn('posts', 'content_text', "TEXT NOT NULL DEFAULT ''");
	  ensureColumn('posts', 'content_format', "TEXT NOT NULL DEFAULT 'plain'");
	  ensureColumn('posts', 'updated_at', "TEXT NOT NULL DEFAULT ''");
	  ensureColumn('posts', 'edited_at', "TEXT NOT NULL DEFAULT ''");
	  db.prepare("UPDATE posts SET updated_at = created_at WHERE updated_at IS NULL OR TRIM(updated_at) = ''").run();
	  ensureColumn('comments', 'parent_comment_id', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('comments', 'floor_number', "INTEGER NOT NULL DEFAULT 0");
  ensureColumn('comments', 'reply_number', "INTEGER NOT NULL DEFAULT 0");
	  ensureColumn('comments', 'is_deleted', "INTEGER NOT NULL DEFAULT 0");
	  ensureColumn('post_images', 'draft_token', "TEXT NOT NULL DEFAULT ''");
	  ensureColumn('post_images', 'is_bound', "INTEGER NOT NULL DEFAULT 0");
	  ensureColumn('post_images', 'updated_at', "TEXT NOT NULL DEFAULT ''");
	  db.prepare("UPDATE post_images SET is_bound = CASE WHEN TRIM(post_id) != '' THEN 1 ELSE 0 END WHERE is_bound IS NULL OR is_bound = 0").run();
	  db.prepare("UPDATE post_images SET updated_at = created_at WHERE updated_at IS NULL OR TRIM(updated_at) = ''").run();
	  ensureColumn('notifications', 'dedupe_key', "TEXT NOT NULL DEFAULT ''");
	  db.exec('CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_comment_id)');
	  db.exec('CREATE INDEX IF NOT EXISTS idx_post_images_bound_created ON post_images(is_bound, created_at)');
	  db.exec('CREATE INDEX IF NOT EXISTS idx_post_images_draft_token ON post_images(draft_token)');
  backfillForumContentFields();
  db.exec(`CREATE TABLE IF NOT EXISTS data_migrations(name TEXT PRIMARY KEY, details TEXT NOT NULL, completed_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS post_image_refs(image_id TEXT NOT NULL REFERENCES post_images(id) ON DELETE CASCADE,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE, PRIMARY KEY(image_id,post_id));
    CREATE INDEX IF NOT EXISTS idx_messages_room_cursor ON messages(room_id,created_at,id);`);
  ensureColumn('post_images', 'unbound_at', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('post_images', 'quarantined_at', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('post_reports', 'original_post_id', "TEXT NOT NULL DEFAULT ''");
  transaction(() => { backfillCommentFloors(); refreshPostImageReferences(); });
  recoverQuarantinedPostImages();
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
    CREATE INDEX IF NOT EXISTS idx_post_images_post_id ON post_images(post_id);
    CREATE INDEX IF NOT EXISTS idx_post_images_user_id ON post_images(user_id);
    CREATE INDEX IF NOT EXISTS idx_post_likes_post_id ON post_likes(post_id);
    CREATE INDEX IF NOT EXISTS idx_post_likes_user_id ON post_likes(user_id);
    CREATE INDEX IF NOT EXISTS idx_post_favorites_post_id ON post_favorites(post_id);
    CREATE INDEX IF NOT EXISTS idx_post_favorites_user_id ON post_favorites(user_id);
    CREATE INDEX IF NOT EXISTS idx_comment_likes_comment_id ON comment_likes(comment_id);
    CREATE INDEX IF NOT EXISTS idx_comment_likes_user_id ON comment_likes(user_id);
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
    if (db.prepare(`SELECT count(*) AS n FROM ${tableName}`).get().n !== db.prepare(`SELECT count(*) AS n FROM ${legacyTable}`).get().n) {
      throw new Error('Legacy table migration would omit records; transaction rolled back');
    }
    db.exec('CREATE TABLE IF NOT EXISTS legacy_table_archive(source_table TEXT NOT NULL,row_json TEXT NOT NULL,archived_at TEXT NOT NULL)');
    for (const row of db.prepare(`SELECT * FROM ${legacyTable}`).all()) db.prepare('INSERT INTO legacy_table_archive VALUES(?,?,?)')
      .run(legacyTable,JSON.stringify(row),new Date().toISOString());
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

function backfillForumContentFields() {
  db.prepare(`
    UPDATE posts
    SET content_text = content
    WHERE TRIM(COALESCE(content_text, '')) = ''
  `).run();
  db.prepare(`
    UPDATE posts
    SET content_format = 'plain'
    WHERE TRIM(COALESCE(content_format, '')) = ''
  `).run();
}

function backfillCommentFloors() {
  const orphans = db.prepare(`SELECT c.* FROM comments c LEFT JOIN comments p ON p.id=c.parent_comment_id
    WHERE c.parent_comment_id!='' AND p.id IS NULL ORDER BY c.created_at,c.id`).all();
  for (const reply of orphans) {
    db.prepare(`INSERT OR IGNORE INTO comments(id,post_id,user_id,username,avatar,content,parent_comment_id,floor_number,reply_number,is_deleted,created_at)
      VALUES(?,?,?,?,?,?,'',?,0,1,?)`).run(reply.parent_comment_id,reply.post_id,'','已删除评论','', '原评论已删除',reply.floor_number||0,reply.created_at);
  }
  for (const {post_id: postId} of db.prepare('SELECT DISTINCT post_id FROM comments').all()) {
    const roots = db.prepare("SELECT * FROM comments WHERE post_id=? AND COALESCE(parent_comment_id,'')='' ORDER BY created_at,id").all(postId);
    let next = Math.max(0,...roots.map(c=>c.floor_number||0));
    for (const root of roots) {
      const floor = root.floor_number > 0 ? root.floor_number : ++next;
      if (!root.floor_number) db.prepare('UPDATE comments SET floor_number=? WHERE id=?').run(floor,root.id);
      const replies = db.prepare('SELECT id,reply_number,floor_number FROM comments WHERE post_id=? AND parent_comment_id=? ORDER BY created_at,id').all(postId,root.id);
      let replyNext = Math.max(0,...replies.map(c=>c.reply_number||0));
      for (const reply of replies) {
        if (reply.floor_number <= 0 || reply.reply_number <= 0) db.prepare('UPDATE comments SET floor_number=?,reply_number=? WHERE id=?')
          .run(reply.floor_number > 0 ? reply.floor_number : floor,reply.reply_number > 0 ? reply.reply_number : ++replyNext,reply.id);
      }
    }
  }
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
  const contentHtml = sanitizeRichHtml(row.content_html || '');
  const contentText = cleanPostContent(row.content_text || stripHtml(contentHtml) || row.content);
  const content = cleanPostContent(row.content || contentText);
  if (!postId || !title || !content) return null;
  return {
    id: postId,
    postId,
    userId: String(row.user_id || ''),
    username: cleanUsername(row.username) || '匿名',
    avatar: cleanAvatar(row.avatar, row.username),
    title,
    content,
	    contentHtml,
	    contentText,
	    contentFormat: row.content_format === 'html' ? 'html' : 'plain',
	    createdAt: Number.isNaN(Date.parse(row.created_at)) ? new Date().toISOString() : row.created_at,
	    updatedAt: Number.isNaN(Date.parse(row.updated_at)) ? (row.created_at || new Date().toISOString()) : row.updated_at,
	    editedAt: Number.isNaN(Date.parse(row.edited_at)) ? '' : row.edited_at,
	    commentCount: Number(row.comment_count || 0)
	  };
	}

function rowToComment(row) {
  if (!row) return null;
  const commentId = cleanForumId(row.id || row.comment_id);
  const postId = cleanForumId(row.post_id);
  const content = row.is_deleted ? '此评论已删除' : cleanCommentContent(row.content);
  if (!commentId || !postId || !content) return null;
  return {
    id: commentId,
    commentId,
    postId,
    userId: String(row.user_id || ''),
    username: cleanUsername(row.username) || '匿名',
    avatar: cleanAvatar(row.avatar, row.username),
    content,
    parentCommentId: cleanForumId(row.parent_comment_id || ''),
    floorNumber: Number(row.floor_number || 0),
    replyNumber: Number(row.reply_number || 0),
    isDeleted: Boolean(row.is_deleted),
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
  if (!message) return;
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
    id: message.id, roomId: message.roomId || DEFAULT_ROOM_ID,
    type: message.type, userId: message.userId || '',
    username: message.username || '', avatar: message.avatar || '',
    content: message.recalled ? '' : (message.content || ''),
    stickerId: message.stickerId || '', duration: message.duration || 0,
    timestamp: message.timestamp, recalled: message.recalled ? 1 : 0
  });
}

function publicMessage(message, viewerUserId = '') {
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
      recalled: false,
      reactions: reactionSummaryForMessage(message.id, viewerUserId)
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
    recalled: true,
    reactions: []
  };
}

function postLikeCount(postId) {
  return Number(db.prepare('SELECT COUNT(*) AS count FROM post_likes WHERE post_id = ?').get(postId).count || 0);
}

function postFavoriteCount(postId) {
  return Number(db.prepare('SELECT COUNT(*) AS count FROM post_favorites WHERE post_id = ?').get(postId).count || 0);
}

function commentLikeCount(commentId) {
  return Number(db.prepare('SELECT COUNT(*) AS count FROM comment_likes WHERE comment_id = ?').get(commentId).count || 0);
}

function userLikedPost(userId, postId) {
  return Boolean(userId && postId && db.prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?').get(postId, userId));
}

function userFavoritedPost(userId, postId) {
  return Boolean(userId && postId && db.prepare('SELECT 1 FROM post_favorites WHERE post_id = ? AND user_id = ?').get(postId, userId));
}

function userLikedComment(userId, commentId) {
  return Boolean(userId && commentId && db.prepare('SELECT 1 FROM comment_likes WHERE comment_id = ? AND user_id = ?').get(commentId, userId));
}

function publicForumPost(post, viewerUserId = '') {
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
    contentHtml: post.contentHtml || '',
	    contentText: post.contentText || post.content,
	    contentFormat: post.contentFormat || 'plain',
	    createdAt: post.createdAt,
	    updatedAt: post.updatedAt || post.createdAt,
	    editedAt: post.editedAt || '',
	    isEdited: Boolean(post.editedAt),
	    commentCount: Number(post.commentCount || 0),
    likeCount: postLikeCount(post.postId),
    favoriteCount: postFavoriteCount(post.postId),
    likedByMe: userLikedPost(viewerUserId, post.postId),
    favoritedByMe: userFavoritedPost(viewerUserId, post.postId)
  };
}

function publicForumComment(comment, viewerUserId = '') {
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
    content: comment.isDeleted ? '此评论已删除' : comment.content,
    parentCommentId: comment.parentCommentId || '',
    floorNumber: Number(comment.floorNumber || 0),
    replyNumber: Number(comment.replyNumber || 0),
    floorLabel: comment.parentCommentId ? `#${comment.floorNumber}-${comment.replyNumber}` : `#${comment.floorNumber || '?'}`,
    isDeleted: Boolean(comment.isDeleted),
    likeCount: commentLikeCount(comment.commentId),
    likedByMe: userLikedComment(viewerUserId, comment.commentId),
    createdAt: comment.createdAt
  };
}

class InputError extends Error {}

// Numeric strings are accepted for HTTP query compatibility; everything else is strict.
function pageInteger(value, fallback, min, max, name) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) {
    throw new InputError(`${name} 分页参数必须是整数`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new InputError(`${name} 分页参数范围为 ${min}–${max}`);
  }
  return number;
}

function pagination(limit, offset, defaultLimit, maxLimit) {
  return { limit: pageInteger(limit, defaultLimit, 1, maxLimit, 'limit'),
    offset: pageInteger(offset, 0, 0, 1000000, 'offset') };
}

function forumChoice(value, choices, fallback) {
  if (value === undefined) return fallback;
  if (!choices.includes(value)) throw new InputError('论坛筛选或排序参数无效');
  return value;
}

function cleanForumSort(value) {
  return ['latest', 'updated', 'comments', 'likes', 'favorites'].includes(value) ? value : 'latest';
}

function cleanForumFilter(value) {
  return ['all', 'mine', 'favorites', 'has_images', 'edited'].includes(value) ? value : 'all';
}

function forumOrderSql(sort) {
  return {
    latest: 'posts.created_at DESC',
    updated: "COALESCE(NULLIF(posts.updated_at, ''), posts.created_at) DESC",
    comments: 'comment_count DESC, posts.created_at DESC',
    likes: 'like_count DESC, posts.created_at DESC',
    favorites: 'favorite_count DESC, posts.created_at DESC'
  }[cleanForumSort(sort)];
}

function listForumPosts(viewerUserId = '', options = {}) {
  const { sort, filter, limit, offset } = cleanForumListOptions(options);
  const where = [];
  const params = { limit, offset };
  if (filter === 'mine' || filter === 'favorites') params.viewerUserId = viewerUserId;
  if (filter === 'mine') {
    where.push('posts.user_id = @viewerUserId');
  } else if (filter === 'favorites') {
    where.push('EXISTS (SELECT 1 FROM post_favorites pf_filter WHERE pf_filter.post_id = posts.id AND pf_filter.user_id = @viewerUserId)');
  } else if (filter === 'has_images') {
    where.push("(EXISTS (SELECT 1 FROM post_image_refs ir WHERE ir.post_id=posts.id) OR EXISTS (SELECT 1 FROM post_images pi_filter WHERE pi_filter.post_id = posts.id AND pi_filter.is_bound = 1))");
  } else if (filter === 'edited') {
    where.push("posts.edited_at IS NOT NULL AND TRIM(posts.edited_at) != ''");
  }
  if ((filter === 'mine' || filter === 'favorites') && !viewerUserId) return [];
  const sql = `
    SELECT posts.*,
      COUNT(DISTINCT comments.id) AS comment_count,
      COUNT(DISTINCT post_likes.id) AS like_count,
      COUNT(DISTINCT post_favorites.id) AS favorite_count
    FROM posts
    LEFT JOIN comments ON comments.post_id = posts.id AND comments.is_deleted = 0
    LEFT JOIN post_likes ON post_likes.post_id = posts.id
    LEFT JOIN post_favorites ON post_favorites.post_id = posts.id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    GROUP BY posts.id
    ORDER BY ${forumOrderSql(sort)}
    LIMIT @limit OFFSET @offset
  `;
  return db.prepare(sql).all(params).map(rowToPost).filter(Boolean).map((post) => publicForumPost(post, viewerUserId));
}

function getForumPost(postIdValue, viewerUserId = '') {
  const postId = cleanForumId(postIdValue);
  if (!postId) return null;
  const row = db.prepare(`
    SELECT posts.*, COUNT(comments.id) AS comment_count
    FROM posts
    LEFT JOIN comments ON comments.post_id = posts.id AND comments.is_deleted = 0
    WHERE posts.id = ?
    GROUP BY posts.id
  `).get(postId);
  return publicForumPost(rowToPost(row), viewerUserId);
}

function listForumComments(postIdValue, viewerUserId = '') {
  const postId = cleanForumId(postIdValue);
  if (!postId) return [];
  return db.prepare(`
    SELECT * FROM comments
    WHERE post_id = ?
    ORDER BY floor_number ASC, reply_number ASC, created_at ASC
  `).all(postId).map(rowToComment).filter(Boolean).map((comment) => publicForumComment(comment, viewerUserId));
}

function forumPostSummary(row, viewerUserId = '') {
  const post = rowToPost(row);
  return post ? publicForumPost(post, viewerUserId) : null;
}

function myForumPosts(userId, sort = 'latest', limit = 60, offset = 0) {
  return listForumPosts(userId, {
    filter: 'mine',
    sort: sort === 'updated' ? 'updated' : 'latest',
    limit,
    offset
  });
}

function myForumFavorites(userId, limit = 60, offset = 0) {
  const page = pagination(limit, offset, 60, 80);
  return db.prepare(`
    SELECT posts.*, post_favorites.created_at AS favorited_at,
      COUNT(DISTINCT comments.id) AS comment_count
    FROM post_favorites
    LEFT JOIN posts ON posts.id = post_favorites.post_id
    LEFT JOIN comments ON comments.post_id = posts.id AND comments.is_deleted = 0
    WHERE post_favorites.user_id = ?
    GROUP BY post_favorites.id
    ORDER BY post_favorites.created_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, page.limit, page.offset).map((row) => {
    if (!row.id) return { unavailable: true, favoritedAt: row.favorited_at || '' };
    const post = forumPostSummary(row, userId);
    return post ? { ...post, favoritedAt: row.favorited_at || '' } : null;
  }).filter(Boolean);
}

function myForumComments(userId, replies = false, limit = 80, offset = 0) {
  const page = pagination(limit, offset, 80, 100);
  return db.prepare(`
    SELECT comments.*, posts.title AS post_title
    FROM comments
    LEFT JOIN posts ON posts.id = comments.post_id
    WHERE comments.user_id = ?
      AND comments.is_deleted = 0
      AND ${replies ? "TRIM(comments.parent_comment_id) != ''" : "(comments.parent_comment_id IS NULL OR TRIM(comments.parent_comment_id) = '')"}
    ORDER BY comments.created_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, page.limit, page.offset).map((row) => {
    const comment = publicForumComment(rowToComment(row), userId);
    return comment ? {
      ...comment,
      postTitle: row.post_title || '相关内容已不可用',
      postUnavailable: !row.post_title
    } : null;
  }).filter(Boolean);
}

function userCommunitySummary(userId, viewerUserId = '') {
  const target = userById(userId);
  if (!target) return null;
  const stats = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM posts WHERE user_id = ?) AS posts,
      (SELECT COUNT(*) FROM comments WHERE user_id = ? AND is_deleted = 0 AND (parent_comment_id IS NULL OR TRIM(parent_comment_id) = '')) AS comments,
      (SELECT COUNT(*) FROM comments WHERE user_id = ? AND is_deleted = 0 AND TRIM(parent_comment_id) != '') AS replies,
      (SELECT COUNT(*) FROM post_favorites WHERE user_id = ?) AS favorites
  `).get(userId, userId, userId, userId);
  const recentPosts = db.prepare(`
    SELECT posts.*, COUNT(comments.id) AS comment_count
    FROM posts
    LEFT JOIN comments ON comments.post_id = posts.id AND comments.is_deleted = 0
    WHERE posts.user_id = ?
    GROUP BY posts.id
    ORDER BY posts.created_at DESC
    LIMIT 5
  `).all(userId).map((row) => forumPostSummary(row, viewerUserId)).filter(Boolean);
  return {
    user: publicUser(target),
    stats: {
      posts: Number(stats.posts || 0),
      comments: Number(stats.comments || 0),
      replies: Number(stats.replies || 0),
      favorites: viewerUserId === userId ? Number(stats.favorites || 0) : undefined,
      stars: starCountForUser(userId)
    },
    recentPosts,
    isSelf: viewerUserId === userId
  };
}

function myCommunityWorkspace(userId) {
  const summary = userCommunitySummary(userId, userId);
  return {
    stats: {
      ...(summary ? summary.stats : {}),
      drafts: 0,
      unreadNotifications: unreadNotificationCount(userId)
    },
    recentPosts: summary ? summary.recentPosts : [],
    recentComments: myForumComments(userId, false, 5, 0),
    recentReplies: myForumComments(userId, true, 5, 0),
    recentFavorites: myForumFavorites(userId, 5, 0)
  };
}

function insertForumPost(post) {
  db.prepare(`
    INSERT INTO posts (id, user_id, username, avatar, title, content, content_html, content_text, content_format, created_at, updated_at, edited_at)
    VALUES (@postId, @userId, @username, @avatar, @title, @content, @contentHtml, @contentText, @contentFormat, @createdAt, @updatedAt, '')
  `).run(post);
}

function updateForumPost(post) {
  db.prepare(`
    UPDATE posts
    SET title = @title,
        content = @content,
        content_html = @contentHtml,
        content_text = @contentText,
        content_format = @contentFormat,
        updated_at = @updatedAt,
        edited_at = @editedAt
    WHERE id = @postId
  `).run(post);
}

function insertForumComment(comment) {
  db.prepare(`
    INSERT INTO comments (id, post_id, user_id, username, avatar, content, parent_comment_id, floor_number, reply_number, is_deleted, created_at)
    VALUES (@commentId, @postId, @userId, @username, @avatar, @content, @parentCommentId, @floorNumber, @replyNumber, 0, @createdAt)
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

function nextCommentFloor(postId, parentCommentId = '') {
  if (parentCommentId) {
    const parent = rowToComment(rawForumComment(parentCommentId));
    if (!parent || parent.isDeleted || parent.postId !== postId || parent.parentCommentId) return null;
    const nextReply = Number(db.prepare(`
      SELECT COALESCE(MAX(reply_number), 0) + 1 AS next FROM comments
      WHERE post_id = ? AND parent_comment_id = ?
    `).get(postId, parentCommentId).next || 1);
    return { floorNumber: parent.floorNumber || 1, replyNumber: nextReply };
  }
  const nextFloor = Number(db.prepare(`
    SELECT COALESCE(MAX(floor_number), 0) + 1 AS next FROM comments
    WHERE post_id = ? AND (parent_comment_id = '' OR parent_comment_id IS NULL)
  `).get(postId).next || 1);
  return { floorNumber: nextFloor, replyNumber: 0 };
}

function referencedImageUrls(post) {
  // Conservative matching also protects legacy plain/HTML content and cross-author reuse.
  return new Set((String(post.content_html || '') + ' ' + String(post.content || '')).match(/\/uploads\/post-images\/[a-zA-Z0-9_.-]+\.(?:jpg|jpeg|png|webp|gif)/g) || []);
}

function refreshPostImageReferences() {
  const posts = db.prepare('SELECT id,content_html,content FROM posts').all().map(p=>({id:p.id,urls:referencedImageUrls(p)}));
  const now = new Date().toISOString();
  db.exec('DELETE FROM post_image_refs');
  for (const image of db.prepare('SELECT * FROM post_images').all()) {
    const refs = posts.filter(p=>p.urls.has(image.url));
    for (const post of refs) db.prepare('INSERT INTO post_image_refs(image_id,post_id) VALUES(?,?)').run(image.id,post.id);
    db.prepare('UPDATE post_images SET post_id=?,is_bound=?,unbound_at=?,draft_token=?,updated_at=? WHERE id=?')
      .run(refs[0]?.id || '',refs.length?1:0,refs.length?'':(image.is_bound || !image.unbound_at ? now : image.unbound_at),refs.length?'':image.draft_token,now,image.id);
  }
}

function updatePostImagesForPost(userId, postId, contentHtml) {
  // Post content must already be written inside the caller's transaction.
  refreshPostImageReferences();
  recoverQuarantinedPostImages();
  return [...referencedImageUrls({content_html:contentHtml})];
}

function togglePostLike(user, postIdValue) {
  if (!user) return { error: '请先登录', status: 401 };
  if (user.isBanned) return { error: '你的账号已被限制使用社区功能', status: 403 };
  const postId = cleanForumId(postIdValue);
  const post = rawForumPost(postId);
  if (!post) return { error: '帖子不存在', status: 404 };
  const existing = db.prepare('SELECT id FROM post_likes WHERE post_id = ? AND user_id = ?').get(postId, user.id);
  let liked = false;
  if (existing) {
    db.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?').run(postId, user.id);
  } else {
    db.prepare('INSERT INTO post_likes (id, post_id, user_id, created_at) VALUES (?, ?, ?, ?)').run(`post-like:${crypto.randomUUID()}`, postId, user.id, new Date().toISOString());
    liked = true;
    if (post.user_id !== user.id) {
      createNotification({
        userId: post.user_id,
        actorUserId: user.id,
        type: 'reaction_received',
        eventType: 'post_like',
        title: `${displayNameOf(user)} 点赞了你的帖子`,
        body: cleanPostTitle(post.title),
        targetType: 'post',
        targetId: postId,
        dedupeKey: `post-like:${postId}:${user.id}:${post.user_id}`
      });
    }
  }
  return { post: getForumPost(postId, user.id), liked, likeCount: postLikeCount(postId) };
}

function togglePostFavorite(user, postIdValue) {
  if (!user) return { error: '请先登录', status: 401 };
  if (user.isBanned) return { error: '你的账号已被限制使用社区功能', status: 403 };
  const postId = cleanForumId(postIdValue);
  if (!rawForumPost(postId)) return { error: '帖子不存在', status: 404 };
  const existing = db.prepare('SELECT id FROM post_favorites WHERE post_id = ? AND user_id = ?').get(postId, user.id);
  let favorited = false;
  if (existing) {
    db.prepare('DELETE FROM post_favorites WHERE post_id = ? AND user_id = ?').run(postId, user.id);
  } else {
    db.prepare('INSERT INTO post_favorites (id, post_id, user_id, created_at) VALUES (?, ?, ?, ?)').run(`post-favorite:${crypto.randomUUID()}`, postId, user.id, new Date().toISOString());
    favorited = true;
  }
  return { post: getForumPost(postId, user.id), favorited, favoriteCount: postFavoriteCount(postId) };
}

function toggleCommentLike(user, commentIdValue) {
  if (!user) return { error: '请先登录', status: 401 };
  if (user.isBanned) return { error: '你的账号已被限制使用社区功能', status: 403 };
  const commentId = cleanForumId(commentIdValue);
  const raw = rawForumComment(commentId);
  const comment = rowToComment(raw);
  if (!comment || comment.isDeleted) return { error: '评论不存在', status: 404 };
  const existing = db.prepare('SELECT id FROM comment_likes WHERE comment_id = ? AND user_id = ?').get(commentId, user.id);
  let liked = false;
  if (existing) {
    db.prepare('DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?').run(commentId, user.id);
  } else {
    db.prepare('INSERT INTO comment_likes (id, comment_id, user_id, created_at) VALUES (?, ?, ?, ?)').run(`comment-like:${crypto.randomUUID()}`, commentId, user.id, new Date().toISOString());
    liked = true;
    if (comment.userId !== user.id) {
      createNotification({
        userId: comment.userId,
        actorUserId: user.id,
        type: 'reaction_received',
        eventType: 'comment_like',
        title: `${displayNameOf(user)} 点赞了你的评论`,
        body: cleanCommentContent(comment.content),
        targetType: 'post',
        targetId: comment.postId,
        dedupeKey: `comment-like:${commentId}:${user.id}:${comment.userId}`
      });
    }
  }
  return { comment: publicForumComment(rowToComment(rawForumComment(commentId)), user.id), liked, likeCount: commentLikeCount(commentId) };
}

function canEditForumPost(user, postRow) {
  if (!user || !postRow) return false;
  if (user.isBanned) return false;
  return postRow.user_id === user.id || isAdminUser(user);
}

function postImageStorageSummary() {
  fs.mkdirSync(POST_IMAGE_UPLOAD_DIR, { recursive: true });
  const files = fs.readdirSync(POST_IMAGE_UPLOAD_DIR).filter((file) => /^[a-zA-Z0-9_.-]+\.(jpg|jpeg|png|webp|gif)$/i.test(file));
  const totalBytes = files.reduce((sum, file) => {
    try {
      return sum + fs.statSync(path.join(POST_IMAGE_UPLOAD_DIR, file)).size;
    } catch (error) {
      return sum;
    }
  }, 0);
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const orphanRows = db.prepare(`
    SELECT * FROM post_images
    WHERE (post_id IS NULL OR TRIM(post_id) = '' OR is_bound = 0)
      AND created_at < ?
  `).all(cutoff);
  return {
    fileCount: files.length,
    totalBytes,
    orphanCount: orphanRows.length,
    orphanBytes: orphanRows.reduce((sum, row) => sum + Number(row.size_bytes || 0), 0)
  };
}

function tableExists(tableName) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function buildMaintenanceStatus() {
  const keyTables = ['notifications', 'chat_read_states', 'message_reactions', 'post_images', 'post_likes', 'post_favorites', 'comment_likes'];
  const configuredPassword = cleanEnv(process.env.ADMIN_PASSWORD);
  return {
    version: PACKAGE_VERSION,
    node: process.version,
    environment: process.env.NODE_ENV || 'development',
    sqlite: 'connected',
    adminPasswordWeak: !configuredPassword || configuredPassword === 'change-me-admin-password' || configuredPassword === 'mushin',
    tables: keyTables.map((name) => ({ name, exists: tableExists(name) })),
    postImages: postImageStorageSummary(),
    startedAt: SERVER_STARTED_AT
  };
}

function quarantinePath(image) {
  return path.join(__dirname, 'image-quarantine', path.basename(postImageFilePath(image.url)));
}

function recoverQuarantinedPostImages(restoreAll = false) {
  for (const row of db.prepare('SELECT * FROM post_images').all()) {
    if (!isSafePostImageUrl(row.url)) continue;
    const source = quarantinePath(row), destination = postImageFilePath(row.url);
    if (!fs.existsSync(source)) {
      if (row.quarantined_at && fs.existsSync(destination)) db.prepare("UPDATE post_images SET quarantined_at='',unbound_at=? WHERE id=?").run(new Date().toISOString(),row.id);
      continue;
    }
    const referenced = db.prepare('SELECT 1 FROM post_image_refs WHERE image_id=?').get(row.id);
    if (!restoreAll && row.quarantined_at && !referenced) continue;
    if (fs.existsSync(destination)) throw new Error('Image recovery conflict; both files retained');
    fs.mkdirSync(path.dirname(destination),{recursive:true});
    fs.renameSync(source,destination);
    db.prepare("UPDATE post_images SET quarantined_at='',unbound_at=? WHERE id=?").run(new Date().toISOString(),row.id);
  }
}

function cleanupOrphanPostImages() {
  const cutoff = new Date(Date.now()-24*60*60*1000).toISOString();
  transaction(refreshPostImageReferences);
  recoverQuarantinedPostImages();
  let quarantined=0;
  for (const row of db.prepare("SELECT * FROM post_images WHERE is_bound=0 AND draft_token='' AND unbound_at < ? AND quarantined_at=''").all(cutoff)) {
    if (!isSafePostImageUrl(row.url)) continue;
    const original=postImageFilePath(row.url), target=quarantinePath(row);
    if (!fs.existsSync(original) || !fs.lstatSync(original).isFile() || fs.lstatSync(original).isSymbolicLink()) continue;
    fs.mkdirSync(path.dirname(target),{recursive:true});
    if (fs.existsSync(target)) throw new Error('Quarantine conflict; no file overwritten');
    try {
      transaction(() => {
        // Recheck actual content under the database write transaction immediately before moving.
        if (db.prepare('SELECT content_html,content FROM posts').all().some(p=>referencedImageUrls(p).has(row.url))) return;
        fs.renameSync(original,target);
        db.prepare('UPDATE post_images SET quarantined_at=? WHERE id=?').run(new Date().toISOString(),row.id);
      });
      if (fs.existsSync(target)) quarantined++;
    } catch (error) {
      if (fs.existsSync(target) && !fs.existsSync(original)) fs.renameSync(target,original);
      throw error;
    }
  }
  // Retain files and metadata for recovery; irreversible disposal requires separate approval/policy.
  return {deleted:0,bytes:0,quarantined};
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

function deleteForumCommentById(id) {
  transaction(() => {
    db.prepare('UPDATE comments SET is_deleted=1 WHERE id=?').run(id);
    db.prepare('DELETE FROM comment_likes WHERE comment_id=?').run(id);
    db.prepare("DELETE FROM notifications WHERE json_extract(CASE WHEN json_valid(metadata_json) THEN metadata_json ELSE '{}' END,'$.commentId')=?").run(id);
  });
}

function deleteMessageData(roomId = null) {
  transaction(() => {
    const where=roomId===null?'':' WHERE room_id=?';const args=roomId===null?[]:[roomId];
    db.prepare(`DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM messages${where})`).run(...args);
    if (roomId===null) {
      db.exec("DELETE FROM notifications WHERE target_type='chat'; DELETE FROM chat_read_states; DELETE FROM messages;");
    } else {
      db.prepare("DELETE FROM notifications WHERE target_type='chat' AND (target_id=? OR json_extract(CASE WHEN json_valid(metadata_json) THEN metadata_json ELSE '{}' END,'$.roomId')=?)").run(roomId,roomId);
      db.prepare('DELETE FROM chat_read_states WHERE conversation_id=?').run(roomId);
      db.prepare('DELETE FROM messages WHERE room_id=?').run(roomId);
    }
    db.prepare("INSERT OR IGNORE INTO data_migrations VALUES('legacy-messages-v1','explicit deletion',?)").run(new Date().toISOString());
  });
}

function deleteRoomData(roomId) {
  transaction(() => {
    deleteMessageData(roomId);
    db.prepare('DELETE FROM room_members WHERE room_id=?').run(roomId);
    db.prepare('DELETE FROM rooms WHERE id=?').run(roomId);
  });
}

function deleteForumPostById(postId) {
  const id = cleanForumId(postId);
  if (!id) return false;
  const post = rawForumPost(id);
  if (!post) return false;
  transaction(() => {
    db.prepare('DELETE FROM comment_likes WHERE comment_id IN (SELECT id FROM comments WHERE post_id=?)').run(id);
    db.prepare("DELETE FROM notifications WHERE target_type='post' AND target_id=?").run(id);
    db.prepare("UPDATE post_reports SET original_post_id=post_id,post_id='',status=CASE WHEN status='pending' THEN 'post_deleted' ELSE status END WHERE post_id=?").run(id);
    for (const table of ['post_likes','post_favorites','comments','post_image_refs']) db.prepare(`DELETE FROM ${table} WHERE post_id=?`).run(id);
    db.prepare('DELETE FROM posts WHERE id=?').run(id);
    refreshPostImageReferences();
  });
  emitForumSubscribers(id, 'forum post deleted', { postId: id });
  broadcastForumPosts();
  return true;
}

function banUser(user, reason = '') {
  if (!user || isAdminUser(user)) return false;
  user.isBanned = true;
  user.bannedAt = new Date().toISOString();
  user.bannedReason = cleanAdminNote(reason) || '违反社区规则';
  saveUsers();
  createNotification({
    userId: user.id,
    type: 'account_restricted',
    title: '你的账号已被限制使用社区功能',
    body: user.bannedReason,
    targetType: 'account',
    targetId: user.id,
    dedupeKey: `ban:${user.id}:${user.bannedAt}`
  });
  socketsForUser(user.id).forEach((connectedSocket) => {
    connectedSocket.user = user;
    connectedSocket.emit('profile updated', { user: publicUser(user) });
    connectedSocket.emit('forum error', '你的账号已被限制使用社区功能');
  });
  broadcastOnlineUsers();
  broadcastAdminDashboards();
  return true;
}

function emitForumSubscribers(postId, event, payload) {
  for (const socket of io.sockets.sockets.values()) {
    if (currentSocketUser(socket) && socket.currentForumPostId === postId) socket.emit(event, payload);
  }
}

function forumPostChannel(postId) {
  return `forum:${postId}`;
}

function cleanForumListOptions(payload = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new InputError('分页参数必须是对象');
  return {
    sort: forumChoice(payload.sort, ['latest', 'updated', 'comments', 'likes', 'favorites'], 'latest'),
    filter: forumChoice(payload.filter, ['all', 'mine', 'favorites', 'has_images', 'edited'], 'all'),
    ...pagination(payload.limit, payload.offset, MAX_FORUM_POSTS, MAX_FORUM_POSTS)
  };
}

function emitForumPosts(socket, options = socket.forumListOptions || {}) {
  if (!currentSocketUser(socket)) return;
  const safeOptions = cleanForumListOptions(options);
  socket.forumListOptions = safeOptions;
  socket.emit('forum posts', {
    posts: listForumPosts(socket.user ? socket.user.id : '', safeOptions),
    sort: safeOptions.sort,
    filter: safeOptions.filter
  });
}

function broadcastForumPosts() {
  io.sockets.sockets.forEach((connectedSocket) => {
    try {
      emitForumPosts(connectedSocket, connectedSocket.forumListOptions || {});
    } catch (error) {
      console.error('Forum broadcast failed:', error.code || error.name);
      connectedSocket.emit('forum error', '论坛列表暂时无法加载，请重试');
    }
  });
}

function broadcastForumPostDetail(postId) {
  io.sockets.sockets.forEach((connectedSocket) => {
    if (!currentSocketUser(connectedSocket) || connectedSocket.currentForumPostId !== postId) return;
    const userId = connectedSocket.user ? connectedSocket.user.id : '';
    const post = getForumPost(postId, userId);
    if (!post) return;
    connectedSocket.emit('forum post detail', {
      post,
      comments: listForumComments(postId, userId)
    });
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
  if (notificationsReady) notifyAnnouncement(announcement);
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

function rowToNotification(row) {
  if (!row) return null;
  const actor = row.actor_user_id ? userById(row.actor_user_id) : null;
  return {
    id: row.id,
    userId: row.user_id,
    actorUserId: row.actor_user_id || '',
    actor: actor ? publicUser(actor) : null,
    type: cleanNotificationType(row.type),
    title: row.title,
    body: row.body || '',
    targetType: row.target_type || '',
    targetId: row.target_id || '',
    targetUrl: row.target_url || '',
    metadata: safeJsonParse(row.metadata_json),
    isRead: Boolean(row.is_read),
    createdAt: row.created_at,
    readAt: row.read_at || ''
  };
}

function notificationPreferenceKey(notification) {
  const type = cleanNotificationType(notification.type);
  if (ALWAYS_ON_NOTIFICATION_TYPES.has(type)) return '';
  const metadata = notification.metadata || {};
  if (type === 'forum_comment') {
    if (['forum_reply','forum_comment'].includes(metadata.eventType)) return metadata.eventType;
    // Legacy rows retain their original type and metadata. Resolve existing
    // comment relationships when possible; never infer from display text.
    const comment = metadata.commentId && db.prepare('SELECT parent_comment_id FROM comments WHERE id = ?').get(metadata.commentId);
    return metadata.parentCommentId || (comment && comment.parent_comment_id) ? 'forum_reply' : 'forum_comment';
  }
  if (type === 'reaction_received') {
    if (['post_like','comment_like'].includes(metadata.eventType)) return metadata.eventType;
    if (notification.targetType === 'chat' || metadata.eventType === 'message_reaction') return '';
    if (String(notification.dedupeKey || '').startsWith('comment-like:')) return 'comment_like';
    if (String(notification.dedupeKey || '').startsWith('post-like:')) return 'post_like';
    return ''; // Ambiguous legacy data remains visible; no title-based guess.
  }
  if (type === 'star_received') return 'star_received';
  if (type === 'sticker_submission_result') return 'sticker_review';
  if (type === 'creator_request_result') return 'creator_result';
  return '';
}

function listNotificationPreferences(userId) {
  const rows = db.prepare('SELECT preference_key, enabled FROM user_notification_preferences WHERE user_id = ?').all(userId);
  const saved = new Map(rows.map((row) => [row.preference_key, Boolean(row.enabled)]));
  return Array.from(NOTIFICATION_PREFERENCE_KEYS).map((key) => ({
    key,
    enabled: saved.has(key) ? saved.get(key) : true,
    locked: false
  })).concat([
    { key: 'system', enabled: true, locked: true },
    { key: 'security', enabled: true, locked: true }
  ]);
}

function notificationPreferenceEnabled(userId, key) {
  if (!key || !NOTIFICATION_PREFERENCE_KEYS.has(key)) return true;
  const row = db.prepare('SELECT enabled FROM user_notification_preferences WHERE user_id = ? AND preference_key = ?').get(userId, key);
  return row ? Boolean(row.enabled) : true;
}

function setNotificationPreference(userId, key, enabled) {
  if (!NOTIFICATION_PREFERENCE_KEYS.has(key)) return null;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO user_notification_preferences (id, user_id, preference_key, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, preference_key) DO UPDATE SET
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `).run(`notification-pref:${crypto.randomUUID()}`, userId, key, enabled ? 1 : 0, now, now);
  return { key, enabled: Boolean(enabled), locked: false };
}

function unreadNotificationCount(userId) {
  if (!userId) return 0;
  return Number(db.prepare(`
    SELECT COUNT(*) AS count FROM notifications
    WHERE user_id = ? AND is_read = 0
  `).get(userId).count || 0);
}

function listNotificationsForUser(userId, { unreadOnly = false, limit = 50, offset = 0 } = {}) {
  const { limit: safeLimit, offset: safeOffset } = pagination(limit, offset, 50, 80);
  const sql = `
    SELECT * FROM notifications
    WHERE user_id = ? ${unreadOnly ? 'AND is_read = 0' : ''}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;
  return db.prepare(sql).all(userId, safeLimit, safeOffset).map(rowToNotification).filter(Boolean);
}

function emitUnreadUpdate(userId) {
  const notificationCount = unreadNotificationCount(userId);
  const chatCount = totalChatUnreadForUser(userId);
  socketsForUser(userId).forEach((connectedSocket) => {
    connectedSocket.emit('unread:update', {
      notifications: notificationCount,
      notificationUnread: notificationCount,
      chat: chatCount,
      chatUnread: chatCount
    });
  });
}

function emitNotifications(socket) {
  if (!currentSocketUser(socket)) return;
  socket.emit('notifications', {
    items: listNotificationsForUser(socket.user.id),
    unreadCount: unreadNotificationCount(socket.user.id)
  });
  emitUnreadUpdate(socket.user.id);
}

function createNotification({
  userId,
  actorUserId = '',
  type = 'announcement',
  title,
  body = '',
  targetType = '',
  targetId = '',
  targetUrl = '',
  metadata = {},
  eventType = '',
  dedupeKey = ''
}) {
  const targetUser = userById(userId);
  const cleanTitle = cleanText(title, 120).replace(/\s+/g, ' ');
  const cleanBody = cleanText(body, 600);
  if (!targetUser || !cleanTitle) return null;
  if (actorUserId && actorUserId === userId && type !== 'announcement' && type !== 'account_restricted') return null;
  const eventMetadata = { ...metadata };
  if (eventType) eventMetadata.eventType = eventType;
  const preferenceKey = notificationPreferenceKey({ type, metadata: eventMetadata, targetType, dedupeKey });
  if (preferenceKey && !notificationPreferenceEnabled(userId, preferenceKey)) return null;
  const notification = {
    id: `notification:${crypto.randomUUID()}`,
    userId,
    actorUserId: actorUserId || '',
    type: cleanNotificationType(type),
    title: cleanTitle,
    body: cleanBody,
    targetType: cleanTargetType(targetType),
    targetId: cleanText(targetId, 100),
    targetUrl: cleanText(targetUrl, 240),
    metadataJson: safeJsonStringify(eventMetadata),
    createdAt: new Date().toISOString(),
    dedupeKey: cleanText(dedupeKey, 160)
  };

  if (notification.dedupeKey) {
    const existing = db.prepare('SELECT * FROM notifications WHERE user_id = ? AND dedupe_key = ?').get(userId, notification.dedupeKey);
    if (existing) {
      if (Date.parse(existing.created_at) >= Date.parse(notification.createdAt)) notification.createdAt = new Date(Date.parse(existing.created_at) + 1).toISOString();
      db.prepare(`
        UPDATE notifications
        SET actor_user_id = ?, type = ?, title = ?, body = ?, target_type = ?, target_id = ?, target_url = ?, metadata_json = ?, is_read = 0, created_at = ?, read_at = ''
        WHERE id = ?
      `).run(
        notification.actorUserId,
        notification.type,
        notification.title,
        notification.body,
        notification.targetType,
        notification.targetId,
        notification.targetUrl,
        notification.metadataJson,
        notification.createdAt,
        existing.id
      );
      const updated = rowToNotification(db.prepare('SELECT * FROM notifications WHERE id = ?').get(existing.id));
      socketsForUser(userId).forEach((connectedSocket) => connectedSocket.emit('notification:new', updated));
      emitUnreadUpdate(userId);
      return updated;
    }
  }

  db.prepare(`
    INSERT INTO notifications (id, user_id, actor_user_id, type, title, body, target_type, target_id, target_url, metadata_json, is_read, created_at, read_at, dedupe_key)
    VALUES (@id, @userId, @actorUserId, @type, @title, @body, @targetType, @targetId, @targetUrl, @metadataJson, 0, @createdAt, '', @dedupeKey)
  `).run(notification);
  const publicNotification = rowToNotification(db.prepare('SELECT * FROM notifications WHERE id = ?').get(notification.id));
  socketsForUser(userId).forEach((connectedSocket) => connectedSocket.emit('notification:new', publicNotification));
  emitUnreadUpdate(userId);
  return publicNotification;
}

function notifyAnnouncement(announcement) {
  if (!announcement) return;
  const targets = announcement.targetUserId
    ? users.filter((user) => user.id === announcement.targetUserId)
    : users;
  targets.forEach((user) => {
    createNotification({
      userId: user.id,
      actorUserId: announcement.createdBy || '',
      type: 'announcement',
      title: announcement.title,
      body: announcement.content,
      targetType: 'announcement',
      targetId: announcement.id,
      metadata: { priority: announcement.priority, announcementType: announcement.type },
      dedupeKey: `announcement:${announcement.id}`
    });
  });
}

function markNotificationRead(userId, notificationId) {
  const id = cleanForumId(notificationId);
  if (!id) return null;
  const row = db.prepare('SELECT * FROM notifications WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) return null;
  db.prepare(`
    UPDATE notifications SET is_read = 1, read_at = ?
    WHERE id = ? AND user_id = ?
  `).run(new Date().toISOString(), id, userId);
  emitUnreadUpdate(userId);
  return rowToNotification(db.prepare('SELECT * FROM notifications WHERE id = ?').get(id));
}

function markAllNotificationsRead(userId) {
  db.prepare(`
    UPDATE notifications SET is_read = 1, read_at = ?
    WHERE user_id = ? AND is_read = 0
  `).run(new Date().toISOString(), userId);
  socketsForUser(userId).forEach((connectedSocket) => connectedSocket.emit('notification:read_all'));
  emitUnreadUpdate(userId);
}

function roomScope(roomId) {
  return typeof roomId === 'string' && roomId.startsWith('dm:') ? 'private' : 'room';
}

function lastMessageForRoom(roomId) {
  return db.prepare(`
    SELECT id, created_at FROM messages
    WHERE room_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get(roomId) || null;
}

function markRoomRead(userId, roomId, cursor) {
  if (!cursor || typeof cursor.id !== 'string' || typeof cursor.timestamp !== 'string') throw new InputError('需要有效的已读消息游标');
  const last = db.prepare('SELECT id, created_at FROM messages WHERE id = ? AND room_id = ?').get(cursor.id, roomId);
  if (!last || last.created_at !== cursor.timestamp) throw new InputError('消息游标不属于当前会话');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO chat_read_states (id, user_id, scope, conversation_id, last_read_message_id, last_read_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, scope, conversation_id) DO UPDATE SET
      last_read_message_id = excluded.last_read_message_id, last_read_at = excluded.last_read_at, updated_at = excluded.updated_at
    WHERE excluded.last_read_at > chat_read_states.last_read_at
       OR (excluded.last_read_at = chat_read_states.last_read_at AND excluded.last_read_message_id > chat_read_states.last_read_message_id)
  `).run(`read:${crypto.randomUUID()}`, userId, roomScope(roomId), roomId, last.id, last.created_at, now);
  emitUnreadUpdate(userId);
}

function readStateForRoom(userId, roomId) {
  return db.prepare(`
    SELECT * FROM chat_read_states
    WHERE user_id = ? AND scope = ? AND conversation_id = ?
    LIMIT 1
  `).get(userId, roomScope(roomId), roomId) || null;
}

function unreadCountForRoom(userId, roomId) {
  if (!userId || !roomId) return 0;
  const state = readStateForRoom(userId, roomId);
  const lastReadAt = state && state.last_read_at ? state.last_read_at : '1970-01-01T00:00:00.000Z';
  return Number(db.prepare(`
    SELECT COUNT(*) AS count FROM messages
    WHERE room_id = ? AND (created_at > ? OR (created_at = ? AND id > ?)) AND COALESCE(user_id, '') != ? AND recalled = 0
  `).get(roomId, lastReadAt, lastReadAt, state ? state.last_read_message_id : '', userId).count || 0);
}

function roomsVisibleToUser(userId) {
  const groupRows = db.prepare(`
    SELECT rooms.id
    FROM rooms
    WHERE rooms.id = ?
      OR EXISTS (
        SELECT 1 FROM room_members
        WHERE room_members.room_id = rooms.id AND room_members.user_id = ?
      )
  `).all(DEFAULT_ROOM_ID, userId).map((row) => row.id);
  const privateRows = db.prepare(`
    SELECT DISTINCT room_id AS id FROM messages
    WHERE room_id LIKE 'dm:%' AND room_id LIKE ?
  `).all(`%${userId}%`).map((row) => row.id);
  return Array.from(new Set([...groupRows, ...privateRows]));
}

function totalChatUnreadForUser(userId) {
  return roomsVisibleToUser(userId).reduce((total, roomId) => total + unreadCountForRoom(userId, roomId), 0);
}

function chatRecipientIds(message) {
  if (!message || !message.roomId) return [];
  if (message.roomId.startsWith('dm:')) {
    return privateRoomUsers(message.roomId).filter((id) => id && id !== message.userId);
  }
  return db.prepare('SELECT user_id FROM room_members WHERE room_id = ? AND user_id != ?')
    .all(message.roomId, message.userId || '')
    .map((row) => row.user_id)
    .filter(Boolean);
}

function notifyChatRecipients(message) {
  chatRecipientIds(message).forEach((userId) => {
    createNotification({
      userId,
      actorUserId: message.userId || '',
      type: 'chat_message',
      title: `${displayNameOf(messageUser(message))} 发来新消息`,
      body: message.type === 'sticker' ? '发送了一个表情包' : message.type === 'image' ? '发送了一张图片' : message.type === 'voice' ? '发送了一条语音' : cleanText(message.content, 80),
      targetType: 'chat',
      targetId: message.roomId,
      metadata: { messageId: message.id, roomId: message.roomId },
      dedupeKey: `chat:${message.roomId}:${message.id}:${userId}`
    });
    emitUnreadUpdate(userId);
  });
  broadcastLobby();
}

function reactionSummaryForMessage(messageId, viewerUserId = '') {
  const id = typeof messageId === 'string' ? messageId : '';
  if (!id) return [];
  const rows = db.prepare(`
    SELECT reaction, COUNT(*) AS count
    FROM message_reactions
    WHERE message_id = ?
    GROUP BY reaction
    ORDER BY MIN(created_at) ASC
  `).all(id);
  const mine = viewerUserId
    ? db.prepare('SELECT reaction FROM message_reactions WHERE message_id = ? AND user_id = ?').get(id, viewerUserId)
    : null;
  return rows.map((row) => ({
    reaction: row.reaction,
    count: Number(row.count || 0),
    mine: Boolean(mine && mine.reaction === row.reaction)
  }));
}

function messageById(messageId) {
  const id = typeof messageId === 'string' ? messageId : '';
  return messages.find((message) => message.id === id) || rowToMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(id));
}

function canUserViewMessage(user, message) {
  if (!user || !message || message.recalled) return false;
  if (message.roomId && message.roomId.startsWith('dm:')) return privateRoomUsers(message.roomId).includes(user.id);
  const room = rooms.find((item) => item.id === message.roomId);
  if (!room) return false;
  if (message.roomId === DEFAULT_ROOM_ID) return true;
  return Boolean(db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').get(message.roomId, user.id));
}

function canUserAccessRoom(user, roomId) {
  if (!user || !roomId) return false;
  if (roomId.startsWith('dm:')) return privateRoomUsers(roomId).includes(user.id);
  if (roomId === DEFAULT_ROOM_ID) return true;
  return Boolean(db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, user.id));
}

function emitReactionUpdate(message) {
  if (!message) return;
  io.sockets.sockets.forEach((connectedSocket) => {
    if (!currentSocketUser(connectedSocket) || !canUserAccessRoom(connectedSocket.user, message.roomId) || connectedSocket.currentRoomId !== message.roomId) return;
    connectedSocket.emit('reaction:update', {
      messageId: message.id,
      reactions: reactionSummaryForMessage(message.id, connectedSocket.user.id)
    });
  });
}

function toggleMessageReaction(user, messageIdValue, reactionValue) {
  if (!user) return { error: '请先登录', status: 401 };
  if (user.isBanned) return { error: '你的账号已被限制使用社区功能', status: 403 };
  const reaction = cleanReaction(reactionValue);
  if (!reaction) return { error: '这个 Reaction 不可用', status: 400 };
  const message = messageById(messageIdValue);
  if (!canUserViewMessage(user, message)) return { error: '消息不存在或不可见', status: 404 };

  const existing = db.prepare('SELECT * FROM message_reactions WHERE message_id = ? AND user_id = ?').get(message.id, user.id);
  const now = new Date().toISOString();
  let removed = false;
  if (existing && existing.reaction === reaction) {
    db.prepare('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ?').run(message.id, user.id);
    removed = true;
  } else if (existing) {
    db.prepare(`
      UPDATE message_reactions SET reaction = ?, updated_at = ?
      WHERE message_id = ? AND user_id = ?
    `).run(reaction, now, message.id, user.id);
  } else {
    db.prepare(`
      INSERT INTO message_reactions (id, message_id, user_id, reaction, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(`reaction:${crypto.randomUUID()}`, message.id, user.id, reaction, now, now);
  }

  if (!removed && message.userId && message.userId !== user.id) {
    createNotification({
      userId: message.userId,
      actorUserId: user.id,
      type: 'reaction_received',
      title: `${displayNameOf(user)} 对你的消息添加了 Reaction`,
      body: `${reaction} ${message.type === 'sticker' ? '表情包消息' : cleanText(message.content, 80)}`,
      targetType: 'chat',
      targetId: message.roomId,
      metadata: { messageId: message.id, reaction },
      eventType: 'message_reaction',
      dedupeKey: `reaction:${message.id}:${user.id}:${message.userId}`
    });
  }

  emitReactionUpdate(message);
  const reactions = reactionSummaryForMessage(message.id, user.id);
  return { messageId: message.id, reactions, removed };
}

function likePattern(query) {
  return `%${query.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

function searchUni(user, { q, scope = 'all', limit = 30, offset = 0 } = {}) {
  const query = cleanSearchQuery(q);
  pagination(limit, offset, 30, 50);
  if (!user || !query) return { query, scope, results: [] };
  const safeScope = cleanSearchScope(scope);
  const { limit: safeLimit, offset: safeOffset } = pagination(limit, offset, 30, 50);
  const pattern = likePattern(query);
  const results = [];
  const include = (name) => safeScope === 'all' || safeScope === name;

  if (include('users')) {
    db.prepare(`
      SELECT * FROM users
      WHERE display_name LIKE ? ESCAPE '\\' OR username LIKE ? ESCAPE '\\' OR bio LIKE ? ESCAPE '\\'
      ORDER BY display_name COLLATE NOCASE ASC
      LIMIT ? OFFSET ?
    `).all(pattern, pattern, pattern, safeLimit, safeOffset).map(rowToUser).filter(Boolean).forEach((item) => {
      results.push({
        type: 'user',
        id: item.id,
        title: displayNameOf(item),
        summary: item.bio || `@${item.username}`,
        avatar: item.avatar || makeAvatar(displayNameOf(item)),
        createdAt: item.createdAt || '',
        targetType: 'user',
        targetId: item.id
      });
    });
  }

  if (include('posts')) {
    db.prepare(`
      SELECT posts.*, COUNT(comments.id) AS comment_count
      FROM posts
      LEFT JOIN comments ON comments.post_id = posts.id AND comments.is_deleted = 0
      WHERE posts.title LIKE ? ESCAPE '\\'
        OR posts.content LIKE ? ESCAPE '\\'
        OR posts.content_text LIKE ? ESCAPE '\\'
      GROUP BY posts.id
      ORDER BY posts.created_at DESC
      LIMIT ? OFFSET ?
    `).all(pattern, pattern, pattern, safeLimit, safeOffset).map(rowToPost).filter(Boolean).forEach((post) => {
      results.push({
        type: 'post',
        id: post.postId,
        title: post.title,
        summary: cleanText(post.contentText || post.content, 160),
        avatar: post.avatar,
        createdAt: post.createdAt,
        targetType: 'post',
        targetId: post.postId
      });
    });

    db.prepare(`
      SELECT comments.*, posts.title AS post_title
      FROM comments
      JOIN posts ON posts.id = comments.post_id
      WHERE comments.is_deleted = 0 AND comments.content LIKE ? ESCAPE '\\'
      ORDER BY comments.created_at DESC
      LIMIT ? OFFSET ?
    `).all(pattern, safeLimit, safeOffset).map(rowToComment).filter(Boolean).forEach((comment) => {
      results.push({
        type: 'comment',
        id: comment.commentId,
        title: `评论：${cleanText(comment.content, 48)}`,
        summary: comment.content,
        avatar: comment.avatar,
        createdAt: comment.createdAt,
        targetType: 'post',
        targetId: comment.postId
      });
    });
  }

  if (include('messages')) {
    const visibleRooms = roomsVisibleToUser(user.id);
    if (visibleRooms.length) {
      const placeholders = visibleRooms.map(() => '?').join(',');
      db.prepare(`
        SELECT * FROM messages
        WHERE room_id IN (${placeholders})
          AND type IN ('text', 'sticker')
          AND recalled = 0
          AND content LIKE ? ESCAPE '\\'
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `).all(...visibleRooms, pattern, safeLimit, safeOffset).map(rowToMessage).filter(Boolean).forEach((message) => {
        results.push({
          type: 'message',
          id: message.id,
          title: `${message.username} 的聊天消息`,
          summary: message.type === 'sticker' ? '表情包消息' : cleanText(message.content, 160),
          avatar: message.avatar,
          createdAt: message.timestamp,
          targetType: 'chat',
          targetId: message.roomId
        });
      });
    }
  }

  if (include('announcements')) {
    listAnnouncementsForUser(user.id)
      .filter((announcement) => `${announcement.title} ${announcement.content}`.toLowerCase().includes(query.toLowerCase()))
      .slice(0, safeLimit)
      .forEach((announcement) => {
        results.push({
          type: 'announcement',
          id: announcement.id,
          title: announcement.title,
          summary: cleanText(announcement.content, 160),
          createdAt: announcement.createdAt,
          targetType: 'announcement',
          targetId: announcement.id
        });
      });
  }

  if (include('stickers')) {
    const stickerRows = db.prepare(`
      SELECT * FROM stickers
      WHERE ((sticker_type = 'official' AND status = 'active')
          OR (sticker_type = 'creator_submission' AND status = 'approved')
          OR (owner_user_id = ? AND status != 'removed'))
        AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(user.id, pattern, pattern, safeLimit, safeOffset);
    stickerRows.map(rowToSticker).filter(Boolean).map(publicSticker).forEach((sticker) => {
      results.push({
        type: 'sticker',
        id: sticker.id,
        title: sticker.title,
        summary: sticker.description || '表情包',
        avatar: sticker.url,
        createdAt: sticker.createdAt,
        targetType: 'sticker',
        targetId: sticker.id
      });
    });
  }

  return { query, scope: safeScope, results: results.slice(0, safeLimit) };
}

function ensureSystemAnnouncements() {
  createAnnouncement({
    id: 'update:5.5.8',
    type: 'update',
    title: 'Sonoma 5.5.8 已上线',
    content: '新增我的内容中心、我的帖子/评论/回复/收藏、本机草稿管理、论坛排序筛选、用户主页社区摘要和通知偏好设置。',
    priority: 'high'
  });
  createAnnouncement({
    id: 'update:5.5.7',
    type: 'update',
    title: 'Sonoma 5.5.7 已上线',
    content: '新增论坛草稿自动保存与恢复、帖子编辑、富文本安全加固、图片维护状态和互动防连点，让 5.5.6 的论坛升级更稳定。',
    priority: 'high'
  });
  createAnnouncement({
    id: 'update:5.5.6',
    type: 'update',
    title: 'Sonoma 5.5.6 已上线',
    content: '新增独立论坛发帖页面、富文本编辑器、帖子图片、点赞收藏、评论回复与楼层，并优化移动端显示和 Sonoma Web 渲染性能。',
    priority: 'high'
  });
  createAnnouncement({
    id: 'update:5.5.5',
    type: 'update',
    title: 'Sonoma 5.5.5 已上线',
    content: '新增统一通知中心、聊天未读状态、全局搜索和消息 Reaction，让聊天、论坛、公告、表情包与社区互动更容易被发现。',
    priority: 'high'
  });
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

// Registration quota is never cleared by successful authentication. Login buckets
// are peer + account scoped so another account's mistakes do not lock out this one.
const registrationAttempts = new Map();
const loginAttempts = new Map();
function authLimitKey(socket) { return socket.handshake.address || socket.id; }
function takeQuota(map, key, limit, windowMs = AUTH_WINDOW_MS, now = Date.now()) {
  for (const [k, v] of map) if (v.resetAt <= now) map.delete(k);
  let record = map.get(key);
  if (!record) {
    if (map.size >= 10000) return false;
    record = { count: 0, resetAt: now + windowMs }; map.set(key, record);
  }
  if (record.count >= limit) return false;
  record.count++; return true;
}
function loginLimitKey(socket, account) { return JSON.stringify([authLimitKey(socket), account]); }
function checkAuthLimit(socket, account) {
  return takeQuota(loginAttempts, loginLimitKey(socket, account), AUTH_MAX_ATTEMPTS);
}
function clearAuthLimit(socket, account) { loginAttempts.delete(loginLimitKey(socket, account)); }

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

function currentSocketUser(socket) {
  const user = socket.user && userById(socket.user.id);
  return user && socket.authPasswordHash === user.passwordHash ? user : null;
}

function clearSocketIdentity(socket, notify = false) {
  const previous = socket.user;
  const previousRoom = socket.currentRoomId;
  clearTyping(socket);
  for (const room of Array.from(socket.rooms)) if (room !== socket.id) socket.leave(room);
  for (const [token, session] of apiSessions) if (session.socketId === socket.id) apiSessions.delete(token);
  for (const [id, upload] of mediaTickets) if (upload.socketId === socket.id) mediaTickets.delete(id);
  socket.apiToken = '';
  socket.currentRoomId = '';
  socket.currentForumPostId = '';
  socket.forumListOptions = undefined;
  socket.authPasswordHash = '';
  socket.user = null;
  onlineUsers.delete(socket.id);
  if (previous && previousRoom) emitAuthorizedRoom(previousRoom, 'system', { type: 'leave', username: displayNameOf(previous), roomId: previousRoom });
  if (notify) socket.emit('loggedOut');
}

function revokeUserSessions(userId) {
  for (const [token, session] of apiSessions) if (session.userId === userId) apiSessions.delete(token);
  for (const socket of io.sockets.sockets.values()) {
    if (socket.user && socket.user.id === userId) clearSocketIdentity(socket, true);
  }
  broadcastOnlineUsers();
}

function bindUser(socket, user) {
  clearSocketIdentity(socket, Boolean(socket.user));
  socket.user = user;
  socket.authPasswordHash = user.passwordHash;
  onlineUsers.set(socket.id, user);
}

function emitAuthorizedRoom(roomId, event, payload) {
  for (const recipient of io.sockets.sockets.values()) {
    const user = currentSocketUser(recipient);
    if (user && recipient.currentRoomId === roomId && canUserAccessRoom(user, roomId)) recipient.emit(event, payload);
  }
}

function requireCurrentRoom(socket) {
  if (!requireAuth(socket, '使用会话')) return false;
  if (canUserAccessRoom(socket.user, socket.currentRoomId)) return true;
  leaveCurrentRoom(socket);
  socket.currentRoomId = '';
  socket.emit('messageError', '请先进入有权限的会话');
  return false;
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

function savePostImageUpload(user, dataUrl, draftToken = '') {
  if (!user) return { error: '请先登录' };
  if (user.isBanned) return { error: '你的账号已被限制使用社区功能' };
  const parsed = parseDataUrl(dataUrl, ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES);
  if (!parsed) return { error: '帖子图片仅支持 JPG、PNG、GIF、WebP，最大 5MB' };

  fs.mkdirSync(POST_IMAGE_UPLOAD_DIR, { recursive: true });
  const ext = IMAGE_EXTENSIONS[parsed.mime] || 'png';
  const fileName = `post_${user.id}_${Date.now()}_${crypto.randomBytes(5).toString('hex')}.${ext}`;
  const filePath = path.join(POST_IMAGE_UPLOAD_DIR, fileName);
  fs.writeFileSync(filePath, parsed.buffer, { mode: 0o600 });
  const now = new Date().toISOString();
  const image = {
    id: `post-image:${crypto.randomUUID()}`,
    postId: '',
    userId: user.id,
    url: `/uploads/post-images/${fileName}`,
    filename: fileName,
    mimeType: parsed.mime,
    sizeBytes: parsed.buffer.length,
    draftToken: cleanTargetType(draftToken).slice(0, 80),
    isBound: 0,
    createdAt: now,
    updatedAt: now
  };
  db.prepare(`
    INSERT INTO post_images (id, post_id, user_id, url, filename, mime_type, size_bytes, draft_token, is_bound, created_at, updated_at)
    VALUES (@id, @postId, @userId, @url, @filename, @mimeType, @sizeBytes, @draftToken, @isBound, @createdAt, @updatedAt)
  `).run(image);
  return { image };
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
    currentSocketUser(connectedSocket) && connectedSocket.user.id === userId
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

function roomHistoryPage(roomId, viewerUserId, options = {}) {
  if (!canUserAccessRoom(userById(viewerUserId),roomId)) throw new InputError('没有会话访问权限');
  const limit = pageInteger(options.limit,MAX_HISTORY_MESSAGES,1,MAX_HISTORY_MESSAGES,'limit');
  let cursor=''; const params=[roomId];
  if (options.before !== undefined) {
    const before=options.before;
    if (!before || typeof before.id!=='string' || !before.id || before.id.length>200 || typeof before.timestamp!=='string' || Number.isNaN(Date.parse(before.timestamp))) throw new InputError('历史游标无效');
    cursor=' AND (created_at < ? OR (created_at = ? AND id < ?))';params.push(before.timestamp,before.timestamp,before.id);
  }
  const rows=db.prepare(`SELECT * FROM messages WHERE room_id=?${cursor} ORDER BY created_at DESC,id DESC LIMIT ?`).all(...params,limit+1);
  const hasMore=rows.length>limit;const page=rows.slice(0,limit);const last=page.at(-1);
  return {roomId,messages:page.reverse().map(rowToMessage).filter(Boolean).map(m=>publicMessage(m,viewerUserId)),hasMore,
    nextCursor:hasMore&&last?{timestamp:last.created_at,id:last.id}:null};
}

function messagesForRoom(roomId, viewerUserId = '') {
  if (!canUserAccessRoom(userById(viewerUserId),roomId)) return [];
  return roomHistoryPage(roomId,viewerUserId).messages;
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

function buildLobbyPayload(viewer = null) {
  return {
    rooms: rooms.filter((room) => room.type === 'group').map((room) => ({
      ...publicRoom(room),
      unreadCount: viewer && canUserAccessRoom(viewer, room.id) ? unreadCountForRoom(viewer.id, room.id) : 0
    })),
    users: publicOnlineUsers(),
    privateUnread: viewer ? Object.fromEntries(roomsVisibleToUser(viewer.id)
      .filter(id=>id.startsWith('dm:') && canUserAccessRoom(viewer,id))
      .map(id=>[privateRoomUsers(id).find(uid=>uid!==viewer.id),unreadCountForRoom(viewer.id,id)])
      .filter(([id])=>id)) : {},
    chatUnreadCount: viewer ? totalChatUnreadForUser(viewer.id) : 0
  };
}

function emitLobby(socket) {
  socket.emit('lobby', buildLobbyPayload(socket.user || null));
}

function broadcastLobby() {
  io.sockets.sockets.forEach((connectedSocket) => {
    connectedSocket.emit('lobby', buildLobbyPayload(connectedSocket.user || null));
  });
}

function refreshOpenRooms() {
  io.sockets.sockets.forEach((connectedSocket) => {
    if (currentSocketUser(connectedSocket) && canUserAccessRoom(connectedSocket.user, connectedSocket.currentRoomId)) {
      connectedSocket.emit('history', messagesForRoom(connectedSocket.currentRoomId, connectedSocket.user ? connectedSocket.user.id : ''));
    }
  });
}

function ensureAdminUser() {
  // Configuration only bootstraps a missing account. Never overwrite existing credentials.
  if (findUserByAccount(ADMIN_ACCOUNT)) return;
  if (!isStrongBootstrapPassword(ADMIN_PASSWORD)) {
    throw new Error('A new administrator requires a non-placeholder ADMIN_PASSWORD of at least 12 characters');
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
  upsertUser(admin);
  users.push(admin);
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
  const user = currentSocketUser(socket);
  if (user) { socket.user = user; return true; }
  if (socket.user) clearSocketIdentity(socket, true);
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

function createApiToken(socket, user) {
  if (socket.apiToken) apiSessions.delete(socket.apiToken);
  const token = crypto.randomBytes(32).toString('hex');
  socket.apiToken = token;
  apiSessions.set(token, { userId: user.id, socketId: socket.id, createdAt: Date.now() });
  return token;
}

function clearApiToken(socket) {
  if (!socket.apiToken) return;
  apiSessions.delete(socket.apiToken);
  socket.apiToken = '';
}

function userFromRequest(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const session = token ? apiSessions.get(token) : null;
  if (!session) return null;
  const socket = io.sockets.sockets.get(session.socketId);
  const user = socket && currentSocketUser(socket);
  return user && user.id === session.userId && socket.apiToken === token ? user : null;
}

function requireApiUser(req, res) {
  const user = userFromRequest(req);
  if (!user) {
    res.status(401).json({ error: '请先登录' });
    return null;
  }
  return user;
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
	    stickerSubmissions: listStickerSubmissions(),
	    maintenance: buildMaintenanceStatus()
	  };
	}

function emitAdminDashboard(socket) {
  socket.emit('admin dashboard', buildAdminDashboard());
}

function groupCodeInfo(now = Date.now()) {
  if (!currentGroupInvite || currentGroupInvite.used || now >= currentGroupInvite.expiresAt) {
    const previous = currentGroupInvite && currentGroupInvite.code;
    let code;
    do { code = String(crypto.randomInt(0, 1000000)).padStart(6, '0'); } while (code === previous);
    currentGroupInvite = { code, expiresAt: now + GROUP_CODE_WINDOW_MS, used: false };
  }
  return { code: currentGroupInvite.code, expiresAt: new Date(currentGroupInvite.expiresAt).toISOString() };
}

function isValidGroupCode(code, now = Date.now()) {
  return Boolean(currentGroupInvite && !currentGroupInvite.used && now < currentGroupInvite.expiresAt &&
    typeof code === 'string' && /^\d{6}$/.test(code.trim()) && code.trim() === currentGroupInvite.code);
}

function allowGroupInviteAttempt(socket, now = Date.now()) {
  for (const [key, entry] of groupInviteAttempts) if (now >= entry.until) groupInviteAttempts.delete(key);
  // Do not trust client-supplied forwarding headers for this security limit.
  const key = socket.handshake.address || 'unknown-peer';
  let entry = groupInviteAttempts.get(key);
  if (!entry) {
    if (groupInviteAttempts.size >= 10000) return false;
    entry = { count: 0, until: now + GROUP_CODE_WINDOW_MS };
    groupInviteAttempts.set(key, entry);
  }
  return ++entry.count <= 5;
}

function broadcastAdminDashboards() {
  io.sockets.sockets.forEach((connectedSocket) => {
    if (currentSocketUser(connectedSocket) && isAdminUser(connectedSocket.user)) {
      emitAdminDashboard(connectedSocket);
    }
  });
}

function mediaType(value) {
  if (typeof value !== 'string' || value.length > 160) return null;
  const match = value.trim().toLowerCase().match(/^(image\/(?:jpeg|png|gif|webp)|audio\/(?:webm|mp4|mpeg|ogg|wav))(?:\s*;\s*codecs\s*=\s*(?:"([a-z0-9., -]+)"|([a-z0-9.,-]+)))?$/);
  if (!match) return null;
  const mime = match[1], codecs = (match[2] || match[3] || '').split(',').map(x => x.trim()).filter(Boolean);
  const allowed = { 'audio/webm': ['opus','vorbis'], 'audio/ogg': ['opus','vorbis'], 'audio/mp4': ['mp4a.40.2','mp4a.40.5','mp4a.40.29'], 'audio/mpeg':['mp3'], 'audio/wav':['1','pcm'] };
  if (codecs.some(c => !(allowed[mime] || []).includes(c))) return null;
  return { mime, codecs, value: mime + (codecs.length ? ';codecs=' + codecs.join(',') : '') };
}
function parseStoredMediaData(value, allowedTypes, maxBytes, legacy = false) {
  if (typeof value !== 'string' || (!legacy && value.length > Math.ceil(maxBytes / 3) * 4 + 200)) return false;
  const match = value.match(legacy ? /^data:([^,]+);base64,([a-z0-9+/=\s]+)$/i : /^data:([^,]+);base64,([a-z0-9+/]*={0,2})$/i);
  if (match && legacy) match[2] = match[2].replace(/\s/g, '');
  const type = match && mediaType(match[1]);
  if (!type || !allowedTypes.has(type.mime) || !match[2] || match[2].length % 4) return false;
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > maxBytes || (!legacy && buffer.toString('base64') !== match[2])) return false;
  return { ...type, buffer };
}
function imageSignature(buffer, mime) {
  if (buffer.length < 12) return false;
  if (mime === 'image/png') return buffer.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));
  if (mime === 'image/jpeg') return buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  if (mime === 'image/gif') return /^GIF8[79]a$/.test(buffer.toString('ascii',0,6));
  return mime === 'image/webp' && buffer.toString('ascii',0,4) === 'RIFF' && buffer.toString('ascii',8,12) === 'WEBP';
}
// Bounded EBML parsing: require a WebM document, audio track and actual blocks.
// This validates structure/codec identifiers; it is not an audio decoder.
function webmAudio(buffer, codecs) {
  let elements=0, doc=false, track=false, frames=false, invalid=false;
  function vint(at, end, id=false) {
    if(at>=end || !buffer[at])throw new Error('vint');
    let width=1, mask=128;while(!(buffer[at]&mask)){width++;mask>>=1;}
    if(width>(id?4:8) || at+width>end)throw new Error('vint');
    let value=BigInt(id?buffer[at]:buffer[at]&(mask-1));
    for(let i=1;i<width;i++)value=(value<<8n)|BigInt(buffer[at+i]);
    return {width,value,unknown:!id && value===(1n<<BigInt(7*width))-1n};
  }
  function walk(start,end,depth=0,parent=0) {
    if(depth>8)throw new Error('depth');
    let at=start, audio=false, codec='';
    while(at<end){
      if(++elements>50000)throw new Error('elements');
      const id=vint(at,end,true);at+=id.width;const size=vint(at,end);at+=size.width;
      const code=Number(id.value);
      if(size.unknown && ![0x18538067,0x1f43b675].includes(code))throw new Error('size');
      const length=size.unknown?end-at:Number(size.value);if(!Number.isSafeInteger(length) || length>end-at)throw new Error('length');
      const stop=at+length;
      if(code===0x4282 && parent===0x1a45dfa3)doc=buffer.toString('ascii',at,stop)==='webm';
      if(code===0x83 && parent===0xae){audio=length===1 && buffer[at]===2;if(!audio)invalid=true;}
      if(code===0x86 && parent===0xae)codec=buffer.toString('ascii',at,stop);
      if([0xa3,0xa1].includes(code) && [0x1f43b675,0xa0].includes(parent)){
        const number=vint(at,stop);if(length>number.width+3)frames=true;
      }
      if([0x1a45dfa3,0x18538067,0x1654ae6b,0xae,0x1f43b675,0xa0].includes(code))walk(at,stop,depth+1,code);
      at=stop;
    }
    if(parent===0xae){const supported=codec==='A_OPUS'?'opus':codec==='A_VORBIS'?'vorbis':'';if(audio && supported && (!codecs.length || codecs.every(c=>c===supported)))track=true;else invalid=true;}
  }
  try {walk(0,buffer.length);return doc&&track&&frames&&!invalid;}catch{return false;}
}
function oggAudio(buffer,codecs) {
  let at=0,pages=0;const packets=[];let parts=[];let serial;
  while(at<buffer.length){
    if(at+27>buffer.length || buffer.toString('ascii',at,at+4)!=='OggS' || buffer[at+4]!==0)return false;
    const stream=buffer.readUInt32LE(at+14);if(serial!==undefined && stream!==serial)return false;serial=stream;
    const count=buffer[at+26];if(at+27+count>buffer.length)return false;
    let body=at+27+count;
    for(let i=0;i<count;i++){const size=buffer[at+27+i];if(body+size>buffer.length)return false;parts.push(buffer.subarray(body,body+size));body+=size;if(size<255){packets.push(Buffer.concat(parts));parts=[];}}
    at=body;if(++pages>10000)return false;
  }
  const first=packets[0];if(!first || parts.length)return false;
  const codec=first.subarray(0,8).toString()==='OpusHead'?'opus':first[0]===1 && first.subarray(1,7).toString()==='vorbis'?'vorbis':'';
  return Boolean(codec && packets.length>=(codec==='opus'?3:4) && packets.at(-1).length && (!codecs.length || codecs.every(c=>c===codec)));
}
function audioSignature(buffer, type) {
  if (buffer.length < 16) return false;
  const ascii = buffer.toString('latin1');
  if (type.mime === 'audio/webm') return buffer.readUInt32BE(0) === 0x1a45dfa3 && webmAudio(buffer,type.codecs);
  if (type.mime === 'audio/ogg') return oggAudio(buffer,type.codecs);
  if (type.mime === 'audio/mp4') {
    let at = 0, ftyp = false, moov = false, mdat = false;
    while (at + 8 <= buffer.length) {
      let size = buffer.readUInt32BE(at), header = 8; const box = buffer.toString('ascii',at+4,at+8);
      if (size === 1) { if (at+16 > buffer.length) return false; const big = buffer.readBigUInt64BE(at+8); if (big > BigInt(buffer.length)) return false; size=Number(big); header=16; }
      if (size === 0) size = buffer.length-at;
      if (size < header || at+size > buffer.length) return false;
      if (box === 'ftyp') ftyp = true;
      if (box === 'moov') moov = buffer.subarray(at+header,at+size).includes(Buffer.from('soun')) && buffer.subarray(at+header,at+size).includes(Buffer.from('mp4a'));
      if (box === 'mdat') mdat = size > header;
      at += size;
    }
    return at === buffer.length && ftyp && moov && mdat;
  }
  if (type.mime === 'audio/wav') {
    if (!ascii.startsWith('RIFF') || ascii.slice(8,12) !== 'WAVE' || buffer.readUInt32LE(4)+8 !== buffer.length) return false;
    let at=12, fmt=false, data=false;
    while(at+8<=buffer.length){const name=ascii.slice(at,at+4), size=buffer.readUInt32LE(at+4);if(at+8+size>buffer.length)return false;
      if(name==='fmt '){if(size<16)return false;const format=buffer.readUInt16LE(at+8), channels=buffer.readUInt16LE(at+10), rate=buffer.readUInt32LE(at+12);fmt=[1,3,0xfffe].includes(format)&&channels>=1&&channels<=2&&rate>=8000&&rate<=96000;}
      if(name==='data')data=size>0; at+=8+size+(size%2);
    } return fmt&&data&&at===buffer.length;
  }
  if (type.mime === 'audio/mpeg') {
    let at=0;
    if(ascii.startsWith('ID3')) { if(buffer.subarray(6,10).some(b=>b>127))return false; at=10+((buffer[6]<<21)|(buffer[7]<<14)|(buffer[8]<<7)|buffer[9]); }
    return at+4<buffer.length && buffer[at]===255 && (buffer[at+1]&0xe0)===0xe0 && (buffer[at+1]&6)!==0 && (buffer[at+2]&0xf0)!==0xf0 && (buffer[at+2]&0xf0)!==0 && (buffer[at+2]&12)!==12;
  }
  return false;
}
function parseDataUrl(value, allowedTypes, maxBytes) {
  const parsed = parseStoredMediaData(value, allowedTypes, maxBytes);
  return parsed && imageSignature(parsed.buffer, parsed.mime) ? parsed : false;
}
function isValidImageData(value) { return Boolean(parseDataUrl(value, ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES)); }
function parseAvatarData(value) { return parseDataUrl(value, ALLOWED_AVATAR_TYPES, MAX_AVATAR_BYTES); }
function isValidVoiceData(value) { const p=parseStoredMediaData(value,ALLOWED_AUDIO_TYPES,MAX_VOICE_BYTES); return Boolean(p && audioSignature(p.buffer,p)); }

// HTTP carries raw bytes; existing Socket events carry a short, session-bound ticket.
// Two in-flight decoders (<=16M RGBA pixels each), 32 MiB encoded ticket cache,
// 5 MiB request bodies. Socket.IO keeps its 1 MB inbound ceiling.
const MEDIA_EVENTS = new Map([
  ['chat image', MAX_IMAGE_BYTES], ['chat voice', MAX_VOICE_BYTES], ['avatar upload', MAX_AVATAR_BYTES],
  ['profile banner upload', MAX_BANNER_BYTES], ['upload post image', MAX_IMAGE_BYTES],
  ['upload sticker', MAX_STICKER_BYTES], ['submit official sticker', MAX_STICKER_BYTES]
]);
const mediaTickets = new Map(), mediaAttempts = new Map();
let activeMedia = 0;
function releaseMediaTicket(socket, payload) {
  const ticket=payload && mediaTickets.get(payload._mediaTicket);
  if(ticket && ticket.socketId===socket.id && ticket.apiToken===socket.apiToken)mediaTickets.delete(payload._mediaTicket);
}
function pruneMediaTickets(now = Date.now()) { for (const [id,t] of mediaTickets) if(t.expiresAt <= now) mediaTickets.delete(id); }
async function validateMedia(buffer, type, event) {
  if (!type || !Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MEDIA_EVENTS.get(event)) throw new InputError('文件类型不支持或超过大小上限');
  if(event === 'chat voice') { if(!audioSignature(buffer,type)) throw new InputError('语音内容与格式不匹配'); return; }
  if (!imageSignature(buffer,type.mime) || (event === 'avatar upload' && !ALLOWED_AVATAR_TYPES.has(type.mime))) throw new InputError('图片内容与格式不匹配');
  try {
    const decoder = sharp(buffer, { animated: true, limitInputPixels: 16000000, failOn: 'warning' });
    const meta = await decoder.metadata();
    if (!meta.width || !meta.height || meta.width > 8192 || (meta.pageHeight || meta.height)>8192 || meta.width*meta.height>16000000 || (meta.pages||1)>100 || 'image/'+(meta.format==='jpeg'?'jpeg':meta.format)!==type.mime) throw new Error('dimensions');
    // Decode every allowed animation frame; reject truncated/broken data. Keep original bytes/animation.
    await decoder.timeout({seconds:5}).raw().toBuffer();
  } catch { throw new InputError('图片损坏或尺寸过大（最多 1600 万总像素、100 帧）'); }
}
function mediaFailure(socket,event,error,reply) {
  const message=error instanceof InputError?error.message:'上传失败，请重试';
  socket.emit(event.includes('sticker')?'sticker error':event==='avatar upload'||event==='profile banner upload'?'profileError':event==='upload post image'?'forum error':'messageError',message);
  if(typeof reply==='function')reply({ok:false,error:message});
}
function installMediaBoundary(socket) {
  socket.use(async (packet,next) => {
    const [event,payload,reply]=packet;
    if(!MEDIA_EVENTS.has(event))return next();
    let reserved=false;
    try {
      const user=currentSocketUser(socket), token=socket.apiToken, originalRoom=socket.currentRoomId;
      if(!user || user.isBanned)throw new InputError('请重新登录或检查账号权限');
      if(!payload || typeof payload.base64!=='string')throw new InputError('缺少上传内容');
      pruneMediaTickets();
      if(payload.base64.startsWith('upload:')) {
        const ticket=mediaTickets.get(payload.base64);
        if(!ticket || ticket.socketId!==socket.id || ticket.apiToken!==token || ticket.event!==event || (event.startsWith('chat ') && ticket.roomId!==socket.currentRoomId))throw new InputError('上传已过期或会话已改变，请重新上传');
        if(event.startsWith('chat ')) {
          if(!payload.clientMessageId || (ticket.clientMessageId && ticket.clientMessageId!==payload.clientMessageId))throw new InputError('上传重试标识不一致');
          ticket.clientMessageId=payload.clientMessageId;
        } else mediaTickets.delete(payload.base64);
        packet[1]={...payload,base64:ticket.dataUrl,_mediaTicket:payload.base64};
      } else {
        // Small legacy clients still work, with identical validation and resource limits.
        if(activeMedia>=2 || !takeQuota(mediaAttempts,user.id,30,60000))throw new InputError('上传繁忙，请稍后重试');
        activeMedia++;reserved=true;
        const parsed=parseStoredMediaData(payload.base64,event==='chat voice'?ALLOWED_AUDIO_TYPES:ALLOWED_IMAGE_TYPES,MEDIA_EVENTS.get(event));
        if(!parsed)throw new InputError('文件格式无效');
        await validateMedia(parsed.buffer,parsed,event);
        if(!currentSocketUser(socket) || socket.apiToken!==token || socket.user.isBanned || (event.startsWith('chat ') && socket.currentRoomId!==originalRoom))throw new InputError('会话已改变，请重新登录');
      }
      next();
    } catch(error) { mediaFailure(socket,event,error,reply); }
    finally { if(reserved)activeMedia--; }
  });
}
app.post('/api/media', (req,res) => {
  const user=requireApiUser(req,res); if(!user)return;
  const event=req.headers['x-uni-media-event'], type=mediaType(req.headers['content-type']);
  const sessionToken=(req.headers.authorization||'').slice(7).trim();
  const session=apiSessions.get(sessionToken), socket=session && io.sockets.sockets.get(session.socketId);
  if(user.isBanned)return res.status(403).json({error:'账号已被限制'});
  if(!MEDIA_EVENTS.has(event) || !type || (event==='chat voice'?!ALLOWED_AUDIO_TYPES.has(type.mime):!ALLOWED_IMAGE_TYPES.has(type.mime)))return res.status(415).json({error:'文件类型不支持'});
  const roomId=socket.currentRoomId;
  if(event.startsWith('chat ') && !canUserAccessRoom(user,roomId))return res.status(403).json({error:'请先进入会话'});
  if(req.headers['content-encoding'] && req.headers['content-encoding']!=='identity')return res.status(415).json({error:'上传不接受压缩编码'});
  if(activeMedia>=2 || !takeQuota(mediaAttempts,user.id,30,60000))return res.status(429).json({error:'上传繁忙，请稍后重试'});
  activeMedia++;
  let released=false;
  const release=()=>{if(!released){released=true;activeMedia--;}};
  let decoding=false;
  const onClose=()=>{if(!decoding)release();}; res.once('close',onClose);
  const deadline=setTimeout(()=>{if(!res.headersSent)res.status(408).json({error:'上传超时，请重试'});req.destroy();},15000);
  res.once('close',()=>clearTimeout(deadline));
  express.raw({type:()=>true,limit:MEDIA_EVENTS.get(event),inflate:false})(req,res,async error=>{
    try {
      if(error && (res.writableEnded || req.destroyed))return;
      if(error)return res.status(error.status===413?413:400).json({error:'文件过大或上传不完整'});
      decoding=true;
      await validateMedia(req.body,type,event);
      if(!userFromRequest(req) || user.isBanned || socket.apiToken!==sessionToken || (event.startsWith('chat ') && socket.currentRoomId!==roomId))return res.status(401).json({error:'会话已改变，请重新登录'});
      pruneMediaTickets();
      const dataUrl='data:'+type.value+';base64,'+req.body.toString('base64');
      const entries=[...mediaTickets.values()];
      if(entries.filter(t=>t.socketId===socket.id).length>=4 || entries.reduce((n,t)=>n+t.dataUrl.length,0)+dataUrl.length>32*1024*1024)return res.status(429).json({error:'待确认上传过多，请稍后重试'});
      const ticket='upload:'+crypto.randomBytes(24).toString('hex');
      mediaTickets.set(ticket,{dataUrl,event,socketId:socket.id,apiToken:sessionToken,roomId,expiresAt:Date.now()+120000});
      res.json({ticket,expiresIn:120});
    } catch(error) { res.status(error instanceof InputError?400:500).json({error:error instanceof InputError?error.message:'上传失败，请重试'}); }
    finally { clearTimeout(deadline);res.off('close',onClose);release(); }
  });
});

initDatabase();
let users = loadUsers();
let messages = loadHistory();
notificationsReady = true;
ensureAdminUser();
let rooms = loadRooms();
const onlineUsers = new Map();
const typingTimers = new Map();

fs.mkdirSync(AVATAR_UPLOAD_DIR, { recursive: true });
fs.mkdirSync(BANNER_UPLOAD_DIR, { recursive: true });
fs.mkdirSync(STICKER_UPLOAD_DIR, { recursive: true });
fs.mkdirSync(POST_IMAGE_UPLOAD_DIR, { recursive: true });
app.use('/uploads', (req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');next();}, express.static(UPLOADS_DIR));
app.get('/api/notifications', (req, res) => {
  const user = requireApiUser(req, res);
  if (!user) return;
  const unreadOnly = req.query.unread === '1' || req.query.unread === 'true';
  res.json({
    items: listNotificationsForUser(user.id, {
      unreadOnly,
      limit: req.query.limit,
      offset: req.query.offset
    }),
    unreadCount: unreadNotificationCount(user.id)
  });
});

app.get('/api/notifications/unread-count', (req, res) => {
  const user = requireApiUser(req, res);
  if (!user) return;
  res.json({
    notifications: unreadNotificationCount(user.id),
    chat: totalChatUnreadForUser(user.id)
  });
});

app.post('/api/notifications/:id/read', (req, res) => {
  const user = requireApiUser(req, res);
  if (!user) return;
  const notification = markNotificationRead(user.id, req.params.id);
  if (!notification) {
    res.status(404).json({ error: '通知不存在' });
    return;
  }
  res.json({ notification, unreadCount: unreadNotificationCount(user.id) });
});

app.post('/api/notifications/read-all', (req, res) => {
  const user = requireApiUser(req, res);
  if (!user) return;
  markAllNotificationsRead(user.id);
  res.json({ ok: true, unreadCount: 0 });
});

app.get('/api/me/community-workspace', (req, res) => {
  const user = requireApiUser(req, res);
  if (!user) return;
  res.json(myCommunityWorkspace(user.id));
});

app.get('/api/me/posts', (req, res) => {
  const user = requireApiUser(req, res);
  if (!user) return;
  res.json({
    items: myForumPosts(user.id, req.query.sort, req.query.limit, req.query.offset)
  });
});

app.get('/api/me/comments', (req, res) => {
  const user = requireApiUser(req, res);
  if (!user) return;
  res.json({
    items: myForumComments(user.id, false, req.query.limit, req.query.offset)
  });
});

app.get('/api/me/replies', (req, res) => {
  const user = requireApiUser(req, res);
  if (!user) return;
  res.json({
    items: myForumComments(user.id, true, req.query.limit, req.query.offset)
  });
});

app.get('/api/me/favorites', (req, res) => {
  const user = requireApiUser(req, res);
  if (!user) return;
  res.json({
    items: myForumFavorites(user.id, req.query.limit, req.query.offset)
  });
});

app.get('/api/me/notification-preferences', (req, res) => {
  const user = requireApiUser(req, res);
  if (!user) return;
  res.json({ items: listNotificationPreferences(user.id) });
});

app.post('/api/me/notification-preferences', (req, res) => {
  const user = requireApiUser(req, res);
  if (!user) return;
  const key = cleanText(req.body && req.body.key, 80);
  if (!NOTIFICATION_PREFERENCE_KEYS.has(key)) {
    res.status(400).json({ error: '这个通知偏好不可修改' });
    return;
  }
  setNotificationPreference(user.id, key, Boolean(req.body && req.body.enabled));
  res.json({ items: listNotificationPreferences(user.id) });
});

app.get('/api/users/:id/community-summary', (req, res) => {
  const user = requireApiUser(req, res);
  if (!user) return;
  const summary = userCommunitySummary(req.params.id, user.id);
  if (!summary) {
    res.status(404).json({ error: '用户不存在' });
    return;
  }
  res.json(summary);
});

app.get('/api/forum/posts', (req, res) => {
  const user = requireApiUser(req, res);
  if (!user) return;
  const options = cleanForumListOptions(req.query || {});
  res.json({
    posts: listForumPosts(user.id, options),
    sort: options.sort,
    filter: options.filter
  });
});

app.get('/api/search', (req, res) => {
  const user = requireApiUser(req, res);
  if (!user) return;
  res.json(searchUni(user, {
    q: req.query.q,
    scope: req.query.scope,
    limit: req.query.limit,
    offset: req.query.offset
  }));
});

app.get('/api/messages/:messageId/reactions', (req, res) => {
  const user = requireApiUser(req, res);
  if (!user) return;
  const message = messageById(req.params.messageId);
  if (!canUserViewMessage(user, message)) {
    res.status(404).json({ error: '消息不存在' });
    return;
  }
  res.json({ messageId: message.id, reactions: reactionSummaryForMessage(message.id, user.id) });
});

app.post('/api/messages/:messageId/reaction', (req, res) => {
  const user = requireApiUser(req, res);
  if (!user) return;
  const result = toggleMessageReaction(user, req.params.messageId, req.body && req.body.reaction);
  if (result.error) {
    res.status(result.status || 400).json({ error: result.error });
    return;
  }
  res.json(result);
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const invalid = error instanceof InputError;
  if (!invalid) console.error('HTTP operation failed:', error.code || error.name);
  const status=invalid?400:[400,413,415].includes(error.status)?error.status:500;
  res.status(status).json({ error: invalid ? error.message : status===413 ? '请求超过大小上限' : status===415 ? '不支持此请求编码' : status===400 ? '请求格式无效' : '操作失败，请稍后重试' });
});

app.use(express.static(path.join(__dirname, 'public')));

// Catch synchronous business failures without exposing database details to clients.
function safeSocketHandler(socket, event, handler) {
  socket.on(event, (payload, acknowledgement) => {
    let answered = false;
    const reply = (result) => {
      if (answered) return;
      answered = true;
      if (typeof acknowledgement === 'function') acknowledgement(result);
    };
    try {
      handler(payload, reply);
      if (!answered && ['chat message', 'chat image', 'chat voice', 'chat sticker'].includes(event)) {
        reply({ ok: false, error: '请求未完成，请检查提示后重试' });
      }
    } catch (error) {
      const message = error instanceof InputError ? error.message : '操作失败，未确认成功，请重试';
      console.error(`Socket operation failed [${event}]:`, error.code || error.name);
      socket.emit(event.startsWith('admin ') ? 'admin error' : event.includes('forum') ? 'forum error' : 'messageError', message);
      reply({ ok: false, error: message });
    }
  });
}

function persistAndPublishMessage(socket, data, payload, reply) {
  const clientId = payload && typeof payload === 'object' ? payload.clientMessageId : undefined;
  if (clientId !== undefined) {
    if (typeof clientId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(clientId)) throw new InputError('消息重试标识无效');
    data.id = 'client:' + crypto.createHash('sha256').update(JSON.stringify([socket.user.id, data.roomId, clientId])).digest('hex');
    const existing = messageById(data.id);
    if (existing) {
      if (!existing.recalled && (existing.type !== data.type || existing.content !== data.content || (existing.stickerId || '') !== (data.stickerId || '') || (existing.duration || 0) !== (data.duration || 0))) {
        throw new InputError('消息重试标识已用于其他内容');
      }
      releaseMediaTicket(socket, payload);
      reply({ ok: true, messageId: existing.id, duplicate: true });
      return;
    }
  }
  // Keep new writes ordered even when several sends share a clock millisecond.
  const latest = lastMessageForRoom(data.roomId);
  if (latest && latest.created_at >= data.timestamp) data.timestamp = new Date(Date.parse(latest.created_at) + 1).toISOString();
  // The database is authoritative. Never update cache, acknowledge, or broadcast first.
  upsertMessage(data);
  messages = trimHistory([...messages, data]);
  releaseMediaTicket(socket, payload);
  reply({ ok: true, messageId: data.id });
  emitAuthorizedRoom(data.roomId, 'chat message', data);
  try {
    notifyPrivateRecipients(data);
    notifyChatRecipients(data);
    broadcastAdminDashboards();
  } catch (error) {
    // Delivery is committed; secondary notification failure must not claim it was rolled back.
    console.error('Message notification failed:', error.code || error.name);
  }
}

io.on('connection', (socket) => {
  installMediaBoundary(socket);
  socket.emit('onlineUsers', { count: onlineUsers.size, users: Array.from(onlineUsers.values()).map(publicUser) });
  emitLobby(socket);

  socket.on('latency:ping', (sentAt) => {
    socket.emit('latency:pong', sentAt);
  });

  safeSocketHandler(socket, 'register', (payload) => {
    if (!takeQuota(registrationAttempts, authLimitKey(socket), AUTH_MAX_ATTEMPTS)) {
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
    const apiToken = createApiToken(socket, user);
    socket.emit('authSuccess', { user: publicUser(user), apiToken });
    emitRenameStatus(socket);
    emitBulletins(socket);
    emitNotifications(socket);
    emitLobby(socket);
    broadcastOnlineUsers();
    broadcastAdminDashboards();
  });

  safeSocketHandler(socket, 'login', (payload) => {
    const input = validateAuthPayload(payload);
    if (input.error) { socket.emit('authError', input.error); return; }
    if (!checkAuthLimit(socket, input.account)) {
      socket.emit('authError', '尝试次数太多了，请稍后再试'); return;
    }

    const user = findUserByAccount(input.account);
    if (!user || !verifyPassword(input.password, user.passwordHash)) {
      socket.emit('authError', '账号或密码不对');
      return;
    }

    recordLogin(socket, user);
    bindUser(socket, user);
    const apiToken = createApiToken(socket, user);
    clearAuthLimit(socket, input.account);
    socket.emit('authSuccess', { user: publicUser(user), apiToken });
    emitRenameStatus(socket);
    emitBulletins(socket);
    emitNotifications(socket);
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

  safeSocketHandler(socket, 'upload sticker', (payload) => {
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

  safeSocketHandler(socket, 'submit official sticker', (payload) => {
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

  safeSocketHandler(socket, 'get forum posts', (payload = {}) => {
    if (!requireAuth(socket, '查看论坛')) return;
    emitForumPosts(socket, payload);
  });

	  safeSocketHandler(socket, 'upload post image', (payload = {}) => {
	    if (!requireCommunityAccess(socket, '上传帖子图片')) return;
	    const result = savePostImageUpload(socket.user, payload && payload.base64, payload && payload.draftToken);
	    if (result.error) {
	      socket.emit('forum error', result.error);
	      return;
	    }
	    socket.emit('post image uploaded', { image: result.image });
  });

  safeSocketHandler(socket, 'create forum post', (payload) => {
    if (!requireCommunityAccess(socket, '发帖')) return;
    const title = cleanPostTitle(payload && payload.title);
    const incomingHtml = sanitizeRichHtml(payload && payload.contentHtml);
    const contentText = richHtmlToText(incomingHtml, payload && payload.content);
    const content = cleanPostContent(payload && payload.content) || contentText;
    if (!title) {
      socket.emit('forum error', '请输入帖子标题');
      return;
    }
    if (!contentText && !content) {
      socket.emit('forum error', '请输入帖子正文');
      return;
    }
    const imageCount = (incomingHtml.match(/<img\b/gi) || []).length;
    if (imageCount > MAX_POST_IMAGES) {
      socket.emit('forum error', `每个帖子最多插入 ${MAX_POST_IMAGES} 张图片`);
      return;
    }

    const post = {
      postId: `post:${crypto.randomUUID()}`,
      userId: socket.user.id,
      username: displayNameOf(socket.user),
      avatar: socket.user.avatar || makeAvatar(displayNameOf(socket.user)),
      title,
      content: contentText || content,
	      contentHtml: incomingHtml,
	      contentText: contentText || content,
	      contentFormat: incomingHtml ? 'html' : 'plain',
	      createdAt: new Date().toISOString(),
	      updatedAt: new Date().toISOString()
	    };
    try {
      transaction(() => { insertForumPost(post);
      updatePostImagesForPost(socket.user.id, post.postId, incomingHtml); });
    } catch (error) {
      socket.emit('forum error', '发帖失败，请稍后再试');
      return;
    }
    const publicPost = publicForumPost({ ...post, commentCount: 0 }, socket.user.id);
    socket.emit('forum post created', { post: publicPost, comments: [] });
	    broadcastForumPosts();
	  });

	  safeSocketHandler(socket, 'update forum post', (payload) => {
	    if (!requireCommunityAccess(socket, '编辑帖子')) return;
	    const postId = cleanForumId(payload && payload.postId);
	    const existing = rawForumPost(postId);
	    if (!existing) {
	      socket.emit('forum error', '帖子不存在');
	      return;
	    }
	    if (!canEditForumPost(socket.user, existing)) {
	      socket.emit('forum error', socket.user.isBanned ? '你的账号已被限制使用社区功能' : '没有权限编辑这个帖子');
	      return;
	    }
	    const title = cleanPostTitle(payload && payload.title);
	    const incomingHtml = sanitizeRichHtml(payload && payload.contentHtml);
	    const contentText = richHtmlToText(incomingHtml, payload && payload.content);
	    const content = cleanPostContent(payload && payload.content) || contentText;
	    if (!title) {
	      socket.emit('forum error', '请输入帖子标题');
	      return;
	    }
	    if (!contentText && !content) {
	      socket.emit('forum error', '请输入帖子正文');
	      return;
	    }
	    const imageCount = (incomingHtml.match(/<img\b/gi) || []).length;
	    if (imageCount > MAX_POST_IMAGES) {
	      socket.emit('forum error', `每个帖子最多插入 ${MAX_POST_IMAGES} 张图片`);
	      return;
	    }
	    const now = new Date().toISOString();
	    try {
	      transaction(() => { updateForumPost({
	        postId,
	        title,
	        content: contentText || content,
	        contentHtml: incomingHtml,
	        contentText: contentText || content,
	        contentFormat: incomingHtml ? 'html' : 'plain',
	        updatedAt: now,
	        editedAt: now
	      });
	      updatePostImagesForPost(socket.user.id, postId, incomingHtml); });
	    } catch (error) {
	      socket.emit('forum error', '保存帖子失败，请稍后再试');
	      return;
	    }
	    const post = getForumPost(postId, socket.user.id);
	    socket.emit('forum post updated', { post, comments: listForumComments(postId, socket.user.id) });
	    broadcastForumPostDetail(postId);
	    broadcastForumPosts();
	    broadcastAdminDashboards();
	  });

  safeSocketHandler(socket, 'get forum post', (postIdValue) => {
    if (!requireAuth(socket, '查看帖子')) return;
    const postId = cleanForumId(postIdValue);
    const post = getForumPost(postId, socket.user.id);
    if (!post) {
      socket.emit('forum error', '帖子不存在');
      return;
    }
    if (socket.currentForumPostId && socket.currentForumPostId !== postId) {
      socket.leave(forumPostChannel(socket.currentForumPostId));
    }
    socket.currentForumPostId = postId;
    socket.join(forumPostChannel(postId));
    socket.emit('forum post detail', { post, comments: listForumComments(postId, socket.user.id) });
  });

  safeSocketHandler(socket, 'create forum comment', (payload) => {
    if (!requireCommunityAccess(socket, '评论')) return;
    const postId = cleanForumId(payload && payload.postId);
    const content = cleanCommentContent(payload && payload.content);
    const parentCommentId = cleanForumId(payload && payload.parentCommentId);
    if (!postId || !getForumPost(postId, socket.user.id)) {
      socket.emit('forum error', '帖子不存在');
      return;
    }
    const floor = nextCommentFloor(postId, parentCommentId);
    if (!floor) {
      socket.emit('forum error', '要回复的评论不存在');
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
      parentCommentId,
      floorNumber: floor.floorNumber,
      replyNumber: floor.replyNumber,
      createdAt: new Date().toISOString()
    };
    try {
      transaction(() => {
        const allocated = nextCommentFloor(postId,parentCommentId);
        if (!allocated) throw new InputError('要回复的评论不存在');
        comment.floorNumber=allocated.floorNumber;comment.replyNumber=allocated.replyNumber;
        insertForumComment(comment);
      });
    } catch (error) {
      socket.emit('forum error', '评论失败，请稍后再试');
      return;
    }
    const post = rawForumPost(postId);
    const parent = parentCommentId ? rowToComment(rawForumComment(parentCommentId)) : null;
    const notifyTargetId = parent && parent.userId !== socket.user.id ? parent.userId : post && post.user_id !== socket.user.id ? post.user_id : '';
    if (notifyTargetId) {
      createNotification({
        userId: notifyTargetId,
        actorUserId: socket.user.id,
        type: 'forum_comment',
        title: parent ? `${displayNameOf(socket.user)} 回复了你的评论` : `${displayNameOf(socket.user)} 评论了你的帖子`,
        body: content,
        targetType: 'post',
        targetId: postId,
        metadata: { commentId: comment.commentId, parentCommentId: parentCommentId || '' },
        eventType: parent ? 'forum_reply' : 'forum_comment',
        dedupeKey: `forum-comment:${comment.commentId}:${notifyTargetId}`
      });
    }
    emitForumSubscribers(postId, 'forum comment created', { comment: publicForumComment(comment) });
    broadcastForumPostDetail(postId);
    broadcastForumPosts();
  });

  safeSocketHandler(socket, 'toggle post like', (postIdValue) => {
    if (!requireCommunityAccess(socket, '点赞帖子')) return;
    const result = togglePostLike(socket.user, postIdValue);
    if (result.error) {
      socket.emit('forum error', result.error);
      return;
    }
    socket.emit('forum post interaction', result);
    broadcastForumPostDetail(result.post.postId);
    broadcastForumPosts();
  });

  safeSocketHandler(socket, 'toggle post favorite', (postIdValue) => {
    if (!requireCommunityAccess(socket, '收藏帖子')) return;
    const result = togglePostFavorite(socket.user, postIdValue);
    if (result.error) {
      socket.emit('forum error', result.error);
      return;
    }
    socket.emit('forum post interaction', result);
    broadcastForumPostDetail(result.post.postId);
    broadcastForumPosts();
  });

  safeSocketHandler(socket, 'toggle comment like', (commentIdValue) => {
    if (!requireCommunityAccess(socket, '点赞评论')) return;
    const result = toggleCommentLike(socket.user, commentIdValue);
    if (result.error) {
      socket.emit('forum error', result.error);
      return;
    }
    socket.emit('forum comment interaction', result);
    if (result.comment && result.comment.postId) broadcastForumPostDetail(result.comment.postId);
  });

  safeSocketHandler(socket, 'delete forum post', (postIdValue) => {
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

  safeSocketHandler(socket, 'delete forum comment', (commentIdValue) => {
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
      deleteForumCommentById(commentId);
    } catch (error) {
      socket.emit('forum error', '删除评论失败');
      return;
    }
    emitForumSubscribers(comment.post_id, 'forum comment deleted', {
      postId: comment.post_id,
      commentId
    });
    broadcastForumPostDetail(comment.post_id);
    broadcastForumPosts();
    broadcastAdminDashboards();
  });

  safeSocketHandler(socket, 'report forum post', (payload) => {
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
    createNotification({
      userId: target.id,
      actorUserId: socket.user.id,
      type: 'star_received',
      title: `${displayNameOf(socket.user)} 给你点亮了 Star`,
      body: '你的主页收到了一颗新的 Star。',
      targetType: 'user',
      targetId: target.id,
      dedupeKey: `star:${todayStarDate()}:${socket.user.id}:${target.id}`
    });
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

  safeSocketHandler(socket, 'profile banner upload', (payload) => {
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

  safeSocketHandler(socket, 'avatar upload', (payload) => {
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

  safeSocketHandler(socket, 'get notifications', (payload = {}) => {
    if (!requireAuth(socket, '查看通知')) return;
    socket.emit('notifications', {
      items: listNotificationsForUser(socket.user.id, {
        unreadOnly: Boolean(payload && payload.unreadOnly),
        limit: payload && payload.limit,
        offset: payload && payload.offset
      }),
      unreadCount: unreadNotificationCount(socket.user.id)
    });
    emitUnreadUpdate(socket.user.id);
  });

  socket.on('mark notification read', (notificationId) => {
    if (!requireAuth(socket, '标记通知')) return;
    const notification = markNotificationRead(socket.user.id, notificationId);
    if (notification) socket.emit('notification:read', notification);
    emitNotifications(socket);
  });

  socket.on('mark all notifications read', () => {
    if (!requireAuth(socket, '标记通知')) return;
    markAllNotificationsRead(socket.user.id);
    emitNotifications(socket);
  });

  safeSocketHandler(socket, 'search', (payload = {}) => {
    if (!requireAuth(socket, '搜索')) return;
    socket.emit('search results', searchUni(socket.user, {
      q: payload && payload.q,
      scope: payload && payload.scope,
      limit: payload && payload.limit,
      offset: payload && payload.offset
    }));
  });

  safeSocketHandler(socket, 'get room history', (payload = {}, reply) => {
    if (!requireAuth(socket,'读取历史')) return;
    const roomId=cleanRoomId(payload && payload.roomId);
    const page=roomHistoryPage(roomId,socket.user.id,payload || {});
    socket.emit('room history',page);reply({ok:true,...page});
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
    socket.emit('room joined', { room: publicRoom(room), messages: messagesForRoom(room.id, socket.user.id) });
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
      messages: messagesForRoom(roomId, socket.user.id)
    });
  });

  safeSocketHandler(socket, 'create room', (payload) => {
    if (!requireAuth(socket, '创建聊天组')) return;
    const name = cleanRoomName(payload && payload.name);
    const code = payload && payload.code;
    const isAdmin = isAdminUser(socket.user);
    if (!name) {
      socket.emit('messageError', '请输入聊天组名称');
      return;
    }
    if (!isAdmin && (!allowGroupInviteAttempt(socket) || !isValidGroupCode(code))) {
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
    db.exec('BEGIN IMMEDIATE');
    try {
      upsertRoom(room);
      ensureRoomMember(room.id, socket.user.id);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    if (!isAdmin) currentGroupInvite.used = true;
    rooms.push(room);
    joinSocketRoom(socket, room.id);
    socket.emit('room created', { room: publicRoom(room) });
    socket.emit('room joined', { room: publicRoom(room), messages: messagesForRoom(room.id, socket.user.id) });
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
    clearSocketIdentity(socket, true);
    emitLobby(socket);
    broadcastOnlineUsers();
    broadcastAdminDashboards();
  });

  safeSocketHandler(socket, 'chat message', (msg, reply) => {
    const content = cleanText(typeof msg === 'object' && msg ? msg.content : msg);
    if (!requireAuth(socket, '发消息') || !content) return;
    if (!requireCurrentRoom(socket)) return;
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
    persistAndPublishMessage(socket, data, msg, reply);
  });

  safeSocketHandler(socket, 'chat image', (data, reply) => {
    const base64 = data && typeof data.base64 === 'string' ? data.base64 : '';
    if (!requireAuth(socket, '发图片')) return;
    if (!requireCurrentRoom(socket)) return;
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
    persistAndPublishMessage(socket, imageData, data, reply);
  });

  safeSocketHandler(socket, 'chat voice', (data, reply) => {
    const base64 = data && typeof data.base64 === 'string' ? data.base64 : '';
    const duration = Number(data && data.duration);
    if (!Number.isFinite(duration) || duration < 0 || duration > 120) throw new InputError('语音时长必须在 0–120 秒之间');
    if (!requireAuth(socket, '发语音')) return;
    if (!requireCurrentRoom(socket)) return;
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
    persistAndPublishMessage(socket, voiceData, data, reply);
  });

  safeSocketHandler(socket, 'chat sticker', (payload, reply) => {
    if (!requireCommunityAccess(socket, '发送表情包')) return;
    if (!requireCurrentRoom(socket)) return;
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
    persistAndPublishMessage(socket, stickerData, payload, reply);
  });

  safeSocketHandler(socket, 'recall message', (messageId) => {
    if (!requireAuth(socket, '撤回消息') || typeof messageId !== 'string') return;
    if (!requireCurrentRoom(socket)) return;
    const message = messageById(messageId);
    if (!message || message.userId !== socket.user.id || message.recalled || message.roomId !== socket.currentRoomId) {
      socket.emit('messageError', '只能撤回自己发出的消息');
      return;
    }
    if (Date.now() - new Date(message.timestamp).getTime() > RECALL_WINDOW_MS) {
      socket.emit('messageError', '消息超过 2 分钟后不可撤回');
      return;
    }

    const recalled = { ...message, recalled: true, content: '' };
    upsertMessage(recalled);
    Object.assign(message, recalled);
    emitAuthorizedRoom(message.roomId, 'message recalled', publicMessage(message));
    broadcastAdminDashboards();
  });

  socket.on('message reaction', (payload = {}) => {
    if (!requireCommunityAccess(socket, '添加 Reaction')) return;
    const result = toggleMessageReaction(socket.user, payload && payload.messageId, payload && payload.reaction);
    if (result.error) {
      socket.emit('messageError', result.error);
      return;
    }
    socket.emit('reaction:updated', result);
  });

  safeSocketHandler(socket, 'mark room read', (payload, reply) => {
    if (!requireCurrentRoom(socket)) return;
    if (!payload || payload.roomId !== socket.currentRoomId) throw new InputError('已读回执会话已改变');
    markRoomRead(socket.user.id, payload.roomId, payload.cursor);
    socketsForUser(socket.user.id).forEach(emitLobby); reply({ ok: true });
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
      createNotification({
        userId: report.reporter_user_id,
        actorUserId: socket.user.id,
        type: 'report_resolved',
        title: '你的举报已处理',
        body: `处理结果：${status === 'dismissed' ? '已忽略' : status === 'post_deleted' ? '已删除帖子' : '已封禁用户'}。${note ? `管理员备注：${note}` : ''}`,
        targetType: 'report',
        targetId: reportId,
        metadata: { status, actionTaken },
        dedupeKey: `report:${reportId}:resolved`
      });
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
    createNotification({
      userId: user.id,
      actorUserId: socket.user.id,
      type: 'creator_request_result',
      title: decision === 'approved' ? '创作者申请已通过' : '创作者申请未通过',
      body: note ? `管理员备注：${note}` : '审核结果已更新。',
      targetType: 'sticker_creator_request',
      targetId: requestId,
      metadata: { status: decision },
      dedupeKey: `creator-request:${requestId}:result`
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
      createNotification({
        userId: owner.id,
        actorUserId: socket.user.id,
        type: 'sticker_submission_result',
        title: status === 'approved' ? '官方表情包已通过审核' : status === 'removed' ? '官方表情包已下架' : '官方表情包未通过审核',
        body: `「${sticker.title}」审核状态已更新。${note ? `管理员备注：${note}` : ''}`,
        targetType: 'sticker',
        targetId: sticker.id,
        metadata: { status },
        dedupeKey: `sticker-submission:${sticker.id}:${status}`
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
    try {
      deleteMessageData();
      messages = [];
    } catch (error) {
      socket.emit('admin error', '清空聊天记录失败');
      return;
    }
	    refreshOpenRooms();
	    broadcastAdminDashboards();
	  });

	  safeSocketHandler(socket, 'admin cleanup post images', () => {
	    if (!requireAdmin(socket)) return;
	    const result = cleanupOrphanPostImages();
	    socket.emit('admin notice', `已将 ${result.quarantined} 张无引用图片移入可恢复隔离区；未永久删除文件`);
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

  safeSocketHandler(socket, 'admin reset password', (payload) => {
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

    if (isAdminUser(user) && !isStrongBootstrapPassword(password)) {
      socket.emit('admin error', '管理员密码至少 12 位，且不能使用示例口令');
      return;
    }
    const updated = { ...user, passwordHash: hashPassword(password) };
    upsertUser(updated);
    user.passwordHash = updated.passwordHash;
    revokeUserSessions(user.id);
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
      deleteRoomData(roomId);
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
    if (!requireCurrentRoom(socket)) return;

    if (isTyping) {
      socket.to(roomChannel(socket.currentRoomId)).emit('typing', { username: displayNameOf(socket.user), isTyping: true, roomId: socket.currentRoomId });
      clearTimeout(typingTimers.get(socket.id));
      typingTimers.set(socket.id, setTimeout(() => clearTyping(socket), TYPING_TIMEOUT_MS));
      return;
    }

    clearTyping(socket);
  });

  socket.on('disconnect', () => {
    clearSocketIdentity(socket);
    broadcastOnlineUsers();
    broadcastAdminDashboards();
  });
});

function clearTyping(socket) {
  clearTimeout(typingTimers.get(socket.id));
  typingTimers.delete(socket.id);
  if (currentSocketUser(socket) && canUserAccessRoom(socket.user, socket.currentRoomId)) {
    socket.to(roomChannel(socket.currentRoomId)).emit('typing', { username: displayNameOf(socket.user), isTyping: false, roomId: socket.currentRoomId });
  }
}

server.listen(APP_PORT, () => {
  console.log(`Uni 5 已启动 -> 端口 ${APP_PORT}`);
});
