import { useId, useState } from 'react';
import { ChevronDown, RefreshCw, ScrollText } from 'lucide-react';
import type { LogEntry, LogLevel } from '@sonarr/shared';
import { Button, Card, EmptyState, PageHeader, Select, StatusBadge, TBody, THead, Table, Td, Th, Tr, type StatusKind } from '../../components/ui';
import { cn } from '../../lib/cn';
import { DateCell, LoadError, Pager, SkeletonRows } from '../activity/History';
import { useLogs } from './hooks';

export const EVENTS_PAGE_SIZE = 50;
/** Messages longer than this are clamped in the table; the full text is in the details row. */
const LONG_MESSAGE = 300;
const COLUMNS = 5;

const levelDisplay: Record<LogLevel, { kind: StatusKind; label: string }> = {
  trace: { kind: 'muted', label: 'Trace' },
  debug: { kind: 'muted', label: 'Debug' },
  info: { kind: 'info', label: 'Info' },
  warn: { kind: 'warning', label: 'Warn' },
  error: { kind: 'error', label: 'Error' },
  fatal: { kind: 'error', label: 'Fatal' },
};

const levelOptions = [
  { value: '', label: 'All' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warn' },
  { value: 'error', label: 'Error' },
];

function EventRow({ entry }: { entry: LogEntry }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const level = levelDisplay[entry.level] ?? levelDisplay.info;
  const long = entry.message.length > LONG_MESSAGE;
  const expandable = Boolean(entry.exception) || long;
  return (
    <>
      <Tr>
        <Td>
          <DateCell iso={entry.time} />
        </Td>
        <Td>
          <StatusBadge status={level.kind} label={level.label} />
        </Td>
        <Td className="max-w-40 truncate text-text-muted" title={entry.logger}>
          {entry.logger}
        </Td>
        <Td className="max-w-xl">
          <span className={cn('block break-words whitespace-pre-wrap', long && 'line-clamp-3')}>{entry.message}</span>
        </Td>
        <Td className="text-right">
          {expandable && (
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={open}
              aria-controls={detailsId}
              onClick={() => setOpen((v) => !v)}
              iconRight={<ChevronDown aria-hidden="true" className={cn('transition-transform', open && 'rotate-180')} />}
            >
              {open ? 'Hide details' : entry.exception ? 'Show exception' : 'Show details'}
            </Button>
          )}
        </Td>
      </Tr>
      {expandable && open && (
        <tr id={detailsId}>
          <td colSpan={COLUMNS} className="bg-surface px-4 py-3">
            {long && <p className="mb-2 text-sm break-words whitespace-pre-wrap text-text">{entry.message}</p>}
            {entry.exception && (
              <pre
                tabIndex={0}
                aria-label="Exception"
                className="focus-ring max-h-80 overflow-auto rounded-md border border-border bg-surface-raised p-3 font-mono text-xs whitespace-pre-wrap text-text"
              >
                {entry.exception}
              </pre>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export function Events() {
  const [page, setPage] = useState(1);
  const [level, setLevel] = useState<LogLevel | ''>('');
  const logs = useLogs({ page, pageSize: EVENTS_PAGE_SIZE, level: level || undefined });
  const levelId = useId();
  const data = logs.data;

  return (
    <>
      <PageHeader
        title="Events"
        description="Recent log entries, newest first."
        toolbar={
          <>
            <label htmlFor={levelId} className="text-sm text-text-muted">
              Level
            </label>
            <Select
              id={levelId}
              options={levelOptions}
              value={level}
              onChange={(e) => {
                setLevel(e.target.value as LogLevel | '');
                setPage(1);
              }}
              className="w-36"
            />
            <Button
              size="sm"
              icon={<RefreshCw aria-hidden="true" />}
              loading={logs.isFetching && !logs.isPending}
              onClick={() => void logs.refetch()}
              className="ml-auto"
            >
              Refresh
            </Button>
          </>
        }
      />

      {logs.isError && !data ? (
        <LoadError what="events" error={logs.error} onRetry={() => void logs.refetch()} />
      ) : data && data.totalRecords === 0 ? (
        <EmptyState
          icon={<ScrollText />}
          title="No events"
          description={level ? 'No log entries at this level.' : 'Nothing has been logged yet.'}
        />
      ) : (
        <Card flush aria-busy={logs.isFetching || undefined}>
          <Table caption="Log events" captionHidden>
            <THead>
              <tr>
                <Th>Time</Th>
                <Th>Level</Th>
                <Th>Logger</Th>
                <Th>Message</Th>
                <Th>
                  <span className="sr-only">Details</span>
                </Th>
              </tr>
            </THead>
            <TBody>
              {!data ? (
                <SkeletonRows columns={COLUMNS} />
              ) : (
                data.records.slice(0, EVENTS_PAGE_SIZE).map((e) => <EventRow key={e.id} entry={e} />)
              )}
            </TBody>
          </Table>
          {data && (
            <Pager
              label="Events pages"
              page={page}
              totalRecords={data.totalRecords}
              pageSize={EVENTS_PAGE_SIZE}
              noun={['event', 'events']}
              onPage={setPage}
            />
          )}
        </Card>
      )}
    </>
  );
}
