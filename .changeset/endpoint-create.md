---
'@openchoreo/backstage-plugin-scaffolder-backend-module': minor
'@openchoreo/backstage-plugin-common': minor
'@openchoreo/backstage-plugin-react': minor
'@openchoreo/backstage-plugin-permission-backend-module-openchoreo-policy': minor
---

Create Endpoints from the portal. A new `create-openchoreo-endpoint` template
on the Create page, next to Component and Resource, runs the
`openchoreo:endpoint:create` action: project, name, Endpoint type, backends
with weights and a reclaim policy. The Endpoint is the same object a Workload
endpoint creates by naming an EndpointType. Adds the `openchoreo.endpoint.create`
permission (`endpoint:create`) and `useEndpointCreatePermission`.
