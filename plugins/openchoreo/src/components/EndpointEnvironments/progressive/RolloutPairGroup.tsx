import { useState } from 'react';
import { Box, Button, Tooltip, Typography } from '@material-ui/core';
import {
  EndpointBackendList,
  type EndpointBackend,
} from '../../EndpointOverview/EndpointBackendList';
import { STRATEGY_COPY } from './endpointRolloutUi';
import { roleOf } from './endpointUi';
import { FinishRolloutDialog } from './FinishRolloutDialog';
import { useEndpointEnvironmentsContext } from './ProgressiveDeliveryContext';
import { RoleTag } from './RoleTag';
import { finishLabel } from './rolloutCopy';

/**
 * The running rollout's two backends on the Set up pane, Current then New,
 * with the one way to end it: Finish, named by the strategy.
 */
export const RolloutPairGroup = ({
  backends,
  namespace,
}: {
  backends: EndpointBackend[];
  namespace: string;
}) => {
  const {
    endpoint,
    environments,
    onFinish,
    changeBlocked = '',
  } = useEndpointEnvironmentsContext();
  const [finishing, setFinishing] = useState(false);
  const rollout = endpoint.rollout;
  if (!rollout) return null;

  return (
    <Box
      border={1}
      borderColor="divider"
      borderRadius={8}
      px={1.5}
      py={1}
      mb={1}
    >
      <Box display="flex" alignItems="center" justifyContent="space-between">
        <Typography variant="overline" color="textSecondary">
          {STRATEGY_COPY[rollout.strategy].name}
        </Typography>
        <Tooltip title={changeBlocked} disableHoverListener={!changeBlocked}>
          <span>
            <Button
              size="small"
              variant="outlined"
              color="primary"
              disabled={Boolean(changeBlocked) || !onFinish}
              onClick={() => setFinishing(true)}
            >
              {finishLabel(rollout)}
            </Button>
          </span>
        </Tooltip>
      </Box>
      <EndpointBackendList
        backends={backends}
        namespace={namespace}
        showShares={false}
        renderActions={backend => {
          const role = roleOf(backend.name, rollout);
          return role ? <RoleTag role={role} /> : null;
        }}
      />
      {onFinish && (
        <FinishRolloutDialog
          open={finishing}
          rollout={rollout}
          environments={environments}
          onClose={() => setFinishing(false)}
          onFinish={onFinish}
        />
      )}
    </Box>
  );
};
