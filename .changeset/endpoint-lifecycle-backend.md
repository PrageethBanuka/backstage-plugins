---
'@openchoreo/openchoreo-client-node': minor
'@openchoreo/backstage-plugin-backend': minor
'@openchoreo/backstage-plugin-common': minor
---

Follow the Endpoint lifecycle:

- `GET /component-traffic` reads the component's reverse index
  (`status.endpoints`) instead of scanning every Endpoint in the namespace,
  and reports whether the component shares each release with other backends.
- Endpoint summaries carry `reclaimPolicy`, `createdFrom` and `orphaned`.
- `WorkloadEndpoint` gains `endpointType` and `endpointName`, to serve a
  workload endpoint through an Endpoint.
