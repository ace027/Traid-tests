import { EmptyState, PageHeader, Spinner } from '../../components/ui';

/** Placeholder; the real page replaces this in phase 5 wave 2. */
export function Backup() {
  return (
    <>
      <PageHeader title="Backup" />
      <EmptyState icon={<Spinner />} title="Loading..." />
    </>
  );
}
