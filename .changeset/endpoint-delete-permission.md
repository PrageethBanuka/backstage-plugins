---
'@openchoreo/backstage-plugin-common': patch
'@openchoreo/backstage-plugin-react': patch
---

Endpoints can be deleted from listing rows. Adds the
`openchoreo.endpoint.delete` permission (`endpoint:delete`) and maps the
Endpoint kind in the delete permission check, which denied it before.
