import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfirmTrafficDialog } from './ConfirmTrafficDialog';

const confirmation = (run: jest.Mock) => ({
  title: 'Keep only the new version?',
  body: 'body',
  note: 'This cuts a new release.',
  confirmLabel: 'Keep',
  run,
});

describe('ConfirmTrafficDialog', () => {
  it('runs the change and closes', async () => {
    const run = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();
    render(
      <ConfirmTrafficDialog
        confirmation={confirmation(run)}
        onClose={onClose}
      />,
    );

    expect(screen.getByText('This cuts a new release.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(run).toHaveBeenCalled();
  });

  it('stays open and says why when the change fails', async () => {
    const run = jest.fn().mockRejectedValue(new Error('v2 still gets traffic'));
    const onClose = jest.fn();
    render(
      <ConfirmTrafficDialog
        confirmation={confirmation(run)}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));

    expect(
      await screen.findByText(/v2 still gets traffic/),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
