import type { Permission } from '@/types';

export const ALL_PERMISSIONS: Permission[] = [
  'products.view', 'products.create', 'products.update', 'products.delete',
  'inventory.view', 'inventory.adjust',
  'customers.view', 'customers.create', 'customers.update',
  'sales.create', 'sales.view', 'sales.cancel',
  'payments.create', 'payments.view', 'payments.cancel',
  'reports.view', 'users.manage', 'settings.manage',
];

export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  ADMIN: [...ALL_PERMISSIONS],
  MANAGER: [
    'products.view', 'products.create', 'products.update', 'products.delete',
    'inventory.view', 'inventory.adjust',
    'customers.view', 'customers.create', 'customers.update',
    'sales.create', 'sales.view', 'sales.cancel',
    'payments.create', 'payments.view', 'payments.cancel',
    'reports.view',
  ],
  CASHIER: [
    'products.view',
    'inventory.view',
    'customers.view', 'customers.create',
    'sales.create', 'sales.view',
    'payments.create', 'payments.view',
  ],
};

export const DEFAULT_CURRENCY = { code: 'DZD', symbol: 'DA' };

export const DB_NAME = 'installment-pos-db';
export const DEVICE_ID_KEY = 'deviceId';
