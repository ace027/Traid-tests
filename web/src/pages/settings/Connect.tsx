import { EmptyState, PageHeader, Spinner } from '../../components/ui';

/** Placeholder; the real page replaces this in phase 5 wave 2. */
export function Connect() {
  return (
    <>
      <PageHeader title="Connect" />
      <EmptyState icon={<Spinner />} title="Loading..." />
    </>
  );
}
