'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const origin = process.argv.find(arg => arg.startsWith('--uni-origin='))?.slice(13);

if (process.isMainFrame && origin && location.origin === origin) {
  contextBridge.exposeInMainWorld('uniDesktop', {
    remember: login => ipcRenderer.invoke('uni:remember', login),
    forget: () => ipcRenderer.invoke('uni:forget'),
    badge: count => ipcRenderer.send('uni:badge', count),
    notice: notice => ipcRenderer.send('uni:notice', notice)
  });

  document.addEventListener('click', event => {
    if (!event.isTrusted || event.defaultPrevented) return;
    const anchor = event.target.closest?.('a[href]');
    if (!anchor || anchor.hasAttribute('download')) return;
    let url;
    try { url = new URL(anchor.href); } catch { return; }
    if (url.origin === origin && ['/', '/index.html'].includes(url.pathname) && !anchor.target && !url.search) return;
    event.preventDefault();
    ipcRenderer.send('uni:external-link', url.href);
  });

  document.addEventListener('click', event => {
    if (!event.isTrusted) return;
    const image = event.target.closest?.('#messages img.chat-img, #messages img.sticker-message-img');
    if (!image) return;
    // RC1's image click opens a browser popup. Show the already-loaded image in place.
    event.stopPropagation();
    const dialog = document.createElement('dialog');
    dialog.className = 'uni-desktop-image';
    dialog.setAttribute('aria-label', '聊天图片预览');
    const preview = image.cloneNode(false);
    preview.removeAttribute('id');
    preview.removeAttribute('srcset');
    preview.src = image.currentSrc || image.src;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '关闭';
    close.addEventListener('click', () => dialog.close(), { once: true });
    dialog.append(preview, close);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
  }, true);

  // This channel belongs to the isolated preload. DOM synthetic clicks cannot open the microphone.
  document.addEventListener('click', event => {
    if (!event.isTrusted) return;
    if (event.target.closest?.('#privateCallOpen, #profileVoiceCall, #voiceBtn, [data-call="accept"], #uniCallMicOptions button')) {
      ipcRenderer.send('uni:audio-action', 'microphone');
    }
    if (event.target.closest?.('[data-call="choose-output"], #uniCallOutputOptions button')) ipcRenderer.send('uni:audio-action', 'speaker');
  }, true);
}
