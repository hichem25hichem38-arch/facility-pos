import { BaseRepository } from './base.repository';
import { getDb } from '@/database/db';
import { newId } from '@/utils/helpers';
import type { Product, SaleItem } from '@/types';

export class ProductRepository extends BaseRepository<Product> {
  constructor() {
    super('products');
  }

  async findByBarcode(barcode: string): Promise<Product | undefined> {
    return getDb().products.where('barcode').equals(barcode).first();
  }

  async search(term: string, limit = 50): Promise<Product[]> {
    const lower = term.toLowerCase();
    return getDb().products
      .filter((p) => p.isActive &&
        (p.name.toLowerCase().includes(lower) || p.sku.toLowerCase().includes(lower) || p.barcode.includes(term)))
      .limit(limit)
      .toArray();
  }

  async listLowStock(): Promise<Product[]> {
    return getDb().products.filter((p) => p.isActive && p.stockQuantity <= p.minimumStock).toArray();
  }

  async updateStock(productId: string, newQuantity: number): Promise<void> {
    await this.update(productId, { stockQuantity: newQuantity });
  }
}

export class SaleItemRepository {
  protected db = getDb();

  async bulkCreate(items: Omit<SaleItem, 'id'>[]): Promise<SaleItem[]> {
    const entities = items.map((i) => ({ ...i, id: newId() }));
    await this.db.saleItems.bulkAdd(entities);
    return entities;
  }

  async getBySaleId(saleId: string): Promise<SaleItem[]> {
    return this.db.saleItems.where('saleId').equals(saleId).toArray();
  }
}

export class CategoryRepository extends BaseRepository<import('@/types').Category> {
  constructor() {
    super('categories');
  }
}

export class CustomerRepository extends BaseRepository<import('@/types').Customer> {
  constructor() {
    super('customers');
  }

  private db = getDb();

  async nextCustomerNumber(): Promise<string> {
    const count = await this.db.customers.count();
    return `C-${String(count + 1).padStart(5, '0')}`;
  }

  async search(term: string, limit = 50): Promise<import('@/types').Customer[]> {
    const lower = term.toLowerCase();
    return this.db.customers
      .filter((c) => c.fullName.toLowerCase().includes(lower) || (c.phone ?? '').includes(term))
      .limit(limit)
      .toArray();
  }
}

export class SaleRepository extends BaseRepository<import('@/types').Sale> {
  constructor() {
    super('sales');
  }

  private db = getDb();

  async nextInvoiceNumber(date: number): Promise<string> {
    const year = new Date(date).getFullYear();
    const count = await this.db.sales.count();
    return `INV-${year}-${String(count + 1).padStart(5, '0')}`;
  }

  async getByDateRange(from: number, to: number): Promise<import('@/types').Sale[]> {
    return this.db.sales.where('saleDate').between(from, to, true, true).toArray();
  }
}
