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

jest.mock('./progressive/EditShareDialog', () => ({
  EditShareDialog: ({ backend }: any) =>
    backend ? <div role="dialog">edit share of {backend.name}</div> : null,
}));

jest.mock('./progressive/ProgressiveDeliveryEntry', () => ({
  ProgressiveDeliveryEntry: () => null,
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

const backend = (name: string, componentName: string, weight: number) => ({
  name,
  componentName,
  endpoint: 'http',
  weight,
});

/** The section with progressive delivery's view of the Endpoint. */
function renderWithPd(
  backends: ReturnType<typeof backend>[],
  extra: Record<string, unknown> = {},
) {
  return render(
    <ProgressiveDeliveryProvider
      value={{
        endpoint: { backends, rolloutSource: 'none', environments: [] },
        environments: [],
        onCopy: jest.fn(),
        ...extra,
      }}
    >
      <EndpointBackendsSection onChanged={jest.fn()} />
    </ProgressiveDeliveryProvider>,
  );
}

describe('EndpointBackendsSection', () => {
  it('opens the progressive delivery window, also for a component Endpoint', () => {
    mockEntity = endpointEntity({ managedByComponent: 'orders' });
    render(<EndpointBackendsSection onChanged={jest.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add backend' }));
    expect(mockNavigate).toHaveBeenCalledWith('add-backend');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('lists backends with their share while no rollout runs', () => {
    mockEntity = endpointEntity({});
    render(<EndpointBackendsSection onChanged={jest.fn()} />);

    expect(screen.getByLabelText('primary traffic share')).toBeInTheDocument();
  });

  it('opens the share editor and the remove dialog for a backend', () => {
    mockEntity = endpointEntity({});
    renderWithPd([
      backend('primary', 'orders', 90),
      backend('canary', 'orders-v2', 10),
    ]);

    fireEvent.click(
      screen.getByRole('button', { name: 'Edit share of canary' }),
    );
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'edit share of canary',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove canary' }));
    expect(screen.getAllByRole('dialog')[1]).toHaveTextContent('remove canary');
  });

  it('edits a share only on a backend that has one, and not the only one', () => {
    mockEntity = endpointEntity({});
    renderWithPd([
      backend('primary', 'orders', 1),
      {
        ...backend('beta', 'orders-beta', 0),
        match: { headers: [{ name: 'x-beta', value: 'true' }] },
      } as any,
    ]);

    expect(
      screen.queryByRole('button', { name: 'Edit share of beta' }),
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Edit share of primary' }),
    ).toBeDisabled();
  });

  it("lists the Endpoint's own backends once progressive delivery has read them", () => {
    mockEntity = endpointEntity({});
    renderWithPd([
      { ...backend('orders-v3', 'orders', 1), releaseLine: 'v3' } as any,
    ]);

    expect(screen.getByText('Backends (1)')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove orders-v3' }),
    ).toBeInTheDocument();
  });

  describe('while a rollout runs', () => {
    const rollout = {
      strategy: 'canary' as const,
      stable: 'primary',
      candidate: 'canary',
      steps: [50, 100],
    };
    const renderRollout = () =>
      render(
        <ProgressiveDeliveryProvider
          value={{
            endpoint: {
              backends: [
                backend('storefront', 'storefront', 1),
                backend('primary', 'orders', 1),
                backend('canary', 'orders-v2', 0),
              ],
              rollout,
              rolloutSource: 'plan',
              environments: [],
            },
            environments: [],
            onCopy: jest.fn(),
            onFinish: jest.fn(),
          }}
        >
          <EndpointBackendsSection onChanged={jest.fn()} />
        </ProgressiveDeliveryProvider>,
      );

    it('groups the pair, Current then New, with Finish canary', () => {
      mockEntity = endpointEntity({});
      renderRollout();

      expect(screen.getByText('Current')).toBeInTheDocument();
      expect(screen.getByText('New')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Finish canary' }),
      ).toBeEnabled();
      expect(
        screen.queryByRole('button', { name: 'Remove primary' }),
      ).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'Remove canary' }),
      ).toBeNull();
    });

    it('keeps the other backends as they are, and adds none', () => {
      mockEntity = endpointEntity({});
      renderRollout();

      expect(
        screen.getByRole('button', { name: 'Remove storefront' }),
      ).toBeDisabled();
      expect(
        screen.getByRole('button', { name: 'Edit share of storefront' }),
      ).toBeDisabled();
      expect(
        screen.getByRole('button', { name: 'Add backend' }),
      ).toBeDisabled();
    });
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
