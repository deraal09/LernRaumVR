import { InvalidCredentialsError, type Entry } from 'ldapts';
import { describe, expect, it } from 'vitest';
import {
  escapeFilter,
  LdapAuthenticator,
  LdapDirectorySearch,
  ldapConfigFromEnv,
  type LdapClient,
  type LdapConfig,
} from '../src/auth/ldap.js';
import { NotInGroupError } from '../src/auth/types.js';

const base: LdapConfig = {
  url: 'ldaps://ad.example',
  baseDn: 'DC=schule,DC=local',
  bindDn: 'CN=svc',
  bindPassword: 'svc-pw',
  userFilter: '(sAMAccountName={{username}})',
  loginAttr: 'sAMAccountName',
  nameAttr: 'displayName',
  teacherSearchFilter: '(cn=*{{query}}*)',
  requiredGroup: '',
};

interface Fake {
  client: LdapClient;
  binds: Array<[string, string]>;
  searches: Array<{ base: string; filter: string }>;
}

/** Minimales Verzeichnis: ein Benutzer „anna“, Passwort „pw“, Mitglied der Gruppe, falls `member`. */
function fakeDirectory(opts: { member?: boolean; groupCount?: number } = {}): () => Fake['client'] & { log: Fake } {
  const log: Fake = { client: undefined as unknown as LdapClient, binds: [], searches: [] };
  return () => {
    const client: LdapClient & { log: Fake } = {
      log,
      async bind(dn, password) {
        log.binds.push([dn, password]);
        const ok =
          (dn === 'CN=svc' && password === 'svc-pw') ||
          (dn === 'CN=Anna,OU=U,DC=schule,DC=local' && password === 'pw') ||
          (dn === 'SCHULE\\anna' && password === 'pw');
        if (!ok) throw new InvalidCredentialsError({ message: 'bad' } as never);
      },
      async unbind() {},
      async search(b, o) {
        log.searches.push({ base: b, filter: o.filter });
        if (o.filter.includes('objectClass=group')) {
          return { searchEntries: Array.from({ length: opts.groupCount ?? 1 }, () => ({ dn: 'CN=AAD-LUL,OU=G,DC=schule,DC=local' }) as Entry) };
        }
        if (o.filter.includes('memberOf:')) {
          return { searchEntries: opts.member ? [{ dn: b } as Entry] : [] };
        }
        if (o.filter.includes('sAMAccountName=anna')) {
          return {
            searchEntries: [
              { dn: 'CN=Anna,OU=U,DC=schule,DC=local', sAMAccountName: 'anna', displayName: 'Anna A.' } as unknown as Entry,
            ],
          };
        }
        return { searchEntries: [] };
      },
    };
    return client;
  };
}

describe('escapeFilter', () => {
  it('maskiert Sonderzeichen nach RFC 4515', () => {
    expect(escapeFilter('a*b(c)d\\e f')).toBe('a\\2ab\\28c\\29d\\5ce\\20f');
    expect(escapeFilter('*)(uid=*')).not.toMatch(/[*()]/);
  });
});

describe('ldapConfigFromEnv', () => {
  it('liefert null ohne LDAP_URL und verlangt sonst die Pflichtfelder', () => {
    expect(ldapConfigFromEnv({})).toBeNull();
    expect(() => ldapConfigFromEnv({ LDAP_URL: 'ldaps://x' })).toThrow(/LDAP_BASE_DN/);
    const cfg = ldapConfigFromEnv({
      LDAP_URL: 'ldaps://x', LDAP_BASE_DN: 'DC=a', LDAP_BIND_DN: 'CN=s', LDAP_BIND_PW: 'p', LDAP_REQUIRED_GROUP: ' AAD-LUL ',
    });
    expect(cfg?.requiredGroup).toBe('AAD-LUL');
    expect(cfg?.userFilter).toBe('(sAMAccountName={{username}})');
  });

  it('braucht im Direkt-Modus kein Service-Konto', () => {
    const cfg = ldapConfigFromEnv({ LDAP_URL: 'ldaps://x', LDAP_BASE_DN: 'DC=a', LDAP_BIND_USER_TEMPLATE: 'SCHULE\\{{username}}' });
    expect(cfg?.userBindTemplate).toBe('SCHULE\\{{username}}');
    expect(cfg?.bindDn).toBe('');
  });
});

describe('LdapAuthenticator (Service-Modus)', () => {
  it('meldet mit richtigem Passwort an', async () => {
    const factory = fakeDirectory();
    const auth = new LdapAuthenticator(base, factory);
    expect(await auth.authenticate('anna', 'pw')).toEqual({ loginSub: 'anna', name: 'Anna A.' });
  });

  it('liefert null bei falschem Passwort oder unbekanntem Konto', async () => {
    const auth = new LdapAuthenticator(base, fakeDirectory());
    expect(await auth.authenticate('anna', 'falsch')).toBeNull();
    expect(await auth.authenticate('niemand', 'pw')).toBeNull();
    expect(await auth.authenticate('anna', '')).toBeNull();
  });

  it('maskiert den Benutzernamen im Suchfilter', async () => {
    const client = fakeDirectory()();
    const auth = new LdapAuthenticator(base, () => client);
    await auth.authenticate('*)(uid=*', 'x');
    expect(client.log.searches[0]!.filter).toBe('(sAMAccountName=\\2a\\29\\28uid=\\2a)');
  });

  it('verlangt die Pflichtgruppe, prüft sie aber erst nach dem Passwort', async () => {
    const cfg = { ...base, requiredGroup: 'AAD-LUL' };
    await expect(new LdapAuthenticator(cfg, fakeDirectory({ member: false })).authenticate('anna', 'pw')).rejects.toBeInstanceOf(NotInGroupError);
    // falsches Passwort verrät nichts über die Gruppe
    expect(await new LdapAuthenticator(cfg, fakeDirectory({ member: false })).authenticate('anna', 'falsch')).toBeNull();
    expect(await new LdapAuthenticator(cfg, fakeDirectory({ member: true })).authenticate('anna', 'pw')).toEqual({ loginSub: 'anna', name: 'Anna A.' });
  });

  it('meldet eine mehrdeutige Gruppe als Konfigurationsfehler', async () => {
    const cfg = { ...base, requiredGroup: 'AAD-LUL' };
    await expect(new LdapAuthenticator(cfg, fakeDirectory({ member: true, groupCount: 2 })).authenticate('anna', 'pw')).rejects.toThrow(/nicht eindeutig/);
  });

  it('meldet einen falschen Service-Konto-Bind als Konfigurationsfehler', async () => {
    const auth = new LdapAuthenticator({ ...base, bindPassword: 'falsch' }, fakeDirectory());
    await expect(auth.authenticate('anna', 'pw')).rejects.toThrow(/LDAP_BIND_DN/);
  });
});

describe('LdapAuthenticator (Direkt-Modus)', () => {
  const direct = { ...base, bindDn: '', bindPassword: '', userBindTemplate: 'SCHULE\\{{username}}' };

  it('bindet mit der Vorlage und liest den Namen', async () => {
    expect(await new LdapAuthenticator(direct, fakeDirectory()).authenticate('anna', 'pw')).toEqual({ loginSub: 'anna', name: 'Anna A.' });
    expect(await new LdapAuthenticator(direct, fakeDirectory()).authenticate('anna', 'falsch')).toBeNull();
  });

  it('prüft die Pflichtgruppe auch im Direkt-Modus', async () => {
    const cfg = { ...direct, requiredGroup: 'AAD-LUL' };
    await expect(new LdapAuthenticator(cfg, fakeDirectory({ member: false })).authenticate('anna', 'pw')).rejects.toBeInstanceOf(NotInGroupError);
    expect(await new LdapAuthenticator(cfg, fakeDirectory({ member: true })).authenticate('anna', 'pw')).toBeTruthy();
  });
});

describe('LdapDirectorySearch', () => {
  it('verlangt ein Service-Konto', async () => {
    await expect(new LdapDirectorySearch({ ...base, bindDn: '', bindPassword: '' }, fakeDirectory()).search('an')).rejects.toThrow(/Service-Konto/);
  });

  it('schränkt auf die Pflichtgruppe ein', async () => {
    const client = fakeDirectory({ member: true })();
    await new LdapDirectorySearch({ ...base, requiredGroup: 'AAD-LUL' }, () => client).search('an');
    const filter = client.log.searches.at(-1)!.filter;
    expect(filter).toContain('1.2.840.113556.1.4.1941');
    expect(filter.startsWith('(&(cn=*an*)')).toBe(true);
  });
});
