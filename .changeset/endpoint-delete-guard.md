---
'@openchoreo/backstage-plugin': minor
---

Deleting a component that an Endpoint still sends traffic to is blocked in
the delete dialog, which names the Endpoint, environment and share and links
to it. Move the weight to 0 and roll out first; the API refuses the same
delete with a 409, whose message the dialog shows.
