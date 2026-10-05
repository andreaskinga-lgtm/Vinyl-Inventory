# Use trusted-LAN single-password authentication with in-memory sessions

Vinyl Inventory will keep public read-only collection browsing and Discogs metadata reads while
requiring a server-validated Admin Session for mutations, Settings, and Discogs sync. The administrator credential comes
from `ADMIN_PASSWORD` in the protected deployment environment, and successful sign-in creates an
opaque, process-local session that expires after 30 minutes without an authenticated request or
when the browser, server, or administrator ends it.

This deliberately does not make the application safe for internet exposure: the supported
deployment remains plain HTTP on a trusted home LAN, so a hostile device able to observe that
network could intercept credentials or sessions. Environment-managed credentials and in-memory
sessions were chosen over persisted accounts, password reset, TLS provisioning, or a database to
give the hobby application meaningful server-side authorization without turning it into an
identity platform; deployment documentation must continue to prohibit public exposure.
