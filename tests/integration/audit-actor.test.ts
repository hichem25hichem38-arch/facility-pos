import '../helpers/memory-storage';
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { getDb } from '@/database/db';
import { AuditService, currentActor } from '@/services/operations.service';
import { useAppStore } from '@/app/store/app.store';
import type { AuditLog } from '@/types';

const actor = { id: 'user-1', username: 'sofiane', displayName: 'سفيان', roleId: 'role-1' };

async function newest(entityId: string): Promise<AuditLog | undefined> {
  return getDb().auditLogs.where('entityId').equals(entityId).first();
}

describe('audit log actor attribution', () => {
  const service = new AuditService();

  beforeAll(() => getDb().open());
  afterEach(() => useAppStore.getState().setAuth(null, []));

  it('signs the signed-in user onto entries the caller left anonymous', async () => {
    useAppStore.getState().setAuth(actor, []);
    await service.log({ action: 'CREATE_CUSTOMER', entity: 'Customer', entityId: 'cust-anon' });
    expect(await newest('cust-anon')).toMatchObject({ userId: actor.id, username: actor.displayName });
  });

  it('keeps the actor supplied by the caller', async () => {
    useAppStore.getState().setAuth(actor, []);
    await service.log({ action: 'LOGIN', entity: 'Session', entityId: 'sess-explicit', userId: 'other', username: 'Other' });
    expect(await newest('sess-explicit')).toMatchObject({ userId: 'other', username: 'Other' });
  });

  it('does not invent an actor when nobody is signed in', async () => {
    await service.log({ action: 'LOGOUT', entity: 'Session', entityId: 'sess-none' });
    const row = await newest('sess-none');
    expect(row?.userId).toBeUndefined();
    expect(row?.username).toBeUndefined();
    expect(currentActor()).toEqual({});
  });
});
