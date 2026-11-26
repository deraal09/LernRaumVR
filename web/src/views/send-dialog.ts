import { getDevices, sendFile, type DeviceInfo, type FileInfo } from '../api';
import { errorMessage } from '../messages';
import { formatBytes, h, replaceChildren } from '../ui';

const SKIP: Record<string, string> = {
  already_queued: 'hat die Datei schon in der Warteschlange',
  no_space: 'hat nicht genug freien Speicher',
  unknown_device: 'ist unbekannt',
};

/** Auswahl der Brillen für einen Sendeauftrag. */
export function openSendDialog(file: FileInfo, onSent: () => void): void {
  const dialog = h('dialog', { class: 'send' });
  const list = h('div', { class: 'device-list' });
  const message = h('p', { class: 'error', role: 'alert' });
  const result = h('p', { class: 'muted' });
  let devices: DeviceInfo[] = [];
  const boxes = new Map<number, HTMLInputElement>();

  const setAll = (pred: (d: DeviceInfo) => boolean): void => {
    for (const d of devices) boxes.get(d.id)!.checked = pred(d);
  };
  const sendBtn = h('button', { type: 'button', onClick: () => {
    const ids = devices.filter((d) => boxes.get(d.id)!.checked).map((d) => d.id);
    if (ids.length === 0) { message.textContent = 'Bitte mindestens eine Brille auswählen.'; return; }
    sendBtn.disabled = true;
    sendFile(file.id, ids).then((res) => {
      const byId = new Map(devices.map((d) => [d.id, d.name]));
      const skipped = res.skipped.map((s) => `${byId.get(s.deviceId) ?? s.deviceId} ${SKIP[s.reason] ?? s.reason}`);
      onSent();
      if (skipped.length === 0) { dialog.close(); dialog.remove(); return; }
      message.textContent = '';
      result.textContent = `${res.created} Aufträge angelegt. Übersprungen: ${skipped.join('; ')}.`;
      sendBtn.remove();
    }, (err: unknown) => { message.textContent = errorMessage(err); sendBtn.disabled = false; });
  } }, 'Senden');

  dialog.append(
    h('h3', {}, `„${file.name}“ senden (${formatBytes(file.groesse)})`),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'secondary small', onClick: () => setAll((d) => d.online) }, 'Alle online'),
      h('button', { type: 'button', class: 'secondary small', onClick: () => setAll(() => true) }, 'Alle'),
      h('button', { type: 'button', class: 'secondary small', onClick: () => setAll(() => false) }, 'Keine')),
    list, message, result,
    h('div', { class: 'row end' }, h('button', { type: 'button', class: 'secondary', onClick: () => { dialog.close(); dialog.remove(); } }, 'Schließen'), sendBtn),
  );
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();

  getDevices().then((res) => {
    devices = res.devices;
    replaceChildren(list, ...(devices.length === 0 ? [h('p', { class: 'muted' }, 'Es sind noch keine Brillen gekoppelt.')] : devices.map((d) => {
      const box = h('input', { type: 'checkbox', id: `dev-${d.id}` });
      boxes.set(d.id, box);
      return h('div', { class: 'device-option' }, box,
        h('label', { for: `dev-${d.id}`, class: 'inline' }, d.name, ' ',
          h('span', { class: `badge ${d.online ? 'ready' : 'blocked'}` }, d.online ? 'online' : 'offline'),
          d.freeBytes !== null ? h('span', { class: 'muted small' }, ` frei: ${formatBytes(d.freeBytes)}`) : null));
    })));
  }, (err: unknown) => { message.textContent = errorMessage(err); });
}
