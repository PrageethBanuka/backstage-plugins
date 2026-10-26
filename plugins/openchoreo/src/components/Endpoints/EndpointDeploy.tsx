import { Routes, Route } from 'react-router-dom';
import { EndpointEnvironmentsList } from './EndpointEnvironmentsList';
import { EndpointConfigurePage } from './EndpointConfigurePage';
import { EndpointReleaseDetailsPage } from './EndpointReleaseDetailsPage';
import { StartRolloutPage } from './StartRolloutPage';

/**
 * Router for the Endpoint entity's `/environments` (Deploy) tab, the same
 * shape as the Resource Deploy tab.
 *
 * Sub-routes:
 * - `/` — the pipeline canvas and detail panel
 * - `/configure` — Configure & Deploy, opened from the Set up tile
 * - `/release/:envName` — the K8s artifacts applied in one environment
 */
export const EndpointDeploy = () => (
  <Routes>
    <Route path="/" element={<EndpointEnvironmentsList mode="deploy" />} />
    <Route path="/configure" element={<EndpointConfigurePage />} />
    <Route path="/release/:envName" element={<EndpointReleaseDetailsPage />} />
  </Routes>
);

/**
 * Router for the Endpoint entity's `/rollout` tab: progressive delivery on
 * the same canvas, for Endpoints that move traffic to a new version.
 *
 * Sub-routes:
 * - `/` — the pipeline canvas in rollout mode
 * - `/start` — Start a rollout
 * - `/release/:envName` — the K8s artifacts applied in one environment
 */
export const EndpointRollout = () => (
  <Routes>
    <Route path="/" element={<EndpointEnvironmentsList mode="rollout" />} />
    <Route path="/start" element={<StartRolloutPage />} />
    <Route path="/release/:envName" element={<EndpointReleaseDetailsPage />} />
  </Routes>
);
