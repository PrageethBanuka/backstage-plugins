import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CHOREO_ANNOTATIONS } from '@openchoreo/backstage-plugin-common';
import { EndpointEnvironmentOverridesPage } from './EndpointEnvironmentOverridesPage';

const mockClient = {
  fetchEndpoint: jest.fn(),
  fetchEndpointEnvironmentInfo: jest.fn(),
  fetchEndpointReleaseSchema: jest.fn(),
  updateEndpointEnvironmentConfigs: jest.fn(),
};

jest.mock('@backstage/core-plugin-api', () => {
  const actual = jest.requireActual('@backstage/core-plugin-api');
  return { ...actual, useApi: () => mockClient };
});

const mockEntity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Endpoint',
  metadata: {
    name: 'checkout',
    annotations: {
      [CHOREO_ANNOTATIONS.PROJECT]: 'default',
      [CHOREO_ANNOTATIONS.NAMESPACE]: 'default',
    },
  },
};

// The same entity on every render, as the catalog provides it.
jest.mock('@backstage/plugin-catalog-react', () => ({
  useEntity: () => ({ entity: mockEntity }),
}));

// RJSF reports its normalized formData once on mount; the mock does too.
jest.mock('@openchoreo/backstage-design-system', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    Skeleton: () => null,
    RjsfForm: ({ formData, onChange }: any) => {
      useEffect(() => onChange({ formData }), []); // eslint-disable-line react-hooks/exhaustive-deps
      return (
        <input
          aria-label="requestTimeout"
          value={formData.requestTimeout ?? ''}
          onChange={e =>
            onChange({
              formData: { ...formData, requestTimeout: e.target.value },
            })
          }
        />
      );
    },
  };
});

jest.mock('@openchoreo/backstage-plugin-react', () => ({
  DetailPageLayout: ({ title, actions, children }: any) => (
    <div>
      <h1>{title}</h1>
      {actions}
      {children}
    </div>
  ),
  ForbiddenState: () => null,
}));

jest.mock('../../hooks', () => ({
  useNotification: () => ({
    notification: null,
    showSuccess: jest.fn(),
    showError: jest.fn(),
  }),
}));

jest.mock('../Environments/components', () => ({
  NotificationBanner: () => null,
}));

const env = (environmentConfigs: Record<string, unknown>) => ({
  name: 'development',
  displayName: 'Development',
  bindingName: 'checkout-development',
  endpointRelease: 'checkout-aaa',
  environmentConfigs,
});

describe('EndpointEnvironmentOverridesPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.fetchEndpoint.mockResolvedValue({ type: { name: 'http' } });
    mockClient.fetchEndpointReleaseSchema.mockResolvedValue({
      type: 'object',
      properties: { requestTimeout: { type: 'string' } },
    });
    mockClient.updateEndpointEnvironmentConfigs.mockResolvedValue({});
  });

  it("saves the environment's values from the release schema", async () => {
    mockClient.fetchEndpointEnvironmentInfo.mockResolvedValue([env({})]);
    const onSaved = jest.fn();
    render(
      <EndpointEnvironmentOverridesPage
        envName="development"
        onBack={jest.fn()}
        onSaved={onSaved}
      />,
    );
    fireEvent.change(await screen.findByLabelText('requestTimeout'), {
      target: { value: '5s' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Overrides' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockClient.fetchEndpointReleaseSchema).toHaveBeenCalledWith(
      expect.anything(),
      'checkout-aaa',
    );
    expect(mockClient.updateEndpointEnvironmentConfigs).toHaveBeenCalledWith(
      expect.anything(),
      'development',
      { requestTimeout: '5s' },
    );
  });

  it('clears stored values', async () => {
    mockClient.fetchEndpointEnvironmentInfo.mockResolvedValue([
      env({ requestTimeout: '30s' }),
    ]);
    render(
      <EndpointEnvironmentOverridesPage
        envName="development"
        onBack={jest.fn()}
        onSaved={jest.fn()}
      />,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Clear Overrides' }),
    );
    await waitFor(() =>
      expect(mockClient.updateEndpointEnvironmentConfigs).toHaveBeenCalledWith(
        expect.anything(),
        'development',
        {},
      ),
    );
  });
});
