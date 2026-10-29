import { getDb } from '@/database/db';
import { newId, syncMeta } from '@/utils/helpers';
import type { BaseEntity, Syncable } from '@/types';

export abstract class BaseRepository<T extends BaseEntity & Syncable> {
  constructor(protected tableName: string) {}

  protected get table() {
    return getDb().table<T, string>(this.tableName);
  }

  async getById(id: string): Promise<T | undefined> {
    return this.table.get(id);
  }

  async getAll(): Promise<T[]> {
    return this.table.toArray();
  }

  async create(data: Omit<T, 'id' | 'createdAt' | 'updatedAt' | keyof Syncable>): Promise<T> {
    const meta = await syncMeta();
    const entity = { ...data, id: newId(), createdAt: Date.now(), updatedAt: Date.now(), ...meta } as T;
    await this.table.add(entity);
    return entity;
  }

  async update(id: string, changes: Partial<T>): Promise<void> {
    const current = await this.table.get(id);
    await this.table.update(id, {
      ...changes,
      updatedAt: Date.now(),
      version: (current?.version ?? 0) + 1,
    } as import('dexie').UpdateSpec<T>);
  }

  async softDeleteIfSupported(id: string): Promise<void> {
    await this.update(id, { isActive: false } as unknown as Partial<T>);
  }

  async count(): Promise<number> {
    return this.table.count();
  }
}
