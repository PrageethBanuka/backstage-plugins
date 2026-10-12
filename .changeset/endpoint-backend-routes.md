---
'@openchoreo/backstage-plugin-backend': minor
'@openchoreo/backstage-plugin-common': minor
---

Add backend routes for Endpoints, which route a project's traffic across its
components with weights:

- `GET /endpoints` lists a project's Endpoints and the environments each is
  routed in.
- `GET /component-traffic` lists the Endpoints that send traffic to a
  component, with the component's live share per environment.
- `GET /endpoint-environment-info` shows one Endpoint per pipeline
  environment: pinned and serving release, resolved backends and status.
- `GET /endpoint-releases` lists an Endpoint's releases for rollback.
- `PUT /update-endpoint-traffic` changes an Endpoint's weights, which cuts a
  new release without moving traffic.
- `PUT /update-endpoint-release-binding` pins an environment to a release
  (roll out, promote or roll back).
- `DELETE /delete-endpoint-release-binding` stops routing an Endpoint in an
  environment.

The wire types are exported from `@openchoreo/backstage-plugin-common`.
