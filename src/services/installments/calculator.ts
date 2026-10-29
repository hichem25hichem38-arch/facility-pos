import { addMonths, round2 } from '@/utils/format';
import type { Frequency, InstallmentStatus } from '@/types';

export interface InstallmentDraft {
  installmentNumber: number;
  dueDate: number;
  amountDue: number;
}

export interface PlanCalculation {
  financedAmount: number;
  numberOfInstallments: number;
  installmentAmount: number;
  drafts: InstallmentDraft[];
}

/**
 * Splits the financed amount into N installments whose sum equals
 * exactly the financed amount. The last installment absorbs any rounding
 * remainder. `startDate` is the due date of the FIRST installment; the
 * remaining ones fall on the same calendar day of the following months.
 */
export function calculateInstallmentPlan(
  totalAmount: number,
  downPayment: number,
  numberOfInstallments: number,
  startDate: number,
  frequency: Frequency = 'MONTHLY',
): PlanCalculation {
  if (numberOfInstallments < 1) throw new Error('INVALID_INSTALLMENT_COUNT');
  if (downPayment < 0 || downPayment > totalAmount) throw new Error('INVALID_DOWN_PAYMENT');

  const financedAmount = round2(totalAmount - downPayment);
  const base = Math.floor((financedAmount / numberOfInstallments) * 100) / 100;
  const sumOfFirstNMinusOne = round2(base * (numberOfInstallments - 1));
  const lastAmount = round2(financedAmount - sumOfFirstNMinusOne);
  const installmentAmount = base;

  const drafts: InstallmentDraft[] = [];
  for (let i = 1; i <= numberOfInstallments; i++) {
    drafts.push({
      installmentNumber: i,
      dueDate: dueDateFor(startDate, i - 1, frequency),
      amountDue: i === numberOfInstallments ? lastAmount : base,
    });
  }
  return { financedAmount, numberOfInstallments, installmentAmount, drafts };
}

/**
 * Due date of the installment at `offset` periods after the first one.
 * Monthly periods use real calendar months (not fixed 30-day steps) so the
 * schedule does not drift across months of different length.
 */
function dueDateFor(startDate: number, offset: number, frequency: Frequency): number {
  if (frequency === 'MONTHLY') return addMonths(startDate, offset);
  return startDate + offset * 30 * 86_400_000;
}

/** Derives the effective installment status from amounts and current time. */
export function deriveInstallmentStatus(
  remainingAmount: number,
  amountPaid: number,
  dueDate: number,
  nowTs: number,
): InstallmentStatus {
  if (remainingAmount <= 0) return 'PAID';
  if (dueDate < nowTs) return 'OVERDUE';
  return amountPaid > 0 ? 'PARTIAL' : 'PENDING';
}
