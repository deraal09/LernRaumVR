import { confirmDevice, getDevices, renameDevice, revokeDevice, type DeviceInfo, type User } from '../api';
import { errorMessage } from '../messages';
import { formatBytes, formatDate, h, replaceChildren } from '../ui';

export function devicesView(user: User): { element: HTMLElement; dispose: () => void } {
  const isAdmin = user.role === 'admin';
  const body = h('tbody');
  const message = h('p', { class: 'error', role: 'alert' });
  const info = h('p', { class: 'muted' });
  const notice = h('p', { class: 'ok', role: 'status' });
  let timer: number | undefined;
  let disposed = false;
  const fail = (err: unknown): void => { message.textContent = errorMessage(err); };

  async function refresh(): Promise<void> {
    if (disposed) return;
    try {
      const { devices } = await getDevices();
      message.textContent = '';
      const online = devices.filter((d) => d.online).length;
      info.textContent = `${devices.length} Brillen, ${online} online`;
      replaceChildren(
        body,
        ...(devices.length === 0
          ? [h('tr', {}, h('td', { colspan: '6', class: 'muted' }, 'Noch keine Brillen gekoppelt.'))]
          : devices.map((d: DeviceInfo) =>
              h('tr', {},
                h('td', {}, h('strong', {}, d.name), h('div', { class: 'muted small' }, d.androidVersion ? `Android ${d.androidVersion}` : '')),
                h('td', {}, h('span', { class: `badge ${d.online ? 'ready' : 'blocked'}` }, d.online ? 'Online' : 'Offline'),
                  h('div', { class: 'muted small' }, d.lastSeenAt ? `zuletzt ${formatDate(d.lastSeenAt)}` : 'noch nie')),
                h('td', { class: 'num' }, d.freeBytes === null ? '–' : formatBytes(d.freeBytes)),
                h('td', { class: 'num' }, d.batteryPercent === null ? '–' : `${d.batteryPercent} %`),
                h('td', {}, d.appVersion ?? '–', d.openTransfers > 0 ? h('div', { class: 'muted small' }, `${d.openTransfers} offene Aufträge`) : null),
                h('td', {}, isAdmin ? h('div', { class: 'row' },
                  h('button', { class: 'secondary small', onClick: () => {
                    const name = prompt('Neuer Name der Brille:', d.name);
                    if (name?.trim()) void renameDevice(d.id, name.trim()).then(refresh, fail);
                  } }, 'Umbenennen'),
                  h('button', { class: 'danger small', onClick: () => {
                    if (confirm(`„${d.name}“ sperren? Die Brille muss danach neu gekoppelt werden.`)) void revokeDevice(d.id).then(refresh, fail);
                  } }, 'Sperren')) : null),
              ))),
      );
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(), 10000);
    } catch (err) { fail(err); }
  }

  const code = h('input', { inputmode: 'numeric', pattern: '[0-9]{6}', maxlength: '6', placeholder: '6-stelliger Code', 'aria-label': 'Kopplungscode', required: true });
  const name = h('input', { placeholder: 'Name (optional, sonst „Brille 01“ …)', 'aria-label': 'Name der Brille' });
  const pairForm = h('form', { class: 'row', onSubmit: (e) => {
    e.preventDefault();
    confirmDevice(code.value.trim(), name.value.trim() || undefined).then(({ device }) => {
      message.textContent = '';
      notice.textContent = `„${device.name}“ gekoppelt.`;
      code.value = ''; name.value = '';
      return refresh();
    }, fail);
  } }, code, name, h('button', { type: 'submit' }, 'Brille koppeln'));

  const element = h('section', {},
    h('h2', {}, 'Brillen'),
    isAdmin ? h('div', { class: 'card pair' }, h('p', {}, 'Auf der Brille die App LernRaumVR öffnen, den angezeigten Code hier eingeben:'), pairForm) : null,
    notice, info, message,
    h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Status'), h('th', { class: 'num' }, 'Freier Speicher'), h('th', { class: 'num' }, 'Akku'), h('th', {}, 'App'), h('th', {}))), body),
  );
  void refresh();
  return { element, dispose() { disposed = true; window.clearTimeout(timer); } };
}
