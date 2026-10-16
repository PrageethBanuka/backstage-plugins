---
'@openchoreo/backstage-plugin-catalog-backend-module': minor
'@openchoreo/backstage-plugin-common': minor
'@openchoreo/backstage-plugin-permission-backend-module-openchoreo-policy': minor
---

List EndpointTypes and ClusterEndpointTypes in the catalog, like
ResourceTypes. The provider syncs them from openchoreo-api, keeps them current
from their events, and relates each Endpoint to its type (instanceOf /
hasInstance). They are read-only and gated by `endpointtype:view` and
`clusterendpointtype:view`.
