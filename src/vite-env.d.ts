/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `full` ships pre-activated; `trial` unlocks through vendor codes. */
  readonly VITE_BUILD_EDITION?: 'full' | 'trial';
  readonly VITE_NO_DEMO?: string;
  readonly VITE_IS_BETA?: string;
}

interface SyncServerInfo {
  running: boolean;
  port: number;
  ips: string[];
  interfaces: { iface: string; address: string }[];
  wsUrls: string[];
  primaryWsUrl: string;
  scanCount: number;
  latestAt: number | null;
  localWsUrl?: string;
  lanWsUrls?: string[];
  /** Pairing token required by the LAN sync server (embedded in wsUrls). */
  token?: string;
}

interface DesktopWindowControls {
  minimize(): Promise<void>;
  maximize(): Promise<boolean>;
  close(): Promise<void>;
  isMaximized(): Promise<boolean>;
  onMaximizedChange(cb: (maximized: boolean) => void): () => void;
}

interface ActivationRequestArgs {
  url: string;
  body: string;
  origin: string;
  timeoutMs: number;
  vendorToken?: string;
}

interface ActivationResponse {
  status: number;
  body: string;
}

interface DesktopBridge {
  isDesktop: boolean;
  print(): Promise<void>;
  getVersion(): Promise<string>;
  getMachineId(): Promise<string>;
  getSyncInfo(): Promise<SyncServerInfo>;
  getSyncWsUrl(): Promise<SyncServerInfo>;
  restartSync(port?: number): Promise<SyncServerInfo>;
  /** Posts to the activation service from the main process (site-origin aware). */
  licenseRequest(args: ActivationRequestArgs): Promise<ActivationResponse>;
  windowControls?: DesktopWindowControls;
}

interface Window {
  desktop?: DesktopBridge;
}
