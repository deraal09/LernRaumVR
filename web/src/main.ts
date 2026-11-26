import './style.css';
import { getHealth } from './api';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('#app fehlt');

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let value = bytes;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

async function render(root: HTMLElement): Promise<void> {
  root.innerHTML = '<h1>LernRaumVR</h1><p id="status">Verbinde mit dem Server …</p>';
  const status = root.querySelector<HTMLElement>('#status');
  if (!status) return;
  try {
    const h = await getHealth();
    const frei = h.freeBytes === undefined ? '' : `, freier Speicher ${formatBytes(h.freeBytes)}`;
    status.className = h.status === 'ok' ? 'status-ok' : 'status-error';
    status.textContent = `Server ${h.status === 'ok' ? 'erreichbar' : 'mit Fehler'} (Version ${h.version ?? '?'}${frei})`;
  } catch {
    status.className = 'status-error';
    status.textContent = 'Server nicht erreichbar.';
  }
}

void render(app);
