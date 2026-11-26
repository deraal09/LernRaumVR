import { cancelBatch, cancelTransfer, getTransfers, retryTransfer, type TransferInfo, type TransferStatus } from '../api';
import { errorMessage } from '../messages';
import { formatBytes, formatDate, h, replaceChildren } from '../ui';

const LABEL: Record<TransferStatus, string> = {
  pending: 'Wartet', downloading: 'Lädt', verified: 'Geprüft', done: 'Fertig',
  awaiting_confirmation: 'Wartet auf Bestätigung', installed: 'Installiert', failed: 'Fehler', cancelled: 'Abgebrochen',
};
const OPEN: TransferStatus[] = ['pending', 'downloading', 'verified', 'awaiting_confirmation'];
const FINISHED: TransferStatus[] = ['done', 'installed'];

function statusText(t: TransferInfo): string {
  if (t.queued) return 'In Warteschlange';
  if (t.status === 'downloading' && t.fileSize) return `Lädt ${Math.floor((t.bytesDone / t.fileSize) * 100)} %`;
  return LABEL[t.status];
}

export function transfersView(): { element: HTMLElement; dispose: () => void } {
  const container = h('div');
  const message = h('p', { class: 'error', role: 'alert' });
  let showAll = false;
  let timer: number | undefined;
  let disposed = false;
  const fail = (err: unknown): void => { message.textContent = errorMessage(err); };

  function group(transfers: TransferInfo[]): Map<string, TransferInfo[]> {
    const map = new Map<string, TransferInfo[]>();
    for (const t of transfers) {
      const key = t.batchId ?? `einzeln-${t.id}`;
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    return map;
  }

  async function refresh(): Promise<void> {
    if (disposed) return;
    try {
      const { transfers } = await getTransfers(showAll);
      message.textContent = '';
      const groups = [...group(transfers).entries()].map(([k, v]) => [k, [...v].sort((a, b) => a.id - b.id)] as const);
      replaceChildren(
        container,
        ...(groups.length === 0 ? [h('p', { class: 'muted' }, showAll ? 'Noch keine Übertragungen.' : 'Keine offenen Übertragungen.')] : groups.map(([batchId, list]) => {
          const count = (s: TransferStatus[]): number => list.filter((t) => s.includes(t.status)).length;
          const open = count(OPEN);
          const done = count(FINISHED);
          const failed = count(['failed']);
          const queued = list.filter((t) => t.queued).length;
          const first = list[0]!;
          const summary = [`${done} von ${list.length} fertig`, open - queued > 0 ? `${open - queued} laufen` : '', queued > 0 ? `${queued} in Warteschlange` : '', failed > 0 ? `${failed} Fehler` : '']
            .filter(Boolean).join(' · ');
          return h('div', { class: 'card batch' },
            h('div', { class: 'row space' },
              h('div', {}, h('strong', {}, first.fileName ?? 'Datei'), h('div', { class: 'muted small' }, `${summary} · von ${first.createdBy ?? '–'}, ${formatDate(first.createdAt)}`)),
              open > 0 && first.batchId ? h('button', { class: 'danger small', onClick: () => {
                if (confirm('Alle offenen Übertragungen dieser Sendung abbrechen?')) void cancelBatch(batchId).then(refresh, fail);
              } }, 'Sendung abbrechen') : null),
            h('progress', { max: String(list.length), value: String(done) }),
            h('table', { class: 'inner' }, h('tbody', {}, ...list.map((t) =>
              h('tr', {},
                h('td', {}, t.deviceName ?? `Brille ${t.deviceId}`),
                h('td', {}, h('span', { class: `badge ${FINISHED.includes(t.status) ? 'ready' : t.status === 'failed' || t.status === 'cancelled' ? 'failed' : 'processing'}` }, statusText(t)),
                  t.errorText ? h('div', { class: 'error small' }, t.errorText) : null),
                h('td', { class: 'num' }, t.fileSize ? `${formatBytes(t.bytesDone)} / ${formatBytes(t.fileSize)}` : ''),
                h('td', {}, OPEN.includes(t.status) ? h('button', { class: 'secondary small', onClick: () => void cancelTransfer(t.id).then(refresh, fail) }, 'Abbrechen')
                  : t.status === 'failed' || t.status === 'cancelled' ? h('button', { class: 'secondary small', onClick: () => void retryTransfer(t.id).then(refresh, fail) }, 'Wiederholen') : null),
              )))),
          );
        })),
      );
      const busy = transfers.some((t) => OPEN.includes(t.status));
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(), busy ? 3000 : 15000);
    } catch (err) { fail(err); }
  }

  const toggle = h('input', { type: 'checkbox', id: 'show-all', onChange: () => { showAll = toggle.checked; void refresh(); } });
  const element = h('section', {},
    h('h2', {}, 'Übertragungen'),
    h('div', { class: 'row' }, toggle, h('label', { for: 'show-all', class: 'inline' }, 'Auch abgeschlossene anzeigen')),
    message, container);
  void refresh();
  return { element, dispose() { disposed = true; window.clearTimeout(timer); } };
}
