'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHmac } = require('node:crypto');
const path = require('node:path');
const { io } = require(path.join(path.dirname(require.resolve('socket.io')), '../client-dist/socket.io.js'));
const { createIceConfig } = require('../lib/uni-call');
const { startFixture, password } = require('./fixtures/uni-call-server.cjs');

const signal = 'uni-call:signal';
const mode = 'uni-call:state';
// Media negotiation and audio are exercised against real browser peer connections
// in test/browser/uni-call.cjs. These values test only the server's signal routing.
const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\n';

function observe(socket, name, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(name, next); reject(Error('Timeout: ' + name)); }, 2500);
    function next(value) {
      if (!predicate(value)) return;
      clearTimeout(timer);
      socket.off(name, next);
      resolve(value);
    }
    socket.on(name, next);
  });
}

async function client(fixture, account, existing = false) {
  const socket = io(fixture.url, { transports: ['websocket'], reconnection: false, autoConnect: false });
  const connection = observe(socket, 'connect');
  socket.connect();
  await connection;
  if (account) {
    const authenticated = observe(socket, 'authSuccess');
    socket.emit(existing ? 'login' : 'register', { account, username: account, password });
    socket.identity = (await authenticated).user;
  }
  return socket;
}

function call(socket, name, payload) {
  return socket.timeout(1800).emitWithAck('uni-call:' + name, payload);
}

async function start(from, to, requestId = randomUUID()) {
  const a = observe(from, mode, s => s.state === 'ringing' && s.direction === 'outgoing');
  const b = observe(to, mode, s => s.state === 'ringing' && s.direction === 'incoming');
  const result = await call(from, 'start', { targetId: to.identity.id, requestId });
  assert.ok(result.ok);
  const [caller, receiver] = await Promise.all([a, b]);
  assert.equal(receiver.id, caller.id);
  assert.equal(receiver.resumeKey, undefined);
  return { ...caller, requestId };
}

async function accept(from, to, id) {
  const initial = observe(from, mode, s => s.id === id && s.state === 'connecting');
  const callee = observe(to, mode, s => s.id === id && s.state === 'connecting');
  assert.ok((await call(to, 'accept', { id })).ok);
  return Promise.all([initial, callee]);
}

async function connectRound(from, to, id, round) {
  const first = observe(to, signal, p => p.id === id && p.kind === 'offer');
  assert.ok((await call(from, 'signal', { id, round, kind: 'offer', value: sdp })).ok);
  assert.equal((await first).round, round);
  const second = observe(from, signal, p => p.id === id && p.kind === 'answer');
  assert.ok((await call(to, 'signal', { id, round, kind: 'answer', value: sdp })).ok);
  await second;
  const connected = observe(from, mode, s => s.id === id && s.state === 'connected');
  assert.ok((await call(from, 'connected', { id, round })).ok);
  assert.ok((await call(to, 'connected', { id, round })).ok);
  return connected;
}

function record(fixture, id) {
  return fixture.db.prepare("SELECT * FROM messages WHERE id = ? AND type = 'call'").get('call:' + id);
}

test('Uni Call authentication, audio-only signal bounds, participant isolation, early ICE and final private history', async t => {
  const f = await startFixture();
  t.after(() => f.close());
  const a = await client(f, 'calluser_a');
  const b = await client(f, 'calluser_b');
  const c = await client(f, 'calluser_c');
  const guest = await client(f);
  const pending = await start(a, b);
  const { id } = pending;
  assert.equal((await call(a, 'start', { targetId: b.identity.id, requestId: pending.requestId })).id, id);
  assert.equal((await call(guest, 'accept', { id })).code, 'unauthorized');
  for (const action of ['sync', 'accept', 'end', 'ice-config', 'signal']) {
    assert.equal((await call(c, action, { id, round: 1, kind: 'offer', value: sdp })).code, 'expired');
  }
  assert.equal((await call(a, 'accept', { id })).code, 'state');
  assert.equal((await call(a, 'ice-config', { id, round: 0 })).code, 'state');
  await accept(a, b, id);
  assert.ok((await call(b, 'accept', { id })).ok);
  const packet = { id, round: 1, kind: 'offer', value: sdp };
  assert.equal((await call(b, 'signal', packet)).code, 'state');
  assert.equal((await call(a, 'signal', { ...packet, value: sdp + 'm=video 9 UDP/TLS/RTP/SAVPF 111\r\n' })).code, 'invalid');
  assert.equal((await call(a, 'signal', { ...packet, value: sdp.repeat(600) })).code, 'invalid');
  assert.equal((await call(a, 'signal', { ...packet, round: 9 })).code, 'state');
  const candidate = observe(b, signal, p => p.kind === 'ice');
  assert.ok((await call(a, 'signal', { id, round: 1, kind: 'ice', value: {
    candidate: 'candidate:1 1 udp 1 192.0.2.1 9999 typ host', sdpMid: '0'
  } })).ok);
  assert.equal((await candidate).value.sdpMid, '0');
  assert.equal((await call(a, 'connected', { id, round: 1 })).code, 'state');
  await connectRound(a, b, id, 1);
  assert.equal((await call(a, 'signal', packet)).duplicate, true);
  const peerEnded = observe(b, mode, p => p.id === id && p.state === 'ended');
  assert.ok((await call(a, 'end', { id, duration: 1000000, reason: 'missed' })).ok);
  assert.equal((await peerEnded).reason, 'completed');
  assert.equal((await call(a, 'end', { id })).code, 'expired');
  const saved = record(f, id);
  assert.equal(saved.content, 'completed');
  assert.ok(saved.duration < 5);
  assert.equal(saved.user_id, a.identity.id);
  assert.equal(f.messagesForRoom(saved.room_id, b.identity.id)[0].type, 'call');
  const room = observe(c, 'messageError');
  c.emit('join room', saved.room_id);
  await room;
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM messages WHERE type='call'").get().n, 1);
});

test('Uni Call simultaneous requests, multi-device acceptance, busy, decline, cancel and timeout', async t => {
  const f = await startFixture({ timeouts: { ringMs: 350 } });
  t.after(() => f.close());
  const a = await client(f, 'multi_a');
  const b = await client(f, 'multi_b');
  const b2 = await client(f, 'multi_b', true);
  const c = await client(f, 'multi_c');
  const [ab, ba] = await Promise.all([
    call(a, 'start', { targetId: b.identity.id, requestId: randomUUID() }),
    call(b, 'start', { targetId: a.identity.id, requestId: randomUUID() })
  ]);
  assert.equal(Number(ab.ok) + Number(ba.ok), 1);
  const winner = ab.ok ? a : b;
  const id = ab.ok ? ab.id : ba.id;
  assert.equal((await call(c, 'start', { targetId: b.identity.id, requestId: randomUUID() })).code, 'busy');
  await call(winner, 'end', { id });
  assert.equal(record(f, id).content, 'canceled');
  const next = await start(a, b);
  const claims = await Promise.all([call(b, 'accept', { id: next.id }), call(b2, 'accept', { id: next.id })]);
  assert.equal(claims.filter(claim => claim.ok).length, 1);
  assert.equal((await call(claims[0].ok ? b2 : b, 'end', { id: next.id })).code, 'expired');
  await call(a, 'end', { id: next.id });
  const declined = await start(a, b);
  await call(b2, 'decline', { id: declined.id });
  assert.equal(record(f, declined.id).content, 'declined');
  const missed = await start(a, b);
  await observe(a, mode, p => p.id === missed.id && p.state === 'ended' && p.reason === 'missed');
  assert.equal(record(f, missed.id).content, 'missed');
  assert.ok(f.db.prepare("SELECT COUNT(*) n FROM messages WHERE type='call' AND content='busy'").get().n >= 1);
});

test('Uni Call reconnect requires same account plus original endpoint secret and has a bounded restart budget', async t => {
  const f = await startFixture({ timeouts: { graceMs: 3000 } });
  t.after(() => f.close());
  const a = await client(f, 'recover_a');
  const b = await client(f, 'recover_b');
  const { id } = await start(a, b);
  const [original] = await accept(a, b, id);
  await connectRound(a, b, id, 1);
  const paused = observe(b, mode, p => p.id === id && p.paused);
  a.disconnect();
  await paused;
  const other = await client(f, 'recover_c');
  const a2 = await client(f, 'recover_a', true);
  assert.equal((await call(other, 'resume', { id, resumeKey: original.resumeKey })).code, 'expired');
  assert.equal((await call(a2, 'resume', { id, resumeKey: '0'.repeat(32) })).code, 'expired');
  const restarting = observe(b, mode, p => p.id === id && p.round === 2 && !p.paused);
  assert.ok((await call(a2, 'resume', { id, resumeKey: original.resumeKey })).ok);
  await restarting;
  await connectRound(a2, b, id, 2);
  assert.equal((await call(a2, 'signal', { id, round: 1, kind: 'offer', value: sdp })).code, 'state');
  assert.ok((await call(a2, 'retry', { id, round: 2 })).ok);
  const exhausted = observe(b, mode, p => p.id === id && p.state === 'ended');
  assert.ok((await call(a2, 'retry', { id, round: 3 })).ok);
  assert.equal((await exhausted).reason, 'failed');
  assert.equal(record(f, id).content, 'failed');
  assert.equal((await call(a2, 'resume', { id, resumeKey: original.resumeKey })).code, 'expired');
});

test('Uni Call logout, grace timeout, bans and session revocation release both participants', async t => {
  const f = await startFixture({ timeouts: { graceMs: 250 } });
  t.after(() => f.close());
  let a = await client(f, 'enduser_a');
  const b = await client(f, 'enduser_b');
  const logout = await start(a, b);
  await accept(a, b, logout.id);
  const ended = observe(b, mode, p => p.id === logout.id && p.state === 'ended');
  a.emit('logout');
  await ended;
  assert.ok(record(f, logout.id));
  a = await client(f, 'enduser_a', true);
  const timed = await start(a, b);
  await accept(a, b, timed.id);
  const timeout = observe(b, mode, p => p.id === timed.id && p.state === 'ended');
  a.disconnect();
  assert.equal((await timeout).reason, 'failed');
  a = await client(f, 'enduser_a', true);
  const revoke = await start(a, b);
  await accept(a, b, revoke.id);
  const invalidated = observe(b, mode, p => p.id === revoke.id && p.state === 'ended');
  f.revokeUserSessions(a.identity.id);
  await invalidated;
  a = await client(f, 'enduser_a', true);
  const banned = await start(a, b);
  const denied = observe(a, mode, p => p.id === banned.id && p.state === 'ended');
  f.banUser(f.users.find(user => user.id === b.identity.id));
  await denied;
  assert.equal((await call(a, 'start', { targetId: b.identity.id, requestId: randomUUID() })).code, 'restricted');
});

test('Uni Call rate limit follows the account across devices and offline calls are deduplicated', async t => {
  const f = await startFixture();
  t.after(() => f.close());
  const a = await client(f, 'quota_a');
  const a2 = await client(f, 'quota_a', true);
  const b = await client(f, 'quota_b');
  b.disconnect();
  await new Promise(resolve => setTimeout(resolve, 35));
  const request = { targetId: b.identity.id, requestId: randomUUID() };
  assert.equal((await call(a, 'start', request)).code, 'offline');
  assert.equal((await call(a, 'start', request)).code, 'offline');
  for (let i = 0; i < 5; i++) assert.equal((await call(a2, 'start', { ...request, requestId: randomUUID() })).code, 'offline');
  assert.equal((await call(a, 'start', { ...request, requestId: randomUUID() })).code, 'limited');
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM messages WHERE type='call' AND content='offline'").get().n, 6);
});

test('TURN credentials use coturn time-limited HMAC and reject unsafe configuration', () => {
  const secret = 'synthetic-secret-for-coturn-test-only';
  const configuration = createIceConfig({
    UNI_CALL_STUN_URLS: 'stun:rtc.example.test:3478',
    UNI_CALL_TURN_URLS: 'turn:rtc.example.test:3478?transport=udp,turn:rtc.example.test:3478?transport=tcp,turns:rtc.example.test:5349?transport=tcp',
    UNI_CALL_TURN_SECRET: secret, UNI_CALL_ICE_POLICY: 'relay'
  })('user-a', 1000000);
  assert.equal(configuration.iceTransportPolicy, 'relay');
  const [stun, turn] = configuration.iceServers;
  assert.equal(stun.urls.length, 1);
  assert.equal(turn.urls.length, 3);
  assert.match(turn.username, /^\d+:user-a$/);
  assert.ok(Number(turn.username.split(':')[0]) > 1000);
  assert.equal(turn.credential, createHmac('sha1', secret).update(turn.username).digest('base64'));
  assert.equal(JSON.stringify(configuration).includes(secret), false);
  assert.throws(() => createIceConfig({ UNI_CALL_ICE_POLICY: 'relay' }));
  assert.throws(() => createIceConfig({ UNI_CALL_TURN_URLS: 'https://rtc.example.test' }));
  assert.throws(() => createIceConfig({ UNI_CALL_TURN_URLS: 'turn:rtc.example.test' }));
  assert.throws(() => createIceConfig({ UNI_CALL_STUN_URLS: 'stun:rtc.example.test:65536' }));
});
