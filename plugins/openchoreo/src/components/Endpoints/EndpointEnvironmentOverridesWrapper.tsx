import { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Box, Typography } from '@material-ui/core';
import { EndpointEnvironmentOverridesPage } from './EndpointEnvironmentOverridesPage';

/**
 * Routing wrapper for `EndpointEnvironmentOverridesPage`, mounted at
 * `/environments/overrides/:envName` by the Endpoint's Deploy tab router,
 * as the Resource overrides page is.
 */
export const EndpointEnvironmentOverridesWrapper = () => {
  const navigate = useNavigate();
  const { envName } = useParams<{ envName: string }>();

  // Path-relative so `..` strips a URL segment instead of climbing the
  // parent route hierarchy.
  const back = useCallback(
    () => navigate('../..', { relative: 'path' }),
    [navigate],
  );

  if (!envName) {
    return (
      <Box p={3}>
        <Typography color="error">
          Missing environment name in the route.
        </Typography>
      </Box>
    );
  }

  return (
    <EndpointEnvironmentOverridesPage
      envName={envName}
      onBack={back}
      onSaved={back}
    />
  );
};
