---
'@openchoreo/backstage-plugin': minor
'@openchoreo/backstage-plugin-backend': minor
---

Delete Endpoints and old Endpoint releases from the portal. The Endpoint page
menu offers Delete, which removes its routes in every environment and its
releases. The Releases dialog deletes a release no environment pins and that
is not the latest one. Adds `DELETE /delete-endpoint` and
`DELETE /delete-endpoint-release`.
