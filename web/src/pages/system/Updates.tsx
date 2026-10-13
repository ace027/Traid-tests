import { EmptyState, PageHeader, Spinner } from '../../components/ui';

/** Placeholder; the real page replaces this in phase 5 wave 2. */
export function Updates() {
  return (
    <>
      <PageHeader title="Updates" />
      <EmptyState icon={<Spinner />} title="Loading..." />
    </>
  );
}
