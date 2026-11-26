import type { User } from '../api';
import { h } from '../ui';

export function pendingView(user: User, onLogout: () => void, onRefresh: () => void): HTMLElement {
  return h(
    'main',
    { class: 'narrow' },
    h(
      'div',
      { class: 'card' },
      h('h1', {}, 'Freischaltung ausstehend'),
      h(
        'p',
        {},
        `Hallo ${user.displayName ?? user.username}, dein Konto ist angemeldet, aber noch nicht für LernRaumVR freigeschaltet. ` +
          'Bitte wende dich an die Administration. Sobald du freigeschaltet bist, kannst du Inhalte hochladen.',
      ),
      h('div', { class: 'row' }, h('button', { onClick: onRefresh }, 'Erneut prüfen'), h('button', { class: 'secondary', onClick: onLogout }, 'Abmelden')),
    ),
  );
}
