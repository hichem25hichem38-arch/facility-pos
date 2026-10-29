import { getDb } from '@/database/db';
import { startOfDay, endOfDay, round2 } from '@/utils/format';

export interface SalesReportData {
  totalSales: number;
  cashSales: number;
  installmentSales: number;
  revenue: number;
  profit: number;
  byDay: { date: string; sales: number; collections: number }[];
}

/** Local calendar day key (YYYY-MM-DD) — UTC keys shift the day in +01:00 zones. */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Next local midnight — setDate keeps DST transitions correct. */
function nextDay(ts: number): number {
  const d = new Date(ts);
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export class ReportService {
  private db = getDb();

  async getSalesReport(fromTs: number, toTs: number): Promise<SalesReportData> {
    const sales = (await this.db.sales.where('saleDate').between(fromTs, toTs, true, true).toArray())
      .filter((s) => s.status !== 'CANCELLED');
    const saleIds = new Set(sales.map((s) => s.id));
    const items = (await this.db.saleItems.toArray()).filter((i) => saleIds.has(i.saleId));
    const products = await this.db.products.toArray();
    const costMap = new Map(products.map((p) => [p.id, p.purchasePrice]));

    let profit = 0;
    const itemsBySale = new Map<string, typeof items>();
    for (const item of items) {
      const list = itemsBySale.get(item.saleId);
      if (list) list.push(item);
      else itemsBySale.set(item.saleId, [item]);
    }
    for (const sale of sales) {
      const saleItems = itemsBySale.get(sale.id) ?? [];
      if (saleItems.length === 0) continue;
      let lineRevenue = 0;
      let lineCost = 0;
      for (const item of saleItems) {
        lineRevenue += item.total;
        lineCost += item.quantity * (costMap.get(item.productId) ?? 0);
      }
      profit += lineRevenue - lineCost - sale.discount;
    }

    const payments = (await this.db.payments.where('paymentDate').between(fromTs, toTs, true, true).toArray())
      .filter((p) => p.status === 'ACTIVE');

    const dayMap = new Map<string, { sales: number; collections: number }>();
    const lastKey = dayKey(toTs);
    for (let d = startOfDay(fromTs); ; d = nextDay(d)) {
      dayMap.set(dayKey(d), { sales: 0, collections: 0 });
      if (dayKey(d) === lastKey || d > toTs) break;
    }
    for (const s of sales) {
      const entry = dayMap.get(dayKey(s.saleDate));
      if (entry) entry.sales = round2(entry.sales + s.totalAmount);
    }
    for (const p of payments) {
      const entry = dayMap.get(dayKey(p.paymentDate));
      if (entry) entry.collections = round2(entry.collections + p.amount);
    }

    return {
      totalSales: sales.length,
      cashSales: sales.filter((s) => s.saleType === 'CASH').length,
      installmentSales: sales.filter((s) => s.saleType === 'INSTALLMENT').length,
      revenue: round2(sales.reduce((s, x) => s + x.totalAmount, 0)),
      profit: round2(profit),
      byDay: [...dayMap.entries()].map(([date, v]) => ({ date, ...v })),
    };
  }

  async getInventoryReport(): Promise<{
    totalProducts: number; inventoryValue: number; lowStock: { name: string; stockQuantity: number; minimumStock: number }[];
  }> {
    const products = await this.db.products.filter((p) => p.isActive).toArray();
    return {
      totalProducts: products.length,
      inventoryValue: round2(products.reduce((s, p) => s + p.stockQuantity * p.purchasePrice, 0)),
      lowStock: products
        .filter((p) => p.stockQuantity <= p.minimumStock)
        .map((p) => ({ name: p.name, stockQuantity: p.stockQuantity, minimumStock: p.minimumStock })),
    };
  }

  async getInstallmentsReport(): Promise<{
    totalPlans: number; financedTotal: number; collectedTotal: number;
    remainingTotal: number; dueCount: number; overdueCount: number;
  }> {
    const plans = await this.db.installmentPlans.filter((p) => p.status !== 'CANCELLED').toArray();
    const planIds = new Set(plans.map((p) => p.id));
    const items = (await this.db.installments.toArray()).filter(
      (i) => planIds.has(i.planId) && i.status !== 'CANCELLED',
    );

    let collected = 0;
    let dueCount = 0;
    let overdueCount = 0;
    const todayStart = startOfDay(Date.now());
    const todayEnd = endOfDay(Date.now());
    for (const i of items) {
      collected += i.amountPaid;
      if (i.remainingAmount <= 0) continue;
      if (i.dueDate < todayStart) overdueCount += 1;
      else if (i.dueDate <= todayEnd) dueCount += 1;
    }

    const financedTotal = round2(plans.reduce((s, p) => s + p.financedAmount, 0));
    return {
      totalPlans: plans.length,
      financedTotal,
      collectedTotal: round2(collected),
      remainingTotal: round2(financedTotal - collected),
      dueCount,
      overdueCount,
    };
  }

  /** Top products by quantity sold, optionally restricted to a date range. */
  async getTopProducts(
    limit = 5,
    fromTs?: number,
    toTs?: number,
  ): Promise<{ name: string; quantitySold: number; revenue: number }[]> {
    const items = await this.db.saleItems.toArray();
    const sales = (await this.db.sales.toArray()).filter((s) => {
      if (s.status === 'CANCELLED') return false;
      if (fromTs !== undefined && s.saleDate < fromTs) return false;
      if (toTs !== undefined && s.saleDate > toTs) return false;
      return true;
    });
    const validSaleIds = new Set(sales.map((s) => s.id));
    const agg = new Map<string, { qty: number; rev: number }>();
    for (const item of items) {
      if (!validSaleIds.has(item.saleId)) continue;
      const cur = agg.get(item.productId) ?? { qty: 0, rev: 0 };
      cur.qty += item.quantity;
      cur.rev += item.total;
      agg.set(item.productId, cur);
    }
    const products = await this.db.products.toArray();
    const nameMap = new Map(products.map((p) => [p.id, p.name]));
    return [...agg.entries()]
      .map(([pid, v]) => ({ name: nameMap.get(pid) ?? pid, quantitySold: v.qty, revenue: round2(v.rev) }))
      .sort((a, b) => b.quantitySold - a.quantitySold)
      .slice(0, limit);
  }
}
