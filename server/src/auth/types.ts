export type Role = 'user' | 'admin';
export type UserStatus = 'pending' | 'approved' | 'blocked';

export interface AppUser {
  id: number;
  ldapUid: string;
  displayName: string | null;
  role: Role;
  status: UserStatus;
}

/** Ergebnis einer erfolgreichen Anmeldung beim Verzeichnis. */
export interface DirectoryIdentity {
  loginSub: string;
  name?: string;
}

/**
 * Abstraktion der Anmeldung, damit der Rest ohne LDAP-Server testbar bleibt.
 * Liefert bei Erfolg die Identität, bei falschen Zugangsdaten `null`.
 * Wirft `NotInGroupError`, wenn das Passwort stimmt, die Person aber nicht zur Pflichtgruppe gehört.
 */
export interface Authenticator {
  authenticate(username: string, password: string): Promise<DirectoryIdentity | null>;
}

export interface DirectoryEntry {
  dn: string;
  loginSub: string;
  name: string | undefined;
}

/** Verzeichnissuche für die Admin-Freischaltung. */
export interface DirectorySearch {
  search(query: string, limit?: number): Promise<DirectoryEntry[]>;
}

export class NotInGroupError extends Error {
  override name = 'NotInGroupError';
  constructor(public readonly group: string) {
    super(`Das Konto gehört nicht zur Gruppe „${group}“.`);
  }
}
