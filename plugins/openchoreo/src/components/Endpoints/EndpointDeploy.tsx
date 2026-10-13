import { Routes, Route } from 'react-router-dom';
import { EndpointEnvironmentsList } from './EndpointEnvironmentsList';
import { EndpointReleaseDetailsPage } from './EndpointReleaseDetailsPage';

/**
 * Router for the Endpoint entity's `/environments` (Deploy) tab.
 *
 * Sub-routes:
 * - `/` — the pipeline canvas and detail panel
 * - `/release/:envName` — the K8s artifacts applied in one environment
 */
export const EndpointDeploy = () => (
  <Routes>
    <Route path="/" element={<EndpointEnvironmentsList />} />
    <Route path="/release/:envName" element={<EndpointReleaseDetailsPage />} />
  </Routes>
);
