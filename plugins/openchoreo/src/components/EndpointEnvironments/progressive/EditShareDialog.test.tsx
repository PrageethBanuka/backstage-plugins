import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Entity } from '@backstage/catalog-model';
import { EditShareDialog } from './EditShareDialog';

const mockClient = { setBackendShare: jest.fn() };
jest.mock('@backstage/core-plugin-api', () => ({
  ...jest.requireActual('@backstage/core-plugin-api'),
  useApi: () => mockClient,
}));

const backends = [
  {
    name: 'trips-python',
    componentName: 'trips-python',
    endpoint: 'http',
    weight: 1,
  },
  {
    name: 'trips-stale',
    componentName: 'trips-stale',
    endpoint: 'http',
    weight: 1,
  },
];

function renderDialog() {
  const onSaved = jest.fn();
  const onClose = jest.fn();
  render(
    <EditShareDialog
      backend={backends[1]}
      backends={backends}
      entity={{ metadata: { name: 'trips' } } as Entity}
      onClose={onClose}
      onSaved={onSaved}
    />,
  );
  return { onSaved, onClose };
}

describe('EditShareDialog', () => {
  beforeEach(() => mockClient.setBackendShare.mockReset());

  it('starts at the current share and saves a new one', async () => {
    mockClient.setBackendShare.mockResolvedValue({ environments: [] });
    const { onSaved, onClose } = renderDialog();

    expect(screen.getByLabelText('Share')).toHaveValue(50);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Share'), {
      target: { value: '30' },
    });
    expect(
      screen.getByRole('img', {
        name: 'Traffic split: trips-python 70%, trips-stale 30%',
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockClient.setBackendShare).toHaveBeenCalledWith(
      expect.anything(),
      'trips-stale',
      30,
    );
    expect(onSaved).toHaveBeenCalledWith('trips-stale gets 30% of requests.');
  });

  it('refuses a share that is not a whole percentage', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('Share'), {
      target: { value: '120' },
    });
    expect(
      screen.getByText('Give a whole percentage from 0 to 100'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('keeps the dialog open with the error when saving fails', async () => {
    mockClient.setBackendShare.mockRejectedValue(new Error('denied'));
    const { onClose } = renderDialog();
    fireEvent.change(screen.getByLabelText('Share'), {
      target: { value: '40' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('denied')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
