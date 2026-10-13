import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Bell, FlaskConical, Plus } from 'lucide-react';
import { NOTIFICATION_EVENT_FLAGS, type NotificationResource } from '@sonarr/shared';
import { Badge, Button, EmptyState, PageHeader, Spinner, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { ProviderCard } from './Indexers';
import { errorMessage } from './hooks';
import type { ProviderTestResult } from './IndexerModal';
import {
  NotificationModal,
  NotificationTemplatePicker,
  triggerLabels,
  useNotificationSchema,
  useNotifications,
} from './NotificationModal';

export function Connect() {
  const notifications = useNotifications();
  const toast = useToast();
  const [picking, setPicking] = useState(false);
  const schema = useNotificationSchema(picking);
  const [editing, setEditing] = useState<NotificationResource | null>(null);

  const testAll = useMutation<ProviderTestResult[], unknown, void>({
    mutationFn: () => api.post<ProviderTestResult[]>('notification/testall'),
    onSuccess: (results) => {
      const failed = (results ?? []).filter((r) => !r.isValid);
      if (failed.length === 0) {
        toast.success('All tests passed');
        return;
      }
      for (const r of failed) {
        const name = notifications.data?.find((n) => n.id === r.id)?.name ?? `Connection ${r.id}`;
        toast.error(`${name}: ${r.validationFailures?.[0]?.errorMessage ?? 'Test failed'}`);
      }
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const add = (
    <Button variant="primary" icon={<Plus aria-hidden="true" />} onClick={() => setPicking(true)}>
      Add Connection
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Connect"
        description="Connections send notifications to other services when things happen."
        actions={
          <>
            <Button
              icon={<FlaskConical aria-hidden="true" />}
              loading={testAll.isPending}
              disabled={!notifications.data?.length}
              onClick={() => testAll.mutate()}
            >
              Test All
            </Button>
            {add}
          </>
        }
      />
      {notifications.isPending ? (
        <Spinner label="Loading connections" />
      ) : notifications.isError ? (
        <div role="alert" className="flex items-center gap-3 text-sm text-danger">
          <span>{errorMessage(notifications.error)}</span>
          <Button size="sm" onClick={() => void notifications.refetch()}>
            Retry
          </Button>
        </div>
      ) : notifications.data.length === 0 ? (
        <EmptyState
          icon={<Bell />}
          title="No connections"
          description="Add a connection to get notified about grabs, imports and health issues."
          action={add}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Connections">
          {notifications.data.map((n) => {
            const on = NOTIFICATION_EVENT_FLAGS.filter((f) => n[f]);
            return (
              <li key={n.id}>
                <ProviderCard name={n.name} subtitle={n.implementation} onOpen={() => setEditing(n)}>
                  {on.length === 0 ? (
                    <Badge variant="neutral">No triggers enabled</Badge>
                  ) : (
                    on.map((f) => (
                      <Badge key={f} variant="success">
                        {triggerLabels[f]}
                      </Badge>
                    ))
                  )}
                </ProviderCard>
              </li>
            );
          })}
        </ul>
      )}
      <NotificationTemplatePicker
        open={picking}
        schema={schema}
        onPick={(template) => {
          setPicking(false);
          setEditing({ ...template, id: 0, name: template.name ?? '' });
        }}
        onClose={() => setPicking(false)}
      />
      {editing && <NotificationModal key={editing.id} notification={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
