import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAppStore } from '../store/app.store';
import type { Permission } from '@/types';
import { MainLayout } from '@/components/common/MainLayout';
import { LoginPage } from '@/features/auth/LoginPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { PosPage } from '@/features/sales/PosPage';
import { ProductsPage } from '@/features/products/ProductsPage';
import { CategoriesPage } from '@/features/categories/CategoriesPage';
import { InventoryPage } from '@/features/inventory/InventoryPage';
import { CustomersPage } from '@/features/customers/CustomersPage';
import { CustomerProfilePage } from '@/features/customers/CustomerProfilePage';
import { SalesPage } from '@/features/sales/SalesPage';
import { InstallmentsPage } from '@/features/installments/InstallmentsPage';
import { ContractPage } from '@/features/installments/ContractPage';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { AuditPage } from '@/features/audit/AuditPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { LicensePage } from '@/features/license/LicensePage';
import { AdminGeneratePage } from '@/features/license/AdminGeneratePage';
import { PhoneScannerPage } from '@/features/scanner/PhoneScannerPage';

// The trial build aliases AdminGeneratePage to a redirect stub (vite.config), so
// the supplier console is neither routed nor shipped there.
const FULL_EDITION = import.meta.env.VITE_BUILD_EDITION !== 'trial';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const authUser = useAppStore((s) => s.authUser);
  const location = useLocation();
  if (!authUser) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

function RequireLicense({ children }: { children: React.ReactNode }) {
  const [ok, setOk] = useState<boolean | null>(null);
  const location = useLocation();

  useEffect(() => {
    let alive = true;
    const check = () => {
      import('@/services/license/license.service')
        .then((m) => m.hasValidLicense())
        .then((valid) => { if (alive) setOk(valid); })
        .catch(() => { if (alive) setOk(false); });
    };
    check();
    const onRevoked = () => setOk(false);
    const onFocus = () => check();
    window.addEventListener('license:revoked', onRevoked);
    window.addEventListener('focus', onFocus);
    return () => {
      alive = false;
      window.removeEventListener('license:revoked', onRevoked);
      window.removeEventListener('focus', onFocus);
    };
  }, [location.pathname]);

  if (ok === null) return null;
  if (!ok) return <Navigate to="/license" replace />;
  return <>{children}</>;
}

export function Guard({ permission, children }: { permission?: Permission; children: React.ReactNode }) {
  const hasPermission = useAppStore((s) => s.hasPermission);
  if (permission && !hasPermission(permission)) return <div className="p-8 text-red-600">403</div>;
  return <>{children}</>;
}

export function AppRouter() {
  return (
    <Routes>
      <Route path="/license" element={<LicensePage />} />
      {FULL_EDITION && <Route path="/license/generate" element={<AdminGeneratePage />} />}
      {FULL_EDITION && <Route path="/generate" element={<AdminGeneratePage />} />}
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireLicense>
            <RequireAuth>
              <MainLayout />
            </RequireAuth>
          </RequireLicense>
        }
      >
        <Route index element={<Guard><DashboardPage /></Guard>} />
        <Route path="pos" element={<Guard permission="sales.create"><PosPage /></Guard>} />
        <Route path="products" element={<Guard permission="products.view"><ProductsPage /></Guard>} />
        <Route path="categories" element={<Guard permission="products.view"><CategoriesPage /></Guard>} />
        <Route path="inventory" element={<Guard permission="inventory.view"><InventoryPage /></Guard>} />
        <Route path="customers" element={<Guard permission="customers.view"><CustomersPage /></Guard>} />
        <Route path="customers/:id" element={<Guard permission="customers.view"><CustomerProfilePage /></Guard>} />
        <Route path="sales" element={<Guard permission="sales.view"><SalesPage /></Guard>} />
        <Route path="installments" element={<InstallmentsPage />} />
        <Route path="contracts/:saleId" element={<ContractPage />} />
        <Route path="reports" element={<Guard permission="reports.view"><ReportsPage /></Guard>} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="scanner" element={<PhoneScannerPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
