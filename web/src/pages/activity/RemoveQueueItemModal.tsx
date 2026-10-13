import { useId, useState } from 'react';
import type { QueueResource } from '@sonarr/shared';
import { Button, Modal } from '../../components/ui';
import type { RemoveOptions } from './hooks';

function CheckboxOption({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description: string;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={`${id}-help`}
        className="focus-ring mt-0.5 size-4 shrink-0 rounded border-control-border accent-accent"
      />
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="cursor-pointer text-sm font-medium text-text">
          {label}
        </label>
        <p id={`${id}-help`} className="text-xs text-text-muted">
          {description}
        </p>
      </div>
    </div>
  );
}

export interface RemoveQueueItemModalProps {
  /** Items to remove; the modal is open while non-empty. */
  items: QueueResource[];
  loading?: boolean;
  onConfirm: (options: RemoveOptions) => void;
  onClose: () => void;
}

/** Confirms removing one or more queue items, optionally from the client and onto the blocklist. */
export function RemoveQueueItemModal({ items, loading, onConfirm, onClose }: RemoveQueueItemModalProps) {
  const [removeFromClient, setRemoveFromClient] = useState(true);
  const [blocklist, setBlocklist] = useState(false);
  const single = items.length === 1 ? items[0] : null;

  return (
    <Modal
      open={items.length > 0}
      onClose={onClose}
      title={single ? 'Remove from queue' : `Remove ${items.length} items from queue`}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={loading} onClick={() => onConfirm({ removeFromClient, blocklist })}>
            Remove
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {single ? (
          <p className="text-sm break-words text-text [overflow-wrap:anywhere]">
            Remove <strong>{single.title}</strong> from the queue?
          </p>
        ) : (
          <p className="text-sm text-text">Remove the {items.length} selected items from the queue?</p>
        )}
        <CheckboxOption
          checked={removeFromClient}
          onChange={setRemoveFromClient}
          label="Remove from download client"
          description="Deletes the download and its files from the download client. Otherwise Sonarr just stops tracking it."
        />
        <CheckboxOption
          checked={blocklist}
          onChange={setBlocklist}
          label="Add release to blocklist"
          description="Sonarr will not grab this release again; automatic searches look for a different one."
        />
      </div>
    </Modal>
  );
}
