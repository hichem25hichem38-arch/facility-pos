import { getDb } from '@/database/db';
import { newId } from '@/utils/helpers';
import { calculateInstallmentPlan } from '@/services/installments/calculator';
import type { Category, Product } from '@/types';

export class SeedService {
  async seedDemoData(): Promise<void> {
    // احترام وضع العميل — لا تزرع بيانات تجريبية
    if ((import.meta as unknown as { env?: { VITE_NO_DEMO?: string } }).env?.VITE_NO_DEMO === 'true') return;
    if (typeof localStorage !== 'undefined' && localStorage.getItem('CLIENT_NO_DEMO') === '1') return;
    const db = getDb();
    if ((await db.products.count()) > 0) return;

    await db.transaction('rw', db.tables, async () => {
      const categories: Category[] = [
        { id: newId(), name: 'إلكترونيات', createdAt: Date.now(), updatedAt: Date.now(), syncStatus: 'LOCAL', version: 1, deviceId: '' },
        { id: newId(), name: 'أثاث منزلي', createdAt: Date.now(), updatedAt: Date.now(), syncStatus: 'LOCAL', version: 1, deviceId: '' },
      ];
      await db.categories.bulkAdd(categories);

      const productDefs = [
        { name: 'هاتف ذكي Samsung A15', sku: 'ELC-001', barcode: '610000000011', categoryId: categories[0].id, purchasePrice: 28000, sellingPrice: 35000, stockQuantity: 15, minimumStock: 5 },
        { name: 'حاسوب محمول HP', sku: 'ELC-002', barcode: '610000000012', categoryId: categories[0].id, purchasePrice: 95000, sellingPrice: 120000, stockQuantity: 8, minimumStock: 2 },
        { name: 'تلفاز 43 بوصة', sku: 'ELC-003', barcode: '610000000013', categoryId: categories[0].id, purchasePrice: 55000, sellingPrice: 70000, stockQuantity: 3, minimumStock: 4 },
        { name: 'ثلاجة LG', sku: 'FRN-001', barcode: '610000000014', categoryId: categories[1].id, purchasePrice: 80000, sellingPrice: 100000, stockQuantity: 6, minimumStock: 2 },
        { name: 'غسالة Whirlpool', sku: 'FRN-002', barcode: '610000000015', categoryId: categories[1].id, purchasePrice: 60000, sellingPrice: 75000, stockQuantity: 10, minimumStock: 3 },
      ];
      const products: Product[] = productDefs.map((p) => ({
        ...p,
        id: newId(),
        description: '',
        isActive: true,
        createdAt: Date.now(), updatedAt: Date.now(),
        syncStatus: 'LOCAL', version: 1, deviceId: '',
      }));
      await db.products.bulkAdd(products);

      const customerDefs = [
        { fullName: 'محمد الأمين', phone: '0555123456', address: 'حي النصر' },
        { fullName: 'فاطمة الزهراء', phone: '0661987654', address: 'وسط المدينة' },
      ];
      const customers = customerDefs.map((c, i) => ({
        ...c, customerNumber: `C-${String(i + 1).padStart(5, '0')}`,
        id: newId(), createdAt: Date.now(), updatedAt: Date.now(),
        syncStatus: 'LOCAL' as const, version: 1, deviceId: '',
      }));
      await db.customers.bulkAdd(customers);

      // one demo installment sale: laptop for customer 1
      const saleDate = Date.now() - 40 * 86_400_000;
      const laptop = products[1];
      const subtotal = laptop.sellingPrice;
      const downPayment = 20000;
      const invoiceNumber = 'INV-2026-00001';
      const saleId = newId();
      await db.sales.add({
        id: saleId, invoiceNumber, customerId: customers[0].id, saleType: 'INSTALLMENT',
        subtotal, discount: 0, totalAmount: subtotal, paidAmount: downPayment,
        remainingAmount: subtotal - downPayment, status: 'PARTIALLY_PAID',
        saleDate, createdAt: saleDate, updatedAt: saleDate,
        syncStatus: 'LOCAL', version: 1, deviceId: '',
      });
      await db.saleItems.add({
        id: newId(), saleId, productId: laptop.id, quantity: 1, unitPrice: subtotal, total: subtotal,
      });
      const prev = laptop.stockQuantity;
      await db.products.update(laptop.id, { stockQuantity: prev - 1 });
      await db.inventoryTransactions.add({
        id: newId(), productId: laptop.id, type: 'SALE', quantity: -1,
        previousQuantity: prev, newQuantity: prev - 1, referenceType: 'SALE',
        referenceId: saleId, reason: `Sale ${invoiceNumber}`, createdAt: saleDate, createdBy: 'seed',
      });
      await db.payments.add({
        id: newId(), saleId, amount: downPayment, paymentMethod: 'CASH',
        paymentDate: saleDate, notes: 'Down payment (demo)', createdAt: saleDate, updatedAt: saleDate,
        syncStatus: 'LOCAL', version: 1, deviceId: '', status: 'ACTIVE',
      });
      const calc = calculateInstallmentPlan(subtotal, downPayment, 12, saleDate);
      const planId = newId();
      await db.installmentPlans.add({
        id: planId, saleId, numberOfInstallments: 12, totalAmount: subtotal,
        downPayment, financedAmount: calc.financedAmount, installmentAmount: calc.installmentAmount,
        startDate: saleDate, frequency: 'MONTHLY', status: 'PARTIALLY_PAID',
        createdAt: saleDate, updatedAt: saleDate, syncStatus: 'LOCAL', version: 1, deviceId: '',
      });
      const nowTs = Date.now();
      await db.installments.bulkAdd(calc.drafts.map((d) => ({
        id: newId(), planId, installmentNumber: d.installmentNumber, dueDate: d.dueDate,
        amountDue: d.amountDue, amountPaid: 0, remainingAmount: d.amountDue,
        status: (d.dueDate < nowTs ? 'OVERDUE' : 'PENDING') as 'OVERDUE' | 'PENDING',
      })));
    });
  }
}
