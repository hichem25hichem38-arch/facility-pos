import { getDb } from '@/database/db';
import { useAppStore } from '@/app/store/app.store';
import { newId } from '@/utils/helpers';
import type { AuditLog, InventoryTransaction, InventoryTransactionType } from '@/types';

/**
 * Resolved at write time so an operation can never be logged without an actor.
 * The log stores the display name alongside the id: the users table is local to
 * each device and is deliberately not synced.
 */
export function currentActor(): { userId?: string; username?: string } {
  const auth = useAppStore.getState().authUser;
  return auth ? { userId: auth.id, username: auth.displayName } : {};
}

export class AuditService {
  async log(entry: {
    userId?: string;
    username?: string;
    action: string;
    entity: string;
    entityId?: string;
    oldValue?: unknown;
    newValue?: unknown;
  }): Promise<void> {
    const actor = currentActor();
    const log: AuditLog = {
      id: newId(),
      createdAt: Date.now(),
      userId: entry.userId ?? actor.userId,
      username: entry.username ?? actor.username,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      oldValue: entry.oldValue,
      newValue: entry.newValue,
    };
    await getDb().auditLogs.add(log);
  }

  async list(limit = 200): Promise<AuditLog[]> {
    return getDb().auditLogs.orderBy('createdAt').reverse().limit(limit).toArray();
  }
}

export class InventoryService {
  async applyTransaction(tx: {
    productId: string;
    type: InventoryTransactionType;
    quantity: number;
    reason?: string;
    referenceType?: string;
    referenceId?: string;
    createdBy: string;
  }): Promise<number> {
    const db = getDb();
    await db.transaction('rw', db.products, db.inventoryTransactions, async () => {
      const product = await db.products.get(tx.productId);
      if (!product) throw new Error(`Product ${tx.productId} not found`);
      const previousQuantity = product.stockQuantity;
      const newQuantity = previousQuantity + tx.quantity;
      if (newQuantity < 0) throw new Error('INSUFFICIENT_STOCK');
      await db.products.update(product.id, { stockQuantity: newQuantity, updatedAt: Date.now() });
      await db.inventoryTransactions.add({
        id: newId(),
        productId: tx.productId,
        type: tx.type,
        quantity: tx.quantity,
        previousQuantity,
        newQuantity,
        referenceType: tx.referenceType,
        referenceId: tx.referenceId,
        reason: tx.reason,
        createdAt: Date.now(),
        createdBy: tx.createdBy,
      });
    });
    const updated = await db.products.get(tx.productId);
    return updated!.stockQuantity;
  }

  async listTransactions(productId?: string, limit = 200): Promise<InventoryTransaction[]> {
    const table = getDb().inventoryTransactions;
    if (productId) {
      return table.where('[productId+createdAt]').between([productId, 0], [productId, Infinity]).reverse().limit(limit).toArray();
    }
    return table.orderBy('createdAt').reverse().limit(limit).toArray();
  }
}
