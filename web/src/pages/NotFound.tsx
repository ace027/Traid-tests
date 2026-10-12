import { Link, useLocation } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { EmptyState } from '../components/ui/EmptyState';
import { PageHeader } from '../components/ui/PageHeader';
import { buttonClasses } from '../components/ui/Button';

export function NotFound() {
  const { pathname } = useLocation();
  return (
    <>
      <PageHeader title="Page not found" />
      <EmptyState
        icon={<Compass />}
        title="We couldn't find that page"
        description={
          <>
            Nothing lives at <code className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-xs">{pathname}</code>.
          </>
        }
        action={
          <Link to="/" className={buttonClasses('primary')}>
            Back to Series
          </Link>
        }
      />
    </>
  );
}
