import { fireEvent, render, screen } from '@testing-library/react';
import type { EndpointRollout } from '@openchoreo/backstage-plugin-common';
import { ProgressiveDeliveryEntry } from './ProgressiveDeliveryEntry';
import {
  ProgressiveDeliveryProvider,
  type ProgressiveDeliveryContextValue,
} from './ProgressiveDeliveryContext';
import type { EndpointEnvironment } from './pdTypes';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

jest.mock('@openchoreo/backstage-plugin-react', () => ({
  formatRelativeTime: () => 'just now',
}));

const rollout: EndpointRollout = {
  strategy: 'canary',
  stable: 'test',
  candidate: 'test-canary',
  steps: [5, 25, 50, 100],
};

function renderEntry(
  environments: EndpointEnvironment[],
  plan: EndpointRollout = rollout,
) {
  const ctx: ProgressiveDeliveryContextValue = {
    endpoint: {
      backends: [
        { name: 'test', componentName: 'test', endpoint: 'http', weight: 100 },
        {
          name: 'test-canary',
          componentName: 'test',
          releaseLine: 'canary',
          endpoint: 'http',
          weight: 0,
        },
      ],
      rollout: plan,
      rolloutSource: 'plan',
      environments: [],
    },
    environments,
    onOpenRolloutDialog: jest.fn(),
    onCopy: jest.fn(),
    onFinish: jest.fn(),
  };
  render(
    <ProgressiveDeliveryProvider value={ctx}>
      <ProgressiveDeliveryEntry />
    </ProgressiveDeliveryProvider>,
  );
  return ctx;
}

const development: EndpointEnvironment = {
  name: 'development',
  displayName: 'Development',
  bindingName: 'test-api-development',
  backends: [],
  overrides: [],
  promotionTargets: [],
};

describe('ProgressiveDeliveryEntry', () => {
  beforeEach(() => jest.clearAllMocks());

  it('edits the rollout settings until the rollout is deployed', () => {
    renderEntry([{ ...development, bindingName: undefined }]);

    expect(screen.getByText(/Not deployed yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(mockNavigate).toHaveBeenCalledWith('rollout-settings');
  });

  it('opens the convert page for a mirror, deployed or not', () => {
    renderEntry([development], { ...rollout, strategy: 'mirror' });

    fireEvent.click(screen.getByRole('button', { name: 'Convert to canary' }));
    expect(mockNavigate).toHaveBeenCalledWith('convert-to-canary');
  });

  it('shows each environment read-only and hides Edit once deployed', () => {
    const live = {
      ...development,
      backends: [
        {
          name: 'test',
          componentName: 'test',
          endpoint: 'http',
          weight: 75,
          resolved: true,
        },
        {
          name: 'test-canary',
          componentName: 'test',
          endpoint: 'http',
          weight: 25,
          resolved: true,
        },
      ],
      rollout: { index: 2, percent: 25, manual: false },
    };
    renderEntry([live]);

    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Development/ })).toBeNull();
  });
});
