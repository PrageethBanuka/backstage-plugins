import { render, screen, waitFor } from '@testing-library/react';
import { TestApiProvider } from '@backstage/test-utils';
import { EntityProvider } from '@backstage/plugin-catalog-react';
import { MemoryRouter } from 'react-router-dom';
import { openChoreoClientApiRef } from '../../api/OpenChoreoClientApi';
import { TrafficCard } from './TrafficCard';

jest.mock('@backstage/core-components', () => ({
  Link: ({ to, children }: any) => <a href={to}>{children}</a>,
}));

const entity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: {
    name: 'payments-v2',
    namespace: 'default',
    annotations: {
      'openchoreo.io/component': 'payments-v2',
      'openchoreo.io/project': 'shop',
      'openchoreo.io/namespace': 'default',
    },
  },
};

function renderCard(fetchComponentTraffic: jest.Mock) {
  return render(
    <MemoryRouter>
      <TestApiProvider
        apis={[[openChoreoClientApiRef, { fetchComponentTraffic } as any]]}
      >
        <EntityProvider entity={entity as any}>
          <TrafficCard />
        </EntityProvider>
      </TestApiProvider>
    </MemoryRouter>,
  );
}

describe('TrafficCard', () => {
  it("shows this component's share per Endpoint and environment", async () => {
    renderCard(
      jest.fn().mockResolvedValue([
        {
          endpointName: 'payments-api',
          environment: 'development',
          status: 'Routing',
          weight: 10,
          totalWeight: 100,
          sharePercent: 10,
          invokeURL: 'http://dev.example.com/payments-v1-http',
        },
      ]),
    );

    expect(await screen.findByText('10% here')).toBeInTheDocument();
    expect(screen.getByText('payments-api').closest('a')).toHaveAttribute(
      'href',
      '/catalog/default/endpoint/payments-api',
    );
    expect(screen.getByText('All endpoints').closest('a')).toHaveAttribute(
      'href',
      '/catalog/default/component/payments-v2/endpoints',
    );
    expect(
      screen.getByText('http://dev.example.com/payments-v1-http'),
    ).toBeInTheDocument();
  });

  it('renders nothing when no Endpoint routes to the component', async () => {
    const fetch = jest.fn().mockResolvedValue([]);
    const { container } = renderCard(fetch);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('stays hidden when the lookup fails', async () => {
    const fetch = jest.fn().mockRejectedValue(new Error('forbidden'));
    const { container } = renderCard(fetch);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
