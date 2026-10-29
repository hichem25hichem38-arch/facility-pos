import { describe, it, expect } from 'vitest';
import { calculateInstallmentPlan } from '@/services/installments/calculator';
import { round2 } from '@/utils/format';

describe('calculateInstallmentPlan', () => {
  it('equal split: 120000 / 12 = 10000 each', () => {
    const plan = calculateInstallmentPlan(120000, 0, 12, Date.now());
    expect(plan.financedAmount).toBe(120000);
    const sum = round2(plan.drafts.reduce((s, d) => s + d.amountDue, 0));
    expect(sum).toBe(120000);
    expect(plan.drafts).toHaveLength(12);
  });

  it('down payment: 120000 with 20000 down → financed 100000', () => {
    const plan = calculateInstallmentPlan(120000, 20000, 12, Date.now());
    expect(plan.financedAmount).toBe(100000);
    expect(plan.installmentAmount).toBeCloseTo(8333.33, 2);
  });

  it('uneven fractions: sum equals financed exactly (last installment absorbs remainder)', () => {
    const financed = 100000;
    const n = 12;
    const plan = calculateInstallmentPlan(financed + 20000, 20000, n, Date.now());
    const sum = round2(plan.drafts.reduce((s, d) => s + d.amountDue, 0));
    expect(sum).toBe(financed);
    // all but last equal base
    for (let i = 0; i < n - 1; i++) {
      expect(plan.drafts[i].amountDue).toBe(plan.installmentAmount);
    }
    expect(plan.drafts[n - 1].amountDue).toBeGreaterThanOrEqual(plan.installmentAmount);
  });

  it('rejects invalid installment count', () => {
    expect(() => calculateInstallmentPlan(1000, 0, 0, Date.now())).toThrow();
  });

  it('rejects down payment exceeding total', () => {
    expect(() => calculateInstallmentPlan(1000, 5000, 3, Date.now())).toThrow();
  });
});
