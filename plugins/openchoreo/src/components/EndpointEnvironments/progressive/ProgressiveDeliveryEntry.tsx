import { useNavigate } from 'react-router-dom';
import { EndpointRolloutPane } from './EndpointRolloutPane';
import { useProgressiveDelivery } from './ProgressiveDeliveryContext';
import { inRollout } from './endpointRolloutUi';

/**
 * The running rollout's card on the Set up pane; nothing when no rollout
 * runs. Its settings can be edited until the rollout is deployed to an
 * environment.
 */
export const ProgressiveDeliveryEntry = () => {
  const pd = useProgressiveDelivery();
  const navigate = useNavigate();
  if (!pd) return null;
  const { endpoint, environments } = pd;
  if (endpoint.rollout) {
    const rollout = endpoint.rollout;
    const deployed = environments.some(e => inRollout(e, rollout));
    return (
      <EndpointRolloutPane
        onEdit={deployed ? undefined : () => navigate('rollout-settings')}
      />
    );
  }
  return null;
};
