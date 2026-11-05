import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  CHOREO_ANNOTATIONS,
  type EndpointBackendWeight,
  type EndpointRollout,
} from '@openchoreo/backstage-plugin-common';
import type { EndpointEnvironment } from '../../../api/OpenChoreoClientApi';
import type { EndpointSummary } from './pdTypes';
import {
  ConfigureTrafficPage,
  formShows,
  overridesProblem,
  overridesShare,
  parseOverrides,
  stepMarks,
} from './ConfigureTrafficPage';

const mockClient = {
  fetchEndpointRollout: jest.fn(),
  fetchEndpointEnvironmentInfo: jest.fn(),
  setRolloutStage: jest.fn(),
  updateEndpointOverrides: jest.fn(),
};

jest.mock('@backstage/core-plugin-api', () => ({
  ...jest.requireActual('@backstage/core-plugin-api'),
  useApi: () => mockClient,
}));

// One entity for every render, as the catalog gives it.
const mockEntity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Endpoint',
  metadata: {
    name: 'trips-api',
    annotations: { [CHOREO_ANNOTATIONS.NAMESPACE]: 'default' },
  },
};

jest.mock('@backstage/plugin-catalog-react', () => ({
  useAsyncEntity: () => ({ refresh: jest.fn() }),
  useEntity: () => ({ entity: mockEntity }),
}));

jest.mock('@openchoreo/backstage-design-system', () => ({
  FormYamlToggle: ({ value, onChange }: any) => (
    <div>
      <button aria-pressed={value === 'form'} onClick={() => onChange('form')}>
        FORM
      </button>
      <button aria-pressed={value === 'yaml'} onClick={() => onChange('yaml')}>
        YAML
      </button>
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
  ChangesList: ({ sections }: any) => (
    <ul>
      {sections.flatMap((s: any) =>
        s.changes.map((c: any) => (
          <li key={c.path}>{`${c.path}: ${c.oldValue} → ${c.newValue}`}</li>
        )),
      )}
    </ul>
  ),
  UnsavedChangesDialog: ({ open, onDiscard, onStay, changeCount }: any) =>
    open ? (
      <div role="dialog" aria-label="Unsaved Changes">
        {changeCount} unsaved
        <button onClick={onDiscard}>Discard Changes</button>
        <button onClick={onStay}>Stay</button>
      </div>
    ) : null,
  YamlEditor: ({ content, onChange, errorText }: any) => (
    <div>
      <textarea
        aria-label="YAML"
        value={content}
        onChange={e => onChange(e.target.value)}
      />
      {errorText && <p role="alert">{errorText}</p>}
    </div>
  ),
  useEndpointReleaseBindingUpdatePermission: () => ({
    canUpdate: true,
    loading: false,
    deniedTooltip: '',
  }),
}));

const canary: EndpointRollout = {
  strategy: 'canary',
  stable: 'trips-python',
  candidate: 'trips-go',
  steps: [5, 25, 50, 100],
  preview: { kind: 'header', name: 'x-canary', value: 'true' },
};

const blueGreen: EndpointRollout = {
  ...canary,
  strategy: 'blueGreen',
  steps: [100],
};

const mirror: EndpointRollout = {
  ...canary,
  strategy: 'mirror',
  steps: [10, 50, 100],
  preview: undefined,
};

const backends: EndpointBackendWeight[] = [
  {
    name: 'trips-python',
    componentName: 'trips-python',
    endpoint: 'http',
    weight: 100,
  },
  { name: 'trips-go', componentName: 'trips-go', endpoint: 'http', weight: 0 },
];

function summary(rollout: EndpointRollout, percent: number): EndpointSummary {
  const index = [0, ...rollout.steps].indexOf(percent);
  return {
    backends,
    rollout,
    rolloutSource: 'plan',
    environments: [
      {
        environment: 'development',
        bindingName: 'trips-api-development',
        endpointRelease: 'rel-1',
        overrides: [
          { name: 'trips-python', weight: 100 - percent },
          { name: 'trips-go', weight: percent },
        ],
        backends: [
          { name: 'trips-python', weight: 100 - percent, resolved: true },
          { name: 'trips-go', weight: percent, resolved: true },
        ],
        rollout: { index, percent, manual: index < 0 },
      },
    ],
  };
}

const development: EndpointEnvironment = {
  name: 'Development',
  resourceName: 'development',
  status: 'Ready',
  bindingName: 'trips-api-development',
  endpointRelease: 'rel-1',
  promotionTargets: [],
};

function renderPage(rollout: EndpointRollout, percent: number) {
  mockClient.fetchEndpointRollout.mockResolvedValue(summary(rollout, percent));
  mockClient.fetchEndpointEnvironmentInfo.mockResolvedValue([development]);
  render(
    <MemoryRouter initialEntries={['/deploy/traffic/development']}>
      <Routes>
        <Route path="/deploy" element={<p>Deploy tab</p>} />
        <Route
          path="/deploy/traffic/:envName"
          element={<ConfigureTrafficPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('override checks', () => {
  it('reads backendOverrides and says what is wrong with them', () => {
    expect(
      parseOverrides(
        'spec:\n  backendOverrides:\n    - name: trips-go\n      weight: 30\n',
      ),
    ).toEqual({ overrides: [{ name: 'trips-go', weight: 30 }] });
    expect(parseOverrides('spec: {}')).toEqual({
      error: 'spec.backendOverrides must be a list',
    });
    expect(parseOverrides('spec: [')).toHaveProperty('error');
  });

  it('keeps each strategy meaning what it says', () => {
    const split = [
      { name: 'trips-python', weight: 70 },
      { name: 'trips-go', weight: 30 },
    ];
    expect(overridesProblem(canary, backends, split)).toBeUndefined();
    expect(overridesProblem(blueGreen, backends, split)).toBe(
      "Blue/green has no split: give trips-go all of trips-python's weight or none",
    );
    expect(
      overridesProblem(blueGreen, backends, [
        { name: 'trips-python', weight: 0 },
        { name: 'trips-go', weight: 100 },
      ]),
    ).toBeUndefined();
    expect(overridesProblem(mirror, backends, split)).toMatch(
      /trips-go answers no one in a mirror/,
    );
    expect(
      overridesProblem(mirror, backends, [
        { name: 'trips-go', mirror: { percent: 50 } },
      ]),
    ).toBeUndefined();
    expect(
      overridesProblem(canary, backends, [
        { name: 'trips-go', mirror: { percent: 50 } },
      ]),
    ).toMatch(/only in a mirror rollout/);
    expect(
      overridesProblem(canary, backends, [{ name: 'trips-rust', weight: 1 }]),
    ).toBe('trips-rust is not a backend of this Endpoint');
  });

  it('reads the share from the overrides over the Endpoint weights', () => {
    expect(
      overridesShare(canary, backends, [{ name: 'trips-go', weight: 50 }]),
    ).toBe(33);
    expect(
      overridesShare(mirror, backends, [
        { name: 'trips-go', mirror: { percent: 50 } },
      ]),
    ).toBe(50);
  });

  it('tells when weights move backends the form cannot show', () => {
    const three = [
      ...backends,
      {
        name: 'trips-legacy',
        componentName: 'trips-legacy',
        endpoint: 'http',
        weight: 100,
      },
    ];
    const form = [
      { name: 'trips-python', weight: 50 },
      { name: 'trips-go', weight: 50 },
      { name: 'trips-legacy', weight: 100 },
    ];
    expect(
      formShows(
        three,
        [
          { name: 'trips-python', weight: 50 },
          { name: 'trips-go', weight: 50 },
        ],
        form,
      ),
    ).toBe(true);
    expect(
      formShows(
        three,
        [...form.slice(0, 2), { name: 'trips-legacy', weight: 10 }],
        form,
      ),
    ).toBe(false);
  });

  it('marks the steps and where the environment is now', () => {
    expect(stepMarks(canary, 25)).toEqual([
      { value: 0, label: '0%' },
      { value: 5, label: undefined },
      { value: 25, label: '25% · now' },
      { value: 50, label: '50%' },
      { value: 100, label: '100%' },
    ]);
  });

  it('leaves a step near a share set by hand unlabelled', () => {
    expect(stepMarks(canary, 30)).toEqual([
      { value: 0, label: '0%' },
      { value: 5, label: undefined },
      { value: 25, label: undefined },
      { value: 50, label: '50%' },
      { value: 100, label: '100%' },
      { value: 30, label: '30% · now' },
    ]);
  });
});

describe('ConfigureTrafficPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.setRolloutStage.mockResolvedValue({ applied: true });
    mockClient.updateEndpointOverrides.mockResolvedValue({ applied: true });
  });

  it('picks the next step and saves it after asking', async () => {
    renderPage(canary, 25);
    expect(
      await screen.findByText('Configure Traffic — Development'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Save Overrides' }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Next step · 50%' }));
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved: 25%50%');
    expect(mockClient.setRolloutStage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Save Overrides' }));
    expect(
      screen.getByText('Confirm Save Changes (1 change)'),
    ).toBeInTheDocument();
    expect(screen.getByText('Traffic share: 25% → 50%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Save' }));
    expect(await screen.findByText('Deploy tab')).toBeInTheDocument();
    expect(mockClient.setRolloutStage).toHaveBeenCalledWith(
      expect.anything(),
      'development',
      50,
    );
  });

  it('asks before leaving with a change not saved', async () => {
    renderPage(canary, 25);
    fireEvent.click(await screen.findByRole('button', { name: 'Abort' }));

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(
      screen.getByRole('dialog', { name: 'Unsaved Changes' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    expect(
      screen.queryByRole('dialog', { name: 'Unsaved Changes' }),
    ).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard Changes' }));
    expect(await screen.findByText('Deploy tab')).toBeInTheDocument();
    expect(mockClient.setRolloutStage).not.toHaveBeenCalled();
  });

  it('keeps a step from taking traffic the rollout has none of', async () => {
    const base = summary(canary, 0);
    const legacy = {
      name: 'trips-legacy',
      componentName: 'trips-legacy',
      endpoint: 'http',
      weight: 0,
    };
    const env = base.environments[0];
    mockClient.fetchEndpointRollout.mockResolvedValue({
      ...base,
      backends: [...backends, legacy],
      environments: [
        {
          ...env,
          overrides: [
            { name: 'trips-python', weight: 0 },
            { name: 'trips-legacy', weight: 100 },
          ],
          backends: [
            { name: 'trips-python', weight: 0, resolved: true },
            { name: 'trips-legacy', weight: 100, resolved: true },
            { name: 'trips-go', weight: 0, resolved: true },
          ],
        },
      ],
    });
    mockClient.fetchEndpointEnvironmentInfo.mockResolvedValue([development]);
    render(
      <MemoryRouter initialEntries={['/deploy/traffic/development']}>
        <Routes>
          <Route
            path="/deploy/traffic/:envName"
            element={<ConfigureTrafficPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Configure Traffic — Development');
    expect(
      screen.getByText(/trips-python and trips-go get no traffic/),
    ).toBeInTheDocument();
    const next = screen.getByRole('button', { name: 'Next step · 5%' });
    expect(next).toBeEnabled();
    fireEvent.click(next);
    expect(
      screen.getByRole('button', { name: 'Save Overrides' }),
    ).toBeDisabled();
  });

  it('leaves at once with nothing changed', async () => {
    renderPage(canary, 25);
    await screen.findByText('Configure Traffic — Development');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Deploy tab')).toBeInTheDocument();
  });

  it('carries a YAML share over to the form', async () => {
    renderPage(canary, 25);
    fireEvent.click(await screen.findByRole('button', { name: 'YAML' }));
    const yaml = screen.getByLabelText('YAML') as HTMLTextAreaElement;
    fireEvent.change(yaml, {
      target: {
        value: yaml.value
          .replace('weight: 75', 'weight: 70')
          .replace('weight: 25', 'weight: 30'),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'FORM' }));
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved: 25%30%');
  });

  it('refuses a blue/green split from YAML and stays in YAML', async () => {
    renderPage(blueGreen, 0);
    fireEvent.click(await screen.findByRole('button', { name: 'YAML' }));
    const yaml = screen.getByLabelText('YAML') as HTMLTextAreaElement;
    fireEvent.change(yaml, {
      target: {
        value: yaml.value
          .replace('weight: 100', 'weight: 70')
          .replace('weight: 0', 'weight: 30'),
      },
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Blue/green has no split',
    );
    expect(
      screen.getByRole('button', { name: 'Save Overrides' }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'FORM' }));
    expect(screen.getByLabelText('YAML')).toBeInTheDocument();
  });

  it('saves edited YAML as the binding overrides', async () => {
    renderPage(canary, 25);
    fireEvent.click(await screen.findByRole('button', { name: 'YAML' }));
    const yaml = screen.getByLabelText('YAML') as HTMLTextAreaElement;
    fireEvent.change(yaml, {
      target: { value: yaml.value.replace('weight: 25', 'weight: 30') },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Overrides' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Save' }));
    expect(await screen.findByText('Deploy tab')).toBeInTheDocument();
    expect(mockClient.updateEndpointOverrides).toHaveBeenCalledWith(
      expect.anything(),
      'development',
      [
        { name: 'trips-python', weight: 75 },
        { name: 'trips-go', weight: 30 },
      ],
    );
  });
});
