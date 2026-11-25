/* global MediaStream, RTCPeerConnection */
(() => {
  'use strict';

  const prefix = 'uni-call:';
  const messages = {
    completed: '语音通话已结束', hangup: '语音通话已结束',
    missed: '未接来电', declined: '语音通话已拒绝', canceled: '呼叫已取消',
    busy: '对方正在通话', failed: '语音连接失败', offline: '对方当前未连接',
    'answered-elsewhere': '已在另一台设备接听'
  };
  const clock = seconds => {
    const parts = [Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0'));
    if (seconds >= 3600) parts.unshift(String(Math.floor(seconds / 3600)));
    return parts.join(':');
  };
  const stop = stream => stream?.getTracks().forEach(track => track.stop());
  const canCall = () => !!(window.isSecureContext && navigator.mediaDevices?.getUserMedia && window.RTCPeerConnection);

  const qualityLabels = {
    unknown: '正在检测网络', good: '连接良好', fair: '网络波动', poor: '连接较差'
  };

  function updateQuality(previous, measured) {
    const values = {};
    for (const [key, value] of Object.entries(measured)) {
      if (!Number.isFinite(value) || value < 0) continue;
      const prior = previous?.values[key];
      values[key] = Number.isFinite(prior) ? prior * .56 + value * .44 : value;
    }
    if (!Object.keys(values).length) return { level: 'unknown', values };

    // The lower recovery thresholds and two-sample confirmation prevent a
    // borderline metric from bouncing the display between severity levels.
    const old = previous?.level || 'unknown';
    const { rtt, jitter, loss } = values;
    const poor = old === 'poor' ? [260, 43, .05] : [320, 55, .07];
    const fair = old === 'good' || old === 'unknown' ? [150, 30, .025] : [120, 22, .018];
    const crosses = ([delay, variation, drops]) => rtt >= delay || jitter >= variation || loss >= drops;
    const candidate = crosses(poor) ? 'poor' : crosses(fair) ? 'fair' : 'good';
    const count = candidate === previous?.candidate ? previous.count + 1 : 1;
    const level = old === 'unknown' || count >= 2 ? candidate : old;

    let range;
    if (Number.isFinite(rtt)) {
      const width = rtt < 100 ? 20 : rtt < 300 ? 50 : 100;
      const start = Math.floor(rtt / width) * width;
      const prior = previous?.range;
      range = prior && rtt >= Math.max(0, prior.start - 4) && rtt < prior.end + 4
        ? prior
        : { start, end: start + width };
    }
    return { level, values, candidate, count, range };
  }

  function formatQuality(quality) {
    const label = qualityLabels[quality?.level || 'unknown'];
    const range = quality?.range;
    if (!range) return label;
    return label + ' · RTT ' + (range.start ? range.start + '–' + range.end : '<' + range.end) + ' ms';
  }

  // Native buttons inside a disclosure keep standard Tab, Enter and Space
  // behavior. The displayed device changes only after a confirmed switch.
  function devicePicker(root, choose, beforeOpen) {
    const trigger = root.querySelector('.uni-call-device-trigger');
    const name = root.querySelector('.uni-call-device-name');
    const options = root.querySelector('.uni-call-device-options');
    const list = root.querySelector('.uni-call-device-list');
    let signature;
    let choosing = false;
    const isOpen = () => !options.inert;

    function close(restoreFocus = false) {
      if (!isOpen()) return;
      if (restoreFocus && options.contains(document.activeElement)) trigger.focus({ preventScroll: true });
      options.inert = true;
      trigger.setAttribute('aria-expanded', 'false');
    }
    function open() {
      beforeOpen();
      trigger.setAttribute('aria-expanded', 'true');
      options.inert = false;
    }
    trigger.addEventListener('click', () => {
      if (!choosing) isOpen() ? close(true) : open();
    });
    trigger.addEventListener('keydown', event => {
      if (choosing || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
      event.preventDefault();
      if (!isOpen()) open();
      const selected = list.querySelector('[aria-pressed="true"]');
      const edge = event.key === 'ArrowUp' ? list.lastElementChild : list.firstElementChild;
      (selected || edge)?.focus();
    });
    list.addEventListener('keydown', event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const rows = [...list.children];
      const index = rows.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1
        : Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)));
      event.preventDefault();
      rows[next]?.focus();
    });
    list.addEventListener('click', async event => {
      const row = event.target.closest('button[data-device-id]');
      if (!row || !isOpen() || choosing) return;
      close(true);
      if (row.getAttribute('aria-pressed') === 'true') return;
      choosing = true;
      trigger.setAttribute('aria-busy', 'true');
      trigger.setAttribute('aria-disabled', 'true');
      try { await choose(row.dataset.deviceId); }
      finally {
        choosing = false;
        trigger.removeAttribute('aria-busy');
        trigger.removeAttribute('aria-disabled');
      }
    });

    function update(devices, selected, fallback, shown) {
      if (!shown) {
        if (root.contains(document.activeElement)) root.closest('.uni-call')?.querySelector('[data-call="settings"]')?.focus({ preventScroll: true });
        close();
      }
      root.hidden = !shown;
      const label = devices.find(device => device.id === selected)?.label || fallback;
      if (name.textContent !== label) name.textContent = label;
      trigger.title = label;
      const nextSignature = JSON.stringify([devices, selected]);
      if (nextSignature === signature) return;
      signature = nextSignature;
      const previousFocus = list.contains(document.activeElement) ? document.activeElement.dataset.deviceId : null;
      const scroll = list.scrollTop;
      const rows = devices.map(device => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'uni-call-device-row';
        button.dataset.deviceId = device.id;
        button.setAttribute('aria-pressed', String(device.id === selected));
        button.title = device.label;
        const text = document.createElement('span');
        text.textContent = device.label;
        const check = document.createElement('span');
        check.className = 'uni-call-device-check';
        check.setAttribute('aria-hidden', 'true');
        check.textContent = '✓';
        button.append(text, check);
        return button;
      });
      list.replaceChildren(...rows);
      list.scrollTop = scroll;
      if (previousFocus !== null && shown && isOpen()) {
        (rows.find(row => row.dataset.deviceId === previousFocus) || trigger).focus({ preventScroll: true });
      }
    }
    return { root, isOpen, close, update };
  }

  function create({ socket, currentUser, recorderActive, avatar, toast }) {
    const panel = document.getElementById('uniCall');
    const field = name => panel.querySelector('[data-call="' + name + '"]');
    const audio = field('audio');
    const toggle = field('toggle');
    const details = field('details');
    const settings = field('settings');
    const audioSettings = field('audio-settings');
    const viewportPopover = typeof panel.showPopover === 'function';
    if (!viewportPopover) {
      // Body is a perspective container in Sonoma. A root sibling keeps
      // fixed positioning relative to the viewport in older browsers.
      panel.removeAttribute('popover');
      panel.dataset.viewportLayer = 'fallback';
      document.documentElement.append(panel);
    }
    const picks = [];
    for (const [name, choose] of [['mic', switchMicrophone], ['output', switchOutput]]) {
      const device = panel.querySelector('[data-call-device="' + name + '"]');
      picks.push(devicePicker(device, choose, () => {
        for (const picker of picks) if (picker.root !== device) picker.close(true);
      }));
    }
    if (navigator.connection?.saveData || navigator.deviceMemory < 4) panel.dataset.lowPower = 'true';
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const contextType = window.AudioContext || window.webkitAudioContext;
    let call = null;
    let closingTimer;
    let permissionPending = false;

    // These listeners belong to the page, and are installed once. Call-specific
    // media callbacks are detached and all per-call timers are cleared in dispose.
    function send(action, payload) {
      return new Promise((resolve, reject) => {
        if (!socket.connected) return reject(Error('信令连接已断开'));
        socket.timeout(4500).emit(prefix + action, payload, (error, response) => {
          if (error || !response) return reject(Error('未收到通话服务器确认'));
          if (!response.ok) return reject(Object.assign(Error(response.error), { code: response.code }));
          resolve(response);
        });
      });
    }

    function active(c) {
      return c === call && !c.finished;
    }

    function seconds(c) {
      return c.startedAt ? Math.max(0, Math.floor((Date.now() + c.clockOffset - c.startedAt) / 1000)) : 0;
    }

    function makeCall(direction, peer) {
      clearTimeout(closingTimer);
      return {
        direction, peer, phase: direction === 'incoming' ? 'incoming' : 'permission',
        ownerId: currentUser()?.id, round: 0, revision: -1, clockOffset: 0,
        queue: Promise.resolve(), candidates: [], sentCandidates: new Set(), timers: new Set(),
        muted: false, expanded: false, settingsOpen: false, quality: null
      };
    }

    function later(c, fn, ms) {
      const timer = setTimeout(() => {
        c.timers.delete(timer);
        if (active(c)) fn();
      }, ms);
      c.timers.add(timer);
      return timer;
    }

    function cancelTimer(c, timer) {
      clearTimeout(timer);
      c.timers.delete(timer);
    }

    function shortStatus(c) {
      if (c.error) return c.error;
      return {
        permission: '等待麦克风权限', outgoing: '等待接听',
        incoming: c.accepting ? '等待麦克风授权' : '语音来电',
        connecting: '正在连接', connected: '已接通',
        reconnecting: c.transportLost ? '请重新登录以恢复' : '正在重连',
        ending: '正在结束通话', ended: c.result
      }[c.phase] || '';
    }

    function setText(element, value) {
      if (element.textContent !== value) element.textContent = value;
    }

    function renderTime(c) {
      const time = field('time');
      time.hidden = !c.startedAt;
      setText(time, c.startedAt ? clock(seconds(c)) : '');
    }

    function render(c) {
      if (c !== call) return;
      const finished = c.phase === 'ended';
      if (!finished) delete panel.dataset.leaving;
      if (panel.hidden) {
        panel.hidden = false;
        if (viewportPopover) panel.showPopover();
      }
      panel.dataset.phase = c.phase;
      panel.dataset.expanded = String(c.expanded);
      const mediaStage = ['connecting', 'connected', 'reconnecting'].includes(c.phase);
      const controls = mediaStage && !!c.stream && !c.transportLost && !c.paused;
      const status = shortStatus(c);
      const name = c.peer?.displayName || c.peer?.username || '语音通话';
      const mic = field('mute');
      const focused = document.activeElement;

      if (!controls) c.settingsOpen = false;
      if (!finished && (!c.expanded && details.contains(focused)
          || ((!controls || !c.settingsOpen) && audioSettings.contains(focused))
          || (!controls && focused === settings)
          || (c.phase !== 'incoming' && field('ring').contains(focused))
          || (!mediaStage && focused === mic))) {
        toggle.focus({ preventScroll: true });
      }
      panel.dataset.settings = String(c.expanded && c.settingsOpen);
      if (panel.dataset.settings !== 'true') for (const picker of picks) picker.close();
      panel.dataset.quality = c.phase === 'reconnecting' ? 'fair'
        : c.phase === 'connected' ? c.quality?.level || 'unknown'
        : c.phase === 'ended' && c.failed ? 'poor' : 'unknown';

      if (field('name').textContent !== name || c.renderedAvatar !== c.peer?.avatar) {
        field('name').textContent = name;
        field('avatar').replaceChildren(avatar(c.peer?.avatar, name));
        c.renderedAvatar = c.peer?.avatar;
      }
      setText(field('status'), status);
      toggle.title = status;
      toggle.disabled = finished;
      toggle.setAttribute('aria-expanded', String(c.expanded));
      setText(field('announce'), name + ' · ' + status);
      renderTime(c);

      field('ring').hidden = c.phase !== 'incoming';
      field('accept').disabled = !!c.accepting;
      const hangup = field('hangup');
      hangup.hidden = c.phase === 'incoming' || finished;
      hangup.disabled = c.phase === 'ending';
      const hangupLabel = ['outgoing', 'permission'].includes(c.phase) ? '取消呼叫' : '挂断通话';
      hangup.setAttribute('aria-label', hangupLabel);
      hangup.title = hangupLabel;

      const micLabel = controls ? c.muted ? '解除麦克风静音' : '静音麦克风' : '麦克风已暂停';
      mic.hidden = !mediaStage || !c.stream;
      mic.disabled = !controls;
      mic.dataset.mic = controls ? c.muted ? 'muted' : 'open' : 'paused';
      mic.setAttribute('aria-label', micLabel);
      mic.title = micLabel;
      mic.setAttribute('aria-pressed', String(c.muted));
      field('play').hidden = !c.playBlocked || !mediaStage;

      details.inert = !c.expanded;
      settings.hidden = !controls;
      settings.setAttribute('aria-expanded', String(panel.dataset.settings === 'true'));
      audioSettings.inert = panel.dataset.settings !== 'true';
      field('activity').hidden = c.phase !== 'connected';
      setText(field('network'), c.phase === 'connected' ? formatQuality(c.quality)
        : c.phase === 'incoming' && !c.error ? '接听后启用麦克风' : status);
    }

    function getContext(c) {
      if (!contextType) return null;
      try {
        c.context ||= new contextType();
        c.context.resume().catch(() => {});
        return c.context;
      } catch {
        return null;
      }
    }

    function stopTone(c) {
      clearInterval(c.toneTimer);
      c.toneTimer = null;
      for (const osc of c.oscillators || []) {
        try { osc.stop(); } catch {}
        osc.disconnect();
      }
      c.oscillators?.clear();
    }

    function tone(c) {
      if (document.hidden || c.toneTimer) return;
      const context = getContext(c);
      if (!context) return;
      c.oscillators ||= new Set();
      const play = () => {
        if (!active(c) || document.hidden || context.state !== 'running') return;
        const start = context.currentTime;
        const frequencies = c.direction === 'incoming' ? [520, 660] : [440, 480];
        frequencies.forEach((frequency, index) => {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          const time = start + index * .18;
          oscillator.frequency.value = frequency;
          gain.gain.setValueAtTime(0, time);
          gain.gain.linearRampToValueAtTime(.055, time + .035);
          gain.gain.exponentialRampToValueAtTime(.001, time + .16);
          oscillator.connect(gain).connect(context.destination);
          c.oscillators.add(oscillator);
          oscillator.onended = () => {
            oscillator.disconnect();
            gain.disconnect();
            c.oscillators.delete(oscillator);
          };
          oscillator.start(time);
          oscillator.stop(time + .17);
        });
      };
      play();
      c.toneTimer = setInterval(play, c.direction === 'incoming' ? 2700 : 3900);
    }

    function syncTrack(c) {
      c.stream?.getAudioTracks().forEach(track => {
        track.enabled = !c.muted && !c.transportLost && !c.paused;
      });
    }

    function dispose(c) {
      stopTone(c);
      for (const timer of c.timers) clearTimeout(timer);
      c.timers.clear();
      clearInterval(c.uiTimer);
      clearInterval(c.statsTimer);
      clearInterval(c.syncTimer);
      stop(c.stream);
      c.stream = null;
      if (c.pc) {
        c.pc.ontrack = c.pc.onicecandidate = c.pc.onconnectionstatechange = c.pc.oniceconnectionstatechange = null;
        c.pc.close();
        c.pc = null;
      }
      c.source?.disconnect();
      c.analyser?.disconnect();
      c.context?.close().catch(() => {});
      c.context = c.source = c.analyser = c.samples = null;
      c.remote = null;
      c.candidates.length = 0;
      c.sentCandidates.clear();
      audio.pause();
      audio.srcObject = null;
      panel.classList.remove('is-speaking');
      for (const picker of picks) picker.update([], undefined, '', false);
    }

    function finish(c, reason, detail) {
      if (!active(c)) return;
      const ownedFocus = panel.contains(document.activeElement);
      c.finished = true;
      c.resumeKey = null;
      c.phase = 'ended';
      c.failed = reason === 'failed';
      c.result = detail || messages[reason] || '语音通话已结束';
      c.error = '';
      c.expanded = false;
      c.settingsOpen = false;
      dispose(c);
      if (ownedFocus && c.trigger?.getClientRects().length && !c.trigger.closest('[inert]')) {
        c.trigger.focus({ preventScroll: true });
      }
      render(c);

      const hide = () => {
        if (call !== c) return;
        call = null;
        if (viewportPopover) panel.hidePopover();
        panel.hidden = true;
        delete panel.dataset.leaving;
      };
      closingTimer = setTimeout(() => {
        if (call !== c) return;
        if (reduceMotion.matches) return hide();
        panel.dataset.leaving = 'true';
        closingTimer = setTimeout(hide, 260);
      }, 1550);
    }

    async function end(c, reason = 'hangup', detail) {
      if (!active(c)) return;
      if (c.phase === 'incoming' && !c.stream) {
        // An unclaimed callee may decline, but may not terminate an accepted call.
        c.phase = 'ending';
        render(c);
        try { await send('decline', { id: c.id }); } catch {}
        finish(c, 'declined');
        return;
      }
      const id = c.id;
      const resumePending = c.transportLost && c.resumeKey;
      if (resumePending) {
        // A disconnected socket cannot end server state immediately. Its peer
        // sees a paused call and both ends expire at the same bounded deadline.
        finish(c, reason, detail);
        return;
      }
      if (id) send('end', { id }).catch(() => {});
      finish(c, reason, detail);
    }

    function micFailure(error) {
      if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return '麦克风权限未授予。请在浏览器中允许访问后重试。';
      if (error.name === 'NotFoundError') return '找不到可用的麦克风';
      if (error.name === 'NotReadableError') return '麦克风暂时不可用，请检查其他应用是否正在使用';
      return error.message || '无法打开麦克风';
    }

    async function microphone(deviceId) {
      if (permissionPending) throw Error('麦克风请求正在处理');
      permissionPending = true;
      try {
        const supported = navigator.mediaDevices.getSupportedConstraints();
        const audioConstraints = {};
        for (const key of ['echoCancellation', 'noiseSuppression', 'autoGainControl']) {
          if (supported[key]) audioConstraints[key] = { ideal: true };
        }
        if (deviceId) audioConstraints.deviceId = { exact: deviceId };
        return await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
      } finally {
        permissionPending = false;
      }
    }

    function bindMicrophone(c) {
      const track = c.stream.getAudioTracks()[0];
      track.addEventListener('ended', () => {
        if (active(c) && c.stream?.getAudioTracks()[0] === track) {
          end(c, 'failed', '麦克风已断开，语音通话结束');
        }
      }, { once: true });
      syncTrack(c);
      refreshDevices(c);
    }

    async function refreshDevices(c) {
      const revision = c.deviceRevision = (c.deviceRevision || 0) + 1;
      let devices;
      try { devices = await navigator.mediaDevices.enumerateDevices(); } catch { return; }
      if (!active(c) || !c.stream || c.deviceRevision !== revision) return;
      const choices = (kind, prefix) => devices.filter(device => device.kind === kind && device.deviceId)
        .map((device, index) => ({ id: device.deviceId, label: device.label || prefix + ' ' + (index + 1) }));
      const track = c.stream.getAudioTracks()[0];
      const input = choices('audioinput', '麦克风');
      picks[0].update(input, track.getSettings().deviceId, track.label || '当前麦克风', input.length > 0);
      const output = choices('audiooutput', '扬声器');
      const defaultOutput = output.find(device => device.id === 'default');
      if (!defaultOutput) output.unshift({ id: '', label: '系统默认' });
      const selectableOutput = typeof audio.setSinkId === 'function';
      const missingOutput = audio.sinkId && !output.some(device => device.id === audio.sinkId);
      picks[1].update(output, audio.sinkId || defaultOutput?.id || '', '当前输出设备不可用',
        selectableOutput && (output.length > 1 || Boolean(missingOutput)));
      field('choose-output').hidden = !selectableOutput
        || typeof navigator.mediaDevices.selectAudioOutput !== 'function';
    }

    async function start(peer, trigger) {
      if (!currentUser()?.id || !socket.connected || currentUser().isBanned) return toast('当前会话无法发起通话');
      if (!peer?.id || peer.id === currentUser().id) return;
      if (call && !call.finished || permissionPending) return toast('已有正在处理的语音通话');
      if (!canCall()) return toast('Uni Call 需要支持 WebRTC 的浏览器和 HTTPS');
      if (recorderActive()) return toast('请先结束语音消息录制');
      const c = call = makeCall('outgoing', peer);
      c.trigger = trigger;
      getContext(c);
      render(c);
      try {
        const stream = await microphone();
        if (!active(c)) return stop(stream);
        c.stream = stream;
        bindMicrophone(c);
        const requestId = crypto.randomUUID();
        const payload = { targetId: peer.id, requestId };
        // A dropped acknowledgement can be replayed with the same ID.
        let response;
        try { response = await send('start', payload); }
        catch (error) {
          if (error.code || !socket.connected) throw error;
          if (!active(c)) throw error;
          response = await send('start', payload);
        }
        if (!active(c)) {
          send('end', { id: response.id }).catch(() => {});
          return;
        }
        c.id = response.id;
        if (c.phase === 'permission') await synchronize(c);
      } catch (error) {
        finish(c, error.code, micFailure(error));
      }
    }

    async function accept(c) {
      if (!active(c) || c.phase !== 'incoming' || c.accepting) return;
      if (!canCall()) { c.error = '当前页面无法使用麦克风，请使用支持 WebRTC 的 HTTPS 浏览器。'; render(c); return; }
      if (recorderActive()) { c.error = '请先结束语音消息录制'; render(c); return; }
      c.accepting = true;
      c.error = '';
      stopTone(c);
      getContext(c);
      render(c);
      try {
        const stream = await microphone();
        if (!active(c) || c.phase !== 'incoming') return stop(stream);
        c.stream = stream;
        bindMicrophone(c);
        try { await send('accept', { id: c.id }); }
        catch (error) {
          // Resolve an uncertain accept without claiming another device's call.
          if (error.code || !socket.connected) throw error;
          const snapshot = await send('sync', { id: c.id });
          if (snapshot.state.state === 'ringing') throw error;
          applyState(snapshot.state);
        }
      } catch (error) {
        if (!active(c)) return;
        stop(c.stream);
        c.stream = null;
        if (error.code === 'expired' || error.code === 'state') return finish(c, 'answered-elsewhere');
        c.error = micFailure(error);
        tone(c);
      } finally {
        c.accepting = false;
        if (active(c)) render(c);
      }
    }

    function enqueue(c, work) {
      c.queue = c.queue.then(async () => {
        if (active(c)) await work();
      }).catch(() => {
        if (active(c) && !c.paused && !c.transportLost) scheduleRetry(c, 500);
      });
    }

    function signal(c, round, kind, value) {
      return send('signal', { id: c.id, round, kind, value });
    }

    async function drainCandidates(c, round) {
      if (!c.pc.remoteDescription || c.remoteRound !== round) return;
      const queued = c.candidates.splice(0);
      for (const candidate of queued) {
        if (!active(c) || c.round !== round) return;
        // Candidate delivery is best effort. A stale username fragment must
        // not abort the rest of the queue after an ICE restart.
        try { await c.pc.addIceCandidate(candidate); } catch {}
      }
    }

    async function playRemote(c) {
      getContext(c);
      try {
        await audio.play();
        if (active(c)) { c.playBlocked = false; render(c); }
      } catch {
        if (active(c)) { c.playBlocked = true; render(c); }
      }
    }

    function onTrack(c, event) {
      if (!active(c) || event.track.kind !== 'audio') return;
      c.remote = event.streams[0] || new MediaStream([event.track]);
      audio.srcObject = c.remote;
      playRemote(c);
      const context = getContext(c);
      if (context) {
        c.source?.disconnect();
        c.source = context.createMediaStreamSource(c.remote);
        c.analyser ||= context.createAnalyser();
        c.analyser.fftSize = 512;
        c.samples = new Float32Array(512);
        c.source.connect(c.analyser);
      }
    }

    function createPeer(c, config) {
      const pc = c.pc = new RTCPeerConnection(config);
      for (const track of c.stream.getAudioTracks()) pc.addTrack(track, c.stream);
      const codecs = window.RTCRtpReceiver?.getCapabilities?.('audio')?.codecs;
      if (codecs?.some(codec => codec.mimeType.toLowerCase() === 'audio/opus')) {
        const opusFirst = [
          ...codecs.filter(codec => codec.mimeType.toLowerCase() === 'audio/opus'),
          ...codecs.filter(codec => codec.mimeType.toLowerCase() !== 'audio/opus')
        ];
        for (const transceiver of pc.getTransceivers()) {
          try { transceiver.setCodecPreferences?.(opusFirst); } catch {}
        }
      }
      pc.ontrack = event => onTrack(c, event);
      pc.onicecandidate = event => {
        if (!active(c) || c.paused || c.transportLost || !event.candidate?.candidate || c.localRound !== c.round) return;
        const candidate = event.candidate.toJSON();
        const fingerprint = candidate.usernameFragment;
        if (fingerprint && c.localUfrag && fingerprint !== c.localUfrag) return;
        const key = candidate.candidate + '|' + candidate.sdpMid;
        if (c.sentCandidates.has(key) || c.sentCandidates.size >= 96) return;
        c.sentCandidates.add(key);
        signal(c, c.round, 'ice', candidate).catch(() => {});
      };
      pc.onconnectionstatechange = pc.oniceconnectionstatechange = () => checkConnection(c);
      c.uiTimer = setInterval(() => {
        if (document.hidden) return;
        renderTime(c);
        if (!c.expanded || !c.analyser || c.context?.state !== 'running' || c.phase !== 'connected') {
          panel.classList.remove('is-speaking');
          return;
        }
        c.analyser.getFloatTimeDomainData(c.samples);
        const rms = Math.sqrt(c.samples.reduce((sum, value) => sum + value * value, 0) / c.samples.length);
        panel.classList.toggle('is-speaking', rms > .018);
      }, 250);
      c.statsTimer = setInterval(() => readStats(c), 4000);
      c.syncTimer = setInterval(() => {
        if (active(c) && !c.transportLost && c.phase === 'connected') synchronize(c, false);
      }, 15000);
    }

    function mediaConnected(pc) {
      return pc.connectionState === 'connected'
        || (typeof pc.connectionState === 'undefined' && ['connected', 'completed'].includes(pc.iceConnectionState));
    }

    function scheduleRetry(c, delay) {
      if (!active(c) || c.retryTimer || !c.round || c.paused || c.transportLost) return;
      c.retryTimer = later(c, async () => {
        c.retryTimer = null;
        try { await send('retry', { id: c.id, round: c.round }); }
        catch (error) {
          if (error.code === 'expired') finish(c, 'failed');
          // The authoritative server deadline still bounds retry failures.
        }
      }, delay);
    }

    function checkConnection(c) {
      if (!active(c) || !c.pc || c.paused || c.transportLost) return;
      const pc = c.pc;
      if (mediaConnected(pc) && c.negotiatedRound === c.round) {
        if (c.retryTimer) {
          cancelTimer(c, c.retryTimer);
          c.retryTimer = null;
        }
        if (c.reportedRound === c.round) return;
        const round = c.reportedRound = c.round;
        send('connected', { id: c.id, round }).catch(() => {
          if (c.reportedRound === round) c.reportedRound = 0;
        });
      } else if (pc.connectionState === 'failed' || pc.iceConnectionState === 'failed') scheduleRetry(c, 250);
      else if (pc.connectionState === 'disconnected' || pc.iceConnectionState === 'disconnected') scheduleRetry(c, 3500);
    }

    async function readStats(c) {
      if (!active(c) || !c.pc || c.paused || c.transportLost) return;
      checkConnection(c);
      if (document.hidden || c.phase !== 'connected' || c.readingStats || performance.now() < (c.nextQualityAt || 0)) return;
      c.readingStats = true;
      c.nextQualityAt = performance.now() + 7500;
      const round = c.round;
      try {
        const stats = await c.pc.getStats();
        if (!active(c) || c.phase !== 'connected' || c.round !== round) return;
        let pair, inbound, legacyPair;
        for (const s of stats.values()) {
          if (s.type === 'transport' && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId);
          if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') legacyPair = s;
          if (s.type === 'inbound-rtp' && (s.kind || s.mediaType) === 'audio') inbound = s;
        }
        pair ||= legacyPair;
        const rtt = pair?.currentRoundTripTime;
        const jitter = inbound?.jitter;
        let loss;
        if (inbound && Number.isFinite(inbound.packetsLost) && Number.isFinite(inbound.packetsReceived)) {
          if (c.previousStats?.id === inbound.id) {
            const lost = Math.max(0, inbound.packetsLost - c.previousStats.lost);
            const received = inbound.packetsReceived - c.previousStats.received;
            if (received >= 0 && lost + received > 0) loss = lost / (lost + received);
          }
          c.previousStats = { id: inbound.id, lost: inbound.packetsLost, received: inbound.packetsReceived };
        }
        c.quality = updateQuality(c.quality, {
          rtt: Number.isFinite(rtt) ? rtt * 1000 : undefined,
          jitter: Number.isFinite(jitter) ? jitter * 1000 : undefined,
          loss
        });
        render(c);
      } catch {
        if (active(c) && c.phase === 'connected' && c.round === round) {
          c.quality = null;
          render(c);
        }
      } finally {
        c.readingStats = false;
      }
    }

    async function setLocal(c, round, description) {
      c.localUfrag = description.sdp.match(/^a=ice-ufrag:([^\r\n]+)/m)?.[1];
      c.localRound = round;
      await c.pc.setLocalDescription(description);
      if (!active(c) || round !== c.round || c.paused || c.transportLost) return false;
      await signal(c, round, description.type, c.pc.localDescription.sdp);
      return active(c) && c.round === round;
    }

    function prepareRound(c, round) {
      c.round = round;
      c.candidates.length = 0;
      c.sentCandidates.clear();
      c.previousStats = null;
      c.quality = null;
      c.nextQualityAt = 0;
      if (c.retryTimer) {
        cancelTimer(c, c.retryTimer);
        c.retryTimer = null;
      }
      enqueue(c, async () => {
        if (c.round !== round || c.paused || c.transportLost) return;
        const response = await send('ice-config', { id: c.id, round });
        if (!active(c) || c.round !== round || c.paused || c.transportLost) return;
        if (!c.pc) createPeer(c, response.config);
        else {
          c.pc.setConfiguration(response.config);
          // A previous failed offer can be left pending when the server starts
          // a new round. Roll back before applying the next remote description.
          if (c.pc.signalingState === 'have-local-offer') await c.pc.setLocalDescription({ type: 'rollback' });
          else if (c.pc.signalingState === 'have-remote-offer') await c.pc.setRemoteDescription({ type: 'rollback' });
        }
        if (c.direction !== 'outgoing') return;
        const offer = await c.pc.createOffer({ iceRestart: round > 1 });
        if (active(c) && c.round === round) await setLocal(c, round, offer);
      });
    }

    function applyState(data) {
      const owner = currentUser();
      if (!owner?.id || !data || typeof data.id !== 'string') return;
      if (call && active(call) && !call.id && call.direction === 'outgoing'
          && data.state === 'ringing' && data.direction === 'incoming') {
        // The server settled crossed dials in favor of the incoming call.
        // Stop our pending capture and let the user explicitly accept it.
        finish(call, 'canceled');
      }
      if ((!call || call.finished) && data.state === 'ringing' && data.direction === 'incoming') {
        call = makeCall('incoming', data.peer);
        call.id = data.id;
      }
      const c = call;
      if (!c || c.finished || c.ownerId !== owner.id) return;
      // Initial outgoing state can arrive before the start promise continuation.
      if (!c.id && data.direction === 'outgoing' && data.state === 'ringing' && c.peer.id === data.peer?.id) c.id = data.id;
      if (c.id !== data.id || data.revision < c.revision) return;
      c.revision = data.revision;
      c.clockOffset = data.serverTime - Date.now();
      if (data.state === 'ended') return finish(c, data.reason);
      c.resumeKey = data.resumeKey || c.resumeKey;
      c.startedAt = data.startedAt;
      c.paused = data.paused;
      c.transportLost = false;
      c.peer = data.peer || c.peer;
      c.phase = data.state === 'ringing' ? c.direction : data.state;
      syncTrack(c);
      cancelTimer(c, c.deadlineTimer);
      // Also release local resources on a lost final state notification.
      if (data.deadline) {
        c.deadlineTimer = later(c, () => synchronize(c), Math.max(100, data.deadline - data.serverTime + 750));
      }
      if (data.state === 'ringing') tone(c);
      else stopTone(c);
      if (!data.paused && data.round > c.round && c.stream) prepareRound(c, data.round);
      render(c);
    }

    async function synchronize(c, required = true) {
      if (!active(c)) return;
      try { applyState((await send('sync', { id: c.id })).state); }
      catch (error) {
        if (active(c) && !c.transportLost && (required || error.code === 'expired')) finish(c, 'failed');
      }
    }

    socket.on(prefix + 'state', applyState);
    socket.on(prefix + 'signal', data => {
      const c = call;
      if (!c || !active(c) || c.id !== data.id || c.round !== data.round || c.paused || c.transportLost) return;
      enqueue(c, async () => {
        if (c.round !== data.round || !c.pc || c.paused || c.transportLost) return;
        if (data.kind === 'ice') {
          if (c.candidates.length < 96) c.candidates.push(data.value);
          await drainCandidates(c, data.round);
          return;
        }
        await c.pc.setRemoteDescription({ type: data.kind, sdp: data.value });
        if (!active(c) || c.round !== data.round) return;
        c.remoteRound = data.round;
        await drainCandidates(c, data.round);
        if (data.kind === 'offer') {
          const answer = await c.pc.createAnswer();
          if (!active(c) || c.round !== data.round || !await setLocal(c, data.round, answer)) return;
        }
        c.negotiatedRound = data.round;
        checkConnection(c);
      });
    });

    async function auth(user) {
      const c = call;
      if (!c || !active(c) || !c.transportLost) return;
      if (user.id !== c.ownerId || user.isBanned || !c.resumeKey) return finish(c, 'failed');
      try {
        const response = await send('resume', { id: c.id, resumeKey: c.resumeKey });
        if (response.state) applyState(response.state);
      } catch { finish(c, 'failed'); }
    }

    function disconnect() {
      const c = call;
      if (!c || !active(c)) return;
      if (!c.resumeKey || !c.stream || !c.round) return finish(c, 'failed', '连接已断开');
      c.phase = 'reconnecting';
      c.transportLost = true;
      syncTrack(c);
      cancelTimer(c, c.deadlineTimer);
      c.deadlineTimer = later(c, () => finish(c, 'failed', '重新登录超时，通话已结束'), 18500);
      render(c);
    }

    field('accept').addEventListener('click', () => call && accept(call));
    field('decline').addEventListener('click', () => call && end(call, 'declined'));
    field('hangup').addEventListener('click', () => call && end(call, call.phase === 'outgoing' ? 'canceled' : 'hangup'));
    field('mute').addEventListener('click', () => {
      if (!call?.stream || !active(call)) return;
      call.muted = !call.muted;
      syncTrack(call);
      render(call);
    });
    field('play').addEventListener('click', () => call && playRemote(call));
    function changeExpansion(expanded) {
      const c = call;
      if (!c || !active(c)) return;
      c.expanded = expanded;
      if (!expanded) c.settingsOpen = false;
      render(c);
    }

    toggle.addEventListener('click', () => call && changeExpansion(!call.expanded));
    field('collapse').addEventListener('click', () => changeExpansion(false));
    settings.addEventListener('click', () => {
      if (!call || !active(call) || !call.expanded) return;
      call.settingsOpen = !call.settingsOpen;
      render(call);
      if (call.settingsOpen) refreshDevices(call);
    });
    panel.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !call?.expanded) return;
      event.preventDefault();
      event.stopPropagation();
      const picker = picks.find(item => item.isOpen());
      if (picker) {
        picker.close(true);
      } else if (call.settingsOpen) {
        settings.focus({ preventScroll: true });
        call.settingsOpen = false;
        render(call);
      } else changeExpansion(false);
    });
    async function switchMicrophone(deviceId) {
      const c = call;
      if (!c?.pc || !active(c)) return;
      const sender = c.pc.getSenders().find(s => s.track?.kind === 'audio');
      if (!sender) return;
      let stream;
      try {
        stream = await microphone(deviceId);
        if (!active(c)) return stop(stream);
        const [track] = stream.getAudioTracks();
        track.enabled = !c.muted && !c.paused && !c.transportLost;
        await sender.replaceTrack(track);
        if (!active(c)) return stop(stream);
        const old = c.stream;
        c.stream = stream;
        bindMicrophone(c);
        stop(old);
      } catch (error) { stop(stream); if (active(c)) { toast(micFailure(error)); refreshDevices(c); } }
    }

    async function switchOutput(deviceId) {
      const c = call;
      if (!c || !active(c) || typeof audio.setSinkId !== 'function') return;
      try { await audio.setSinkId(deviceId); }
      catch { if (active(c)) toast('浏览器无法切换到此输出设备'); }
      if (active(c)) await refreshDevices(c);
    }

    field('choose-output').addEventListener('click', async () => {
      const c = call;
      if (!c || !active(c)) return;
      try {
        const device = await navigator.mediaDevices.selectAudioOutput();
        if (!active(c)) return;
        await switchOutput(device.deviceId);
      } catch { if (active(c)) toast('未能选择音频输出设备'); }
    });
    const volume = field('volume');
    try {
      audio.volume = .6;
      volume.parentElement.hidden = audio.volume !== .6;
      audio.volume = 1;
    } catch { volume.parentElement.hidden = true; }
    function syncVolume() {
      const percent = Math.round(audio.volume * 100) + '%';
      volume.style.setProperty('--call-volume', percent);
      volume.setAttribute('aria-valuetext', percent);
      field('volume-value').textContent = percent;
    }
    volume.addEventListener('input', () => { audio.volume = Number(volume.value); syncVolume(); });
    syncVolume();
    navigator.mediaDevices?.addEventListener?.('devicechange', () => {
      if (call && active(call)) refreshDevices(call);
    });
    document.addEventListener('visibilitychange', () => {
      if (!call || !active(call)) return;
      if (document.hidden) {
        stopTone(call);
        panel.classList.remove('is-speaking');
      } else {
        if (['incoming', 'outgoing'].includes(call.phase)) tone(call);
        if (call.id && !call.transportLost) synchronize(call);
      }
    });
    window.addEventListener('pagehide', () => {
      if (!call || !active(call)) return;
      // Closing one ringing tab must not decline the invite on behalf of all
      // other devices. The server removes this socket from the ringing set.
      if (call.phase === 'incoming') finish(call, 'missed');
      else end(call, 'hangup');
    });
    return {
      start, auth, disconnect, canCall,
      reset() { if (call && active(call)) end(call, 'hangup'); },
      usesMicrophone() { return permissionPending || !!call?.stream; }
    };
  }

  window.UniCall = {
    create,
    historyLabel(reason, duration) {
      return (messages[reason] || '语音通话') + (reason === 'completed' || duration > 0 ? ' · ' + clock(duration) : '');
    }
  };
})();
