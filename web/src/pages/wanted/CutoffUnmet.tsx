import { CircleCheck } from 'lucide-react';
import { WantedTable } from './WantedTable';

export function CutoffUnmet() {
  return (
    <WantedTable
      kind="cutoff"
      title="Cutoff Unmet"
      description="Episodes whose file is below the quality profile's cutoff."
      emptyTitle="No episodes below cutoff"
      emptyDescription="Every monitored episode file meets its quality profile's cutoff."
      emptyIcon={<CircleCheck />}
    />
  );
}
