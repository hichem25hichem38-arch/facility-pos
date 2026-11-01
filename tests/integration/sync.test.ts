import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { getDb } from '@/database/db';
import { BackupService, type BackupPayload } from '@/services/backup/backup.service';
import { LanSyncService } from '@/services/sync/lan-sync.service';
import { registerSyncWatch } from '@/services/sync/sync.service';
import { isLocalWriteSuppressed, markLocalWrite, registerSyncPusher, withSuppressedLocalWrites } from '@/services/sync/sync-state';
import type { Category, Customer, Installment, InstallmentPlan, InventoryTransaction, Payment, Product, Sale, SaleItem } from '@/types';

const db = getDb();
const uid = () => crypto.randomUUID();
const now = Date.now();

const snapshot = (tables: Record<string, unknown[]>): BackupPayload => ({
  appVersion: 'test',
  exportedAt: now,
  tables,
});

const product = (over: Partial<Product> = {}): Product => ({
  id: uid(), sku: `SKU-${uid().slice(0, 6)}`, barcode: `${Math.floor(Math.random() * 1e12)}`,
  name: 'Produit', description: '', purchasePrice: 100, sellingPrice: 200,
  stockQuantity: 5, minimumStock: 1, isActive: true,
  createdAt: now, updatedAt: now, syncStatus: 'LOCAL', version: 1, deviceId: 'PHONE',
  ...over,
});

const sale = (over: Partial<Sale> = {}): Sale => ({
  id: uid(), invoiceNumber: `FAC-${uid().slice(0, 6)}`, saleType: 'CASH', subtotal: 200, discount: 0,
  totalAmount: 200, paidAmount: 200, remainingAmount: 0, status: 'PAID', saleDate: now,
  createdAt: now, updatedAt: now, syncStatus: 'LOCAL', version: 1, deviceId: 'PHONE',
  ...over,
});

const lan = new LanSyncService();

/** Tombstones are written on the next macrotask, after the row transaction. */
const settle = () => new Promise((r) => setTimeout(r, 20));

beforeAll(async () => {
  await db.open();
  registerSyncWatch(db);
});

afterAll(() => {
  vi.useRealTimers();
});

describe('LAN snapshot import', () => {
  it('stores rows of every page, not only products', async () => {
    const cat: Category = { id: uid(), name: `cat-${uid().slice(0, 6)}`, createdAt: now, updatedAt: now, syncStatus: 'LOCAL', version: 1, deviceId: 'PHONE' };
    const cust: Customer = { id: uid(), customerNumber: `CL-${uid().slice(0, 6)}`, fullName: 'Karim', createdAt: now, updatedAt: now, syncStatus: 'LOCAL', version: 1, deviceId: 'PHONE' };
    const p = product();
    const s = sale({ customerId: cust.id });
    const item: SaleItem = { id: uid(), saleId: s.id, productId: p.id, quantity: 1, unitPrice: 200, total: 200 };
    const plan: InstallmentPlan = {
      id: uid(), saleId: uid(), numberOfInstallments: 3, totalAmount: 300, downPayment: 100,
      financedAmount: 200, installmentAmount: 100, startDate: now, frequency: 'MONTHLY', status: 'PENDING',
      createdAt: now, updatedAt: now, syncStatus: 'LOCAL', version: 1, deviceId: 'PHONE',
    };
    const inst: Installment = { id: uid(), planId: plan.id, installmentNumber: 1, dueDate: now, amountDue: 100, amountPaid: 0, remainingAmount: 100, status: 'PENDING' };
    const pay: Payment = {
      id: uid(), saleId: s.id, amount: 200, paymentMethod: 'CASH', paymentDate: now, status: 'ACTIVE',
      createdAt: now, updatedAt: now, syncStatus: 'LOCAL', version: 1, deviceId: 'PHONE',
    };
    const move: InventoryTransaction = { id: uid(), productId: p.id, type: 'SALE', quantity: 1, previousQuantity: 5, newQuantity: 4, createdAt: now, createdBy: 'u' };

    await lan.importSnapshot(snapshot({
      categories: [cat], customers: [cust], products: [p], sales: [s], saleItems: [item],
      installmentPlans: [plan], installments: [inst], payments: [pay], inventoryTransactions: [move],
    }));

    await expect(db.categories.get(cat.id)).resolves.toMatchObject({ id: cat.id });
    await expect(db.customers.get(cust.id)).resolves.toMatchObject({ fullName: 'Karim' });
    await expect(db.products.get(p.id)).resolves.toMatchObject({ name: 'Produit' });
    await expect(db.sales.get(s.id)).resolves.toMatchObject({ totalAmount: 200 });
    await expect(db.saleItems.get(item.id)).resolves.toMatchObject({ saleId: s.id });
    await expect(db.installmentPlans.get(plan.id)).resolves.toMatchObject({ numberOfInstallments: 3 });
    await expect(db.installments.get(inst.id)).resolves.toMatchObject({ planId: plan.id });
    await expect(db.payments.get(pay.id)).resolves.toMatchObject({ amount: 200 });
    await expect(db.inventoryTransactions.get(move.id)).resolves.toMatchObject({ type: 'SALE' });
  });

  it('keeps the newer local version of a row', async () => {
    const p = product({ updatedAt: 5000, name: 'LOCAL' });
    await db.products.add(p);

    await lan.importSnapshot(snapshot({ products: [product({ id: p.id, updatedAt: 1000, name: 'PEER OLD' })] }));
    await expect(db.products.get(p.id)).resolves.toMatchObject({ name: 'LOCAL' });

    await lan.importSnapshot(snapshot({ products: [product({ id: p.id, updatedAt: 9000, name: 'PEER NEW' })] }));
    await expect(db.products.get(p.id)).resolves.toMatchObject({ name: 'PEER NEW' });
  });

  it('replaces child rows that carry no timestamp (installments, stock moves)', async () => {
    const plan: InstallmentPlan = {
      id: uid(), saleId: uid(), numberOfInstallments: 2, totalAmount: 200, downPayment: 0,
      financedAmount: 200, installmentAmount: 100, startDate: now, frequency: 'MONTHLY', status: 'PENDING',
      createdAt: now, updatedAt: now, syncStatus: 'LOCAL', version: 1, deviceId: 'DESKTOP',
    };
    const inst: Installment = { id: uid(), planId: plan.id, installmentNumber: 1, dueDate: now, amountDue: 100, amountPaid: 0, remainingAmount: 100, status: 'PENDING' };
    await db.installmentPlans.add(plan);
    await db.installments.add(inst);

    await lan.importSnapshot(snapshot({ installments: [{ ...inst, amountPaid: 100, remainingAmount: 0, status: 'PAID' }] }));
    await expect(db.installments.get(inst.id)).resolves.toMatchObject({ amountPaid: 100, status: 'PAID' });
  });

  it('ignores accounts and device-local licence settings', async () => {
    await lan.importSnapshot(snapshot({
      users: [{ id: uid(), username: 'evil', displayName: 'Evil', credentialId: '', roleId: 'role-ADMIN', isActive: true, createdAt: now, updatedAt: now }],
      settings: [
        { key: 'licenseKey', value: 'EVIL' },
        { key: 'deviceId', value: 'EVIL' },
        { key: 'storeName', value: 'Store from peer' },
      ],
    }));
    await expect(db.users.where('username').equals('evil').count()).resolves.toBe(0);
    expect((await db.settings.get('licenseKey'))?.value).not.toBe('EVIL');
    expect((await db.settings.get('deviceId'))?.value).not.toBe('EVIL');
    await expect(db.settings.get('storeName')).resolves.toMatchObject({ value: 'Store from peer' });
  });

  it('replays a peer hard delete and keeps a later local rewrite', async () => {
    const cat: Category = { id: uid(), name: `doomed-${uid().slice(0, 6)}`, createdAt: now, updatedAt: now, syncStatus: 'LOCAL', version: 1, deviceId: 'DESKTOP' };
    await db.categories.add(cat);

    await lan.importSnapshot(snapshot({
      // a relay snapshot still carries the row it just lost: the tombstone wins
      categories: [cat],
      syncTombstones: [{ id: `categories:${cat.id}`, tableName: 'categories', rowId: cat.id, deletedAt: now }],
    }));
    await settle();

    await expect(db.categories.get(cat.id)).resolves.toBeUndefined();
    await expect(db.syncTombstones.get(`categories:${cat.id}`)).resolves.toMatchObject({ rowId: cat.id });

    // re-creating the row locally forgets its deletion
    await db.categories.add({ ...cat, name: `${cat.name}-again` });
    await settle();
    await expect(db.syncTombstones.get(`categories:${cat.id}`)).resolves.toBeUndefined();
  });

  it('never treats a peer import as a local edit', async () => {
    const pusher = vi.fn();
    registerSyncPusher(pusher);
    const p = product();

    await withSuppressedLocalWrites(async () => {
      expect(isLocalWriteSuppressed()).toBe(true);
      await lan.importSnapshot(snapshot({ products: [p] }));
    });

    expect(isLocalWriteSuppressed()).toBe(false);
    expect(pusher).not.toHaveBeenCalled();
    await expect(db.products.get(p.id)).resolves.toMatchObject({ id: p.id });
    await db.products.delete(p.id);
  });

  it('debounces local writes into a single push', async () => {
    const pusher = vi.fn();
    registerSyncPusher(pusher);
    const a = product();
    const b = product();

    await db.products.add(a);
    await db.products.add(b);
    markLocalWrite(15);
    markLocalWrite(15);

    await new Promise((r) => setTimeout(r, 60));
    expect(pusher).toHaveBeenCalledTimes(1);

    await db.products.delete(a.id);
    await db.products.delete(b.id);
  });

  it('leaves a tombstone for every hard delete made on this device', async () => {
    const p = product();
    await db.products.add(p);
    await db.products.delete(p.id);
    await settle();

    await expect(db.syncTombstones.get(`products:${p.id}`)).resolves.toMatchObject({ tableName: 'products', rowId: p.id });
  });
});

describe('sync payload scope', () => {
  it('carries every business table and no credentials', async () => {
    const payload = await new BackupService().createSyncPayload();
    for (const table of ['products', 'categories', 'customers', 'sales', 'saleItems', 'installmentPlans', 'installments', 'payments', 'inventoryTransactions', 'auditLogs', 'settings', 'syncTombstones']) {
      expect(payload.tables).toHaveProperty(table);
    }
    expect(payload.tables).not.toHaveProperty('users');
    expect(payload.tables).not.toHaveProperty('userCredentials');
    expect(payload.tables).not.toHaveProperty('roles');
  });
});
