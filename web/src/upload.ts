import * as tus from 'tus-js-client';

export type UploadState = 'running' | 'done' | 'error' | 'cancelled';

export interface UploadItem {
  file: File;
  state: UploadState;
  sent: number;
  total: number;
  message: string;
  cancel(): void;
}

/** 32 MB je Teil: groß genug für wenig Overhead, klein genug für Wiederholungen und nginx-Limits. */
const CHUNK_SIZE = 32 * 1024 * 1024;

function serverMessage(err: Error): string {
  const detailed = err as tus.DetailedError;
  const res = detailed.originalResponse;
  const status = res?.getStatus();
  const body = res?.getBody()?.trim();
  if (status === 413) return body || 'Die Datei ist zu groß oder dein Speicherkontingent ist erreicht.';
  if (status === 507) return 'Auf dem Server ist nicht genug Speicherplatz frei.';
  if (status === 429) return body || 'Zu viele gleichzeitige Uploads.';
  if (status === 403) return body || 'Dazu fehlt die Berechtigung.';
  if (status === 401) return 'Bitte melde dich erneut an.';
  if (status === 404 || status === 410) return 'Der Upload ist abgelaufen. Bitte neu starten.';
  return 'Die Verbindung wurde unterbrochen.';
}

/** Startet einen fortsetzbaren Upload; setzt nach Browser-Neustart einen früheren Versuch fort. */
export function startUpload(file: File, onChange: (item: UploadItem) => void): UploadItem {
  const item: UploadItem = {
    file,
    state: 'running',
    sent: 0,
    total: file.size,
    message: '',
    cancel: () => undefined,
  };
  const upload = new tus.Upload(file, {
    endpoint: '/api/uploads',
    chunkSize: CHUNK_SIZE,
    retryDelays: [0, 1000, 3000, 5000, 10000, 20000],
    metadata: { filename: file.name, filetype: file.type || 'application/octet-stream' },
    removeFingerprintOnSuccess: true,
    onProgress(sent, total) {
      item.sent = sent;
      item.total = total;
      onChange(item);
    },
    onSuccess() {
      item.state = 'done';
      item.sent = item.total;
      onChange(item);
    },
    onError(err) {
      item.state = 'error';
      item.message = serverMessage(err);
      onChange(item);
    },
  });
  item.cancel = () => {
    item.state = 'cancelled';
    void upload.abort(true).finally(() => onChange(item));
  };
  void upload.findPreviousUploads().then((previous) => {
    const resumable = previous[0];
    if (resumable) upload.resumeFromPreviousUpload(resumable);
    upload.start();
    onChange(item);
  });
  return item;
}
