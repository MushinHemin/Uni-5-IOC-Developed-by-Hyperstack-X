'use strict';

const { randomUUID, randomBytes, createHmac, timingSafeEqual } = require('node:crypto');

const EVENT = 'uni-call:';
const SIGNAL_LIMIT = 24 * 1024;
const ID = /^[a-z0-9_-]{1,100}$/i;
const MAX_RESTARTS = 2;
const MAX_SECONDS = 8 * 60 * 60;

function createIceConfig(env) {
  const urls = (key, pattern) => {
    const entries = (env[key] || '').split(',').map(value => value.trim()).filter(Boolean);
    const invalid = entries.some(value => {
      if (!pattern.test(value)) return true;
      const port = value.match(/:(\d+)(?:\?|$)/)?.[1];
      return port && (Number(port) < 1 || Number(port) > 65535);
    });
    if (entries.length > 8 || invalid) throw Error('Invalid Uni Call ICE configuration: ' + key);
    return [...new Set(entries)];
  };
  const host = '(?:[a-z0-9.-]+|\\[[a-f0-9:]+\\])(?::[0-9]{1,5})?';
  const stun = urls('UNI_CALL_STUN_URLS', new RegExp('^stuns?:' + host + '$', 'i'));
  const turn = urls('UNI_CALL_TURN_URLS', new RegExp('^turns?:' + host + '(?:\\?transport=(?:udp|tcp))?$', 'i'));
  const secret = env.UNI_CALL_TURN_SECRET || '';
  const policy = env.UNI_CALL_ICE_POLICY || 'all';
  if (turn.length && Buffer.byteLength(secret) < 32) throw Error('UNI_CALL_TURN_SECRET requires at least 32 bytes');
  if (!['all', 'relay'].includes(policy) || (policy === 'relay' && !turn.length)) throw Error('Invalid Uni Call ICE policy');
  return (userId, now) => {
    const iceServers = [];
    if (stun.length) iceServers.push({ urls: stun });
    if (turn.length) {
      // A credential remains usable for refresh and bounded ICE restarts during
      // the whole call. It has no use in the Uni account authentication layer.
      const username = Math.floor(now / 1000 + MAX_SECONDS + 120) + ':' + userId;
      const credential = createHmac('sha1', secret).update(username).digest('base64');
      iceServers.push({ urls: turn, username, credential, credentialType: 'password' });
    }
    return { iceServers, iceTransportPolicy: policy };
  };
}

function audioSdp(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > SIGNAL_LIMIT || !/^v=0\r?\n/.test(value) || value.includes('\0')) return false;
  const media = value.match(/^m=.*$/gm) || [];
  return media.length === 1 && /^m=audio \d+ UDP\/TLS\/RTP\/SAVPF [\d ]+\r?$/.test(media[0]);
}

function iceCandidate(value) {
  if (value === null) return true;
  return value && typeof value === 'object'
    && typeof value.candidate === 'string' && value.candidate.length <= 1024
    && /^candidate:[^\r\n\0]+$/.test(value.candidate)
    && (value.sdpMLineIndex === 0 || value.sdpMLineIndex == null)
    && (typeof value.sdpMid === 'string' && /^[\w-]{1,32}$/.test(value.sdpMid) || value.sdpMid == null)
    && (value.sdpMLineIndex === 0 || typeof value.sdpMid === 'string')
    && (value.usernameFragment == null || typeof value.usernameFragment === 'string' && /^[\w+/=-]{1,256}$/.test(value.usernameFragment));
}

const errors = {
  unauthorized: '请先登录后使用 Uni Call',
  restricted: '当前账号无法进行语音通话',
  invalid: '通话请求无效',
  offline: '对方当前未连接',
  busy: '通话线路正忙',
  expired: '通话已结束或当前设备无权操作',
  state: '当前通话状态不允许此操作',
  limited: '通话操作过于频繁，请稍后再试',
  unavailable: '通话服务暂不可用'
};
const fail = code => ({ ok: false, code, error: errors[code] });
const ok = extra => ({ ok: true, ...extra });

function createUniCall({
  userFor, findUser, socketsFor, socketById, publicPeer, canCall, record,
  env = process.env, now = Date.now, ringMs = 30000, connectMs = 22000, graceMs = 18000
}) {
  const iceConfig = createIceConfig(env);
  const calls = new Map();
  const busy = new Map();
  const recentStarts = new Map();
  const eventQuotas = new WeakMap();
  const startQuotas = new Map();

  const token = () => randomBytes(24).toString('base64url');
  const endpoint = (user, socket) => ({
    userId: user.id, sessionHash: user.passwordHash, socketId: socket.id, resumeKey: token(), connected: false
  });

  function takeQuota(map, key, count, windowMs) {
    const time = now();
    let entry = map.get(key);
    if (!entry || entry.until <= time) {
      if (map instanceof Map && map.size >= 2048) {
        for (const [id, item] of map) if (item.until <= time) map.delete(id);
        if (map.size >= 2048 && !map.has(key)) return false;
      }
      entry = { count: 0, until: time + windowMs };
      map.set(key, entry);
    }
    return ++entry.count <= count;
  }

  function allowed(a, b) {
    return Boolean(a && b && a.id !== b.id && !a.isBanned && !b.isBanned && canCall(a, b));
  }

  function endpointSocket(member) {
    if (!member?.socketId) return null;
    const socket = socketById(member.socketId);
    const user = socket && userFor(socket);
    return user?.id === member.userId && user.passwordHash === member.sessionHash ? socket : null;
  }

  function participants(call) {
    return [call.from.userId, call.targetId];
  }

  function view(call, userId, member) {
    const peerId = userId === call.from.userId ? call.targetId : call.from.userId;
    return {
      id: call.id, revision: call.revision, state: call.state, round: call.round,
      direction: userId === call.from.userId ? 'outgoing' : 'incoming',
      peer: publicPeer(findUser(peerId)), deadline: call.deadline, serverTime: now(),
      startedAt: call.startedAt || null, reason: call.reason || null,
      paused: Boolean(call.from.offline || call.to?.offline),
      ...(member && call.state !== 'ended' ? { resumeKey: member.resumeKey } : {})
    };
  }

  function sendState(call) {
    call.revision++;
    for (const member of [call.from, call.to]) {
      endpointSocket(member)?.emit(EVENT + 'state', view(call, member.userId, member));
    }
    // Ring all authenticated devices only before the recipient claims the call.
    for (const socketId of call.ringers) {
      const socket = socketById(socketId);
      if (socket && userFor(socket)?.id === call.targetId) {
        socket.emit(EVENT + 'state', view(call, call.targetId));
      }
    }
  }

  function setDeadline(call, ms, handler) {
    clearTimeout(call.timer);
    call.deadline = now() + ms;
    call.timer = setTimeout(handler, ms);
    call.timer.unref?.();
  }

  function writeRecord(call) {
    const result = {
      id: call.id, callerId: call.from.userId, calleeId: call.targetId,
      reason: call.reason, seconds: call.seconds, endedAt: call.endedAt
    };
    try {
      record(result);
    } catch (error) {
      console.error('Uni Call history write failed:', error.code || error.name);
      // A transient SQLite failure must not keep a microphone or busy lock alive.
      // Retrying the same ID cannot duplicate the history row.
      const retry = setTimeout(() => {
        try { record(result); }
        catch (failure) { console.error('Uni Call history retry failed:', failure.code || failure.name); }
      }, 1000);
      retry.unref?.();
    }
  }

  function end(call, reason) {
    if (call.state === 'ended') return;
    clearTimeout(call.timer);
    clearTimeout(call.lifetime);
    call.state = 'ended';
    call.reason = call.startedAt && reason === 'hangup' ? 'completed' : reason;
    call.endedAt = now();
    call.seconds = call.startedAt ? Math.min(MAX_SECONDS, Math.max(0, Math.floor((call.endedAt - call.startedAt) / 1000))) : 0;
    call.deadline = 0;
    calls.delete(call.id);
    for (const id of participants(call)) if (busy.get(id) === call.id) busy.delete(id);
    sendState(call);
    writeRecord(call);
  }

  function getCall(socket, user, payload) {
    const call = ID.test(typeof payload.id === 'string' ? payload.id : '') && calls.get(payload.id);
    if (!call || !participants(call).includes(user.id)) return null;
    const member = user.id === call.from.userId ? call.from : call.to;
    if (member?.socketId === socket.id && member.sessionHash === user.passwordHash) return { call, member };
    if (!member && call.ringers.has(socket.id)) return { call, member: null };
    return null;
  }

  function start(socket, user, payload, reply) {
    if (typeof payload.targetId !== 'string' || !ID.test(payload.targetId) || typeof payload.requestId !== 'string' || !ID.test(payload.requestId)) return reply(fail('invalid'));
    const requestKey = user.id + ':' + payload.requestId;
    const prior = recentStarts.get(requestKey);
    if (prior?.until > now()) {
      return reply(prior.socketId === socket.id && prior.targetId === payload.targetId ? prior.response : fail('invalid'));
    }
    if (!takeQuota(startQuotas, user.id, 6, 60000)) return reply(fail('limited'));
    const target = findUser(payload.targetId);
    if (!allowed(user, target)) return reply(fail('restricted'));
    if (busy.has(user.id)) return reply(fail('busy'));
    const devices = socketsFor(target.id).slice(0, 16);
    if (recentStarts.size >= 12000) {
      for (const [key, item] of recentStarts) if (item.until <= now()) recentStarts.delete(key);
      if (recentStarts.size >= 12000) return reply(fail('unavailable'));
    }
    const call = {
      id: randomUUID(), from: endpoint(user, socket), targetId: target.id, to: null,
      ringers: new Set(), state: 'ringing', round: 0, revision: 0, restarts: 0
    };
    const respond = response => {
      recentStarts.set(requestKey, { until: now() + 60000, socketId: socket.id, targetId: target.id, response });
      reply(response);
    };
    if (busy.has(target.id) || !devices.length) {
      const reason = busy.has(target.id) ? 'busy' : 'offline';
      respond(fail(reason));
      end(call, reason);
      return;
    }
    if (calls.size >= 500) return reply(fail('unavailable'));
    call.ringers = new Set(devices.map(device => device.id));
    calls.set(call.id, call);
    busy.set(user.id, call.id);
    busy.set(target.id, call.id);
    setDeadline(call, ringMs, () => end(call, 'missed'));
    // The acknowledgement is queued before state so the caller can match a start
    // even if it cancels while the request is in flight.
    respond(ok({ id: call.id }));
    sendState(call);
  }

  function validPair(call) {
    return allowed(findUser(call.from.userId), findUser(call.targetId))
      && (!call.from.offline ? !!endpointSocket(call.from) : true)
      && (!call.to || call.to.offline || !!endpointSocket(call.to));
  }

  function retry(call) {
    if (call.from.offline || call.to.offline) return;
    if (call.restarts >= MAX_RESTARTS) return end(call, 'failed');
    call.restarts++;
    call.round++;
    call.offer = false;
    call.answer = false;
    call.from.connected = false;
    call.to.connected = false;
    call.state = 'reconnecting';
    setDeadline(call, connectMs, () => retry(call));
    sendState(call);
  }

  function accept(socket, user, call, member, reply) {
    if (member && call.to === member) return reply(ok({ state: view(call, user.id, member) }));
    if (call.state !== 'ringing' || member) return reply(fail('state'));
    call.to = endpoint(user, socket);
    call.ringers.delete(socket.id);
    for (const id of call.ringers) {
      const other = socketById(id);
      if (other && userFor(other)?.id === user.id) other.emit(EVENT + 'state', { ...view(call, user.id), state: 'ended', reason: 'answered-elsewhere' });
    }
    call.ringers.clear();
    call.state = 'connecting';
    call.round = 1;
    setDeadline(call, connectMs, () => retry(call));
    call.lifetime = setTimeout(() => end(call, call.startedAt ? 'hangup' : 'failed'), MAX_SECONDS * 1000);
    call.lifetime.unref?.();
    reply(ok());
    sendState(call);
  }

  function resume(socket, user, payload, reply) {
    const call = typeof payload.id === 'string' && calls.get(payload.id);
    if (!call?.to) return reply(fail('expired'));
    const member = call.from.userId === user.id ? call.from : call.to.userId === user.id ? call.to : null;
    if (!member || member.sessionHash !== user.passwordHash || typeof payload.resumeKey !== 'string' || !/^[\w-]{32}$/.test(payload.resumeKey)) return reply(fail('expired'));
    if (!timingSafeEqual(Buffer.from(payload.resumeKey), Buffer.from(member.resumeKey))) return reply(fail('expired'));
    if (!member.offline) {
      if (member.socketId !== socket.id) return reply(fail('expired'));
      return reply(ok({ state: view(call, user.id, member) }));
    }
    if (call.deadline <= now() || !validPair(call)) {
      end(call, 'failed');
      return reply(fail('expired'));
    }
    member.offline = false;
    member.socketId = socket.id;
    reply(ok());
    if (call.from.offline || call.to.offline) sendState(call);
    else retry(call);
  }

  function signal(call, member, payload, reply) {
    const { kind, value } = payload;
    const peer = member === call.from ? call.to : call.from;
    const target = endpointSocket(peer);
    if (!target || call.state === 'ringing') return reply(fail('state'));
    if (kind === 'offer' || kind === 'answer') {
      if (!audioSdp(value)) return reply(fail('invalid'));
      if (kind === 'offer' ? member !== call.from : member !== call.to || !call.offer) return reply(fail('state'));
      if (call[kind]) return reply(ok({ duplicate: true }));
      call[kind] = true;
      target.emit(EVENT + 'signal', { id: call.id, round: call.round, kind, value });
    } else if (kind === 'ice' && iceCandidate(value)) {
      const candidate = value && {
        candidate: value.candidate, sdpMid: value.sdpMid ?? null,
        sdpMLineIndex: value.sdpMLineIndex ?? null, usernameFragment: value.usernameFragment ?? null
      };
      target.emit(EVENT + 'signal', { id: call.id, round: call.round, kind, value: candidate });
    } else return reply(fail('invalid'));
    reply(ok());
  }

  function register(socket) {
    for (const action of ['start', 'accept', 'decline', 'end', 'resume', 'sync', 'ice-config', 'signal', 'connected', 'retry']) {
      socket.on(EVENT + action, (payload, respond) => {
        if (typeof respond !== 'function') return;
        try {
          if (!takeQuota(eventQuotas, socket, 180, 10000)) return respond(fail('limited'));
          const user = userFor(socket);
          if (!user) return respond(fail('unauthorized'));
          if (user.isBanned) return respond(fail('restricted'));
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return respond(fail('invalid'));
          if (action === 'start') return start(socket, user, payload, respond);
          if (action === 'resume') return resume(socket, user, payload, respond);
          const match = getCall(socket, user, payload);
          if (!match) return respond(fail('expired'));
          const { call, member } = match;
          if (!validPair(call)) {
            end(call, 'failed');
            return respond(fail('expired'));
          }
          if (action === 'sync') return respond(ok({ state: view(call, user.id, member) }));
          if (action === 'accept') return accept(socket, user, call, member, respond);
          if (action === 'decline' && !member && call.state === 'ringing') {
            end(call, 'declined');
            return respond(ok());
          }
          if (!member) return respond(fail('state'));
          if (action === 'end') {
            end(call, call.state === 'ringing' ? 'canceled' : call.startedAt ? 'hangup' : 'failed');
            return respond(ok());
          }
          if (!call.to || call.from.offline || call.to.offline || payload.round !== call.round) return respond(fail('state'));
          if (action === 'ice-config') return respond(ok({ config: iceConfig(user.id, now()) }));
          if (action === 'signal') return signal(call, member, payload, respond);
          if (action === 'retry') {
            retry(call);
            return respond(ok());
          }
          if (action === 'connected' && call.answer) {
            member.connected = true;
            if (call.from.connected && call.to.connected && call.state !== 'connected') {
              clearTimeout(call.timer);
              call.deadline = 0;
              call.startedAt ||= now();
              call.state = 'connected';
              sendState(call);
            }
            return respond(ok());
          }
          return respond(fail('state'));
        } catch (error) {
          console.error('Uni Call operation failed [' + action + ']:', error.code || error.name);
          respond(fail('unavailable'));
        }
      });
    }
  }

  function detach(socket, disconnected) {
    const userId = socket.user?.id;
    const call = calls.get(busy.get(userId));
    if (!call) return;
    const member = call.from.socketId === socket.id ? call.from : call.to?.socketId === socket.id ? call.to : null;
    if (!member) {
      if (call.ringers.delete(socket.id) && !call.ringers.size && !call.to) end(call, 'missed');
      return;
    }
    if (!disconnected || !call.to) return end(call, call.startedAt ? 'hangup' : 'canceled');
    const alreadyPaused = call.from.offline || call.to.offline;
    member.offline = true;
    member.socketId = null;
    call.state = 'reconnecting';
    if (!alreadyPaused) setDeadline(call, graceMs, () => end(call, 'failed'));
    sendState(call);
  }

  function revoke(userId) {
    const call = calls.get(busy.get(userId));
    if (call) end(call, 'failed');
  }

  return { register, detach, revoke };
}

module.exports = { createUniCall, createIceConfig };
