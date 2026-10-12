import { useRef, useState, type FormEvent } from 'react';
import { Pencil, Plus, Tag as TagIcon, Trash2 } from 'lucide-react';
import type { Tag } from '@sonarr/shared';
import { ApiError } from '../../lib/api';
import { Button, Card, ConfirmDialog, EmptyState, FormField, Input, Modal, PageHeader, Spinner, useToast } from '../../components/ui';
import { errorMessage, useCreateTag, useDeleteTag, useTags, useUpdateTag } from './hooks';

const fieldMessage = (error: unknown) =>
  error ? (error instanceof ApiError ? (error.fieldError('label') ?? errorMessage(error)) : errorMessage(error)) : undefined;

export function Tags() {
  const toast = useToast();
  const tags = useTags();
  const [label, setLabel] = useState('');
  const [editing, setEditing] = useState<Tag | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [toDelete, setToDelete] = useState<Tag | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const create = useCreateTag({
    onSuccess: () => {
      setLabel('');
      toast.success('Tag added');
    },
  });
  const update = useUpdateTag({
    onSuccess: () => {
      setEditing(null);
      toast.success('Tag updated');
    },
  });
  const remove = useDeleteTag({
    onSuccess: () => {
      setToDelete(null);
      toast.success('Tag deleted');
    },
  });

  const onAdd = (e: FormEvent) => {
    e.preventDefault();
    if (label.trim()) create.mutate(label.trim());
  };
  const onSaveEdit = (e: FormEvent) => {
    e.preventDefault();
    if (editing && editLabel.trim()) update.mutate({ ...editing, label: editLabel.trim() });
  };
  const openEdit = (tag: Tag) => {
    update.reset();
    setEditLabel(tag.label);
    setEditing(tag);
  };

  return (
    <>
      <PageHeader title="Tags" description="Tags link series to restrictions, lists and notifications." />
      <Card title="Tags" flush>
        <div className="p-5">
          {tags.isPending ? (
            <Spinner label="Loading tags" />
          ) : tags.isError ? (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(tags.error)}
            </p>
          ) : tags.data.length === 0 ? (
            <EmptyState
              icon={<TagIcon />}
              title="No tags yet"
              description="Add a tag below to start grouping your series."
              action={
                <Button variant="secondary" onClick={() => inputRef.current?.focus()}>
                  Add a tag
                </Button>
              }
            />
          ) : (
            <ul className="flex flex-wrap gap-3">
              {tags.data.map((tag) => (
                <li key={tag.id} className="flex items-center gap-1 rounded-lg border border-border bg-surface pl-3">
                  <span className="text-sm font-medium text-text">{tag.label}</span>
                  <Button variant="ghost" size="sm" aria-label={`Edit tag ${tag.label}`} onClick={() => openEdit(tag)} icon={<Pencil />} />
                  <Button variant="ghost" size="sm" aria-label={`Delete tag ${tag.label}`} onClick={() => setToDelete(tag)} icon={<Trash2 />} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <form onSubmit={onAdd} className="flex flex-wrap items-start gap-3 border-t border-border p-5" noValidate>
          <FormField label="New tag" error={fieldMessage(create.error)} className="min-w-64 flex-1">
            <Input ref={inputRef} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="anime" autoComplete="off" />
          </FormField>
          <Button type="submit" variant="primary" className="mt-6" loading={create.isPending} disabled={!label.trim()} icon={<Plus />}>
            Add tag
          </Button>
        </form>
      </Card>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit tag"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form="edit-tag-form" loading={update.isPending} disabled={!editLabel.trim()}>
              Save
            </Button>
          </>
        }
      >
        <form id="edit-tag-form" onSubmit={onSaveEdit} noValidate>
          <FormField label="Label" error={fieldMessage(update.error)}>
            <Input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} autoComplete="off" />
          </FormField>
        </form>
      </Modal>

      <ConfirmDialog
        open={toDelete !== null}
        title="Delete tag"
        message={`Delete the tag "${toDelete?.label ?? ''}"?`}
        loading={remove.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
      />
    </>
  );
}
