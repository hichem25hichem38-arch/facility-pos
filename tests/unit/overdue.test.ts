import { describe, it, expect } from 'vitest';
import { deriveInstallmentStatus } from '@/services/installments/calculator';

describe('deriveInstallmentStatus', () => {
  const day = 86_400_000;

  it('paid when remaining is zero', () => {
    expect(deriveInstallmentStatus(0, 10000, Date.now() - day, Date.now())).toBe('PAID');
  });
  it('overdue when past due date and unpaid', () => {
    expect(deriveInstallmentStatus(10000, 0, Date.now() - day, Date.now())).toBe('OVERDUE');
  });
  it('pending when not yet due', () => {
    expect(deriveInstallmentStatus(10000, 0, Date.now() + day, Date.now())).toBe('PENDING');
  });
});
