import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CHOREO_ANNOTATIONS } from '@openchoreo/backstage-plugin-common';
import type { EndpointEnvironment } from '../../../api/OpenChoreoClientApi';
import type { EndpointSummary } from './pdTypes';
import { StartRolloutPage } from './StartRolloutPage';

const mockClient = {
  fetchEndpointRollout: jest.fn(),
  fetchEndpointEnvironmentInfo: jest.fn(),
  startRollout: jest.fn(),
  addBackend: jest.fn(),
  updateRolloutSettings: jest.fn(),
  convertRollout: jest.fn(),
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
  YamlViewer: ({ value }: any) => <pre data-testid="yaml">{value}</pre>,
  FormYamlToggle: ({ onChange }: any) => (
    <div>
      <button onClick={() => onChange('form')}>FORM</button>
      <button onClick={() => onChange('yaml')}>YAML</button>
    </div>
  ),
}));

jest.mock('@openchoreo/backstage-plugin-react', () => ({
  DetailPageLayout: ({ title, onBack, actions, children }: any) => (
    <div>
      <h1>{title}</h1>
      <button onClick={onBack}>Back</button>
      {actions}
      {children}
    </div>
  ),
  ForbiddenState: () => null,
  UnsavedChangesDialog: ({ open, onDiscard, onStay, changeCount }: any) =>
    open ? (
      <div role="dialog" aria-label="Unsaved Changes">
        {changeCount} unsaved
        <button onClick={onDiscard}>Discard Changes</button>
        <button onClick={onStay}>Stay</button>
      </div>
    ) : null,
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

function renderPage(props: { editing?: boolean; convert?: boolean } = {}) {
  render(
    <MemoryRouter initialEntries={['/deploy/add-backend']}>
      <Routes>
        <Route path="/deploy" element={<p>Deploy tab</p>} />
        <Route
          path="/deploy/add-backend"
          element={<StartRolloutPage {...props} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

/** Picks the component (its main line or a release line); its endpoint follows. */
async function pickVersion(name: RegExp) {
  fireEvent.mouseDown(screen.getByLabelText('Component'));
  fireEvent.click(await screen.findByRole('option', { name }));
}

const save = () => screen.getByText('Save & Deploy').closest('button')!;
const yamlText = () => {
  fireEvent.click(screen.getByRole('button', { name: 'YAML' }));
  return screen.getByTestId('yaml').textContent ?? '';
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
    mockClient.addBackend.mockResolvedValue({
      latestRelease: 'rel-2',
      environments: [],
    });
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
    renderPage({ editing: true });

    const versions = await screen.findByRole('region', { name: 'Versions' });
    expect(within(versions).getByText('trips-python @ v2')).toBeInTheDocument();
    expect(within(versions).getByText('New')).toBeInTheDocument();
    expect(screen.getByText('Configure Rollout')).toBeInTheDocument();
    expect(screen.queryByLabelText('Component')).toBeNull();
    expect(screen.getByRole('button', { name: 'Blue/green' })).toBeDisabled();
    expect(screen.getByLabelText('Header')).toHaveValue('x-canary');

    fireEvent.click(screen.getByRole('button', { name: 'Presets' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '10% → 100%' }));
    fireEvent.change(screen.getByLabelText('Header'), {
      target: { value: 'x-beta' },
    });
    fireEvent.click(save());

    await waitFor(() =>
      expect(mockClient.updateRolloutSettings).toHaveBeenCalled(),
    );
    expect(mockClient.updateRolloutSettings.mock.calls[0][1]).toEqual({
      steps: [10, 100],
      preview: { kind: 'header', name: 'x-beta', value: 'true' },
      mirrorPercent: undefined,
    });
    expect(mockClient.startRollout).not.toHaveBeenCalled();
    expect(await screen.findByText('Deploy tab')).toBeInTheDocument();
  });

  it('converts a mirror to a canary with the steps picked here', async () => {
    mockClient.convertRollout.mockResolvedValue({
      latestRelease: 'rel-3',
      environments: [],
    });
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
          name: 'trips-go',
          componentName: 'trips-go',
          endpoint: 'http',
          weight: 0,
          mirror: { percent: 50 },
        },
      ],
      rollout: {
        strategy: 'mirror',
        stable: 'trips-python',
        candidate: 'trips-go',
        steps: [10, 50, 100],
      },
      rolloutSource: 'plan',
    });
    renderPage({ editing: true, convert: true });

    expect(screen.getByText('Convert to a Canary')).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Canary' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('No steps yet.')).toBeInTheDocument();
    expect(screen.getByLabelText('Header')).toHaveValue('x-canary');
    expect(screen.getByText('Convert').closest('button')).toBeDisabled();
    expect(
      screen.getByText('Pick the steps to see how requests flow.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Presets' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '10% → 100%' }));
    fireEvent.click(screen.getByText('Convert'));

    await waitFor(() => expect(mockClient.convertRollout).toHaveBeenCalled());
    expect(mockClient.convertRollout.mock.calls[0].slice(1)).toEqual([
      { name: 'x-canary', value: 'true' },
      [10, 100],
    ]);
    expect(mockClient.deployEndpointRelease).not.toHaveBeenCalled();
  });

  it('replaces the busiest version unless another is picked', async () => {
    renderPage();

    expect(
      await screen.findByRole('radio', { name: /trips-python · 70%/ }),
    ).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /trips-legacy · 30%/ }));

    await pickVersion(/^trips-go/);
    expect(screen.getByLabelText('Endpoint')).toHaveTextContent('http');
    fireEvent.click(save());

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
    renderPage();
    await screen.findByRole('radio', { name: /trips-python · 70%/ });

    fireEvent.mouseDown(screen.getByLabelText('Component'));
    expect(
      await screen.findByRole('option', { name: /^trips-go/ }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(
      screen.getByRole('option', { name: /trips-python.*v2/ }),
    ).toBeInTheDocument();
  });

  it('starts a canary on a release line of a component', async () => {
    renderPage();
    await screen.findByRole('radio', { name: /trips-python · 70%/ });

    await pickVersion(/trips-python.*v2/);
    fireEvent.click(save());

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
    renderPage();
    await screen.findByRole('radio', { name: /trips-python · 70%/ });

    fireEvent.click(screen.getByRole('button', { name: 'A/B test' }));
    await pickVersion(/^trips-go/);
    fireEvent.click(screen.getByRole('button', { name: 'Only with a header' }));
    fireEvent.click(screen.getByRole('button', { name: 'Presets' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Your app' }));
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '' } });
    expect(save()).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Value'), {
      target: { value: 'android' },
    });
    fireEvent.click(save());

    await waitFor(() => expect(mockClient.startRollout).toHaveBeenCalled());
    expect(mockClient.startRollout.mock.calls[0][1].preview).toMatchObject({
      kind: 'cookie',
      audience: { name: 'X-Client', type: 'Exact', value: 'android' },
    });
  });

  it('names the new backend, and lets the name be changed', async () => {
    renderPage();
    await screen.findByRole('radio', { name: /trips-python · 70%/ });

    await pickVersion(/trips-python.*v2/);
    expect(screen.getByText('trips-python-v2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('Backend name'), {
      target: { value: 'trips-legacy' },
    });
    expect(
      screen.getByText('The Endpoint already has a backend with this name.'),
    ).toBeInTheDocument();
    expect(save()).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Backend name'), {
      target: { value: 'trips-next' },
    });
    fireEvent.click(save());

    await waitFor(() => expect(mockClient.startRollout).toHaveBeenCalled());
    expect(mockClient.startRollout.mock.calls[0][1].candidate).toMatchObject({
      componentName: 'trips-python',
      releaseLine: 'v2',
      name: 'trips-next',
    });
  });

  it('adds a mirror and shows the Endpoint it saves as YAML', async () => {
    renderPage();
    await screen.findByRole('radio', { name: /trips-python · 70%/ });

    fireEvent.click(screen.getByRole('button', { name: 'Mirror' }));
    await pickVersion(/^trips-go/);
    expect(screen.getByText('Copy steps')).toBeInTheDocument();
    expect(screen.getByText(/getting copies only/)).toBeInTheDocument();

    const yaml = yamlText();
    expect(yaml).toMatch(/mirror:\s+percent: 0/);
    expect(yaml).toMatch(/strategy: mirror/);
    fireEvent.click(screen.getByRole('button', { name: 'FORM' }));
    fireEvent.click(save());

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
    renderPage();
    await screen.findByRole('radio', { name: /trips-python · 70%/ });

    expect(screen.getByRole('button', { name: 'Mirror' })).toBeDisabled();
    expect(
      screen.getByText(/Mirror: gamma-httproute can't mirror requests/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Canary' })).toBeEnabled();
  });

  it('previews blue/green by a path', async () => {
    renderPage();
    await screen.findByRole('radio', { name: /trips-python · 70%/ });

    fireEvent.click(screen.getByRole('button', { name: 'Blue/green' }));
    await pickVersion(/^trips-go/);
    fireEvent.click(screen.getByRole('button', { name: 'Path' }));
    fireEvent.change(screen.getByLabelText('Path'), {
      target: { value: '/next' },
    });
    expect(yamlText()).toMatch(/type: PathPrefix\s+value: \/next/);
    fireEvent.click(screen.getByRole('button', { name: 'FORM' }));
    fireEvent.click(save());

    await waitFor(() => expect(mockClient.startRollout).toHaveBeenCalled());
    expect(mockClient.startRollout.mock.calls[0][1].preview).toMatchObject({
      kind: 'path',
      value: '/next',
    });
  });

  it('leaves at once with nothing changed', async () => {
    renderPage();
    await screen.findByRole('radio', { name: /trips-python · 70%/ });

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Deploy tab')).toBeInTheDocument();
  });

  it('keeps the picks when Stay is chosen, and drops them on Discard', async () => {
    renderPage();
    await screen.findByRole('radio', { name: /trips-python · 70%/ });
    await pickVersion(/^trips-go/);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(
      screen.getByRole('dialog', { name: 'Unsaved Changes' }),
    ).toHaveTextContent('1 unsaved');
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    expect(document.getElementById('rollout-component')).toHaveTextContent(
      'trips-go',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard Changes' }));
    expect(await screen.findByText('Deploy tab')).toBeInTheDocument();
    expect(mockClient.startRollout).not.toHaveBeenCalled();
  });

  it('adds a backend gradually by default', async () => {
    renderPage();
    expect(
      await screen.findByRole('radio', { name: /^Gradually/ }),
    ).toBeChecked();
    expect(
      screen.getByRole('region', { name: 'Strategy' }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Share')).toBeNull();
  });

  it('adds a backend by share, with no strategy, and deploys it', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('radio', { name: /^By share/ }));
    expect(screen.queryByRole('region', { name: 'Strategy' })).toBeNull();
    expect(
      screen.queryByRole('radio', { name: /trips-python · 70%/ }),
    ).toBeNull();
    await pickVersion(/^trips-go/);
    fireEvent.change(screen.getByLabelText('Share'), {
      target: { value: '20' },
    });
    expect(
      screen.getByRole('region', { name: 'How requests flow' }),
    ).toHaveTextContent('where trips-go gets 20%');
    expect(yamlText()).not.toContain('rollout:');
    fireEvent.click(screen.getByRole('button', { name: 'FORM' }));
    fireEvent.click(save());

    await waitFor(() => expect(mockClient.addBackend).toHaveBeenCalled());
    expect(mockClient.addBackend.mock.calls[0].slice(1)).toEqual([
      {
        componentName: 'trips-go',
        endpoint: 'http',
        name: 'trips-go',
        weight: 20,
      },
      20,
    ]);
    expect(mockClient.deployEndpointRelease.mock.calls[0].slice(1)).toEqual([
      'development',
      'rel-2',
    ]);
    expect(mockClient.startRollout).not.toHaveBeenCalled();
  });

  it('adds a backend by match at weight 0', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('radio', { name: /^By match/ }));
    await pickVersion(/^trips-go/);
    expect(save()).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Header'), {
      target: { value: 'x-beta' },
    });
    fireEvent.change(screen.getByLabelText('Value'), {
      target: { value: 'true' },
    });
    fireEvent.click(save());

    await waitFor(() => expect(mockClient.addBackend).toHaveBeenCalled());
    expect(mockClient.addBackend.mock.calls[0][1]).toEqual({
      componentName: 'trips-go',
      endpoint: 'http',
      name: 'trips-go',
      weight: 0,
      match: { headers: [{ name: 'x-beta', value: 'true' }] },
    });
  });

  it("disables By match when the type can't route by a match", async () => {
    mockClient.fetchEndpointRollout.mockResolvedValue({
      ...summary,
      typeName: 'plain-http',
      capabilities: ['Mirror'],
    });
    renderPage();
    const match = await screen.findByRole('radio', { name: /^By match/ });
    expect(match).toBeDisabled();
    expect(
      screen.getByText("plain-http can't route by a match"),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^By share/ })).toBeEnabled();
  });
});
