import { ApiError } from './api';

const MESSAGES: Record<string, string> = {
  invalid_credentials: 'Benutzername oder Passwort ist falsch.',
  not_in_group: 'Dein Konto gehört nicht zur Gruppe der Lehrkräfte und darf LernRaumVR nicht nutzen.',
  blocked: 'Dein Zugang wurde gesperrt. Bitte wende dich an die Administration.',
  ldap_error: 'Die Anmeldung beim Schulverzeichnis ist gerade nicht möglich. Bitte später erneut versuchen.',
  ldap_not_configured: 'Die Anmeldung ist auf dem Server noch nicht eingerichtet.',
  unauthorized: 'Bitte melde dich an.',
  forbidden: 'Dazu fehlt die Berechtigung.',
  open_transfers: 'Die Datei wird gerade an Brillen gesendet und kann noch nicht gelöscht werden.',
  uploading: 'Die Datei wird noch hochgeladen. Bitte den Upload abbrechen.',
  query_too_short: 'Bitte mindestens 2 Zeichen eingeben.',
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'rate_limited') {
      return `Zu viele Versuche. Bitte in ${String(err.data['retryAfter'] ?? 30)} Sekunden erneut versuchen.`;
    }
    return MESSAGES[err.code] ?? `Fehler (${err.status}).`;
  }
  return 'Server nicht erreichbar.';
}
