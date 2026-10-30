import { Box, Button, Chip, Typography } from '@material-ui/core';
import type { EndpointEnvironment } from '@openchoreo/backstage-plugin-common';
import { useEndpointEnvironmentsContext } from './EndpointEnvironmentsContext';
import {
  inRollout,
  rolloutReachText,
  stageText,
  STRATEGY_COPY,
} from './endpointRolloutUi';

/**
 * The one line a running rollout takes on an environment's panel, under the
 * traffic bar: the strategy, the stage here, how the new version is
 * reached, and Manage rollout. Nothing when no rollout runs.
 */
export const RolloutLine = ({ env }: { env: EndpointEnvironment }) => {
  const { endpoint, environments, onOpenRolloutDialog } =
    useEndpointEnvironmentsContext();
  const rollout = endpoint.rollout;
  if (!rollout) return null;

  const here = inRollout(env, rollout);
  const previous = environments[environments.indexOf(env) - 1];
  let caption = rolloutReachText(rollout, endpoint, env);
  if (!here) {
    caption = previous
      ? `Promote from ${previous.displayName} brings ${rollout.candidate} here at 0%`
      : `${rollout.candidate} is not here yet`;
  }

  return (
    <Box
      display="flex"
      alignItems="center"
      justifyContent="space-between"
      flexWrap="wrap"
      gridGap={8}
      mt={1}
    >
      <Box minWidth={0} display="flex" flexDirection="column" gridGap={4}>
        <Box display="flex" alignItems="center" flexWrap="wrap" gridGap={8}>
          <Chip
            size="small"
            color="primary"
            label={STRATEGY_COPY[rollout.strategy].name}
          />
          <Typography variant="body2" style={{ fontWeight: 500 }}>
            {here ? stageText(env, rollout) : 'Not here yet'}
          </Typography>
        </Box>
        {caption && (
          <Typography variant="caption" color="textSecondary">
            {caption}
          </Typography>
        )}
      </Box>
      <Button
        variant="outlined"
        color="primary"
        size="small"
        onClick={() => onOpenRolloutDialog(env.name)}
      >
        Manage rollout
      </Button>
    </Box>
  );
};
