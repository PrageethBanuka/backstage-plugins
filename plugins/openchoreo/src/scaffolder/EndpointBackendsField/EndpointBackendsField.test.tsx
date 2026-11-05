import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from '@testing-library/react';
import { TestApiProvider } from '@backstage/test-utils';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import {
  EndpointBackendsField,
  deriveBackendName,
  endpointBackendsFieldValidation,
} from './EndpointBackendsField';
import { EndpointSchemaField } from '../EndpointSchemaField/EndpointSchemaField';
import { openChoreoClientApiRef } from '../../api/OpenChoreoClientApi';
import {
  isRoutable,
  readProjectNamespace,
  workloadEndpointOptions,
} from './useProjectWorkloadEndpoints';

function component(name: string) {
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: {
      name,
      namespace: 'acme',
      annotations: {
        'openchoreo.io/project': 'store',
        'openchoreo.io/component': name,
        'openchoreo.io/namespace': 'acme',
      },
    },
    spec: {},
  };
}

const COMPONENTS = [
  component('orders'),
  component('billing'),
  component('batch'),
];

// orders/http has a schema; billing/grpc has none, which the catalog's API
// entities would miss.
const WORKLOADS: Record<string, any> = {
  orders: {
    spec: {
      endpoints: {
        http: {
          port: 8080,
          type: 'HTTP',
          visibility: ['external'],
          schema: { type: 'openapi', content: 'openapi: 3.0.0' },
        },
        admin: { port: 9090, type: 'HTTP' },
      },
    },
  },
  billing: {
    spec: {
      endpoints: {
        grpc: { port: 5000, type: 'gRPC', visibility: ['internal'] },
      },
    },
  },
};

function makeApis(): [any, any][] {
  const catalog = {
    getEntities: jest.fn().mockResolvedValue({ items: COMPONENTS }),
  };
  const client = {
    fetchWorkloadInfo: jest.fn((entity: any) => {
      const workload = WORKLOADS[entity.metadata.name];
      return workload
        ? Promise.resolve(workload)
        : Promise.reject(new Error('No workload found for this component'));
    }),
    fetchReleaseLines: jest.fn((entity: any) =>
      Promise.resolve(
        entity.metadata.name === 'orders'
          ? [
              { name: 'main', isMain: true },
              { name: 'v2', isMain: false },
            ]
          : [],
      ),
    ),
  };
  return [
    [catalogApiRef, catalog],
    [openChoreoClientApiRef, client],
  ];
}

const formContext = {
  formData: {
    project_namespace: {
      project_name: 'store',
      namespace_name: 'domain:default/acme',
    },
  },
};

function validate(value: any) {
  const errors: string[] = [];
  endpointBackendsFieldValidation(value, {
    addError: (e: string) => errors.push(e),
  } as any);
  return errors;
}

describe('workload endpoint options', () => {
  it("reads endpoints, visibility and schema from a Workload's spec", () => {
    expect(
      workloadEndpointOptions('orders', WORKLOADS.orders.spec.endpoints),
    ).toEqual([
      {
        component: 'orders',
        endpoint: 'http',
        visibility: ['external'],
        schemaType: 'openapi',
        schemaContent: 'openapi: 3.0.0',
      },
      { component: 'orders', endpoint: 'admin', visibility: [] },
    ]);
  });

  it('routes only to internal or external endpoints', () => {
    const [http, admin] = workloadEndpointOptions(
      'orders',
      WORKLOADS.orders.spec.endpoints,
    );
    expect(isRoutable(http)).toBe(true);
    expect(isRoutable(admin)).toBe(false);
  });

  it('strips entity-ref prefixes from the project form value', () => {
    expect(
      readProjectNamespace(formContext.formData, 'project_namespace'),
    ).toEqual({
      project: 'store',
      namespace: 'acme',
    });
  });
});

describe('deriveBackendName', () => {
  it('names a backend after its component and endpoint, uniquely', () => {
    expect(deriveBackendName('orders', 'http', [])).toBe('orders-http');
    expect(deriveBackendName('orders', 'http', ['orders-http'])).toBe(
      'orders-http-2',
    );
    expect(deriveBackendName('Orders', 'HTTP_v2', [])).toBe('orders-http-v2');
    expect(deriveBackendName('orders', 'http', [], 'v2')).toBe(
      'orders-v2-http',
    );
  });
});

describe('endpointBackendsFieldValidation', () => {
  const row = { name: 'orders-http', component: 'orders', endpoint: 'http' };

  it('requires at least one complete backend', () => {
    expect(validate([])).toEqual(['Add at least one backend.']);
    expect(validate([{ ...row, endpoint: '' }])[0]).toMatch(/pick a component/);
  });

  it('rejects duplicate names and bad weights', () => {
    expect(validate([row, row])).toContain(
      'Backend 2: name "orders-http" is already used.',
    );
    expect(validate([{ ...row, weight: 1.5 }])[0]).toMatch(/whole number/);
  });

  it('rejects two backends routing to the same workload endpoint', () => {
    expect(validate([row, { ...row, name: 'orders-http-2' }])).toContain(
      'Backend 2: routes to the same workload endpoint as backend 1.',
    );
    expect(
      validate([row, { ...row, name: 'orders-v2-http', releaseLine: 'v2' }]),
    ).toEqual([]);
  });

  it('requires some backend to take traffic', () => {
    expect(validate([{ ...row, weight: 0 }])).toEqual([
      'At least one backend needs a weight above 0.',
    ]);
    expect(validate([row])).toEqual([]);
  });
});

describe('EndpointBackendsField', () => {
  it('asks for a project before offering backends', () => {
    render(
      <TestApiProvider apis={makeApis()}>
        <EndpointBackendsField
          {...({
            formData: [],
            onChange: jest.fn(),
            formContext: { formData: {} },
            uiSchema: {},
          } as any)}
        />
      </TestApiProvider>,
    );
    expect(screen.getByText('Select a project first.')).toBeInTheDocument();
  });

  it("reads the project's components and their Workloads, then adds a first backend at full weight", async () => {
    const apis = makeApis();
    const [[, catalog], [, client]] = apis;
    const onChange = jest.fn();
    render(
      <TestApiProvider apis={apis}>
        <EndpointBackendsField
          {...({ formData: [], onChange, formContext, uiSchema: {} } as any)}
        />
      </TestApiProvider>,
    );

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /add backend/i }),
      ).toBeEnabled(),
    );
    expect(catalog.getEntities).toHaveBeenCalledWith({
      filter: {
        kind: 'Component',
        'metadata.namespace': 'acme',
        'metadata.annotations.openchoreo.io/project': 'store',
      },
    });
    expect(client.fetchWorkloadInfo).toHaveBeenCalledTimes(4);

    fireEvent.click(screen.getByRole('button', { name: /add backend/i }));
    expect(onChange).toHaveBeenCalledWith([
      { name: '', component: '', endpoint: '', weight: 100 },
    ]);
  });

  it('offers every workload endpoint of the chosen component', async () => {
    render(
      <TestApiProvider apis={makeApis()}>
        <EndpointBackendsField
          {...({
            formData: [
              { name: '', component: 'orders', endpoint: '', weight: 100 },
            ],
            onChange: jest.fn(),
            formContext,
            uiSchema: {},
          } as any)}
        />
      </TestApiProvider>,
    );

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /add backend/i }),
      ).toBeEnabled(),
    );
    fireEvent.mouseDown(
      screen.getByRole('button', { name: 'Workload endpoint for backend 1' }),
    );
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getByText('http (external)')).toBeInTheDocument();
    expect(within(listbox).getByText('admin')).toBeInTheDocument();
  });

  it('offers release lines and not a workload endpoint another backend routes to', async () => {
    render(
      <TestApiProvider apis={makeApis()}>
        <EndpointBackendsField
          {...({
            formData: [
              { name: 'orders-http', component: 'orders', endpoint: 'http' },
              { name: '', component: 'orders', endpoint: '' },
            ],
            onChange: jest.fn(),
            formContext,
            uiSchema: {},
          } as any)}
        />
      </TestApiProvider>,
    );

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /add backend/i }),
      ).toBeEnabled(),
    );
    fireEvent.mouseDown(
      screen.getByRole('button', { name: 'Component for backend 2' }),
    );
    expect(
      within(await screen.findByRole('listbox')).getByText('orders @ v2'),
    ).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });

    fireEvent.mouseDown(
      screen.getByRole('button', { name: 'Workload endpoint for backend 2' }),
    );
    const listbox = await screen.findByRole('listbox');
    expect(
      within(listbox).getByText('http (external)').closest('li'),
    ).toHaveAttribute('aria-disabled', 'true');
    expect(
      within(listbox).getByText('admin').closest('li'),
    ).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('offers a workload endpoint that has no schema', async () => {
    render(
      <TestApiProvider apis={makeApis()}>
        <EndpointBackendsField
          {...({
            formData: [
              { name: '', component: 'billing', endpoint: '', weight: 100 },
            ],
            onChange: jest.fn(),
            formContext,
            uiSchema: {},
          } as any)}
        />
      </TestApiProvider>,
    );

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /add backend/i }),
      ).toBeEnabled(),
    );
    fireEvent.mouseDown(
      screen.getByRole('button', { name: 'Workload endpoint for backend 1' }),
    );
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getByText('grpc (internal)')).toBeInTheDocument();
  });
});

describe('EndpointSchemaField', () => {
  it("copies the first backend's workload endpoint schema", async () => {
    const onChange = jest.fn();
    render(
      <TestApiProvider apis={makeApis()}>
        <EndpointSchemaField
          {...({
            formData: undefined,
            onChange,
            formContext: {
              formData: {
                ...formContext.formData,
                backends: [
                  {
                    name: 'orders-http',
                    component: 'orders',
                    endpoint: 'http',
                  },
                ],
              },
            },
            uiSchema: {},
          } as any)}
        />
      </TestApiProvider>,
    );

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        type: 'openapi',
        content: 'openapi: 3.0.0',
        copiedFrom: 'orders/http',
      }),
    );
  });

  it('keeps an edited schema instead of re-copying it', async () => {
    const onChange = jest.fn();
    render(
      <TestApiProvider apis={makeApis()}>
        <EndpointSchemaField
          {...({
            formData: { type: 'openapi', content: 'my own schema' },
            onChange,
            formContext: {
              formData: {
                ...formContext.formData,
                backends: [
                  {
                    name: 'orders-http',
                    component: 'orders',
                    endpoint: 'http',
                  },
                ],
              },
            },
            uiSchema: {},
          } as any)}
        />
      </TestApiProvider>,
    );

    expect(
      await screen.findByDisplayValue('my own schema'),
    ).toBeInTheDocument();
    await new Promise(r => setTimeout(r, 0));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('names the rows Current and New version, with no weights, under a strategy', async () => {
    render(
      <TestApiProvider apis={makeApis()}>
        <EndpointBackendsField
          {...({
            formData: [
              { name: 'a', component: 'orders', endpoint: 'http', weight: 100 },
              { name: 'b', component: 'billing', endpoint: 'grpc', weight: 0 },
            ],
            onChange: jest.fn(),
            formContext: {
              formData: { ...formContext.formData, strategy: 'canary' },
            },
            uiSchema: {},
          } as any)}
        />
      </TestApiProvider>,
    );

    expect(await screen.findByText('Current')).toBeInTheDocument();
    expect(screen.getByText('New version')).toBeInTheDocument();
    expect(screen.queryByLabelText('Weight')).toBeNull();
  });
});
