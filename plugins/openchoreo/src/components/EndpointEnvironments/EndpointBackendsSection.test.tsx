import { fireEvent, render, screen } from '@testing-library/react';
import type { Entity } from '@backstage/catalog-model';
import { EndpointBackendsSection } from './EndpointBackendsSection';
import { ProgressiveDeliveryProvider } from './progressive/ProgressiveDeliveryContext';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

let mockEntity: Entity;
jest.mock('@backstage/plugin-catalog-react', () => ({
  useEntity: () => ({ entity: mockEntity }),
  useAsyncEntity: () => ({ refresh: jest.fn() }),
  EntityRefLink: ({ entityRef }: any) => <span>{entityRef.name}</span>,
}));

jest.mock('./EndpointBackendDialogs', () => ({
  RemoveBackendDialog: ({ backend }: any) =>
    backend ? <div role="dialog">remove {backend.name}</div> : null,
}));

function endpointEntity(spec: Record<string, unknown>): Entity {
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Endpoint',
    metadata: { name: 'orders-api', namespace: 'acme' },
    spec: {
      backends: [
        { name: 'primary', component: 'orders', endpoint: 'http', weight: 90 },
        {
          name: 'canary',
          component: 'orders-v2',
          endpoint: 'http',
          weight: 10,
        },
      ],
      ...spec,
    },
  } as Entity;
}

describe('EndpointBackendsSection', () => {
  it('opens the progressive delivery window, also for a component Endpoint', () => {
    mockEntity = endpointEntity({ managedByComponent: 'orders' });
    render(<EndpointBackendsSection onChanged={jest.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add backend' }));
    expect(mockNavigate).toHaveBeenCalledWith('add-backend');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('lists backends without their release weights', () => {
    mockEntity = endpointEntity({});
    render(<EndpointBackendsSection onChanged={jest.fn()} />);

    expect(screen.queryByText('90%')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('primary traffic share')).toBeNull();
  });

  it('opens the remove dialog for a backend, with no weight editor', () => {
    mockEntity = endpointEntity({});
    render(<EndpointBackendsSection onChanged={jest.fn()} />);

    expect(
      screen.queryByRole('button', { name: 'Edit weight of canary' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove canary' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('remove canary');
  });

  it("lists the Endpoint's own backends once progressive delivery has read them", () => {
    mockEntity = endpointEntity({});
    render(
      <ProgressiveDeliveryProvider
        value={{
          endpoint: {
            backends: [
              {
                name: 'orders-v3',
                componentName: 'orders',
                endpoint: 'http',
                releaseLine: 'v3',
                weight: 1,
              },
            ],
            rolloutSource: 'none',
            environments: [],
          },
          environments: [],
          onOpenRolloutDialog: jest.fn(),
          onCopy: jest.fn(),
        }}
      >
        <EndpointBackendsSection onChanged={jest.fn()} />
      </ProgressiveDeliveryProvider>,
    );

    expect(screen.getByText('Backends (1)')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove orders-v3' }),
    ).toBeInTheDocument();
  });

  it('finishes a rollout by removing a version that gets no traffic', () => {
    mockEntity = endpointEntity({});
    const onFinish = jest.fn();
    const env = (percent: number) => ({
      name: 'development',
      displayName: 'Development',
      bindingName: 'orders-api-development',
      backends: [
        {
          name: 'primary',
          componentName: 'orders',
          endpoint: 'http',
          weight: 100 - percent,
          resolved: true,
        },
        {
          name: 'canary',
          componentName: 'orders-v2',
          endpoint: 'http',
          weight: percent,
          resolved: true,
        },
      ],
      overrides: [],
      rollout: { index: 0, percent, manual: false },
      promotionTargets: [],
    });
    const renderAt = (percent: number) =>
      render(
        <ProgressiveDeliveryProvider
          value={{
            endpoint: {
              backends: [
                {
                  name: 'primary',
                  componentName: 'orders',
                  endpoint: 'http',
                  weight: 100,
                },
                {
                  name: 'canary',
                  componentName: 'orders-v2',
                  endpoint: 'http',
                  weight: 0,
                },
              ],
              rollout: {
                strategy: 'canary',
                stable: 'primary',
                candidate: 'canary',
                steps: [50, 100],
              },
              rolloutSource: 'plan',
              environments: [],
            },
            environments: [env(percent)],
            onOpenRolloutDialog: jest.fn(),
            onCopy: jest.fn(),
            onFinish,
          }}
        >
          <EndpointBackendsSection onChanged={jest.fn()} />
        </ProgressiveDeliveryProvider>,
      );

    const first = renderAt(50);
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove canary' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Remove primary' }),
    ).toBeDisabled();
    first.unmount();

    const back = renderAt(0);
    fireEvent.click(screen.getByRole('button', { name: 'Remove canary' }));
    expect(onFinish).toHaveBeenCalledWith('abandon');
    expect(
      screen.getByRole('button', { name: 'Remove primary' }),
    ).toBeDisabled();
    back.unmount();

    renderAt(100);
    fireEvent.click(screen.getByRole('button', { name: 'Remove primary' }));
    expect(onFinish).toHaveBeenCalledWith('complete');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the last backend', () => {
    mockEntity = endpointEntity({
      backends: [{ name: 'primary', component: 'orders', endpoint: 'http' }],
    });
    render(<EndpointBackendsSection onChanged={jest.fn()} />);

    expect(
      screen.getByRole('button', { name: 'Remove primary' }),
    ).toBeDisabled();
  });

  it('stops adding backends at the CRD maximum', () => {
    mockEntity = endpointEntity({
      backends: Array.from({ length: 16 }, (_, i) => ({
        name: `b${i}`,
        component: `c${i}`,
        endpoint: 'http',
      })),
    });
    render(<EndpointBackendsSection onChanged={jest.fn()} />);

    expect(screen.getByRole('button', { name: 'Add backend' })).toBeDisabled();
  });
});
