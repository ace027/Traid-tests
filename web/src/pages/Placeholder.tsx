import { Sparkles } from 'lucide-react';
import { EmptyState } from '../components/ui/EmptyState';
import { PageHeader } from '../components/ui/PageHeader';

export interface PlaceholderProps {
  title: string;
  description?: string;
}

/** Stand-in for pages that are not built yet. */
export function Placeholder({ title, description }: PlaceholderProps) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <EmptyState
        icon={<Sparkles />}
        title="Coming soon"
        description={`The ${title} page is part of the redesign and will arrive in a later phase.`}
      />
    </>
  );
}
