import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TriangleAlert } from 'lucide-react';
import type { Series } from '@sonarr/shared';
import { Button, Modal, useToast } from '../../components/ui';
import { useDeleteSeries } from './hooks';

export interface DeleteSeriesModalProps {
  series: Series;
  open: boolean;
  onClose: () => void;
}

/** Removes a series; files on disk are only deleted when the checkbox is ticked. */
export function DeleteSeriesModal({ series, open, onClose }: DeleteSeriesModalProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const remove = useDeleteSeries({
    onSuccess: () => {
      toast.success(`Deleted ${series.title}`);
      onClose();
      navigate('/');
    },
  });

  const close = () => {
    setDeleteFiles(false);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={`Delete ${series.title}`}
      size="md"
      initialFocusRef={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} onClick={close} disabled={remove.isPending}>
            Cancel
          </Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate({ id: series.id, deleteFiles })}>
            Delete
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-text-muted">
          The series is removed from your library. Files on disk are kept unless you choose to delete them.
        </p>
        <label className="flex cursor-pointer items-center gap-2 font-medium text-text">
          <input
            type="checkbox"
            checked={deleteFiles}
            onChange={(e) => setDeleteFiles(e.target.checked)}
            className="focus-ring size-4 accent-danger"
          />
          Delete series folder
        </label>
        {deleteFiles && (
          <div role="alert" className="flex gap-3 rounded-md border border-danger/40 bg-danger-soft p-3 text-danger">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <p>
              The folder <code className="font-mono break-all">{series.path}</code> and everything in it will be
              permanently deleted.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
