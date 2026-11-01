import Dexie, { type Table } from 'dexie';
import { DEVICE_ID_KEY } from '@/constants';
import type {
  Product, Category, Customer, Sale, SaleItem, InstallmentPlan,
  Installment, Payment, InventoryTransaction, User, UserCredential,
  Role, AuditLog, StoreSettings, SyncTombstone,
} from '@/types';

export class PosDatabase extends Dexie {
  products!: Table<Product, string>;
  categories!: Table<Category, string>;
  customers!: Table<Customer, string>;
  sales!: Table<Sale, string>;
  saleItems!: Table<SaleItem, string>;
  installmentPlans!: Table<InstallmentPlan, string>;
  installments!: Table<Installment, string>;
  payments!: Table<Payment, string>;
  inventoryTransactions!: Table<InventoryTransaction, string>;
  users!: Table<User, string>;
  userCredentials!: Table<UserCredential, string>;
  roles!: Table<Role, string>;
  auditLogs!: Table<AuditLog, string>;
  settings!: Table<StoreSettings, string>;
  syncTombstones!: Table<SyncTombstone, string>;

  constructor() {
    super('installment-pos');
    this.version(1).stores({
      products: 'id, &sku, &barcode, name, categoryId, isActive',
      categories: 'id, &name',
      customers: 'id, &customerNumber, fullName, phone',
      sales: 'id, &invoiceNumber, customerId, saleType, status, saleDate',
      saleItems: 'id, saleId, productId',
      installmentPlans: 'id, &saleId, status',
      installments: 'id, planId, dueDate, status, [planId+status]',
      payments: 'id, saleId, installmentId, paymentDate',
      inventoryTransactions: 'id, productId, createdAt, [productId+createdAt]',
      users: 'id, &username, roleId',
      userCredentials: 'id, &userId',
      roles: 'id, &name',
      auditLogs: 'id, entity, entityId, createdAt, userId',
      settings: '&key',
    });
    // v2: deletions must reach the other devices too.
    this.version(2).stores({
      syncTombstones: 'id, tableName, deletedAt',
    });
  }
}

let _db: PosDatabase | null = null;

export function getDb(): PosDatabase {
  if (!_db) _db = new PosDatabase();
  return _db;
}

export async function getDeviceId(): Promise<string> {
  const row = await getDb().settings.get(DEVICE_ID_KEY);
  if (row && typeof row.value === 'string') return row.value;
  const id = `POS-${crypto.randomUUID().slice(0, 8)}`;
  await getDb().settings.put({ key: DEVICE_ID_KEY, value: id });
  return id;
}
