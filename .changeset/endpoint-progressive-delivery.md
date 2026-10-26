---
'@openchoreo/backstage-plugin': minor
'@openchoreo/backstage-plugin-backend': minor
'@openchoreo/backstage-plugin-common': minor
'@openchoreo/backstage-plugin-react': minor
'@openchoreo/backstage-plugin-catalog-backend-module': minor
'@openchoreo/backstage-plugin-scaffolder-backend-module': minor
'@openchoreo/openchoreo-client-node': minor
---

Progressive delivery on Endpoints, on the Endpoint shape with `visibility`,
`autoDeploy` and `rules`:

- The Endpoint's Deploy tab follows the Resource Deploy tab: a Set up tile
  with Configure & Deploy, environment tiles with Promote, version history,
  per-environment weights and stop routing.
- A separate Rollout tab runs canary, blue/green and A/B rollouts. Starting
  one adds the new version at 0% with the rule it needs (a testers' or preview
  header, or a cookie group, optionally mobile only); each environment then
  advances, switches or ships from its tile. The rollout is recorded in the
  `openchoreo.dev/rollout` annotation so its stage survives a reload.
- Complete runs from the last environment once every environment sends all
  traffic to the new version; Abandon sits in the Rollout pane's Danger zone.
- A routing rules editor for header, cookie and query matches, weights,
  mirrors and a catch-all.
- EndpointReleaseBindings show their full definition on the Kubernetes
  artifacts page.
- EndpointTypes and ClusterEndpointTypes get catalog pages. The create
  template asks where the Endpoint is reachable from and whether to deploy
  each release automatically, and flags a backend another Endpoint already
  routes in the same visibility.
- Removed with the old shape: the Endpoint address, take-over, reclaim
  policy, external backends and the Workload editor's serve-through-Endpoint
  fields.
