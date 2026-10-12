import { useState } from 'react';
import { Pencil, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import type { QualityProfile } from '@sonarr/shared';
import { Badge, Button, Card, ConfirmDialog, EmptyState, PageHeader, Spinner, useToast } from '../../components/ui';
import { QualityProfileEditor } from './QualityProfileEditor';
import { errorMessage, useDeleteQualityProfile, useQualityProfileSchema, useQualityProfiles } from './hooks';

export function Profiles() {
  const toast = useToast();
  const profiles = useQualityProfiles();
  const schema = useQualityProfileSchema();
  const [editing, setEditing] = useState<QualityProfile | null>(null);
  const [toDelete, setToDelete] = useState<QualityProfile | null>(null);
  const remove = useDeleteQualityProfile();

  const confirmDelete = () => {
    if (!toDelete) return;
    // Failures (e.g. deleting the last profile) are toasted by the hook with the server's message.
    remove.mutate(toDelete.id, {
      onSuccess: () => toast.success('Quality profile deleted'),
      onSettled: () => setToDelete(null),
    });
  };

  return (
    <>
      <PageHeader
        title="Profiles"
        description="Quality profiles decide which releases Sonarr will download and upgrade."
        actions={
          <Button
            variant="primary"
            icon={<Plus />}
            disabled={!schema.data}
            onClick={() => schema.data && setEditing({ ...schema.data, id: 0, name: '' })}
          >
            Add profile
          </Button>
        }
      />
      {profiles.isPending ? (
        <Spinner label="Loading profiles" />
      ) : profiles.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(profiles.error)}
        </p>
      ) : profiles.data.length === 0 ? (
        <EmptyState icon={<SlidersHorizontal />} title="No quality profiles" description="Add a profile to get started." />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {profiles.data.map((profile) => {
            const allowed = [...profile.items].reverse().filter((i) => i.allowed);
            return (
              <li key={profile.id}>
                <Card
                  title={profile.name}
                  description={profile.upgradeAllowed ? 'Upgrades allowed' : 'Upgrades disabled'}
                  className="h-full"
                  actions={
                    <>
                      <Button variant="ghost" size="sm" aria-label={`Edit ${profile.name}`} onClick={() => setEditing(profile)} icon={<Pencil />} />
                      <Button variant="ghost" size="sm" aria-label={`Delete ${profile.name}`} onClick={() => setToDelete(profile)} icon={<Trash2 />} />
                    </>
                  }
                >
                  <ul className="flex flex-wrap gap-1.5" aria-label={`Allowed qualities for ${profile.name}`}>
                    {allowed.map((item) => (
                      <li key={item.quality.id}>
                        <Badge variant={item.quality.id === profile.cutoff ? 'accent' : 'neutral'}>
                          {item.quality.name}
                          {item.quality.id === profile.cutoff && <span className="sr-only"> (cutoff)</span>}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      {editing && (
        <QualityProfileEditor key={editing.id} profile={editing} onClose={() => setEditing(null)} />
      )}
      <ConfirmDialog
        open={toDelete !== null}
        title="Delete quality profile"
        message={`Delete the profile "${toDelete?.name ?? ''}"?`}
        loading={remove.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={confirmDelete}
      />
    </>
  );
}
