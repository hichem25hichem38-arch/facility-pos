import { hashPassword } from '@/utils/crypto';
import { getDb } from '@/database/db';
import { ROLE_PERMISSIONS } from '@/constants';
import { newId } from '@/utils/helpers';
import type { Role, User, UserCredential } from '@/types';
import type { Locale } from '@/i18n';

export interface SettingsData {
  storeName: string;
  storePhone: string;
  storeAddress: string;
  storeEmail: string;
  currency: string;
  defaultInstallments: number;
  locale: Locale;
  darkMode: boolean;
  storeLogo?: string;
}

const DEFAULT_SETTINGS: SettingsData = {
  storeName: 'متجري',
  storePhone: '',
  storeAddress: '',
  storeEmail: '',
  currency: 'DZD',
  defaultInstallments: 12,
  locale: 'ar',
  darkMode: false,
  storeLogo: '',
};

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof SettingsData)[];

export class SettingsService {
  private db = getDb();

  async get(): Promise<SettingsData> {
    const rows = await this.db.settings.bulkGet(SETTING_KEYS as string[]);
    const data: Partial<SettingsData> = {};
    rows.forEach((row, i) => {
      if (!row || row.value === undefined) return;
      Object.assign(data, { [SETTING_KEYS[i]]: row.value });
    });
    return { ...DEFAULT_SETTINGS, ...data };
  }

  async update(changes: Partial<SettingsData>): Promise<void> {
    for (const [key, value] of Object.entries(changes)) {
      await this.db.settings.put({ key, value });
    }
  }
}

export class UserService {
  private db = getDb();

  async ensureDefaults(): Promise<void> {
    await this.removeLegacyClientAccount();

    const flag = await this.db.settings.get('seeded-users');
    if (flag?.value === true) return;
    await this.db.settings.put({ key: 'seeded-users', value: true });

    const roles: Role[] = ['ADMIN', 'MANAGER', 'CASHIER'].map((name) => ({
      id: `role-${name}`, name, permissions: ROLE_PERMISSIONS[name],
    }));
    await this.db.roles.bulkPut(roles);
    const adminRole = roles[0];

    const userId = 'user-admin';
    const user: User = {
      id: userId, username: 'admin', displayName: 'Administrator',
      credentialId: '', roleId: adminRole.id, isActive: true,
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    await this.db.users.put(user);

    const { salt, passwordHash } = await hashPassword('admin123');
    const credential: UserCredential = {
      id: 'cred-admin', userId, salt, passwordHash,
    };
    user.credentialId = credential.id;
    await this.db.users.update(userId, { credentialId: credential.id });
    await this.db.userCredentials.put(credential);

    // cashier demo account
    const cashierId = 'user-cashier';
    const cashierUser: User = {
      id: cashierId, username: 'caissier', displayName: 'Cashier',
      credentialId: '', roleId: roles[2].id, isActive: true,
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    await this.db.users.put(cashierUser);
    const c2 = await hashPassword('cashier123');
    const credential2: UserCredential = {
      id: 'cred-cashier', userId: cashierId, salt: c2.salt, passwordHash: c2.passwordHash,
    };
    await this.db.userCredentials.put(credential2);
    await this.db.users.update(cashierId, { credentialId: credential2.id });
  }

  /**
   * Removes the "client" account that older builds seeded with an admin role
   * and a known password. It is a full-access backdoor, so it must not survive.
   */
  private async removeLegacyClientAccount(): Promise<void> {
    const legacy = await this.db.users.get('user-client');
    if (!legacy || legacy.username !== 'client') return;
    await this.db.userCredentials.where('userId').equals('user-client').delete();
    await this.db.users.delete('user-client');
  }

  async list(): Promise<User[]> {
    return this.db.users.toArray();
  }

  async listRoles(): Promise<Role[]> {
    return this.db.roles.toArray();
  }

  async createUser(input: {
    username: string; password: string; displayName: string; roleId: string;
  }): Promise<User> {
    const exists = await this.db.users.where('username').equals(input.username).first();
    if (exists) throw new Error('USERNAME_TAKEN');
    const userId = newId();
    const { salt, passwordHash } = await hashPassword(input.password);
    const credential: UserCredential = { id: newId(), userId, salt, passwordHash };
    const user: User = {
      id: userId, username: input.username, displayName: input.displayName,
      credentialId: credential.id, roleId: input.roleId, isActive: true,
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    await this.db.users.put(user);
    await this.db.userCredentials.put(credential);
    return user;
  }

  async setUserActive(userId: string, active: boolean): Promise<void> {
    await this.db.users.update(userId, { isActive: active, updatedAt: Date.now() });
  }

  async updateUser(userId: string, changes: { displayName?: string; roleId?: string; password?: string }): Promise<void> {
    const user = await this.db.users.get(userId);
    if (!user) throw new Error('USER_NOT_FOUND');
    const upd: Partial<User> = { updatedAt: Date.now() };
    if (changes.displayName) upd.displayName = changes.displayName;
    if (changes.roleId) upd.roleId = changes.roleId;
    await this.db.users.update(userId, upd);
    if (changes.password) {
      const { salt, passwordHash } = await hashPassword(changes.password);
      const cred = await this.db.userCredentials.where('userId').equals(userId).first();
      if (cred) await this.db.userCredentials.update(cred.id, { salt, passwordHash });
      else await this.db.userCredentials.add({ id: newId(), userId, salt, passwordHash });
    }
  }

  async deleteUser(userId: string): Promise<void> {
    if (userId === 'user-admin') throw new Error('CANNOT_DELETE_ADMIN');
    const count = await this.db.users.count();
    if (count <= 1) throw new Error('CANNOT_DELETE_LAST_USER');
    await this.db.users.delete(userId);
    const cred = await this.db.userCredentials.where('userId').equals(userId).first();
    if (cred) await this.db.userCredentials.delete(cred.id);
  }
}
