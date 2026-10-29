# نظام البيع بالتقسيط وإدارة المخزون — Installment POS

تطبيق ويب + سطح مكتب (Electron) لإدارة المنتجات، المخزون، العملاء، المبيعات النقدية، البيع بالتقسيط، الأقساط، الدفعات، التقارير، والصلاحيات — Offline-First بالكامل.

## Features
- **POS**: بيع نقدي وتقسيط مع مسح باركود واختصارات لوحة مفاتيح (F2 بحث / F4 عميل / F8 إتمام / Esc إغلاق)
- **أقساط دقيقة**: `sum(installments) == financedAmount` — القسط الأخير يمتص فرق الكسور
- **دفعات جزئية/كاملة** مع منع الدفع الزائد وحساب المتأخرات تلقائيًا (عدد أيام التأخير)
- **مخزون قابل للتتبع**: كل تغيير كمية يسجّل كـ Inventory Transaction
- **إلغاء بيع** يعيد المخزون ولا يحذف السجلات المالية
- **صلاحيات** ADMIN / MANAGER / CASHIER مع PBKDF2 password hashing
- **تقارير**: مبيعات، أرباح، مخزون، تقسيط، أكثر المنتجات مبيعًا
- **Audit Log** لكل عملية حساسة
- **نسخ احتياطي/استعادة** بصيغة JSON
- **i18n**: العربية (RTL) / Français / English + وضع داكن + عملة قابلة للإعداد

## Architecture

```
UI (React Components)
   ↓
Services  (Business Logic: SaleService, PaymentService, ReportService…)
   ↓
Repositories (ProductRepository, SaleRepository…)
   ↓
Database Adapter (Dexie/IndexedDB — قابل للاستبدال)
```

- لا تتعامل المكونات مع قاعدة البيانات مباشرة.
- كل عملية بيع Atomic داخل Dexie transaction.
- Sync fields على كل كيان (`syncStatus`, `version`, `deviceId`) جاهزة لمزامنة مستقبلية عبر REST API.

## Folder Structure
```
src/
├── app/          # App root, router, stores (Zustand)
├── components/   # UI primitives + layout
├── features/     # auth, dashboard, pos, products, inventory, customers,
│                 # sales, installments, reports, audit, settings
├── services/     # Business logic + installments calculator + printing/sync/backup
├── repositories/ # Data access layer
├── database/     # Dexie schema + seed data
├── types/ constants/ utils/ hooks/ i18n/
electron/         # main (contextIsolation) + preload (limited IPC API)
tests/            # unit + integration
```

## Installation & Development
```bash
npm install
npm run dev            # Web app on http://localhost:5173
```

### Default accounts
| User | Password | Role |
|---|---|---|
| admin | admin123 | ADMIN |
| caissier | cashier123 | CASHIER |

> غيّر كلمات المرور في الإنتاج.

## Environment Variables
انسخ `.env.example` إلى `.env`:
```
API_URL=            # خادم المستقبل للمزامنة
APP_ENV=development
SYNC_ENABLED=false
DEVICE_ID=POS-01
```

## Testing
```bash
npm test             # 15 tests: installments calc, overdue, E2E flow,
                     # payments, stock atomicity, cancel sale, auth
```

## Electron Desktop
```bash
npm run electron:dev      # development
npm run electron:build    # production installer (NSIS on Windows)
```

## Database
- IndexedDB عبر Dexie (14 tables مع indexes وunique constraints على SKU/barcode/invoiceNumber).
- لا حذف مباشر للبيانات المالية: حالات `CANCELLED` فقط + Audit Log.
- Migrations عبر نسخ Dexie versioning.
- Backup/Restore من صفحة الإعدادات.

## Sync (future)
كل كيان يحمل `syncStatus/version/deviceId`. عند توفر خادم:
نفّذ push/pull ضد `/api` contract؛ سياسة التعارض: **server-authoritative** مع تسجيل CONFLICT محليًا.
