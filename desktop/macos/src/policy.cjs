'use strict';
const { createHash } = require('node:crypto');

function serverOrigin(value) {
  if (typeof value !== 'string' || value.length > 2048 || !/^https?:\/\//i.test(value.trim())) return null;
  try {
    const url = new URL(value.trim());
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port)) return null;
    return url.origin;
  } catch { return null; }
}

function isUniPage(value, origin) {
  try {
    const url = new URL(value);
    return Boolean(origin && url.origin === origin && !url.username && !url.password
      && ['/','/index.html'].includes(url.pathname) && !url.search);
  } catch { return false; }
}

function externalURL(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

function senderIs(event, contents, allowsURL) {
  if (!contents || contents.isDestroyed() || event.sender !== contents) return false;
  const sender = event.senderFrame;
  return Boolean(sender && sender === contents.mainFrame && allowsURL(sender.url));
}

function allowsAudio({ expected, contents, origin, details, requestingOrigin, mode }) {
  if (!expected || contents !== expected || !origin || details?.isMainFrame !== true) return false;
  if (![requestingOrigin, details.requestingOrigin, details.securityOrigin, details.requestingUrl, details.embeddingOrigin]
    .filter(Boolean).every(address => {
      try { return new URL(address).origin === origin; } catch { return false; }
    })) return false;
  if (!(requestingOrigin || details.requestingOrigin || details.securityOrigin || details.requestingUrl)) return false;
  if (mode === 'check') return details.mediaType === 'audio';
  return details.mediaTypes?.length === 1 && details.mediaTypes[0] === 'audio';
}

function partitionName(origin) {
  return 'persist:uni-' + createHash('sha256').update(origin).digest('hex').slice(0, 32);
}

function validLogin(value) {
  return value && typeof value.account === 'string' && /^[a-z0-9_]{1,24}$/i.test(value.account)
    && typeof value.password === 'string' && value.password.length >= 1 && value.password.length <= 256;
}

function safeNotice(value) {
  if (!value || typeof value !== 'object') return null;
  const { kind, id, target, label, preview } = value;
  if (!['chat', 'community', 'call'].includes(kind) || !validIdentifier(id) || !validIdentifier(target)) return null;
  return { kind, id, target, label: plainText(label, 50), preview: plainText(preview, 110) };
}

function validIdentifier(value) {
  return typeof value === 'string' && /^[\w:.-]{1,180}$/.test(value);
}

function plainText(text, limit) {
  return typeof text === 'string' ? text.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ').trim().slice(0, limit) : '';
}

module.exports = { serverOrigin, isUniPage, externalURL, senderIs, allowsAudio, partitionName, validLogin, safeNotice };
