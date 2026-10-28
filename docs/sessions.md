# Remembered sign-in

Authentication uses the existing PostgreSQL session store, not passwords or
tokens saved in browser storage. Login and registration create a persistent
HttpOnly, SameSite=Lax cookie with a 30-day inactivity window. Authenticated HTTP
requests renew the browser expiry and the store expiry. The existing 30-second
session poll and live-presence requests count as activity while the app is open;
browser background throttling may pause those requests.

The same browser profile and hostname can restore a valid session after browser
or server restarts. Clearing site data, private browsing, switching browsers,
devices, or hostnames does not preserve sign-in.

## Hosting and local development

Keep `SESSION_SECRET` configured as a shared secret and stable across restarts
and deployments. Changing it invalidates existing signed cookies. Hosted or
production startup fails if it is missing; only unhosted local development has a
development fallback. The same PostgreSQL session store must remain available.
Do not print the secret or session cookies.

The Replit HTTPS edge forwards requests to the application over HTTP. Express
trusts only the immediate proxy hop in hosted/production execution, not all
forwarded addresses. Cookies use `secure: "auto"`: HTTPS requests (including
forwarded HTTPS) receive Secure cookies; intentional direct local HTTP works
without Secure. Unhosted development does not trust forwarded protocol headers.
Do not expose the app's internal listener directly to the public internet;
forwarded headers must be supplied by the hosting edge. If the hosting topology
changes, verify proxy trust and HTTPS cookie behavior again.

The application emits `SameSite=Lax`. In the verified Replit development preview,
the public edge rewrites this to `SameSite=None; Secure` to support the preview
iframe. The browser test reports that edge value separately; it does not claim
the browser received Lax. Origin integration tests verify the application's Lax
policy. No published deployment is changed or tested by these development tests.

Logout destroys the stored session and clears the cookie with matching path,
HttpOnly, SameSite, and Secure attributes. Expiry, deletion, and administrative
revocation still prevent session reuse. Reactivation requires a fresh login.

## Verification

- `npx tsx --test tests/session-persistence.test.ts`: isolated PostgreSQL schema,
  lifetime, rolling expiry, fixation, anonymous behavior, revocation and logout.
- `npm run test:session-browser`: isolated application server and database schema,
  real persistent Chromium profile close/reopen, server-process restart, startup
  loading/error/retry, deep links, and authenticated `/auth` redirect. Also checks
  HTTPS preview cookie attributes using a disposable account, without modifying
  existing users. Requires a running preview and `REPLIT_DEV_DOMAIN`.
