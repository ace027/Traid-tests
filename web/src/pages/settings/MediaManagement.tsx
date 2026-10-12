import { useState, type FormEvent } from 'react';
import { FolderPlus, Trash2, TriangleAlert } from 'lucide-react';
import type { RootFolder } from '@sonarr/shared';
import { ApiError } from '../../lib/api';
import { Badge, Button, Card, ConfirmDialog, EmptyState, FormField, Input, PageHeader, Spinner, Table, TBody, Td, Th, THead, Tr, useToast } from '../../components/ui';
import { errorMessage, formatBytes, useAddRootFolder, useDeleteRootFolder, useRootFolders } from './hooks';

export function MediaManagement() {
  const toast = useToast();
  const folders = useRootFolders();
  const [path, setPath] = useState('');
  const [toDelete, setToDelete] = useState<RootFolder | null>(null);

  const add = useAddRootFolder({
    onSuccess: () => {
      setPath('');
      toast.success('Root folder added');
    },
  });
  const remove = useDeleteRootFolder({
    onSuccess: () => {
      setToDelete(null);
      toast.success('Root folder removed');
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (path.trim()) add.mutate(path.trim());
  };

  const addError = add.error
    ? add.error instanceof ApiError
      ? (add.error.fieldError('path') ?? errorMessage(add.error))
      : errorMessage(add.error)
    : undefined;

  return (
    <>
      <PageHeader title="Media Management" description="Where Sonarr finds and stores your series." />
      <Card title="Root Folders" description="Series are added to one of these folders." flush>
        {folders.isPending ? (
          <div className="p-5">
            <Spinner label="Loading root folders" />
          </div>
        ) : folders.isError ? (
          <p role="alert" className="p-5 text-sm text-danger">
            {errorMessage(folders.error)}
          </p>
        ) : folders.data.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={<FolderPlus />} title="No root folders" description="Add a root folder below to start adding series." />
          </div>
        ) : (
          <Table caption="Root folders" captionHidden>
            <THead>
              <Tr>
                <Th>Path</Th>
                <Th>Free space</Th>
                <Th>Status</Th>
                <Th className="text-right">
                  <span className="sr-only">Actions</span>
                </Th>
              </Tr>
            </THead>
            <TBody>
              {folders.data.map((folder) => (
                <Tr key={folder.id}>
                  <Td className="font-mono text-xs">{folder.path}</Td>
                  <Td>{folder.accessible ? formatBytes(folder.freeSpace) : 'Unknown'}</Td>
                  <Td>
                    {folder.accessible ? (
                      <Badge variant="success" dot>
                        Accessible
                      </Badge>
                    ) : (
                      <Badge variant="warning">
                        <TriangleAlert aria-hidden="true" className="size-3.5" />
                        Inaccessible
                      </Badge>
                    )}
                  </Td>
                  <Td className="text-right">
                    <Button variant="ghost" size="sm" aria-label={`Delete ${folder.path}`} onClick={() => setToDelete(folder)} icon={<Trash2 />}>
                      Delete
                    </Button>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        <form onSubmit={onSubmit} className="flex flex-wrap items-start gap-3 border-t border-border p-5" noValidate>
          <FormField label="New root folder path" error={addError} className="min-w-64 flex-1">
            <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/tv" autoComplete="off" />
          </FormField>
          <Button type="submit" variant="primary" className="mt-6" loading={add.isPending} disabled={!path.trim()} icon={<FolderPlus />}>
            Add root folder
          </Button>
        </form>
      </Card>
      <ConfirmDialog
        open={toDelete !== null}
        title="Delete root folder"
        message={
          <>
            Remove <span className="font-mono">{toDelete?.path}</span> from Sonarr? Files on disk are not deleted.
          </>
        }
        loading={remove.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
      />
    </>
  );
}
