import { Routes, Route } from 'react-router-dom';
import { EndpointEnvironmentsList } from './EndpointEnvironmentsList';
import { EndpointEnvironmentOverridesWrapper } from './EndpointEnvironmentOverridesWrapper';
import { StartRolloutPage } from './progressive/StartRolloutPage';

/**
 * Router for the Endpoint entity's `/environments` (Deploy) tab.
 *
 * Sub-routes:
 * - `/` — deploy view (canvas + detail panel)
 * - `/overrides/:envName` — per-environment overrides
 * - `/add-backend` — add a backend through a progressive delivery strategy
 * - `/rollout-settings` — change the running rollout's settings
 * - `/convert-to-canary` — turn a running mirror into a canary
 */
export const EndpointEnvironments = () => (
  <Routes>
    <Route path="/" element={<EndpointEnvironmentsList />} />
    <Route
      path="/overrides/:envName"
      element={<EndpointEnvironmentOverridesWrapper />}
    />
    <Route path="/add-backend" element={<StartRolloutPage />} />
    <Route path="/rollout-settings" element={<StartRolloutPage editing />} />
    <Route
      path="/convert-to-canary"
      element={<StartRolloutPage editing convert />}
    />
  </Routes>
);
