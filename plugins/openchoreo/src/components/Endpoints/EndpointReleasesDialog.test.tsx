import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  EndpointEnvironment,
  EndpointReleaseSummary,
} from '@openchoreo/backstage-plugin-common';
import { EndpointReleasesDialog } from './EndpointReleasesDialog';

jest.mock('@openchoreo/backstage-plugin-react', () => ({
  formatRelativeTime: () => '2 days ago',
  useEndpointRolloutPermission: () => ({
    canRollOut: true,
    loading: false,
    rollOutDeniedTooltip: '',
  }),
  useEndpointTrafficPermission: () => ({
    canChangeTraffic: true,
    loading: false,
    deniedTooltip: '',
  }),
}));

const environment: EndpointEnvironment = {
  name: 'development',
  displayName: 'Development',
  isProduction: false,
  status: 'Routing',
  bindingName: 'payments-api-development',
  endpointRelease: 'rel-pinned',
  latestRelease: 'rel-latest',
  backends: [],
  overrides: [],
  rules: [],
  deployedBackends: ['payments-v1/http'],
  promotionTargets: [],
};

const release = (name: string): EndpointReleaseSummary => ({
  name,
  createdAt: '2026-10-14T00:00:00Z',
  backends: [{ componentName: 'payments-v1', endpoint: 'http', weight: 100 }],
  rules: [],
});

function renderDialog(onDelete = jest.fn().mockResolvedValue(undefined)) {
  render(
    <EndpointReleasesDialog
      open
      environment={environment}
      releases={[
        release('rel-latest'),
        release('rel-pinned'),
        release('rel-old'),
      ]}
      backendIndex={() => 0}
      isPinning={false}
      onClose={jest.fn()}
      onPin={jest.fn()}
      pinnedReleases={new Map([['rel-pinned', ['Development']]])}
      onDelete={onDelete}
    />,
  );
  return onDelete;
}

describe('EndpointReleasesDialog', () => {
  it('deletes an old release no environment uses', async () => {
    const onDelete = renderDialog();
    fireEvent.click(screen.getByText(/^rel-old/));
    fireEvent.click(screen.getByRole('button', { name: 'Delete version' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('rel-old'));
  });

  it('cannot delete the pinned or the latest release', () => {
    renderDialog();
    // The pinned release is selected first.
    expect(
      screen.getByRole('button', { name: 'Delete version' }),
    ).toBeDisabled();
    fireEvent.click(screen.getByText(/^rel-latest/));
    expect(
      screen.getByRole('button', { name: 'Delete version' }),
    ).toBeDisabled();
  });

  it('shows why the API refused a delete', async () => {
    renderDialog(jest.fn().mockRejectedValue(new Error('release is in use')));
    fireEvent.click(screen.getByText(/^rel-old/));
    fireEvent.click(screen.getByRole('button', { name: 'Delete version' }));
    expect(await screen.findByText(/release is in use/)).toBeInTheDocument();
  });
});
