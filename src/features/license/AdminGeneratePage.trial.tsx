import { Navigate } from 'react-router-dom';

/**
 * Trial builds swap this module in for AdminGeneratePage at build time, so the
 * supplier console cannot be reached or fetched from a customer device.
 */
export function AdminGeneratePage() {
  return <Navigate to="/license" replace />;
}
