import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  CHOREO_ANNOTATIONS,
  type EndpointEnvironment,
  type EndpointSummary,
} from '@openchoreo/backstage-plugin-common';
import { StartRolloutPage } from './StartRolloutPage';

const mockClient = {
  fetchEndpoint: jest.fn(),
  fetchEndpointEnvironmentInfo: jest.fn(),
  startRollout: jest.fn(),
};

const mockCatalog = {
  getEntities: jest.fn(),
};

jest.mock('@backstage/core-plugin-api', () => {
  const actual = jest.requireActual('@backstage/core-plugin-api');
  return {
    ...actual,
    useApi: (ref: { id: string }) =>
      ref.id === 'plugin.catalog.service' ? mockCatalog : mockClient,
  };
});

jest.mock('@backstage/plugin-catalog-react', () => ({
  catalogApiRef: { id: 'plugin.catalog.service' },
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
  name: 'trips-api',
  namespaceName: 'default',
  projectName: 'trips',
  type: { kind: 'ClusterEndpointType', name: 'http' },
  visibility: ['external'],
  autoDeploy: true,
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
  latestRelease: 'rel-1',
};

const development: EndpointEnvironment = {
  name: 'development',
  displayName: 'Development',
  isProduction: false,
  status: 'Routing',
  bindingName: 'trips-api-development',
  endpointRelease: 'rel-1',
  backends: [],
  overrides: [],
  deployedBackends: [
    { componentName: 'trips-go', endpoint: 'http' },
    { componentName: 'trips-python', endpoint: 'http' },
    { componentName: 'trips-legacy', endpoint: 'http' },
  ],
  promotionTargets: [],
} as unknown as EndpointEnvironment;

describe('StartRolloutPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.fetchEndpoint.mockResolvedValue(summary);
    mockClient.fetchEndpointEnvironmentInfo.mockResolvedValue([development]);
    mockClient.startRollout.mockResolvedValue({ environments: [] });
    mockCatalog.getEntities.mockResolvedValue({
      items: [
        { metadata: { name: 'trips-go' } },
        { metadata: { name: 'trips-legacy' } },
        { metadata: { name: 'trips-python' } },
      ],
    });
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

    fireEvent.mouseDown(screen.getByLabelText('Component'));
    fireEvent.click(await screen.findByRole('option', { name: 'trips-go' }));
    fireEvent.click(screen.getByText(/^Save and deploy/));

    await waitFor(() => expect(mockClient.startRollout).toHaveBeenCalled());
    expect(mockClient.startRollout.mock.calls[0][1]).toMatchObject({
      strategy: 'canary',
      candidate: { componentName: 'trips-go', endpoint: 'http' },
      replaces: 'trips-legacy',
    });
  });

  it('offers a version already on the Endpoint at 0%', async () => {
    mockClient.fetchEndpoint.mockResolvedValue({
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

    fireEvent.mouseDown(screen.getByLabelText('Component'));
    expect(
      await screen.findByRole('option', { name: 'trips-go' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: 'trips-python' }),
    ).not.toBeInTheDocument();
  });

  it('sends the header an A/B group must also carry', async () => {
    render(
      <MemoryRouter>
        <StartRolloutPage />
      </MemoryRouter>,
    );
    await screen.findByRole('radio', { name: /trips-python · 70%/ });

    fireEvent.click(screen.getByRole('radio', { name: /A\/B test/ }));
    fireEvent.mouseDown(screen.getByLabelText('Component'));
    fireEvent.click(await screen.findByRole('option', { name: 'trips-go' }));
    fireEvent.click(
      screen.getByRole('radio', {
        name: /Only requests that also send a header/,
      }),
    );
    fireEvent.click(screen.getByText('Your app'));
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '' } });
    expect(
      screen.getByText(/^Save and deploy/).closest('button'),
    ).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Value'), {
      target: { value: 'android' },
    });
    fireEvent.click(screen.getByText(/^Save and deploy/));

    await waitFor(() => expect(mockClient.startRollout).toHaveBeenCalled());
    expect(mockClient.startRollout.mock.calls[0][1].preview).toMatchObject({
      kind: 'cookie',
      audience: { name: 'X-Client', type: 'Exact', value: 'android' },
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
    fireEvent.mouseDown(screen.getByLabelText('Component'));
    fireEvent.click(await screen.findByRole('option', { name: 'trips-go' }));
    expect(screen.getByText(/mirror: \{percent: 100\}/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/^Save and deploy/));

    await waitFor(() => expect(mockClient.startRollout).toHaveBeenCalled());
    expect(mockClient.startRollout.mock.calls[0][1]).toMatchObject({
      strategy: 'mirror',
      mirrorPercent: 100,
    });
  });

  it('previews blue/green by a path', async () => {
    render(
      <MemoryRouter>
        <StartRolloutPage />
      </MemoryRouter>,
    );
    await screen.findByRole('radio', { name: /trips-python · 70%/ });

    fireEvent.click(screen.getByRole('radio', { name: /Blue\/green/ }));
    fireEvent.mouseDown(screen.getByLabelText('Component'));
    fireEvent.click(await screen.findByRole('option', { name: 'trips-go' }));
    fireEvent.click(screen.getByRole('radio', { name: /A path/ }));
    fireEvent.change(screen.getByLabelText('Path'), {
      target: { value: '/next' },
    });
    expect(
      screen.getByText(/path: \{type: PathPrefix, value: \/next\}/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText(/^Save and deploy/));

    await waitFor(() => expect(mockClient.startRollout).toHaveBeenCalled());
    expect(mockClient.startRollout.mock.calls[0][1].preview).toMatchObject({
      kind: 'path',
      value: '/next',
    });
  });
});
