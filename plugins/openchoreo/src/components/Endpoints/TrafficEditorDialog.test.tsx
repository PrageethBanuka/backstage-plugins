import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { EndpointEnvironment } from '@openchoreo/backstage-plugin-common';
import { TrafficEditorDialog } from './TrafficEditorDialog';

const mockRolloutPerm = jest.fn();
jest.mock('@openchoreo/backstage-plugin-react', () => ({
  formatRelativeTime: () => '3 days ago',
  useEndpointRolloutPermission: (env: string, hasBinding: boolean) =>
    mockRolloutPerm(env, hasBinding),
}));

const backends = [
  { componentName: 'payments-v1', endpoint: 'http', weight: 90 },
  { componentName: 'payments-v2', endpoint: 'http', weight: 10 },
];

const env = (
  name: string,
  deployed: string[],
  isProduction = false,
): EndpointEnvironment => ({
  name,
  displayName: name,
  isProduction,
  status: 'Routing',
  bindingName: `payments-api-${name}`,
  endpointRelease: 'payments-api-aaa',
  backends: [],
  deployedBackends: deployed,
  promotionTargets: [],
});

const environments = [
  env('development', ['payments-v1/http', 'payments-v2/http']),
  env('staging', ['payments-v1/http']),
  env('production', ['payments-v1/http', 'payments-v2/http'], true),
];

function renderDialog(
  overrides: Partial<Parameters<typeof TrafficEditorDialog>[0]> = {},
) {
  const props = {
    open: true as const,
    endpointName: 'payments-api',
    backends,
    environments,
    releases: [],
    onClose: jest.fn(),
    onSave: jest
      .fn()
      .mockResolvedValue({ latestRelease: 'payments-api-bbb', changed: true }),
    onRollOut: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(<TrafficEditorDialog {...props} />);
  return props;
}

const percentInput = (component: string) =>
  screen.getByLabelText(new RegExp(`^${component}`), {
    selector: 'input[type="number"]',
  });

beforeEach(() => {
  mockRolloutPerm.mockReturnValue({
    canRollOut: true,
    canStopRouting: true,
    loading: false,
    rollOutDeniedTooltip: '',
    stopRoutingDeniedTooltip: '',
  });
});

describe('TrafficEditorDialog', () => {
  it('cannot save the split it started with', () => {
    renderDialog();
    expect(
      screen.getByRole('button', { name: 'Save as new release' }),
    ).toBeDisabled();
  });

  it('keeps two backends at 100 when one changes', () => {
    renderDialog();
    fireEvent.change(percentInput('payments-v1'), { target: { value: '60' } });
    expect(percentInput('payments-v2')).toHaveValue(40);
    expect(screen.getByText(/Total 100%/)).toBeInTheDocument();
  });

  it('adds a project component as a backend at 0% (a canary on the same Endpoint)', async () => {
    const props = renderDialog({
      backends: [
        { componentName: 'payments-v1', endpoint: 'http', weight: 100 },
      ],
      componentOptions: ['payments-v1', 'payments-v2'],
    });
    const add = screen.getByRole('button', { name: 'Add at 0%' });
    expect(add).toBeDisabled();

    fireEvent.mouseDown(screen.getByLabelText('Component to add'));
    fireEvent.click(await screen.findByRole('option', { name: 'payments-v2' }));
    fireEvent.click(add);

    expect(percentInput('payments-v2')).toHaveValue(0);
    fireEvent.click(
      screen.getByRole('button', { name: 'Save as new release' }),
    );
    await waitFor(() => expect(props.onSave).toHaveBeenCalled());
    expect((props.onSave as jest.Mock).mock.calls[0][0]).toEqual([
      { componentName: 'payments-v1', endpoint: 'http', weight: 100 },
      { componentName: 'payments-v2', endpoint: 'http', weight: 0 },
    ]);
  });

  it('offers to remove only a backend with no traffic in the saved split', () => {
    renderDialog({
      backends: [
        { componentName: 'payments-v1', endpoint: 'http', weight: 0 },
        { componentName: 'payments-v2', endpoint: 'http', weight: 100 },
      ],
    });
    expect(screen.queryByLabelText('Remove payments-v2')).toBeNull();
    fireEvent.click(screen.getByLabelText('Remove payments-v1'));
    expect(screen.queryByText('payments-v1')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Save as new release' }),
    ).toBeEnabled();
  });

  it('applies a preset', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: '50 / 50' }));
    expect(percentInput('payments-v1')).toHaveValue(50);
    expect(percentInput('payments-v2')).toHaveValue(50);
  });

  it('saves, then pre-checks each environment before rolling out', async () => {
    const props = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: '50 / 50' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Save as new release' }),
    );

    await waitFor(() => expect(props.onSave).toHaveBeenCalled());
    expect(
      (props.onSave as jest.Mock).mock.calls[0][0].map((b: any) => b.weight),
    ).toEqual([50, 50]);

    // Step 2: development is pre-selected, staging is missing payments-v2,
    // production is allowed but not selected by default.
    expect(await screen.findByLabelText('development')).toBeChecked();
    expect(screen.getByLabelText('staging')).toBeDisabled();
    expect(screen.getByText('payments-v2 not deployed')).toBeInTheDocument();
    expect(screen.getByLabelText('production')).not.toBeChecked();

    fireEvent.click(
      screen.getByRole('button', { name: 'Roll out to 1 environment' }),
    );
    await waitFor(() =>
      expect(props.onRollOut).toHaveBeenCalledWith(
        ['development'],
        'payments-api-bbb',
      ),
    );
  });

  it('says so when the saved split matches an existing release', async () => {
    const props = renderDialog({
      releases: [
        {
          name: 'payments-api-bbb',
          createdAt: '2026-10-09T00:00:00Z',
          backends: [],
        },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: '50 / 50' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Save as new release' }),
    );

    await waitFor(() => expect(props.onSave).toHaveBeenCalled());
    expect(
      await screen.findByText(/so that release is reused/),
    ).toBeInTheDocument();
    expect(screen.getByText('payments-api-bbb')).toBeInTheDocument();
  });

  it('does not claim a reuse when the release is new', async () => {
    const props = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: '50 / 50' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Save as new release' }),
    );

    await waitFor(() => expect(props.onSave).toHaveBeenCalled());
    expect(await screen.findByLabelText('development')).toBeInTheDocument();
    expect(screen.queryByText(/is reused/)).not.toBeInTheDocument();
  });

  it('blocks an environment the user may not change', async () => {
    mockRolloutPerm.mockImplementation((name: string) => ({
      canRollOut: name !== 'production',
      canStopRouting: false,
      loading: false,
      rollOutDeniedTooltip:
        name === 'production'
          ? 'You do not have permission to change traffic in production'
          : '',
      stopRoutingDeniedTooltip: '',
    }));
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: '50 / 50' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Save as new release' }),
    );

    expect(await screen.findByLabelText('production')).toBeDisabled();
    expect(
      screen.getByText(
        'You do not have permission to change traffic in production',
      ),
    ).toBeInTheDocument();
  });
});
