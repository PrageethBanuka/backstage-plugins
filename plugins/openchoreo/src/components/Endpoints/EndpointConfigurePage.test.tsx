import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  CHOREO_ANNOTATIONS,
  type EndpointRollout,
  type EndpointSummary,
} from '@openchoreo/backstage-plugin-common';
import { EndpointConfigurePage } from './EndpointConfigurePage';

const mockClient = {
  fetchEndpoint: jest.fn(),
  fetchEndpointEnvironmentInfo: jest.fn(),
  fetchEndpointCandidates: jest.fn(),
  updateEndpointTraffic: jest.fn(),
  updateEndpointRules: jest.fn(),
  updateEndpointSettings: jest.fn(),
  updateEndpointReleaseBinding: jest.fn(),
};

jest.mock('@backstage/core-plugin-api', () => ({
  ...jest.requireActual('@backstage/core-plugin-api'),
  useApi: () => mockClient,
}));

jest.mock('@backstage/plugin-catalog-react', () => ({
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
  useEndpointTrafficPermission: () => ({
    canChangeTraffic: true,
    loading: false,
    deniedTooltip: '',
  }),
}));

jest.mock('../Environments/components/AutoDeployConfirmationDialog', () => ({
  AutoDeployConfirmationDialog: () => null,
}));

const summary = (rollout?: EndpointRollout): EndpointSummary => ({
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
      name: 'trips-go',
      componentName: 'trips-go',
      endpoint: 'http',
      weight: 30,
    },
  ],
  rollout,
  rolloutSource: rollout ? 'annotation' : 'none',
  environments: [],
  latestRelease: 'rel-1',
});

const renderPage = async (rollout?: EndpointRollout) => {
  mockClient.fetchEndpoint.mockResolvedValue(summary(rollout));
  mockClient.fetchEndpointEnvironmentInfo.mockResolvedValue([]);
  mockClient.fetchEndpointCandidates.mockResolvedValue([
    {
      componentName: 'trips-legacy',
      endpoints: [{ name: 'http', environments: ['development'] }],
    },
  ]);
  render(
    <MemoryRouter>
      <EndpointConfigurePage />
    </MemoryRouter>,
  );
  await screen.findByText('Version');
};

describe('EndpointConfigurePage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('keeps only the version picked when the Endpoint serves several', async () => {
    mockClient.updateEndpointTraffic.mockResolvedValue({
      latestRelease: 'rel-2',
      changed: true,
    });
    await renderPage();

    expect(
      screen.getByText(/Saving keeps only this version/),
    ).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByLabelText('Component / endpoint'));
    fireEvent.click(
      await screen.findByRole('option', { name: 'trips-legacy/http' }),
    );
    fireEvent.click(screen.getByText('Save & Deploy'));

    await waitFor(() =>
      expect(mockClient.updateEndpointTraffic).toHaveBeenCalled(),
    );
    expect(
      mockClient.updateEndpointTraffic.mock.calls[0][1].map((b: any) => [
        b.componentName,
        b.endpoint,
        b.weight,
      ]),
    ).toEqual([['trips-legacy', 'http', 100]]);
  });

  it('locks the version while a rollout runs', async () => {
    await renderPage({
      strategy: 'canary',
      stable: 'trips-python',
      candidate: 'trips-go',
      steps: [5, 25, 50, 100],
    });

    expect(
      screen.getByText(/trips-go is being rolled out/),
    ).toBeInTheDocument();
  });
});
