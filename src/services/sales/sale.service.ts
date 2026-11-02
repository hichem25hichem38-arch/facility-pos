import { getDb } from '@/database/db';
import { newId } from '@/utils/helpers';
import { round2 } from '@/utils/format';
import type { Sale, SaleItem, InstallmentPlan, Installment, Payment, SaleType } from '@/types';
import { calculateInstallmentPlan } from '@/services/installments/calculator';
import type { PlanCalculation } from '@/services/installments/calculator';
import { currentActor } from '@/services/operations.service';

export interface CartLine {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface CreateSaleInput {
  cart: CartLine[];
  discount: number;
  saleType: SaleType;
  customerId?: string;
  paidAmount: number;
  paymentMethod: Payment['paymentMethod'];
  installmentConfig?: {
    downPayment: number;
    numberOfInstallments: number;
    firstDueDate: number;
  };
  userId: string;
}

export class SaleService {
  private db = getDb();

  /**
   * Atomically creates a sale: sale + items + inventory deduction +
   * (for installments) plan + schedule + initial payment + audit log.
   */
  async createSale(input: CreateSaleInput): Promise<Sale> {
    if (input.cart.length === 0) throw new Error('EMPTY_CART');
    if (input.cart.some((l) => !Number.isFinite(l.quantity) || l.quantity <= 0 || l.unitPrice < 0)) {
      throw new Error('INVALID_CART_LINE');
    }
    const deviceId = await getDeviceIdSafe();

    return this.db.transaction('rw', this.db.tables, async () => {
      const subtotal = round2(input.cart.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
      const total = round2(subtotal - input.discount);
      if (total < 0) throw new Error('INVALID_DISCOUNT');

      // A cart may contain the same product twice; validate the aggregated quantity.
      const wanted = new Map<string, number>();
      for (const line of input.cart) wanted.set(line.productId, (wanted.get(line.productId) ?? 0) + line.quantity);

      // validate stock
      for (const [productId, qty] of wanted) {
        const product = await this.db.products.get(productId);
        if (!product) throw new Error(`PRODUCT_NOT_FOUND:${productId}`);
        if (product.stockQuantity < qty) throw new Error(`INSUFFICIENT_STOCK:${product.name}`);
      }

      const saleDate = Date.now();
      let paidAmount = round2(input.paidAmount);

      if (input.saleType === 'CASH') {
        if (paidAmount < total) throw new Error('CASH_INSUFFICIENT_PAYMENT');
        // Change handed back to the customer is not part of the sale.
        paidAmount = total;
      } else {
        const cfg = input.installmentConfig;
        if (!cfg || cfg.downPayment < 0 || cfg.numberOfInstallments < 1) throw new Error('INVALID_INSTALLMENT_CONFIG');
        if (!input.customerId) throw new Error('CUSTOMER_REQUIRED_FOR_INSTALLMENT');
        if (round2(cfg.downPayment) > total) throw new Error('DOWN_PAYMENT_EXCEEDS_TOTAL');
        paidAmount = round2(cfg.downPayment);
      }

      const invoiceNumber = await this.nextInvoiceNumber();
      let status: Sale['status'] = 'PENDING';
      if (input.saleType === 'CASH') status = 'PAID';
      else if (paidAmount >= total) status = 'PAID';
      else if (paidAmount > 0) status = 'PARTIALLY_PAID';

      const sale: Sale = {
        id: newId(),
        invoiceNumber,
        customerId: input.customerId,
        saleType: input.saleType,
        subtotal,
        discount: input.discount,
        totalAmount: total,
        paidAmount,
        remainingAmount: round2(total - paidAmount),
        status,
        saleDate,
        createdAt: saleDate,
        updatedAt: saleDate,
        syncStatus: 'LOCAL',
        version: 1,
        deviceId,
      };
      await this.db.sales.add(sale);

      const items: SaleItem[] = input.cart.map((l) => ({
        id: newId(),
        saleId: sale.id,
        productId: l.productId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        total: round2(l.quantity * l.unitPrice),
      }));
      await this.db.saleItems.bulkAdd(items);

      // deduct inventory with transactions
      for (const [productId, qty] of wanted) {
        const product = await this.db.products.get(productId);
        if (!product) continue;
        const prev = product.stockQuantity;
        const next = prev - qty;
        await this.db.products.update(productId, { stockQuantity: next, updatedAt: saleDate });
        await this.db.inventoryTransactions.add({
          id: newId(),
          productId,
          type: 'SALE',
          quantity: -qty,
          previousQuantity: prev,
          newQuantity: next,
          referenceType: 'SALE',
          referenceId: sale.id,
          reason: `Sale ${invoiceNumber}`,
          createdAt: saleDate,
          createdBy: input.userId,
        });
      }

      // record the paid amount as a payment
      if (paidAmount > 0) {
        await this.db.payments.add({
          id: newId(),
          saleId: sale.id,
          amount: paidAmount,
          paymentMethod: input.paymentMethod,
          paymentDate: saleDate,
          notes: input.saleType === 'INSTALLMENT' ? 'Down payment' : 'Cash sale',
          createdAt: saleDate,
          updatedAt: saleDate,
          syncStatus: 'LOCAL',
          version: 1,
          deviceId,
          status: 'ACTIVE',
        });
      }

      // installment plan
      if (input.saleType === 'INSTALLMENT' && round2(total - paidAmount) > 0) {
        const cfg = input.installmentConfig!;
        const calc: PlanCalculation = calculateInstallmentPlan(
          total, cfg.downPayment, cfg.numberOfInstallments, cfg.firstDueDate,
        );
        const plan: InstallmentPlan = {
          id: newId(),
          saleId: sale.id,
          numberOfInstallments: calc.numberOfInstallments,
          totalAmount: total,
          downPayment: round2(input.installmentConfig!.downPayment),
          financedAmount: calc.financedAmount,
          installmentAmount: calc.installmentAmount,
          startDate: input.installmentConfig!.firstDueDate,
          frequency: 'MONTHLY',
          status,
          createdAt: saleDate,
          updatedAt: saleDate,
          syncStatus: 'LOCAL',
          version: 1,
          deviceId,
        };
        await this.db.installmentPlans.add(plan);

        const nowTs = Date.now();
        const installments: Installment[] = calc.drafts.map((d) => ({
          id: newId(),
          planId: plan.id,
          installmentNumber: d.installmentNumber,
          dueDate: d.dueDate,
          amountDue: d.amountDue,
          amountPaid: 0,
          remainingAmount: d.amountDue,
          status: d.dueDate < nowTs ? 'OVERDUE' : 'PENDING',
        }));
        // sanity invariant: sum of installments == financedAmount
        const sum = round2(installments.reduce((s, i) => s + i.amountDue, 0));
        if (sum !== calc.financedAmount) throw new Error('INSTALLMENT_SUM_MISMATCH');
        await this.db.installments.bulkAdd(installments);
      }

      await this.audit(input.userId, 'CREATE_SALE', 'Sale', sale.id, null, { invoiceNumber, total, saleType: input.saleType });
      return sale;
    });
  }

  /**
   * Cancels a sale: restores inventory, voids every payment that was applied
   * to it (cash, down payment and installments) and closes the plan so no
   * balance keeps counting against the customer.
   */
  async cancelSale(saleId: string, userId: string): Promise<void> {
    const db = this.db;
    await db.transaction('rw', db.tables, async () => {
      const sale = await db.sales.get(saleId);
      if (!sale || sale.status === 'CANCELLED') throw new Error('SALE_NOT_CANCELLABLE');

      const items = await db.saleItems.where('saleId').equals(saleId).toArray();
      for (const item of items) {
        const product = await db.products.get(item.productId);
        if (!product) continue;
        const next = product.stockQuantity + item.quantity;
        await db.products.update(product.id, { stockQuantity: next, updatedAt: Date.now() });
        await db.inventoryTransactions.add({
          id: newId(), productId: product.id, type: 'RETURN', quantity: item.quantity,
          previousQuantity: product.stockQuantity, newQuantity: next,
          referenceType: 'SALE_CANCEL', referenceId: sale.id, reason: `Cancel ${sale.invoiceNumber}`,
          createdAt: Date.now(), createdBy: userId,
        });
      }

      const plan = await db.installmentPlans.where('saleId').equals(saleId).first();
      const installments = plan ? await db.installments.where('planId').equals(plan.id).toArray() : [];

      const payments = await db.payments.where('saleId').equals(saleId).toArray();
      if (installments.length > 0) {
        const extra = await db.payments
          .where('installmentId')
          .anyOf(installments.map((i) => i.id))
          .toArray();
        const seen = new Set(payments.map((p) => p.id));
        for (const p of extra) if (!seen.has(p.id)) payments.push(p);
      }
      const activeIds = payments.filter((p) => p.status === 'ACTIVE').map((p) => p.id);
      if (activeIds.length > 0) {
        await db.payments.where('id').anyOf(activeIds).modify({ status: 'CANCELLED', updatedAt: Date.now() });
      }

      for (const inst of installments) {
        await db.installments.update(inst.id, {
          amountPaid: 0,
          remainingAmount: 0,
          status: 'CANCELLED',
        });
      }
      if (plan) await db.installmentPlans.update(plan.id, { status: 'CANCELLED', updatedAt: Date.now() });

      await db.sales.update(saleId, {
        status: 'CANCELLED',
        paidAmount: 0,
        remainingAmount: 0,
        updatedAt: Date.now(),
      });
      await this.audit(userId, 'CANCEL_SALE', 'Sale', saleId, { status: sale.status, paidAmount: sale.paidAmount }, {
        status: 'CANCELLED',
        voidedPayments: activeIds.length,
      });
    });
  }

  /** Next free invoice number for the current year (survives deletions). */
  private async nextInvoiceNumber(): Promise<string> {
    const prefix = `INV-${new Date().getFullYear()}-`;
    const rows = await this.db.sales.where('invoiceNumber').startsWith(prefix).toArray();
    let serial = rows.reduce((max, s) => {
      const n = Number(s.invoiceNumber.slice(prefix.length));
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);
    for (;;) {
      serial += 1;
      const candidate = `${prefix}${String(serial).padStart(5, '0')}`;
      const taken = await this.db.sales.where('invoiceNumber').equals(candidate).first();
      if (!taken) return candidate;
    }
  }

  private async audit(userId: string, action: string, entity: string, entityId: string, oldValue: unknown, newValue: unknown): Promise<void> {
    await this.db.auditLogs.add({
      id: newId(), userId, username: currentActor().username, action, entity, entityId, oldValue, newValue, createdAt: Date.now(),
    });
  }
}

async function getDeviceIdSafe(): Promise<string> {
  try {
    const { getDeviceId } = await import('@/database/db');
    return await getDeviceId();
  } catch {
    return 'UNKNOWN';
  }
}
