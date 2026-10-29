import { getDb } from '@/database/db';
import { BaseRepository } from './base.repository';
import type { InstallmentPlan, Installment, Payment } from '@/types';

export class InstallmentPlanRepository extends BaseRepository<InstallmentPlan> {
  constructor() {
    super('installmentPlans');
  }

  async getBySaleId(saleId: string): Promise<InstallmentPlan | undefined> {
    return getDb().installmentPlans.where('saleId').equals(saleId).first();
  }
}

export class InstallmentRepository {
  private db = getDb();

  async bulkCreate(installments: Omit<Installment, 'id'>[]): Promise<void> {
    await this.db.installments.bulkAdd(installments.map((i) => ({ ...i, id: crypto.randomUUID() })));
  }

  async getByPlanId(planId: string): Promise<Installment[]> {
    return this.db.installments.where('planId').equals(planId).sortBy('installmentNumber');
  }

  async update(id: string, changes: Partial<Installment>): Promise<void> {
    await this.db.installments.update(id, changes);
  }

  async getDueBetween(from: number, to: number): Promise<Installment[]> {
    const overdueOrDue: Installment[] = [];
    const plans = await this.db.installmentPlans.toArray();
    for (const plan of plans) {
      if (plan.status === 'CANCELLED') continue;
      const items = await this.db.installments.where('planId').equals(plan.id).toArray();
      overdueOrDue.push(...items.filter((i) => i.remainingAmount > 0 && i.dueDate >= from && i.dueDate <= to));
    }
    return overdueOrDue.sort((a, b) => a.dueDate - b.dueDate);
  }

  async getOverdue(nowTs = Date.now()): Promise<{ installment: Installment; daysLate: number; plan: InstallmentPlan }[]> {
    const result: { installment: Installment; daysLate: number; plan: InstallmentPlan }[] = [];
    const plans = await this.db.installmentPlans.filter((p) => p.status !== 'CANCELLED').toArray();
    for (const plan of plans) {
      const items = await this.db.installments.where('planId').equals(plan.id).toArray();
      for (const item of items) {
        if (item.remainingAmount > 0 && item.dueDate < nowTs) {
          result.push({ installment: item, daysLate: Math.floor((nowTs - item.dueDate) / 86_400_000), plan });
        }
      }
    }
    return result.sort((a, b) => b.daysLate - a.daysLate);
  }
}

export class PaymentRepository extends BaseRepository<Payment> {
  constructor() {
    super('payments');
  }

  async getBySaleId(saleId: string): Promise<Payment[]> {
    return getDb().payments.where('saleId').equals(saleId).sortBy('createdAt');
  }

  async getByDateRange(from: number, to: number): Promise<Payment[]> {
    return getDb().payments.where('paymentDate').between(from, to, true, true).toArray();
  }
}
