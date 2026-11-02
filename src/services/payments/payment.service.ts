import { getDb, getDeviceId } from '@/database/db';
import { newId } from '@/utils/helpers';
import { round2 } from '@/utils/format';
import { deriveInstallmentStatus } from '@/services/installments/calculator';
import { currentActor } from '@/services/operations.service';
import type { Installment, Payment, Sale } from '@/types';

export class PaymentService {
  private db = getDb();

  /**
   * Records a payment against an installment (partial or full).
   * Rejects amounts exceeding the remaining balance and cancelled plans.
   * Updates installment, plan and sale balances atomically.
   */
  async recordInstallmentPayment(input: {
    installmentId: string;
    amount: number;
    paymentMethod: Payment['paymentMethod'];
    paymentDate?: number;
    notes?: string;
    reference?: string;
    userId: string;
  }): Promise<{ installment: Installment; changeDue: number }> {
    const amount = round2(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('INVALID_PAYMENT_AMOUNT');

    const deviceId = await getDeviceId();

    return this.db.transaction('rw', this.db.tables, async () => {
      const installment = await this.db.installments.get(input.installmentId);
      if (!installment) throw new Error('INSTALLMENT_NOT_FOUND');
      if (installment.status === 'CANCELLED') throw new Error('INSTALLMENT_NOT_PAYABLE');

      const plan = await this.db.installmentPlans.get(installment.planId);
      if (!plan) throw new Error('PLAN_NOT_FOUND');
      const sale = await this.db.sales.get(plan.saleId);
      if (!sale || sale.status === 'CANCELLED') throw new Error('SALE_NOT_PAYABLE');

      const remaining = round2(installment.remainingAmount);
      if (remaining <= 0) throw new Error('INSTALLMENT_ALREADY_PAID');
      if (amount > remaining) throw new Error('PAYMENT_EXCEEDS_REMAINING');

      const nowTs = input.paymentDate ?? Date.now();
      const newPaid = round2(installment.amountPaid + amount);
      const newRemaining = round2(installment.amountDue - newPaid);

      await this.db.installments.update(installment.id, {
        amountPaid: newPaid,
        remainingAmount: newRemaining,
        status: deriveInstallmentStatus(newRemaining, newPaid, installment.dueDate, nowTs),
        paidDate: newRemaining <= 0 ? nowTs : installment.paidDate,
      });

      const payment: Payment = {
        id: newId(),
        installmentId: installment.id,
        amount,
        paymentMethod: input.paymentMethod,
        paymentDate: nowTs,
        reference: input.reference,
        notes: input.notes,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        syncStatus: 'LOCAL',
        version: 1,
        deviceId,
        status: 'ACTIVE',
      };
      await this.db.payments.add(payment);

      await this.refreshSaleState(sale.id);

      await this.db.auditLogs.add({
        id: newId(), userId: input.userId, username: currentActor().username, action: 'RECORD_PAYMENT', entity: 'Payment',
        entityId: payment.id, newValue: { installmentId: installment.id, amount }, createdAt: Date.now(),
      });

      return {
        installment: { ...installment, amountPaid: newPaid, remainingAmount: newRemaining, status: 'PARTIAL' },
        changeDue: 0,
      };
    });
  }

  /**
   * Cancels a payment (cash, down payment or installment) and recomputes the
   * whole chain: installment → plan → sale.
   */
  async cancelPayment(paymentId: string, userId: string): Promise<void> {
    await this.db.transaction('rw', this.db.tables, async () => {
      const payment = await this.db.payments.get(paymentId);
      if (!payment || payment.status === 'CANCELLED') throw new Error('PAYMENT_NOT_CANCELLABLE');

      await this.db.payments.update(paymentId, { status: 'CANCELLED', updatedAt: Date.now() });

      if (payment.installmentId) {
        const inst = await this.db.installments.get(payment.installmentId);
        if (inst && inst.status !== 'CANCELLED') {
          const newPaid = round2(Math.max(0, inst.amountPaid - payment.amount));
          const newRemaining = round2(inst.amountDue - newPaid);
          await this.db.installments.update(inst.id, {
            amountPaid: newPaid,
            remainingAmount: newRemaining,
            status: deriveInstallmentStatus(newRemaining, newPaid, inst.dueDate, Date.now()),
            paidDate: newRemaining <= 0 ? inst.paidDate : undefined,
          });
        }
      }

      const saleId = payment.saleId ?? (await this.saleIdForPayment(payment));
      if (saleId) await this.refreshSaleState(saleId);

      await this.db.auditLogs.add({
        id: newId(), userId, username: currentActor().username, action: 'CANCEL_PAYMENT', entity: 'Payment',
        entityId: paymentId, oldValue: { amount: payment.amount }, createdAt: Date.now(),
      });
    });
  }

  /** Recomputes paid/remaining/status of a sale, its plan and overdue flags. */
  private async refreshSaleState(saleId: string): Promise<void> {
    const sale = await this.db.sales.get(saleId);
    if (!sale || sale.status === 'CANCELLED') return;

    const paid = round2(Math.min(await this.sumActiveSalePayments(saleId), sale.totalAmount));
    const remaining = round2(sale.totalAmount - paid);
    let status: Sale['status'] = remaining <= 0 ? 'PAID' : paid > 0 ? 'PARTIALLY_PAID' : 'PENDING';

    if (remaining > 0) {
      const plan = await this.db.installmentPlans.where('saleId').equals(saleId).first();
      if (plan && plan.status !== 'CANCELLED') {
        const items = await this.db.installments.where('planId').equals(plan.id).toArray();
        const overdue = items.some((i) => i.status !== 'CANCELLED' && i.remainingAmount > 0 && i.dueDate < Date.now());
        if (overdue) status = 'OVERDUE';
        await this.db.installmentPlans.update(plan.id, { status, updatedAt: Date.now() });
      }
    } else {
      const plan = await this.db.installmentPlans.where('saleId').equals(saleId).first();
      if (plan && plan.status !== 'CANCELLED') {
        await this.db.installmentPlans.update(plan.id, { status: 'PAID', updatedAt: Date.now() });
      }
    }

    await this.db.sales.update(saleId, { paidAmount: paid, remainingAmount: remaining, status, updatedAt: Date.now() });
  }

  private async saleIdForPayment(payment: Payment): Promise<string | undefined> {
    if (!payment.installmentId) return undefined;
    const inst = await this.db.installments.get(payment.installmentId);
    if (!inst) return undefined;
    const plan = await this.db.installmentPlans.get(inst.planId);
    return plan?.saleId;
  }

  private async sumActiveSalePayments(saleId: string): Promise<number> {
    const direct = await this.db.payments.where('saleId').equals(saleId).toArray();
    const seen = new Set(direct.map((p) => p.id));
    let total = direct.filter((p) => p.status === 'ACTIVE').reduce((s, p) => s + p.amount, 0);

    const plan = await this.db.installmentPlans.where('saleId').equals(saleId).first();
    if (plan) {
      const items = await this.db.installments.where('planId').equals(plan.id).toArray();
      if (items.length > 0) {
        const instPayments = await this.db.payments
          .where('installmentId')
          .anyOf(items.map((i) => i.id))
          .toArray();
        for (const p of instPayments) {
          if (p.status !== 'ACTIVE' || seen.has(p.id)) continue;
          seen.add(p.id);
          total += p.amount;
        }
      }
    }
    return round2(total);
  }
}
