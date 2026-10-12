import { useState } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  FormField,
  Input,
  Modal,
  Select,
  Switch,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  ToastProvider,
  useToast,
  TOAST_DURATION_MS,
} from './index';

function ModalHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open dialog</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Edit tag" footer={<Button>Save</Button>}>
        <FormField label="Label">
          <Input />
        </FormField>
      </Modal>
    </>
  );
}

describe('Modal', () => {
  it('is labelled, traps focus and closes on Escape returning focus', async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);
    const trigger = screen.getByRole('button', { name: 'Open dialog' });
    await user.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Edit tag' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const close = within(dialog).getByRole('button', { name: 'Close' });
    const input = within(dialog).getByLabelText('Label');
    const save = within(dialog).getByRole('button', { name: 'Save' });
    expect(close).toHaveFocus();

    await user.tab();
    expect(input).toHaveFocus();
    await user.tab();
    expect(save).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(save).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes on backdrop click', async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);
    await user.click(screen.getByRole('button', { name: 'Open dialog' }));
    await user.click(screen.getByTestId('modal-backdrop'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('ConfirmDialog', () => {
  it('focuses cancel and confirms', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog open title="Delete tag" message="Really?" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe('Switch', () => {
  it('toggles aria-checked', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [on, setOn] = useState(false);
      return (
        <FormField label="Monitored">
          <Switch checked={on} onCheckedChange={setOn} />
        </FormField>
      );
    }
    render(<Harness />);
    const sw = screen.getByRole('switch', { name: 'Monitored' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await user.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'true');
    await user.keyboard(' ');
    expect(sw).toHaveAttribute('aria-checked', 'false');
  });
});

describe('FormField', () => {
  it('links label, help and error to the control', () => {
    render(
      <FormField label="Path" help="Absolute path" error="Path does not exist" required>
        <Input />
      </FormField>,
    );
    const input = screen.getByLabelText(/Path/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(input).toHaveAccessibleDescription('Absolute path Path does not exist');
  });
});

describe('Table', () => {
  it('exposes aria-sort on sortable headers', async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    render(
      <Table caption="Root folders">
        <THead>
          <Tr>
            <Th sortable sortDirection="ascending" onSort={onSort}>
              Path
            </Th>
            <Th>Free space</Th>
          </Tr>
        </THead>
        <TBody>
          <Tr>
            <Td>/tv</Td>
            <Td>1 TB</Td>
          </Tr>
        </TBody>
      </Table>,
    );
    expect(screen.getByRole('columnheader', { name: /Path/ })).toHaveAttribute('aria-sort', 'ascending');
    await user.click(screen.getByRole('button', { name: /Path/ }));
    expect(onSort).toHaveBeenCalled();
  });
});

describe('Toast', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('announces in a polite live region and auto-dismisses after 5 s', () => {
    vi.useFakeTimers();
    function Trigger() {
      const toast = useToast();
      return <button onClick={() => toast.success('Tag saved')}>Save</button>;
    }
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    act(() => {
      screen.getByRole('button', { name: 'Save' }).click();
    });
    const region = screen.getByRole('region', { name: 'Notifications' });
    const live = region.querySelector('[aria-live="polite"]')!;
    expect(live).toHaveTextContent('Tag saved');
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS + 10);
    });
    expect(live).not.toHaveTextContent('Tag saved');
  });

  it('throws outside the provider', () => {
    function Bad() {
      useToast();
      return null;
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Bad />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });
});

describe('accessibility', () => {
  it('a sample form has no axe violations', async () => {
    const { container } = render(
      <main>
        <Card title="General" actions={<Badge variant="success">Healthy</Badge>} footer={<Button variant="primary">Save</Button>}>
          <form className="grid gap-4">
            <FormField label="Instance name" help="Shown in the browser title">
              <Input defaultValue="Sonarr" />
            </FormField>
            <FormField label="Log level" error="Pick one">
              <Select options={[{ value: 'info', label: 'Info' }, { value: 'debug', label: 'Debug' }]} />
            </FormField>
            <FormField label="Launch browser" inline>
              <Switch checked={false} onCheckedChange={() => {}} />
            </FormField>
            <Button variant="danger" loading>
              Delete
            </Button>
          </form>
        </Card>
      </main>,
    );
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
