import { EmptyState, PageHeader, Spinner } from '../../components/ui';

/** Placeholder; the real page replaces this in phase 5 wave 2. */
export function Status() {
  return (
    <>
      <PageHeader title="System" />
      <EmptyState icon={<Spinner />} title="Loading..." />
    </>
  );
}
