import { fireEvent, render, screen } from '@testing-library/react';
import type { EndpointRollout } from '@openchoreo/backstage-plugin-common';
import { FinishRolloutDialog } from './FinishRolloutDialog';
import type { EndpointEnvironment } from './pdTypes';

const rollout: EndpointRollout = {
  strategy: 'canary',
  stable: 'trips-python',
  candidate: 'trips-go',
  steps: [20, 100],
};

const env = (goWeight: number): EndpointEnvironment => ({
  name: 'development',
  displayName: 'Development',
  bindingName: 'trips-development',
  backends: [
    {
      name: 'trips-python',
      componentName: 'trips-python',
      endpoint: 'http',
      weight: 100 - goWeight,
      resolved: true,
    },
    {
      name: 'trips-go',
      componentName: 'trips-go',
      endpoint: 'http',
      weight: goWeight,
      resolved: true,
    },
  ],
  overrides: [],
  promotionTargets: [],
});

function renderDialog(goWeight: number) {
  const onFinish = jest.fn();
  const onClose = jest.fn();
  render(
    <FinishRolloutDialog
      open
      rollout={rollout}
      environments={[env(goWeight)]}
      onClose={onClose}
      onFinish={onFinish}
    />,
  );
  return { onFinish, onClose };
}

describe('FinishRolloutDialog', () => {
  it('keeps the new version once every environment is at 100%', () => {
    const { onFinish, onClose } = renderDialog(100);

    expect(screen.getByText('Finish canary')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Keep trips-go/ })).toBeChecked();
    expect(
      screen.getByRole('radio', { name: /Keep trips-python/ }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(onFinish).toHaveBeenCalledWith('complete');
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps the current version once every environment is back at 0%', () => {
    const { onFinish } = renderDialog(0);

    expect(
      screen.getByRole('radio', { name: /Keep trips-python/ }),
    ).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(onFinish).toHaveBeenCalledWith('abandon');
  });

  it('says which environments still need to move, and finishes nothing', () => {
    const { onFinish } = renderDialog(20);

    expect(
      screen.getByText(
        'trips-python still gets traffic in Development. Step them to 100% first.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'trips-go still gets traffic in Development. Move them to 0% first.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finish' })).toBeDisabled();
    expect(onFinish).not.toHaveBeenCalled();
  });
});
