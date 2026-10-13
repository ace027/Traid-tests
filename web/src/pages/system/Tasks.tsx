import { useEffect, useMemo, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import type { Command, ScheduledTaskResource } from '@sonarr/shared';
import { Button, Card, PageHeader, StatusBadge, TBody, THead, Table, Td, Th, Tr, type StatusKind } from '../../components/ui';
import { DateCell, LoadError, SkeletonRows } from '../activity/History';
import { durationBetween, formatInterval, humanizeName, isActiveCommand, useCommands, useRunTask, useTasks } from './hooks';

const DAY_MS = 86_400_000;

const commandStatus: Record<Command['status'], { kind: StatusKind; label: string }> = {
  queued: { kind: 'muted', label: 'Queued' },
  started: { kind: 'running', label: 'Started' },
  completed: { kind: 'ok', label: 'Completed' },
  failed: { kind: 'error', label: 'Failed' },
  aborted: { kind: 'warning', label: 'Aborted' },
};

function RunNowButton({ task, label }: { task: ScheduledTaskResource; label: string }) {
  const { run, running } = useRunTask(task.commandName);
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={`Run ${label} now`}
      title={running ? `${label} is running` : `Run ${label} now`}
      loading={running}
      icon={<Play aria-hidden="true" />}
      onClick={run}
    />
  );
}

function ScheduledTable({ labelFor }: { labelFor: (commandName: string) => string }) {
  const tasks = useTasks();
  const COLUMNS = 6;
  if (tasks.isError && !tasks.data) {
    return <LoadError what="scheduled tasks" error={tasks.error} onRetry={() => void tasks.refetch()} />;
  }
  return (
    <Card title="Scheduled" flush aria-busy={tasks.isPending || undefined}>
      <Table caption="Scheduled tasks" captionHidden>
        <THead>
          <tr>
            <Th>Name</Th>
            <Th>Interval</Th>
            <Th>Last Execution</Th>
            <Th>Last Duration</Th>
            <Th>Next Execution</Th>
            <Th>
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </THead>
        <TBody>
          {tasks.isPending ? (
            <SkeletonRows columns={COLUMNS} />
          ) : tasks.data.length === 0 ? (
            <tr>
              <Td colSpan={COLUMNS} className="text-center text-text-muted">
                No scheduled tasks
              </Td>
            </tr>
          ) : (
            tasks.data.map((t) => {
              const label = labelFor(t.commandName) || humanizeName(t.name);
              return (
                <Tr key={t.name}>
                  <Td className="font-medium">{label}</Td>
                  <Td className="whitespace-nowrap">{formatInterval(t.interval)}</Td>
                  <Td>
                    <DateCell iso={t.lastExecution} />
                  </Td>
                  <Td className="whitespace-nowrap">{durationBetween(t.lastStartTime, t.lastExecution)}</Td>
                  <Td>
                    <DateCell iso={t.nextExecution} />
                  </Td>
                  <Td className="text-right">
                    <RunNowButton task={t} label={label} />
                  </Td>
                </Tr>
              );
            })
          )}
        </TBody>
      </Table>
    </Card>
  );
}

function QueueTable({ commands, labelFor }: { commands: ReturnType<typeof useCommands>; labelFor: (n: string) => string }) {
  const COLUMNS = 8;
  const recent = useMemo(() => {
    const cutoff = Date.now() - DAY_MS;
    return (commands.data ?? [])
      .filter((c) => isActiveCommand(c) || Date.parse(c.queued) >= cutoff)
      .sort((a, b) => Date.parse(b.queued) - Date.parse(a.queued) || b.id - a.id);
  }, [commands.data]);

  if (commands.isError && !commands.data) {
    return <LoadError what="the command queue" error={commands.error} onRetry={() => void commands.refetch()} />;
  }
  return (
    <Card title="Queue" description="Commands from the last 24 hours" flush aria-busy={commands.isPending || undefined}>
      <Table caption="Command queue" captionHidden>
        <THead>
          <tr>
            <Th>Name</Th>
            <Th>Status</Th>
            <Th>Queued</Th>
            <Th>Started</Th>
            <Th>Ended</Th>
            <Th>Duration</Th>
            <Th>Message</Th>
            <Th>Trigger</Th>
          </tr>
        </THead>
        <TBody>
          {commands.isPending ? (
            <SkeletonRows columns={COLUMNS} />
          ) : recent.length === 0 ? (
            <tr>
              <Td colSpan={COLUMNS} className="text-center text-text-muted">
                No commands in the last 24 hours
              </Td>
            </tr>
          ) : (
            recent.map((c) => {
              const st = commandStatus[c.status] ?? commandStatus.queued;
              return (
                <Tr key={c.id}>
                  <Td className="font-medium">{labelFor(c.name)}</Td>
                  <Td>
                    <StatusBadge status={st.kind} label={st.label} />
                  </Td>
                  <Td>
                    <DateCell iso={c.queued} />
                  </Td>
                  <Td>
                    <DateCell iso={c.started ?? undefined} />
                  </Td>
                  <Td>
                    <DateCell iso={c.ended ?? undefined} />
                  </Td>
                  <Td className="whitespace-nowrap">{c.duration ?? durationBetween(c.started, c.ended)}</Td>
                  <Td className="max-w-xs text-text-muted">
                    <span className="line-clamp-2 break-words" title={c.message ?? undefined}>
                      {c.message ?? '-'}
                    </span>
                  </Td>
                  <Td className="capitalize">{c.trigger}</Td>
                </Tr>
              );
            })
          )}
        </TBody>
      </Table>
    </Card>
  );
}

/**
 * Announces commands that finish while the page is open. Commands already finished on
 * first load are not announced.
 */
function useCompletionAnnouncement(commands: Command[] | undefined, labelFor: (n: string) => string): string {
  const seen = useRef<Map<number, Command['status']> | null>(null);
  const mountedAt = useRef(Date.now());
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!commands) return;
    const prev = seen.current;
    const next = new Map(commands.map((c) => [c.id, c.status] as const));
    seen.current = next;
    if (!prev) return;
    const done: string[] = [];
    for (const c of commands) {
      const before = prev.get(c.id);
      if (isActiveCommand(c)) continue;
      // Newly seen finished commands only count when they were started during this visit.
      const finishedNow =
        before === undefined ? Boolean(c.ended) && Date.parse(c.ended!) >= mountedAt.current : isActiveCommand({ status: before });
      if (!finishedNow) continue;
      const label = labelFor(c.name);
      done.push(c.status === 'completed' ? `Task ${label} completed` : c.status === 'aborted' ? `Task ${label} aborted` : `Task ${label} failed`);
    }
    if (done.length > 0) setMessage(done.join('. '));
  }, [commands, labelFor]);
  return message;
}

export function Tasks() {
  const tasks = useTasks();
  const commands = useCommands();
  const taskNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tasks.data ?? []) map.set(t.commandName, humanizeName(t.name));
    return map;
  }, [tasks.data]);
  const labelFor = useMemo(() => (commandName: string) => taskNames.get(commandName) ?? humanizeName(commandName), [taskNames]);
  const announcement = useCompletionAnnouncement(commands.data, labelFor);

  return (
    <>
      <PageHeader title="Tasks" description="Scheduled tasks and the commands that ran recently." />
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="task-announcer">
        {announcement}
      </div>
      <div className="flex flex-col gap-6">
        <ScheduledTable labelFor={(n) => taskNames.get(n) ?? ''} />
        <QueueTable commands={commands} labelFor={labelFor} />
      </div>
    </>
  );
}
