---
'@openchoreo/backstage-plugin-common': minor
'@openchoreo/backstage-plugin-react': minor
---

Add Endpoint permissions and hooks. `openchoreo.endpoint.update` gates
changing an Endpoint's traffic split, and
`openchoreo.endpointreleasebinding.{create,update,delete}` gate rolling a
release out, rolling back and stopping routing in an environment. They map to
the `endpoint:update` and `endpointreleasebinding:*` OpenChoreo actions and are
project-scoped. `useEndpointTrafficPermission` and
`useEndpointRolloutPermission(environment, hasBinding)` evaluate them, the
latter per environment so ABAC environment constraints apply.
