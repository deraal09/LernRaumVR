import './style.css';
import { ApiError, getMe, logout, type User } from './api';
import { h, replaceChildren } from './ui';
import { libraryView } from './views/library';
import { devicesView } from './views/devices';
import { loginView } from './views/login';
import { pendingView } from './views/pending';
import { transfersView } from './views/transfers';
import { usersView } from './views/users';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('#app fehlt');

let dispose: (() => void) | undefined;

function show(...nodes: Array<Node | null>): void {
  dispose?.();
  dispose = undefined;
  replaceChildren(root!, ...nodes);
}

async function signOut(): Promise<void> {
  await logout().catch(() => undefined);
  showLogin();
}

function showLogin(): void {
  show(loginView((user) => showApp(user)));
}

function showApp(user: User): void {
  if (user.status !== 'approved') {
    show(pendingView(user, () => void signOut(), () => void start()));
    return;
  }
  type Tab = 'library' | 'devices' | 'transfers' | 'users';
  let tab: Tab = 'library';
  const content = h('div');
  const nav = h('nav', { class: 'tabs' });

  function render(): void {
    dispose?.();
    dispose = undefined;
    const tabs: Array<[Tab, string]> = [['library', 'Bibliothek'], ['devices', 'Brillen'], ['transfers', 'Übertragungen']];
    if (user.role === 'admin') tabs.push(['users', 'Benutzer']);
    replaceChildren(nav, ...tabs.map(([id, label]) =>
      h('button', { class: id === tab ? 'tab active' : 'tab', onClick: () => { tab = id; render(); } }, label)));
    if (tab === 'library') {
      const view = libraryView(user);
      dispose = view.dispose;
      replaceChildren(content, view.element);
    } else if (tab === 'devices') {
      const view = devicesView(user);
      dispose = view.dispose;
      replaceChildren(content, view.element);
    } else if (tab === 'transfers') {
      const view = transfersView();
      dispose = view.dispose;
      replaceChildren(content, view.element);
    } else {
      replaceChildren(content, usersView());
    }
  }

  const header = h(
    'header',
    { class: 'topbar' },
    h('strong', {}, 'LernRaumVR'),
    nav,
    h('span', { class: 'row' }, h('span', { class: 'muted' }, user.displayName ?? user.username),
      h('button', { class: 'secondary small', onClick: () => void signOut() }, 'Abmelden')),
  );
  show(header, h('main', {}, content));
  render();
}

async function start(): Promise<void> {
  try {
    const { user } = await getMe();
    showApp(user);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) showLogin();
    else show(h('main', { class: 'narrow' }, h('p', { class: 'error' }, 'Server nicht erreichbar.')));
  }
}

void start();
