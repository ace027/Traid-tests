import { Card, PageHeader } from '../../components/ui';
import { useSystemStatus } from './hooks';

const steps = [
  { command: 'git pull', note: 'fetch the latest source' },
  { command: 'npm ci', note: 'install the locked dependencies' },
  { command: 'npm run build', note: 'build the server and the web UI' },
  { command: 'npm start', note: 'restart Sonarr (stop the running instance first)' },
];

export function Updates() {
  const status = useSystemStatus();
  return (
    <>
      <PageHeader title="Updates" />
      <Card title="Updating Sonarr">
        <div className="flex flex-col gap-4 text-sm text-text">
          <p>In-app updates are not supported in this build.</p>
          {status.data && (
            <p className="text-text-muted">
              Installed version: <span className="font-medium text-text">{status.data.version}</span>
            </p>
          )}
          <p>To update, run these commands in the installation folder:</p>
          <ol className="flex list-decimal flex-col gap-2 pl-6">
            {steps.map((s) => (
              <li key={s.command}>
                <code className="rounded bg-surface-hover px-1.5 py-0.5 font-mono text-text">{s.command}</code>
                <span className="text-text-muted"> - {s.note}</span>
              </li>
            ))}
          </ol>
          <p className="text-text-muted">Your data and settings live in the AppData folder and are kept across updates.</p>
        </div>
      </Card>
    </>
  );
}
