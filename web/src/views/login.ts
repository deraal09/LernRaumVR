import { login, type User } from '../api';
import { errorMessage } from '../messages';
import { h } from '../ui';

export function loginView(onLoggedIn: (user: User) => void): HTMLElement {
  const error = h('p', { class: 'error', role: 'alert' });
  const username = h('input', { id: 'username', name: 'username', autocomplete: 'username', required: true });
  const password = h('input', {
    id: 'password', name: 'password', type: 'password', autocomplete: 'current-password', required: true,
  });
  const button = h('button', { type: 'submit' }, 'Anmelden');

  const form = h(
    'form',
    {
      class: 'card',
      onSubmit: (e) => {
        e.preventDefault();
        error.textContent = '';
        button.disabled = true;
        login(username.value, password.value)
          .then(({ user }) => onLoggedIn(user))
          .catch((err: unknown) => {
            error.textContent = errorMessage(err);
            password.value = '';
            button.disabled = false;
          });
      },
    },
    h('h1', {}, 'LernRaumVR'),
    h('p', { class: 'muted' }, 'Anmeldung mit deinem Schulkonto'),
    h('label', { for: 'username' }, 'Benutzername'),
    username,
    h('label', { for: 'password' }, 'Passwort'),
    password,
    error,
    button,
  );
  return h('main', { class: 'narrow' }, form);
}
