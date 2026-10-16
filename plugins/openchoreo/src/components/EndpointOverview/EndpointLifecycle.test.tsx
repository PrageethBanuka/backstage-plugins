import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TestApiProvider } from '@backstage/test-utils';
import { EntityProvider } from '@backstage/plugin-catalog-react';
import type { EndpointSummary } from '@openchoreo/backstage-plugin-common';
import { openChoreoClientApiRef } from '../../api/OpenChoreoClientApi';
import { describeCreatedFrom, EndpointLifecycle } from './EndpointLifecycle';

jest.mock('@openchoreo/backstage-plugin-react', () => ({
  useEndpointTrafficPermission: () => ({
    canChangeTraffic: true,
    loading: false,
    deniedTooltip: '',
  }),
}));

const summary = (
  overrides: Partial<EndpointSummary> = {},
): EndpointSummary => ({
  name: 'payments-api',
  namespaceName: 'default',
  projectName: 'shop',
  type: { kind: 'ClusterEndpointType', name: 'http-gateway' },
  backends: [],
  environments: [],
  reclaimPolicy: 'Delete',
  orphaned: false,
  ...overrides,
});

function renderLifecycle(
  endpoint: EndpointSummary,
  updateEndpointReclaimPolicy = jest.fn().mockResolvedValue({}),
) {
  render(
    <TestApiProvider
      apis={[[openChoreoClientApiRef, { updateEndpointReclaimPolicy } as any]]}
    >
      <EntityProvider
        entity={
          {
            apiVersion: 'v1',
            kind: 'Endpoint',
            metadata: { name: 'payments-api' },
          } as any
        }
      >
        <EndpointLifecycle endpoint={endpoint} />
      </EntityProvider>
    </TestApiProvider>,
  );
  return updateEndpointReclaimPolicy;
}

describe('describeCreatedFrom', () => {
  it('reads the created-from annotation', () => {
    expect(describeCreatedFrom('workload/payments-v1/http')).toBe(
      'payments-v1 / http (Workload)',
    );
    expect(describeCreatedFrom('portal')).toBe('the portal');
    expect(describeCreatedFrom(undefined)).toBeUndefined();
  });
});

describe('EndpointLifecycle', () => {
  it('shows where the Endpoint came from and the Orphaned notice', () => {
    renderLifecycle(
      summary({
        createdFrom: 'workload/payments-v1/http',
        orphaned: true,
        reclaimPolicy: 'Retain',
      }),
    );
    expect(
      screen.getByText('Created from payments-v1 / http (Workload)'),
    ).toBeInTheDocument();
    expect(screen.getByText(/No backends left/)).toBeInTheDocument();
  });

  it('shows why a degraded Endpoint cannot cut a release', () => {
    renderLifecycle(
      summary({
        problem: 'Component(s) payments-v3 not found in project "shop"',
      }),
    );
    expect(
      screen.getByText(/Degraded: Component\(s\) payments-v3/),
    ).toBeInTheDocument();
  });

  it('changes the reclaim policy', async () => {
    const update = renderLifecycle(summary());
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Reclaim policy' }));
    fireEvent.click(
      await screen.findByRole('option', { name: 'Keep it (Orphaned)' }),
    );
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(expect.anything(), 'Retain'),
    );
  });
});
