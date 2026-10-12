import { Routes, Route } from 'react-router-dom';
import { EndpointsList } from './EndpointsList';
import { EndpointEnvironmentsList } from './EndpointEnvironmentsList';

/**
 * Router for the Project entity's `/endpoints` tab.
 *
 * Sub-routes:
 * - `/` — the project's Endpoints
 * - `/:endpointName` — one Endpoint's environments (canvas + detail panel)
 */
export const EndpointsTab = () => (
  <Routes>
    <Route path="/" element={<EndpointsList />} />
    <Route path="/:endpointName" element={<EndpointEnvironmentsList />} />
  </Routes>
);
