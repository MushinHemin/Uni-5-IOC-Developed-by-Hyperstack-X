'use strict';
const ui = Object.fromEntries(['screen', 'heading', 'status', 'form', 'address', 'background', 'notifications', 'previews',
  'form-error', 'back', 'retry', 'connect', 'forget', 'settings'].map(id => [id, document.getElementById(id)]));

let current;
function update(next) {
  const previous = current;
  current = next;
  ui.screen.hidden = next.mode === 'app';
  if (ui.screen.hidden) return;
  ui.heading.textContent = ({ setup: '连接 Uni', settings: '连接设置', connecting: '正在连接', error: '无法连接 Uni' })[next.mode];
  ui.status.textContent = next.message;
  ui.back.hidden = !next.canReturn;
  ui.retry.hidden = !next.origin || next.mode === 'settings';
  ui.retry.disabled = next.mode === 'connecting';
  ui.connect.textContent = next.mode === 'settings' ? '保存' : '连接';
  ui.forget.hidden = !next.origin;
  if (next.mode === 'settings' && previous?.mode !== 'settings' || !previous) {
    ui.address.value = next.origin || '';
    ui.background.checked = next.background;
    ui.notifications.checked = next.notifications;
    ui.previews.checked = next.previews;
    ui['form-error'].textContent = '';
  }
}
window.uniWindow.onState(update);
window.uniWindow.getState().then(update);
ui.settings.onclick = () => window.uniWindow.open();
ui.back.onclick = () => window.uniWindow.back();
ui.retry.onclick = () => window.uniWindow.retry();
ui.forget.onclick = async () => {
  await window.uniWindow.forget();
  ui.status.textContent = '已清除保存的登录，下次连接需要手动登录。';
};
ui.form.onsubmit = async event => {
  event.preventDefault();
  ui['form-error'].textContent = '';
  ui.connect.disabled = true;
  try {
    const result = await window.uniWindow.save({
      address: ui.address.value, background: ui.background.checked,
      notifications: ui.notifications.checked, previews: ui.previews.checked
    });
    if (!result.ok) ui['form-error'].textContent = result.message;
  } catch {
    ui['form-error'].textContent = '无法保存设置，请重试。';
  } finally {
    ui.connect.disabled = false;
  }
};
