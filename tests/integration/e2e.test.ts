import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { getDb } from '@/database/db';
import { SaleService, type CartLine } from '@/services/sales/sale.service';
import { PaymentService } from '@/services/payments/payment.service';
import { InventoryService } from '@/services/operations.service';
import { UserService } from '@/services/settings/settings.service';
import { round2 } from '@/utils/format';
import type { Customer, Product } from '@/types';

async function createProduct(overrides: Partial<Product> = {}): Promise<Product> {
  const db = getDb();
  const product: Product = {
    id: crypto.randomUUID(), sku: `SKU-${crypto.randomUUID().slice(0, 6)}`,
    barcode: `${Math.floor(Math.random() * 1e12)}`, name: 'Test Product', description: '',
    purchasePrice: 5000, sellingPrice: 10000, stockQuantity: 10, minimumStock: 2,
    categoryId: undefined, isActive: true,
    createdAt: Date.now(), updatedAt: Date.now(),
    syncStatus: 'LOCAL', version: 1, deviceId: 'TEST',
    ...overrides,
  };
  await db.products.add(product);
  return product;
}

const line = (p: Product, qty = 1): CartLine => ({ productId: p.id, name: p.name, quantity: qty, unitPrice: p.sellingPrice });

async function createCustomer(): Promise<Customer> {
  const customer: Customer = {
    id: crypto.randomUUID(), customerNumber: crypto.randomUUID().slice(0, 8),
    fullName: 'Test Customer', createdAt: Date.now(), updatedAt: Date.now(),
    syncStatus: 'LOCAL', version: 1, deviceId: 'TEST',
  };
  await getDb().customers.add(customer);
  return customer;
}

describe('E2E business flow', () => {
  let userId: string;
  const saleService = new SaleService();
  const paymentService = new PaymentService();

  beforeAll(async () => {
    const db = getDb();
    await db.open();
    const users = new UserService();
    await users.ensureDefaults();
    userId = (await db.users.where('username').equals('admin').first())!.id;
  });

  it('cash sale: deducts stock, records payment, status PAID', async () => {
    const product = await createProduct({ stockQuantity: 10 });
    const sale = await saleService.createSale({
      cart: [line(product, 2)], discount: 0, saleType: 'CASH',
      paidAmount: 20000, paymentMethod: 'CASH', userId,
    });
    expect(sale.totalAmount).toBe(20000);
    expect(sale.paidAmount).toBe(20000);
    expect(sale.remainingAmount).toBe(0);
    expect(sale.status).toBe('PAID');

    const updated = (await getDb().products.get(product.id))!;
    expect(updated.stockQuantity).toBe(8);

    const payments = await getDb().payments.where('saleId').equals(sale.id).toArray();
    expect(payments).toHaveLength(1);
  });

  it('installment sale requires a customer', async () => {
    const product = await createProduct({ sellingPrice: 50000 });
    await expect(saleService.createSale({
      cart: [line(product)], discount: 0, saleType: 'INSTALLMENT',
      paidAmount: 0, paymentMethod: 'CASH',
      installmentConfig: { downPayment: 0, numberOfInstallments: 3, firstDueDate: Date.now() },
      userId,
    })).rejects.toThrowError(/CUSTOMER_REQUIRED_FOR_INSTALLMENT/);
    expect((await getDb().products.get(product.id))!.stockQuantity).toBe(10);
  });

  it('installment sale with down payment: sum of installments equals financed amount', async () => {
    const product = await createProduct({ sellingPrice: 120000 });
    const customer = await createCustomer();
    const sale = await saleService.createSale({
      cart: [line(product)], customerId: customer.id, discount: 0, saleType: 'INSTALLMENT',
      paidAmount: 0, paymentMethod: 'CASH',
      installmentConfig: { downPayment: 20000, numberOfInstallments: 12, firstDueDate: Date.now() },
      userId,
    });
    const plan = (await getDb().installmentPlans.where('saleId').equals(sale.id).first())!;
    const items = await getDb().installments.where('planId').equals(plan.id).toArray();

    expect(plan.financedAmount).toBe(100000);
    expect(items).toHaveLength(12);
    expect(round2(items.reduce((s, i) => s + i.amountDue, 0))).toBe(100000);
    expect(sale.paidAmount).toBe(20000);
    expect(sale.remainingAmount).toBe(100000);
    expect(sale.status).toBe('PARTIALLY_PAID');
  });

  it('partial then full installment payment updates balances and statuses', async () => {
    const product = await createProduct({ sellingPrice: 30000 });
    const customer = await createCustomer();
    const sale = await saleService.createSale({
      cart: [line(product)], customerId: customer.id, discount: 0, saleType: 'INSTALLMENT',
      paidAmount: 0, paymentMethod: 'CASH',
      installmentConfig: { downPayment: 0, numberOfInstallments: 3, firstDueDate: Date.now() },
      userId,
    });
    const plan = (await getDb().installmentPlans.where('saleId').equals(sale.id).first())!;
    const items = await getDb().installments.where('planId').equals(plan.id).sortBy('installmentNumber');
    const first = items[0];
    expect(first.amountDue).toBe(10000);

    // partial payment
    const afterPartial = await paymentService.recordInstallmentPayment({
      installmentId: first.id, amount: 4000, paymentMethod: 'CASH', userId,
    });
    expect(afterPartial.installment.remainingAmount).toBe(6000);
    expect(afterPartial.installment.status).toBe('PARTIAL');

    // overpay rejected
    await expect(paymentService.recordInstallmentPayment({
      installmentId: first.id, amount: 99999, paymentMethod: 'CASH', userId,
    })).rejects.toThrowError(/EXCEEDS_REMAINING|exceeds/i);

    // full payment
    await paymentService.recordInstallmentPayment({
      installmentId: first.id, amount: 6000, paymentMethod: 'CASH', userId,
    });
    const paid = (await getDb().installments.get(first.id))!;
    expect(paid.remainingAmount).toBe(0);
    expect(paid.status).toBe('PAID');

    const updatedSale = (await getDb().sales.get(sale.id))!;
    expect(updatedSale.paidAmount).toBe(10000);
    expect(updatedSale.remainingAmount).toBe(20000);
  });

  it('insufficient stock is rejected atomically', async () => {
    const product = await createProduct({ stockQuantity: 1 });
    await expect(saleService.createSale({
      cart: [line(product, 5)], discount: 0, saleType: 'CASH',
      paidAmount: 99999, paymentMethod: 'CASH', userId,
    })).rejects.toThrowError(/INSUFFICIENT_STOCK/);
    expect((await getDb().products.get(product.id))!.stockQuantity).toBe(1);
  });

  it('cancel sale restores inventory and marks CANCELLED', async () => {
    const product = await createProduct({ stockQuantity: 10 });
    const sale = await saleService.createSale({
      cart: [line(product, 3)], discount: 0, saleType: 'CASH',
      paidAmount: 30000, paymentMethod: 'CASH', userId,
    });
    await saleService.cancelSale(sale.id, userId);
    const cancelled = (await getDb().sales.get(sale.id))!;
    expect(cancelled.status).toBe('CANCELLED');
    expect((await getDb().products.get(product.id))!.stockQuantity).toBe(10);
  });

  it('inventory service logs transactions', async () => {
    const product = await createProduct({ stockQuantity: 20 });
    const inv = new InventoryService();
    const next = await inv.applyTransaction({
      productId: product.id, type: 'STOCK_OUT', quantity: -3, reason: 'تلف', createdBy: userId,
    });
    expect(next).toBe(17);
    const txs = await inv.listTransactions(product.id);
    expect(txs[0]).toMatchObject({ previousQuantity: 20, newQuantity: 17, quantity: -3 });
  });

  it('auth rejects wrong password and accepts correct one', async () => {
    const { AuthService } = await import('@/services/auth/auth.service');
    const auth = new AuthService();
    await expect(auth.login('admin', 'wrong')).rejects.toThrowError(/AUTH_INVALID_CREDENTIALS/);
    const user = await auth.login('admin', 'admin123');
    expect(user.username).toBe('admin');
    expect(await auth.hasPermission(user.id, 'users.manage')).toBe(true);
  });
});
