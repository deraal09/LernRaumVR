import { deleteFile, getFiles, getStorage, type FileInfo, type StorageInfo, type User } from '../api';
import { errorMessage } from '../messages';
import { startUpload, type UploadItem } from '../upload';
import { formatBytes, formatDate, formatDuration, h, replaceChildren } from '../ui';

const KIND: Record<FileInfo['typ'], string> = { video: 'Video', image: 'Bild', apk: 'App (APK)', other: 'Datei' };
const STATUS: Record<FileInfo['status'], string> = {
  uploading: 'Wird hochgeladen',
  processing: 'Wird geprüft …',
  ready: 'Bereit',
  failed: 'Fehler',
};

function details(f: FileInfo): string {
  const parts: string[] = [];
  if (f.meta.codec) parts.push(f.meta.codec.toUpperCase());
  if (f.meta.width && f.meta.height) parts.push(`${f.meta.width}×${f.meta.height}`);
  if (f.meta.fps) parts.push(`${f.meta.fps} fps`);
  if (f.meta.durationSec) parts.push(formatDuration(f.meta.durationSec));
  return parts.join(' · ');
}

export function libraryView(user: User): { element: HTMLElement; dispose: () => void } {
  const uploads: UploadItem[] = [];
  const storageLine = h('p', { class: 'muted' });
  const uploadList = h('ul', { class: 'uploads' });
  const tableBody = h('tbody');
  const message = h('p', { class: 'error', role: 'alert' });
  let timer: number | undefined;
  let disposed = false;

  const beforeUnload = (e: BeforeUnloadEvent): void => {
    if (uploads.some((u) => u.state === 'running')) e.preventDefault();
  };
  window.addEventListener('beforeunload', beforeUnload);

  function renderUploads(): void {
    replaceChildren(
      uploadList,
      ...uploads
        .filter((u) => u.state !== 'cancelled')
        .map((u) => {
          const pct = u.total ? Math.floor((u.sent / u.total) * 100) : 0;
          const status =
            u.state === 'running' ? `${pct} % (${formatBytes(u.sent)} von ${formatBytes(u.total)})` :
            u.state === 'done' ? 'Hochgeladen, wird geprüft' : u.message;
          return h(
            'li',
            { class: u.state },
            h('div', { class: 'row space' }, h('strong', {}, u.file.name),
              u.state === 'running' ? h('button', { class: 'secondary small', onClick: () => u.cancel() }, 'Abbrechen') : null),
            h('progress', { max: '100', value: String(u.state === 'done' ? 100 : pct) }),
            h('span', { class: u.state === 'error' ? 'error' : 'muted' }, status),
          );
        }),
    );
  }

  function addFiles(files: FileList | null): void {
    if (!files) return;
    for (const file of Array.from(files)) {
      const item = startUpload(file, () => {
        renderUploads();
        if (item.state === 'done') {
          void refresh().then(() => {
            window.setTimeout(() => {
              const i = uploads.indexOf(item);
              if (i >= 0) uploads.splice(i, 1);
              renderUploads();
            }, 4000);
          });
        }
      });
      uploads.push(item);
    }
    renderUploads();
  }

  function renderStorage(s: StorageInfo): void {
    const quota = s.quotaBytes === null ? '' : ` von ${formatBytes(s.quotaBytes)}`;
    storageLine.textContent =
      `Frei auf dem Server: ${formatBytes(s.freeBytes)} · Dein Speicher: ${formatBytes(s.usedBytes)}${quota} · ` +
      `Größte Datei: ${formatBytes(s.maxUploadBytes)}`;
  }

  function renderFiles(files: FileInfo[]): void {
    if (files.length === 0) {
      replaceChildren(tableBody, h('tr', {}, h('td', { colspan: '6', class: 'muted' }, 'Noch keine Dateien hochgeladen.')));
      return;
    }
    replaceChildren(
      tableBody,
      ...files.map((f) =>
        h(
          'tr',
          {},
          h('td', {}, h('strong', {}, f.name), f.meta && details(f) ? h('div', { class: 'muted small' }, details(f)) : null,
            ...f.warnungen.map((w) => h('div', { class: 'warn small' }, `⚠ ${w}`))),
          h('td', {}, KIND[f.typ]),
          h('td', { class: 'num' }, formatBytes(f.groesse)),
          h('td', {}, h('span', { class: `badge ${f.status}` }, STATUS[f.status])),
          h('td', {}, f.uploadedBy?.name ?? '–', h('div', { class: 'muted small' }, formatDate(f.createdAt))),
          h('td', {}, f.canDelete && f.status !== 'uploading'
            ? h('button', {
                class: 'danger small',
                onClick: () => {
                  if (!confirm(`„${f.name}“ wirklich löschen?`)) return;
                  deleteFile(f.id).then(refresh).catch((err: unknown) => { message.textContent = errorMessage(err); });
                },
              }, 'Löschen')
            : null),
        ),
      ),
    );
  }

  async function refresh(): Promise<void> {
    if (disposed) return;
    try {
      const [{ files }, storage] = await Promise.all([getFiles(), getStorage()]);
      message.textContent = '';
      renderFiles(files);
      renderStorage(storage);
      const busy = files.some((f) => f.status === 'processing' || f.status === 'uploading');
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(), busy ? 3000 : 20000);
    } catch (err) {
      message.textContent = errorMessage(err);
    }
  }

  const input = h('input', { type: 'file', multiple: true, class: 'visually-hidden', id: 'file-input',
    onChange: () => { addFiles(input.files); input.value = ''; } });
  const drop = h(
    'label',
    {
      class: 'dropzone', for: 'file-input',
      onDragover: (e) => { e.preventDefault(); drop.classList.add('over'); },
      onDragleave: () => drop.classList.remove('over'),
      onDrop: (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles((e as DragEvent).dataTransfer?.files ?? null); },
    },
    h('strong', {}, 'Dateien hierher ziehen oder klicken'),
    h('span', { class: 'muted' }, 'Videos, Bilder und andere Dateien' + (user.role === 'admin' ? ', auch APKs' : '') + '. Große Dateien werden in Teilen übertragen und lassen sich fortsetzen.'),
  );

  const element = h(
    'section',
    {},
    h('h2', {}, 'Bibliothek'),
    storageLine,
    input,
    drop,
    message,
    uploadList,
    h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Art'), h('th', { class: 'num' }, 'Größe'), h('th', {}, 'Status'), h('th', {}, 'Hochgeladen von'), h('th', {}))), tableBody),
  );
  void refresh();
  return {
    element,
    dispose() {
      disposed = true;
      window.clearTimeout(timer);
      window.removeEventListener('beforeunload', beforeUnload);
    },
  };
}
