import { verifyPassword } from '@/utils/crypto';
import { getDb } from '@/database/db';
import type { Permission, User } from '@/types';

export class AuthService {
  async login(username: string, password: string): Promise<User> {
    const db = getDb();
    const user = await db.users.where('username').equals(username).first();
    if (!user || !user.isActive) throw new Error('AUTH_INVALID_CREDENTIALS');
    const credential = await db.userCredentials.where('userId').equals(user.id).first();
    if (!credential) throw new Error('AUTH_INVALID_CREDENTIALS');
    const ok = await verifyPassword(password, credential.salt, credential.passwordHash);
    if (!ok) throw new Error('AUTH_INVALID_CREDENTIALS');
    return user;
  }

  async getPermissions(userId: string): Promise<Permission[]> {
    const db = getDb();
    const user = await db.users.get(userId);
    if (!user) return [];
    const role = await db.roles.get(user.roleId);
    return role?.permissions ?? [];
  }

  async hasPermission(userId: string, permission: Permission): Promise<boolean> {
    const perms = await this.getPermissions(userId);
    return perms.includes(permission);
  }
}
