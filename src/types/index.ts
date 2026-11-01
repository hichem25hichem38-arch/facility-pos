export interface BaseEntity {
  id: string;
  createdAt: number;
  updatedAt: number;
}

export type SyncStatus = 'LOCAL' | 'PENDING' | 'SYNCED' | 'FAILED' | 'CONFLICT';

export interface Syncable {
  syncStatus: SyncStatus;
  version: number;
  deviceId: string;
}

export type SaleType = 'CASH' | 'INSTALLMENT';
export type SaleStatus = 'PAID' | 'PARTIALLY_PAID' | 'PENDING' | 'OVERDUE' | 'CANCELLED';
export type InstallmentStatus = 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE' | 'CANCELLED';
export type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'CHECK' | 'CARD';
export type Frequency = 'MONTHLY';

export interface Product extends BaseEntity, Syncable {
  sku: string;
  barcode: string;
  name: string;
  description?: string;
  categoryId?: string;
  purchasePrice: number;
  sellingPrice: number;
  stockQuantity: number;
  minimumStock: number;
  isActive: boolean;
  image?: string;
}

export interface Category extends BaseEntity, Syncable {
  name: string;
  description?: string;
}

export interface Customer extends BaseEntity, Syncable {
  customerNumber: string;
  fullName: string;
  phone?: string;
  address?: string;
  nationalId?: string;
  notes?: string;
}

export interface Sale extends BaseEntity, Syncable {
  invoiceNumber: string;
  customerId?: string;
  saleType: SaleType;
  subtotal: number;
  discount: number;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: SaleStatus;
  saleDate: number;
}

export interface SaleItem {
  id: string;
  saleId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface InstallmentPlan extends BaseEntity, Syncable {
  saleId: string;
  numberOfInstallments: number;
  totalAmount: number;
  downPayment: number;
  financedAmount: number;
  installmentAmount: number;
  startDate: number;
  frequency: Frequency;
  status: SaleStatus;
}

export interface Installment {
  id: string;
  planId: string;
  installmentNumber: number;
  dueDate: number;
  amountDue: number;
  amountPaid: number;
  remainingAmount: number;
  paidDate?: number;
  status: InstallmentStatus;
  notes?: string;
}

export interface Payment extends BaseEntity, Syncable {
  saleId?: string;
  installmentId?: string;
  amount: number;
  paymentMethod: PaymentMethod;
  paymentDate: number;
  reference?: string;
  notes?: string;
  status: 'ACTIVE' | 'CANCELLED';
}

export type InventoryTransactionType = 'PURCHASE' | 'SALE' | 'RETURN' | 'ADJUSTMENT' | 'STOCK_IN' | 'STOCK_OUT';

export interface InventoryTransaction {
  id: string;
  productId: string;
  type: InventoryTransactionType;
  quantity: number;
  previousQuantity: number;
  newQuantity: number;
  referenceType?: string;
  referenceId?: string;
  reason?: string;
  createdAt: number;
  createdBy: string;
}

export type RoleName = 'ADMIN' | 'MANAGER' | 'CASHIER' | string;

export interface Role {
  id: string;
  name: RoleName;
  permissions: Permission[];
}

export interface User extends BaseEntity {
  username: string;
  displayName: string;
  credentialId: string;
  roleId: string;
  isActive: boolean;
}

export interface UserCredential {
  id: string;
  userId: string;
  salt: string;
  passwordHash: string;
}

export interface AuditLog {
  id: string;
  userId?: string;
  username?: string;
  action: string;
  entity: string;
  entityId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  createdAt: number;
}

export interface StoreSettings {
  key: string;
  value: unknown;
}

/**
 * Record of a hard delete. Without it a row deleted on one device would be
 * re-imported from another device's snapshot on the next sync.
 */
export interface SyncTombstone {
  id: string;
  tableName: string;
  rowId: string;
  deletedAt: number;
}

export type Permission =
  | 'products.view' | 'products.create' | 'products.update' | 'products.delete'
  | 'inventory.view' | 'inventory.adjust'
  | 'customers.view' | 'customers.create' | 'customers.update'
  | 'sales.create' | 'sales.view' | 'sales.cancel'
  | 'payments.create' | 'payments.view' | 'payments.cancel'
  | 'reports.view'
  | 'users.manage' | 'settings.manage';
