import { Routes, Route } from 'react-router-dom';
import { EndpointEnvironmentsList } from './EndpointEnvironmentsList';
import { EndpointConfigurePage } from './EndpointConfigurePage';
import { EndpointReleaseDetailsPage } from './EndpointReleaseDetailsPage';
import { StartRolloutPage } from './StartRolloutPage';
import { EndpointEnvironmentOverridesWrapper } from './EndpointEnvironmentOverridesWrapper';

/**
 * Router for the Endpoint entity's `/environments` (Deploy) tab, the same
 * shape as the Resource Deploy tab. Progressive delivery runs here too: a
 * new backend is added from the Set up pane, and each environment moves
 * forward from its own panel.
 *
 * Sub-routes:
 * - `/` — the pipeline canvas and detail panel
 * - `/configure` — Configure & Deploy, opened from the Set up tile
 * - `/add-backend` — Add a backend and choose how it gets traffic
 * - `/overrides/:envName` — Configure overrides of the EndpointType's
 *   environment configs for one environment
 * - `/release/:envName` — the K8s artifacts applied in one environment
 */
export const EndpointDeploy = () => (
  <Routes>
    <Route path="/" element={<EndpointEnvironmentsList />} />
    <Route path="/configure" element={<EndpointConfigurePage />} />
    <Route path="/add-backend" element={<StartRolloutPage />} />
    <Route
      path="/overrides/:envName"
      element={<EndpointEnvironmentOverridesWrapper />}
    />
    <Route path="/release/:envName" element={<EndpointReleaseDetailsPage />} />
  </Routes>
);
