/* Executed by the desktop client on the configured Uni app document after it initializes. */
(function connectDesktop(bridge, remembered) {
  if (!bridge || typeof socket !== 'object' || typeof state !== 'object' || typeof loginForm !== 'object') return false;
  if (window.__uniDesktopReady) return true;
  window.__uniDesktopReady = true;

  const remember = document.createElement('input');
  remember.type = 'checkbox';
  remember.checked = Boolean(remembered);
  const label = document.createElement('label');
  label.className = 'uni-desktop-remember';
  label.append(remember, ' 在此 Mac 上保持登录');
  label.title = '使用 macOS 钥匙串保护的本地加密保存登录信息。切换用户时清除。';
  const loginSubmit = loginForm.querySelector('[type="submit"]');
  if (loginSubmit?.parentNode) loginSubmit.before(label);
  else loginForm.append(label);

  let pending;
  let resumeAttempt = false;
  let saved = remembered;
  let lastUser = state.userId;
  let lastIncoming = null;
  const emit = socket.emit;
  const badge = () => bridge.badge(state.userId ? state.chatUnread : 0);

  function resetNotices() {
    lastIncoming = null;
  }

  function clearSaved() {
    pending = null;
    saved = null;
    resumeAttempt = false;
    bridge.forget().catch(() => {});
  }

  socket.emit = function (name, payload, ...args) {
    if (name === 'logout') clearSaved();
    if (name === 'login' || name === 'register') {
      pending = remember.checked ? { account: String(payload?.account || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24), password: payload?.password } : undefined;
      resumeAttempt = false;
    }
    return payload === undefined ? emit.call(this, name, ...args) : emit.call(this, name, payload, ...args);
  };

  function resume() {
    if (!socket.connected || state.userId || !saved || resumeAttempt || pending) return;
    resumeAttempt = true;
    emit.call(socket, 'login', saved);
  }

  socket.on('connect', resume);
  socket.on('authSuccess', () => {
    if (state.userId !== lastUser) resetNotices();
    lastUser = state.userId;
    if (resumeAttempt) {
      resumeAttempt = false;
    } else if (pending) {
      saved = pending;
      pending = null;
      bridge.remember(saved).catch(() => {});
    } else {
      clearSaved();
    }
    badge();
  });
  socket.on('authError', () => {
    pending = null;
    if (resumeAttempt) clearSaved();
  });
  socket.on('loggedOut', () => { clearSaved(); resetNotices(); badge(); });
  socket.on('disconnect', () => { pending = null; resumeAttempt = false; resetNotices(); badge(); });

  socket.on('lobby', badge);
  socket.on('unread:update', badge);
  socket.on('notification:new', payload => {
    const item = payload?.notification || payload;
    if (!state.userId || !item?.id || item.isRead) return;
    const chat = item.targetType === 'chat' && item.targetId;
    let target = chat ? item.targetId : item.id;
    if (chat && target.startsWith('dm:')) {
      const members = target.slice(3).split(':');
      const peer = members.length === 2 && members.includes(state.userId) && members.find(id => id !== state.userId);
      if (!peer) return;
      target = 'dm:' + peer;
    }
    bridge.notice({
      kind: chat ? 'chat' : 'community',
      id: item.id + ':' + (Date.parse(item.createdAt) || 0),
      target, label: item.title, preview: item.body
    });
  });
  socket.on('uni-call:state', call => {
    if (call?.state !== 'ringing' || call.direction !== 'incoming' || !state.userId) {
      if (lastIncoming?.id === call?.id) lastIncoming = null;
      return;
    }
    lastIncoming = call;
    bridge.notice({ kind: 'call', id: call.id, target: call.id, label: call.peer?.displayName || call.peer?.username });
  });

  window.addEventListener('uni-desktop-forget', () => { clearSaved(); remember.checked = false; });
  window.addEventListener('uni-desktop-end-call', () => { callController?.reset(); });
  window.addEventListener('uni-desktop-notice', ({ detail }) => {
    if (!socket.connected || !state.userId) return;
    if (detail.kind === 'call') {
      if (lastIncoming?.id === detail.target) document.querySelector('[data-call="accept"]')?.focus();
      return;
    }
    if (detail.kind === 'chat') {
      const privateRoom = detail.target.startsWith('dm:');
      socket.emit(privateRoom ? 'open private chat' : 'join room', privateRoom ? detail.target.slice(3) : detail.target);
      return;
    }
    const item = state.notifications.find(notification => notification.id === detail.target);
    if (item) openNotificationTarget(item);
    else openNotificationModal();
  });
  resume();
  badge();
  return true;
})
