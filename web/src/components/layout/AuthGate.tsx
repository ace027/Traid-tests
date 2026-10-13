import { useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadInitialize } from '../../lib/api';

/**
 * Sends the browser to /setup while first-run setup is pending, or to /login when forms
 * authentication is on and the visitor is not signed in. Renders its children meanwhile; the
 * server enforces access, this only picks the right screen.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  useEffect(() => {
    let active = true;
    loadInitialize().then(
      (init) => {
        if (!active) return;
        if (init.setupRequired) navigate('/setup', { replace: true });
        else if (!init.authenticated && init.authMethod === 'forms') navigate('/login', { replace: true });
      },
      () => {
        // Offline or failed: stay put; API calls surface the error.
      },
    );
    return () => {
      active = false;
    };
  }, [navigate]);
  return <>{children}</>;
}
