'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  serverOrigin, isUniPage, externalURL, senderIs, allowsAudio, partitionName, validLogin, safeNotice
} = require('../src/policy.cjs');

test('server settings require a bare HTTPS origin or explicit IPv4 loopback HTTP', () => {
  assert.equal(serverOrigin(' https://Uni.example:443/ '), 'https://uni.example');
  assert.equal(serverOrigin('http://127.0.0.1:3210'), 'http://127.0.0.1:3210');
  for (const address of ['http://uni.example', 'http://localhost:3210', 'http://127.0.0.2:3210',
    'http://127.0.0.1', 'https://x:pass@uni.example', 'https://uni.example/deep', 'https://uni.example/?a',
    'https://uni.example/#token', 'file:///tmp/index.html', 'wss://uni.example', null]) {
    assert.equal(serverOrigin(address), null, address);
  }
});

test('app navigation permits the exact origin and entry document', () => {
  const origin = 'https://uni.example';
  assert.equal(isUniPage(origin + '/#tab', origin), true);
  assert.equal(isUniPage(origin + '/index.html', origin), true);
  for (const address of ['https://uni.example.evil/', 'http://uni.example/', origin + ':8080/',
    origin + '/other', origin + '/?token=a', 'data:text/html,.', 'https://x@uni.example/']) {
    assert.equal(isUniPage(address, origin), false, address);
  }
});

test('external URLs reject executable, local file and credential-bearing protocols', () => {
  assert.equal(externalURL('https://example.org/docs'), 'https://example.org/docs');
  for (const address of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,abc', 'blob:https://x/id',
    'x-apple.systempreferences:permission', 'https://u:p@example.org/']) assert.equal(externalURL(address), null, address);
});

test('IPC sender must be the current main frame and exact trusted page', () => {
  const frame = { url: 'https://uni.example/' };
  const contents = { mainFrame: frame, isDestroyed: () => false };
  const allowed = address => isUniPage(address, 'https://uni.example');
  assert.equal(senderIs({ sender: contents, senderFrame: frame }, contents, allowed), true);
  assert.equal(senderIs({ sender: contents, senderFrame: { ...frame } }, contents, allowed), false);
  assert.equal(senderIs({ sender: {}, senderFrame: frame }, contents, allowed), false);
  frame.url = 'https://example.org/';
  assert.equal(senderIs({ sender: contents, senderFrame: frame }, contents, allowed), false);
});

test('microphone policy checks both origins, frame and requested media types', () => {
  const contents = {};
  const origin = 'https://uni.example';
  const check = { expected: contents, contents, origin, requestingOrigin: origin, mode: 'check',
    details: { isMainFrame: true, requestingOrigin: origin, mediaType: 'audio' } };
  assert.equal(allowsAudio(check), true);
  assert.equal(allowsAudio({ ...check, requestingOrigin: 'https://example.org' }), false);
  assert.equal(allowsAudio({ ...check, contents: {} }), false);
  for (const changes of [{ isMainFrame: false }, { mediaType: 'video' }, { mediaType: 'unknown' },
    { embeddingOrigin: 'https://example.org' }, { requestingUrl: 'file:///tmp/x' }]) {
    assert.equal(allowsAudio({ ...check, details: { ...check.details, ...changes } }), false);
  }
  const request = { ...check, mode: 'request', requestingOrigin: null,
    details: { isMainFrame: true, requestingUrl: origin + '/', mediaTypes: ['audio'] } };
  assert.equal(allowsAudio(request), true);
  assert.equal(allowsAudio({ ...request, details: { ...request.details, mediaTypes: ['audio', 'video'] } }), false);
});

test('on-disk partitions differ by origin and credential input is bounded', () => {
  assert.match(partitionName('https://uni.example'), /^persist:uni-[a-f0-9]{32}$/);
  assert.notEqual(partitionName('https://uni.example'), partitionName('https://uni.example:8443'));
  assert.equal(validLogin({ account: 'demo_1', password: 'Synthetic example' }), true);
  assert.equal(validLogin({ account: 'demo_1', password: 'x'.repeat(257) }), false);
});

test('notification bridge accepts fixed routes and strips control characters', () => {
  assert.deepEqual(safeNotice({ kind: 'chat', id: '1', target: 'dm:user1', label: 'Test\n⛅', preview: 'Hi\u202e' }),
    { kind: 'chat', id: '1', target: 'dm:user1', label: 'Test ⛅', preview: 'Hi' });
  assert.equal(safeNotice({ kind: 'file', id: '1', target: 'arbitrary' }), null);
  assert.equal(safeNotice({ kind: 'chat', id: '1', target: '/unsafe/path' }), null);
});
