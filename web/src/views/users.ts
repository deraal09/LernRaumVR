import { getUsers, ldapSearch, patchUser, preApprove, type AdminUser } from '../api';
import { errorMessage } from '../messages';
import { formatBytes, formatDate, h, replaceChildren } from '../ui';

const STATUS: Record<AdminUser['status'], string> = { pending: 'Wartet auf Freischaltung', approved: 'Freigeschaltet', blocked: 'Gesperrt' };

export function usersView(): HTMLElement {
  const body = h('tbody');
  const message = h('p', { class: 'error', role: 'alert' });
  const results = h('ul', { class: 'results' });

  const fail = (err: unknown): void => { message.textContent = errorMessage(err); };

  async function refresh(): Promise<void> {
    try {
      const { users } = await getUsers();
      message.textContent = '';
      replaceChildren(
        body,
        ...users.map((u) =>
          h(
            'tr',
            { class: u.status },
            h('td', {}, h('strong', {}, u.displayName ?? u.ldapUid), h('div', { class: 'muted small' }, u.ldapUid + (u.role === 'admin' ? ' · Admin' : ''))),
            h('td', {}, h('span', { class: `badge ${u.status}` }, STATUS[u.status])),
            h('td', { class: 'num' }, formatBytes(u.usedBytes) + (u.quotaBytes !== null ? ` / ${formatBytes(u.quotaBytes)}` : '')),
            h('td', {}, u.lastLoginAt ? formatDate(u.lastLoginAt) : '–'),
            h('td', {}, h('div', { class: 'row' },
              u.status !== 'approved' ? h('button', { class: 'small', onClick: () => void patchUser(u.id, { status: 'approved' }).then(refresh, fail) }, 'Freischalten') : null,
              u.status !== 'blocked' && u.role !== 'admin' ? h('button', { class: 'danger small', onClick: () => void patchUser(u.id, { status: 'blocked' }).then(refresh, fail) }, 'Sperren') : null,
              h('button', { class: 'secondary small', onClick: () => {
                const raw = prompt('Speicherkontingent in GB (leer = Standard, 0 = keine Uploads):', u.quotaBytes === null ? '' : String(u.quotaBytes / 1024 ** 3));
                if (raw === null) return;
                const gb = raw.trim() === '' ? null : Number(raw.replace(',', '.'));
                if (gb !== null && (!Number.isFinite(gb) || gb < 0)) { message.textContent = 'Bitte eine Zahl eingeben.'; return; }
                void patchUser(u.id, { quotaBytes: gb === null ? null : Math.round(gb * 1024 ** 3) }).then(refresh, fail);
              } }, 'Kontingent'),
            )),
          ),
        ),
      );
    } catch (err) { fail(err); }
  }

  const query = h('input', { type: 'search', placeholder: 'Name im Schulverzeichnis suchen …', 'aria-label': 'Verzeichnissuche' });
  const search = h('form', { class: 'row', onSubmit: (e) => {
    e.preventDefault();
    ldapSearch(query.value).then(({ results: found }) => {
      message.textContent = '';
      replaceChildren(results, ...(found.length === 0 ? [h('li', { class: 'muted' }, 'Keine Treffer.')] : found.map((r) =>
        h('li', { class: 'row space' }, h('span', {}, `${r.displayName ?? r.username} (${r.username})`),
          h('button', { class: 'small', type: 'button', onClick: () => void preApprove(r.username, r.displayName ?? undefined).then(() => { replaceChildren(results); query.value = ''; return refresh(); }, fail) }, 'Freischalten')))));
    }, fail);
  } }, query, h('button', { type: 'submit', class: 'secondary' }, 'Suchen'));

  const element = h(
    'section',
    {},
    h('h2', {}, 'Benutzer'),
    h('p', { class: 'muted' }, 'Wer sich mit dem Schulkonto anmeldet, erscheint hier und wartet auf Freischaltung. Admins werden über die Serverkonfiguration (ADMIN_USERS) festgelegt.'),
    search,
    results,
    message,
    h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Status'), h('th', { class: 'num' }, 'Speicher'), h('th', {}, 'Letzte Anmeldung'), h('th', {}))), body),
  );
  void refresh();
  return element;
}
