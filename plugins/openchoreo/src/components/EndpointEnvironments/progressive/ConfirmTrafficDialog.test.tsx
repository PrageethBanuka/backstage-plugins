import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfirmTrafficDialog } from './ConfirmTrafficDialog';

const confirmation = (run: jest.Mock) => ({
  title: 'Convert the mirror to a canary?',
  body: 'body',
  confirmLabel: 'Convert',
  header: { name: 'x-canary', value: 'true' },
  run,
});

const field = (label: RegExp) =>
  screen.getByLabelText(label, { selector: 'input' }) as HTMLInputElement;

describe('ConfirmTrafficDialog header', () => {
  it('passes the prefilled header', async () => {
    const run = jest.fn().mockResolvedValue(undefined);
    render(
      <ConfirmTrafficDialog
        confirmation={confirmation(run)}
        onClose={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Convert' }));

    await waitFor(() =>
      expect(run).toHaveBeenCalledWith({ name: 'x-canary', value: 'true' }),
    );
  });

  it('converts without a header when it is turned off', async () => {
    const run = jest.fn().mockResolvedValue(undefined);
    render(
      <ConfirmTrafficDialog
        confirmation={confirmation(run)}
        onClose={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.queryByLabelText(/^Header$/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Convert' }));

    await waitFor(() => expect(run).toHaveBeenCalledWith(undefined));
  });

  it('waits for both a header and a value while the header is on', () => {
    render(
      <ConfirmTrafficDialog
        confirmation={confirmation(jest.fn())}
        onClose={jest.fn()}
      />,
    );

    fireEvent.change(field(/Value/), { target: { value: '' } });

    expect(screen.getByRole('button', { name: 'Convert' })).toBeDisabled();
  });
});
