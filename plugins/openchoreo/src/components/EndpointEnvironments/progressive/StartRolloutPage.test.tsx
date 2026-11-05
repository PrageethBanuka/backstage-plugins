import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CHOREO_ANNOTATIONS } from '@openchoreo/backstage-plugin-common';
import type { EndpointEnvironment } from '../../../api/OpenChoreoClientApi';
import type { EndpointSummary } from './pdTypes';
import { StartRolloutPage } from './StartRolloutPage';

const mockClient = {
  fetchEndpointRollout: jest.fn(),
  fetchEndpointEnvironmentInfo: jest.fn(),
  startRollout: jest.fn(),
  updateRolloutSettings: jest.fn(),
  deployEndpointRelease: jest.fn(),
};

jest.mock('@backstage/core-plugin-api', () => {
  const actual = jest.requireActual('@backstage/core-plugin-api');
  return {
    ...actual,
    useApi: () => mockClient,
  };
});

jest.mock(
  '../../../scaffolder/EndpointBackendsField/useProjectWorkloadEndpoints',
  () => ({
    useProjectWorkloadEndpoints: () => ({
      loading: false,
      options: [
        ...['trips-go', 'trips-legacy', 'trips-python'].map(component => ({
          component,
          endpoint: 'http',
          visibility: [],
        })),
        {
          component: 'trips-python',
          releaseLine: 'v2',
          endpoint: 'http',
          visibility: [],
        },
      ],
    }),
  }),
);

jest.mock('@backstage/plugin-catalog-react', () => ({
  useAsyncEntity: () => ({ refresh: jest.fn() }),
  useEntity: () => ({
    entity: {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Endpoint',
      metadata: {
        name: 'trips-api',
        annotations: {
          [CHOREO_ANNOTATIONS.PROJECT]: 'trips',
          [CHOREO_ANNOTATIONS.NAMESPACE]: 'default',
        },
      },
    },
  }),
}));

jest.mock('@openchoreo/backstage-design-system', () => ({
  Skeleton: () => null,
}));

jest.mock('@openchoreo/backstage-plugin-react', () => ({
  DetailPageLayout: ({ actions, children }: any) => (
    <div>
      {actions}
      {children}
    </div>
  ),
  ForbiddenState: () => null,
}));

const summary: EndpointSummary = {
  backends: [
    {
      name: 'trips-python',
      componentName: 'trips-python',
      endpoint: 'http',
      weight: 70,
    },
    {
      name: 'trips-legacy',
      componentName: 'trips-legacy',
      endpoint: 'http',
      weight: 30,
    },
  ],
  rolloutSource: 'none',
  environments: [],
};

const development: EndpointEnvironment = {
  name: 'Development',
  resourceName: 'development',
  status: 'Ready',
  bindingName: 'trips-api-development',
  endpointRelease: 'rel-1',
  promotionTargets: [],
};

describe('StartRolloutPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.fetchEndpointRollout.mockResolvedValue(summary);
    mockClient.fetchEndpointEnvironmentInfo.mockResolvedValue([development]);
    mockClient.startRollout.mockResolvedValue({
      latestRelease: 'rel-2',
      environments: [],
    });
    mockClient.deployEndpointRelease.mockResolvedValue({ environments: [] });
  });

  it('edits the running rollout with its settings filled in', async () => {
    mockClient.updateRolloutSettings.mockResolvedValue({ environments: [] });
    mockClient.fetchEndpointRollout.mockResolvedValue({
      ...summary,
      backends: [
        {
          name: 'trips-python',
          componentName: 'trips-python',
          endpoint: 'http',
          weight: 100,
        },
        {
          name: 'trips-python-v2',
          componentName: 'trips-python',
          releaseLine: 'v2',
          endpoint: 'http',
          weight: 0,
          match: {
            headers: [{ name: 'x-canary', type: 'Exact', value: 'true' }],
          },
        },
      ],
      rollout: {
        strategy: 'canary',
        stable: 'trips-python',
        candidate: 'trips-python-v2',
        steps: [5, 25, 50, 100],
        preview: { kind: 'header', name: 'x-canary', value: 'true' },
      },
      rolloutSource: 'plan',
    });
    render(
      <MemoryRouter>
        <StartRolloutPage editing />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText('trips-python · v2 next to trips-python'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Where to start')).toBeNull();
    expect(screen.queryByLabelText('Component and endpoint')).toBeNull();
    expect(screen.getByLabelText('Header')).toHaveValue('x-canary');

    fireEvent.click(screen.getByRole('button', { name: '10 → 100' }));
    fireEvent.change(screen.getByLabelText('Header'), {
      target: { value: 'x-beta' },
    });
    fireEvent.click(screen.getByText('Save & Deploy'));

    await waitFor(() =>
      expect(mockClient.updateRolloutSettings).toHaveBeenCalled(),
    );
    expect(mockClient.updateRolloutSettings.mock.calls[0][1]).toEqual({
      steps: [10, 100],
      preview: { kind: 'header', name: 'x-beta', value: 'true' },
      mirrorPercent: undefined,
    });
    expect(mockClient.startRollout).not.toHaveBeenCalled();
  });

  it('replaces the busiest version unless another is picked', async () => {
    render(
      <MemoryRouter>
        <StartRolloutPage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole('radio', { name: /trips-python · 70%/ }),
    ).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /trips-legacy · 30%/ }));

    fireEvent.mouseDown(screen.getByLabelText('Component and endpoint'));
    fireEvent.click(
      await screen.findByRole('option', { name: 'trips-go · http' }),
    );
    fireEvent.click(screen.getByText('Save & Deploy'));

    await waitFor(() => expect(mockClient.startRollout).toHaveBeenCalled());
    expect(mockClient.startRollout.mock.calls[0][1]).toMatchObject({
      strategy: 'canary',
      candidate: { componentName: 'trips-go', endpoint: 'http' },
      replaces: 'trips-legacy',
    });
  });

  it('offers a version already on the Endpoint at 0%', async () => {
    mockClient.fetchEndpointRollout.mockResolvedValue({
      ...summary,
      backends: [
        ...summary.backends,
        {
          name: 'trips-go',
          componentName: 'trips-go',
          endpoint: 'http',
          weight: 0,
        },
      ],
    });
    render(
      <MemoryRouter>
        <StartRolloutPage />
      </MemoryRouter>,
    );
    await screen.findByRole('radio', { name: /trips-python · 70%/ });

    fireEvent.mouseDown(screen.getByLabelText('Component and endpoint'));
    expect(
      await screen.findByRole('option', { name: 'trips-go · http' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: 'trips-python · http' }),
    ).not.toBeInTheDocument();
  });

  it('starts a canary on a release line of a component', async () => {
    render(
      <MemoryRouter>
        <StartRolloutPage />
      </MemoryRouter>,
    );
    await screen.findByRole('radio', { name: /trips-python · 70%/ });

    fireEvent.mouseDown(screen.getByLabelText('Component and endpoint'));
    fireEvent.click(
      await screen.findByRole('option', {
        name: 'trips-python (release line v2) · http',
      }),
    );
    fireEvent.click(screen.getByText('Save & Deploy'));

    await waitFor(() => expect(mockClient.startRollout).toHaveBeenCalled());
    expect(mockClient.startRollout.mock.calls[0][1]).toMatchObject({
      strategy: 'canary',
      candidate: {
        componentName: 'trips-python',
        endpoint: 'http',
        releaseLine: 'v2',
      },
    });
    await waitFor(() =>
      expect(mockClient.deployEndpointRelease).toHaveBeenCalledWith(
        expect.anything(),
        'development',
        'rel-2',
      ),
    );
  });

  it('sends the header an A/B group must also carry', async () => {
    render(
      <MemoryRouter>
        <StartRolloutPage />
      </MemoryRouter>,
    );
    await screen.findByRole('radio', { name: /trips-python · 70%/ });

    fireEvent.click(screen.getByRole('radio', { name: /A\/B test/ }));
    fireEvent.mouseDown(screen.getByLabelText('Component and endpoint'));
    fireEvent.click(
      await screen.findByRole('option', { name: 'trips-go · http' }),
    );
    fireEvent.click(
      screen.getByRole('radio', {
        name: /Only requests that also send a header/,
      }),
    );
    fireEvent.click(screen.getByText('Your app'));
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '' } });
    expect(screen.getByText('Save & Deploy').closest('button')).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Value'), {
      target: { value: 'android' },
    });
    fireEvent.click(screen.getByText('Save & Deploy'));

    await waitFor(() => expect(mockClient.startRollout).toHaveBeenCalled());
    expect(mockClient.startRollout.mock.calls[0][1].preview).toMatchObject({
      kind: 'cookie',
      audience: { name: 'X-Client', type: 'Exact', value: 'android' },
    });
  });

  it('names the new backend, and lets the name be changed', async () => {
    render(
      <MemoryRouter>
        <StartRolloutPage />
      </MemoryRouter>,
    );
    await screen.findByRole('radio', { name: /trips-python · 70%/ });

    fireEvent.mouseDown(screen.getByLabelText('Component and endpoint'));
    fireEvent.click(
      await screen.findByRole('option', {
        name: 'trips-python (release line v2) · http',
      }),
    );
    expect(screen.getByText('trips-python-v2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.change(screen.getByLabelText('Backend name'), {
      target: { value: 'trips-legacy' },
    });
    expect(
      screen.getByText('The Endpoint already has a backend with this name.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Save & Deploy').closest('button')).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Backend name'), {
      target: { value: 'trips-next' },
    });
    fireEvent.click(screen.getByText('Save & Deploy'));

    await waitFor(() => expect(mockClient.startRollout).toHaveBeenCalled());
    expect(mockClient.startRollout.mock.calls[0][1].candidate).toMatchObject({
      componentName: 'trips-python',
      releaseLine: 'v2',
      name: 'trips-next',
    });
  });

  it('adds a mirror and shows the backendRefs it saves', async () => {
    render(
      <MemoryRouter>
        <StartRolloutPage />
      </MemoryRouter>,
    );
    await screen.findByRole('radio', { name: /trips-python · 70%/ });

    fireEvent.click(screen.getByRole('radio', { name: /Mirror/ }));
    fireEvent.mouseDown(screen.getByLabelText('Component and endpoint'));
    fireEvent.click(
      await screen.findByRole('option', { name: 'trips-go · http' }),
    );
    expect(screen.getByText(/mirror: \{percent: 5\}/)).toBeInTheDocument();
    expect(screen.getAllByText('Copy steps')[1]).toBeInTheDocument();
    expect(screen.getAllByText('5 → 25 → 50 → 100%')[0]).toBeInTheDocument();
    expect(screen.getByText('trips-go, copies only')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Save & Deploy'));

    await waitFor(() => expect(mockClient.startRollout).toHaveBeenCalled());
    expect(mockClient.startRollout.mock.calls[0][1]).toMatchObject({
      strategy: 'mirror',
      steps: [5, 25, 50, 100],
    });
  });

  it("disables the strategies the Endpoint's type can't render", async () => {
    mockClient.fetchEndpointRollout.mockResolvedValue({
      ...summary,
      typeName: 'gamma-httproute',
      capabilities: ['Match'],
    });
    render(
      <MemoryRouter>
        <StartRolloutPage />
      </MemoryRouter>,
    );
    await screen.findByRole('radio', { name: /trips-python · 70%/ });

    expect(screen.getByRole('radio', { name: /Mirror/ })).toBeDisabled();
    expect(
      screen.getByText("gamma-httproute can't mirror requests"),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Canary/ })).toBeEnabled();
  });

  it('previews blue/green by a path', async () => {
    render(
      <MemoryRouter>
        <StartRolloutPage />
      </MemoryRouter>,
    );
    await screen.findByRole('radio', { name: /trips-python · 70%/ });

    fireEvent.click(screen.getByRole('radio', { name: /Blue\/green/ }));
    fireEvent.mouseDown(screen.getByLabelText('Component and endpoint'));
    fireEvent.click(
      await screen.findByRole('option', { name: 'trips-go · http' }),
    );
    fireEvent.click(screen.getByRole('radio', { name: /A path/ }));
    fireEvent.change(screen.getByLabelText('Path'), {
      target: { value: '/next' },
    });
    expect(
      screen.getByText(/path: \{type: PathPrefix, value: \/next\}/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText('Save & Deploy'));

    await waitFor(() => expect(mockClient.startRollout).toHaveBeenCalled());
    expect(mockClient.startRollout.mock.calls[0][1].preview).toMatchObject({
      kind: 'path',
      value: '/next',
    });
  });
});
