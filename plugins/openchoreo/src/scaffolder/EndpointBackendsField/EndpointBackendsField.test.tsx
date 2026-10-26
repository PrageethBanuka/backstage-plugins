import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { FieldValidation } from '@rjsf/utils';
import {
  EndpointBackendsField,
  endpointBackendsFieldValidation,
  type EndpointRoutingValue,
} from './EndpointBackendsField';

const mockFetchCandidates = jest.fn();
jest.mock('@backstage/core-plugin-api', () => ({
  ...jest.requireActual('@backstage/core-plugin-api'),
  useApi: () => ({ fetchEndpointCandidates: mockFetchCandidates }),
}));

const candidates = [
  {
    componentName: 'payments-v1',
    endpoints: [
      {
        name: 'http',
        protocol: 'HTTP',
        environments: ['development'],
        routedBy: [{ endpointName: 'payments-api', visibility: ['external'] }],
      },
    ],
  },
  {
    componentName: 'payments-v3',
    endpoints: [
      {
        name: 'http',
        protocol: 'HTTP',
        environments: ['development', 'staging'],
      },
    ],
  },
];

const renderField = (formData?: EndpointRoutingValue) => {
  const onChange = jest.fn();
  render(
    <EndpointBackendsField
      {...({
        formData,
        onChange,
        rawErrors: [],
        uiSchema: { 'ui:options': { projectField: 'project_namespace' } },
        formContext: {
          formData: {
            project_namespace: {
              namespace_name: 'domain:default/default',
              project_name: 'system:default/shop',
            },
          },
        },
      } as any)}
    />,
  );
  return onChange;
};

const validate = (value: EndpointRoutingValue | undefined) => {
  const errors: string[] = [];
  endpointBackendsFieldValidation(value, {
    addError: (m: string) => errors.push(m),
  } as unknown as FieldValidation);
  return errors;
};

describe('EndpointBackendsField', () => {
  beforeEach(() => {
    mockFetchCandidates.mockReset().mockResolvedValue(candidates);
  });

  it("loads the project's deployed endpoints and starts with external visibility", async () => {
    renderField();
    expect(mockFetchCandidates).toHaveBeenCalledWith('default', 'shop');
    expect(
      await screen.findByRole('checkbox', { name: /External/ }),
    ).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Namespace/ })).not.toBeChecked();
  });

  it('reports a backend another Endpoint already routes in a picked visibility', async () => {
    const onChange = renderField({
      visibility: ['internal'],
      backends: [
        { componentName: 'payments-v1', endpoint: 'http', weight: 100, deployed: true },
      ],
    });
    await screen.findAllByRole('checkbox');
    await waitFor(() => expect(mockFetchCandidates).toHaveBeenCalled());
    await act(async () => {});

    fireEvent.click(screen.getByRole('checkbox', { name: /External/ }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        visibility: ['internal', 'external'],
        conflicts: [
          'payments-v1/http is already routed by payments-api (external)',
        ],
      }),
    );
  });
});

describe('endpointBackendsFieldValidation', () => {
  const visibility: EndpointRoutingValue['visibility'] = ['external'];
  const row = (componentName: string, weight: number, deployed = true) => ({
    componentName,
    endpoint: 'http',
    weight,
    deployed,
  });

  it('accepts a weighted backend and a staged one not deployed yet', () => {
    expect(
      validate({
        visibility,
        backends: [row('payments-v3', 100), row('payments-v4', 0, false)],
      }),
    ).toEqual([]);
  });

  it('needs a visibility and refuses slot conflicts', () => {
    expect(validate({ visibility: [], backends: [row('payments-v3', 100)] })).toEqual([
      'Pick where the Endpoint is reachable from',
    ]);
    expect(
      validate({
        visibility,
        backends: [row('payments-v1', 100)],
        conflicts: ['payments-v1/http is already routed by payments-api (external)'],
      }),
    ).toEqual([
      'payments-v1/http is already routed by payments-api (external); add the backend to that Endpoint, or pick another visibility',
    ]);
  });

  it('keeps a backend that is not deployed at 0%', () => {
    expect(
      validate({
        visibility,
        backends: [row('payments-v3', 50), row('payments-v4', 50, false)],
      }),
    ).toEqual([
      'payments-v4/http is not deployed yet; keep it at 0% until it is deployed',
    ]);
  });

  it('refuses duplicates, empty rows and an all-zero split', () => {
    expect(
      validate({
        visibility,
        backends: [row('payments-v3', 100), row('payments-v3', 0)],
      }),
    ).toEqual(['payments-v3/http is listed twice']);
    expect(validate({ visibility, backends: [row('', 0)] })).toEqual([
      'Pick a component for every backend, or remove the empty row',
    ]);
    expect(validate({ visibility, backends: [row('payments-v3', 0)] })).toEqual([
      'At least one backend needs a weight above 0',
    ]);
  });
});
