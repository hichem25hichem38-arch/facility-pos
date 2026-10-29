import { useEffect } from 'react';
import { HashRouter } from 'react-router-dom';
import { AppRouter } from './router/router';
import { ToastContainer } from '@/components/ui';
import { useApplyTheme } from '@/hooks/useApplyTheme';
import { useAppStore } from './store/app.store';

export function App() {
  useApplyTheme();

  useEffect(() => {
    (async () => {
      const { getDb } = await import('@/database/db');
      await getDb().open();
      // One device id everywhere (license, sync, audit): prefer the machine id.
      const { getDeviceId } = await import('@/services/license/license.service');
      await getDeviceId().catch(() => {});
      const { initScanSync } = await import('@/services/sync/scan.service');
      void initScanSync().catch(() => {});
      const { startLicenseHeartbeat } = await import('@/services/license/heartbeat.service');
      startLicenseHeartbeat();
      const { UserService } = await import('@/services/settings/settings.service');
      const { SettingsService } = await import('@/services/settings/settings.service');
      await new UserService().ensureDefaults();
      const settings = await new SettingsService().get();
      useAppStore.getState().setCurrency(settings.currency);
      if (!useAppStore.getState().storeName) useAppStore.getState().setStoreName(settings.storeName);
      // نسخة العميل بدون بيانات تجريبية: VITE_NO_DEMO=true أو localStorage CLIENT_NO_DEMO=1
      const noDemo = (import.meta as unknown as { env?: { VITE_NO_DEMO?: string } }).env?.VITE_NO_DEMO === 'true'
        || (typeof localStorage !== 'undefined' && localStorage.getItem('CLIENT_NO_DEMO') === '1');
      if (!noDemo) {
        const { SeedService } = await import('@/database/seed/seed.service');
        await new SeedService().seedDemoData();
      }
      // نسخ احتياطي تلقائي يومي
      try {
        const { AutoBackupService } = await import('@/services/backup/autoBackup.service');
        AutoBackupService.maybeRun().then(r => { if (r.did) console.log('[auto-backup]', r.reason); });
        // فحص كل ساعة
        setInterval(() => AutoBackupService.maybeRun().then(r => { if (r.did) console.log('[auto-backup interval]', r.reason); }), 60 * 60 * 1000);
      } catch {}
    })().catch(console.error);
  }, []);

  return (
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ToastContainer />
      <AppRouter />
    </HashRouter>
  );
}
