import { PartyPopper } from 'lucide-react';
import { WantedTable } from './WantedTable';

export function Missing() {
  return (
    <WantedTable
      kind="missing"
      title="Missing"
      description="Monitored episodes that have aired but have no file yet."
      emptyTitle="No missing episodes"
      emptyDescription="Every monitored episode that has aired is on disk."
      emptyIcon={<PartyPopper />}
    />
  );
}
