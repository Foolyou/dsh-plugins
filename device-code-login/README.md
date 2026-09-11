# Device-code login

Independent, zero-dependency Node ESM **Host** plugin for DSH browser login. It replaces the Tailscale identity login bridge; it does not depend on Tailscale identity headers, modify installed DSH files, or replace the settings UI. A browser requests a short code, the machine owner explicitly approves it through a local UNIX socket, and the browser receives a native DSH session Cookie.

## Configuration

Load the absolute `src/index.js` path in the Web profile and remove/disable any other plugin owning `/`, `/index.html`, `/login` (including `tailscale-login`). Keep native Connection, Web server, frontend static assets, API and WebSocket services enabled.

```yaml
- id: connection
  config:
    trustedHosts: !!js ctx.webRuntime.trustedHosts
    cookieMaxAgeDays: 30
- insert:
    - id: device-code-login
      name: /absolute/path/to/dsh-plugins/device-code-login/src/index.js
      config:
        origins:
          - http://127.0.0.1:12052
          - http://localhost:12052
          - https://your-device.example.net
        frontendIndex: /absolute/path/to/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html
        # Optional; otherwise uses process.env.DSH_HOME, then ~/.dsh
        # home: /absolute/path/to/.dsh
```

Each origin must be **canonical**, with no path, trailing slash, credentials, query, fragment, or redundant default port. HTTPS is required remotely; HTTP is accepted only for `127.0.0.1`, `localhost`, and `[::1]`. The authority must already pass native Connection trusted-host validation. Do not configure two schemes for the same authority; Host cannot disambiguate that behind a proxy. Exact configured Host and exact Origin checks apply; forwarded-host/identity headers are not trusted. Add each desired local alias explicitly. Remote transport should terminate TLS at a trusted proxy, with the backend bound to loopback, not expose plain HTTP publicly.

`cookieMaxAgeDays: 30` is configured in **native Connection**, not this plugin. The plugin does not override or silently assume the effective lifetime. Refresh the existing GUI after changing the profile; no second Web server is needed. A service restart clears pending requests but native signed Cookies survive if the native credential-signing record persists.

See [DEPLOYMENT.md](DEPLOYMENT.md) for generic deployment and verification instructions. Plugin sources have no build step or npm runtime dependencies.

## Local CLI

```sh
node /absolute/path/to/device-code-login/src/cli.js list
node /absolute/path/to/device-code-login/src/cli.js approve ABCD-EFGH
node /absolute/path/to/device-code-login/src/cli.js deny ABCD-EFGH
# Explicit noninteractive approval (only for your own known request):
node /absolute/path/to/device-code-login/src/cli.js approve ABCD-EFGH --yes
# Same home as the running Host if it is non-default:
node /absolute/path/to/device-code-login/src/cli.js --home /path/to/.dsh list
```

For the short command shown in the browser, install a `dsh-device-auth` executable wrapper on your PATH that invokes the above script with your Node executable, or install this local package's `bin` with your package manager. Manage that wrapper separately from this plugin and keep its paths consistent with your installation. Merely loading the Host plugin does not install shell commands.

`approve CODE` first displays request metadata and requires typing `yes` in a TTY. `--yes` explicitly opts out of that confirmation. Listing, approving, and denying communicate only over `DSH_HOME/device-code-login/approval.sock`, **never an HTTP approval endpoint**. Run the CLI as the same OS user as DSH. An authorization code is not sufficient to log in: only the browser holding the independent private request secret can claim the approved Cookie.

## Browser flow and security

- Unauthenticated GET `/`, `/index.html`, `/login` shows the device login page. POST `/auth/device-code/create` creates a request. POST `/auth/device-code/status` polls with the private secret in its JSON body. Both POSTs require exact Origin, native Host/Origin validation, JSON content type, and bounded body size.
- Each request has a cryptographically random eight-character human code and **independent 256-bit secret**. The browser holds the secret only in a JavaScript closure, not in URL, localStorage, sessionStorage or application logs. Server memory stores its SHA-256 lookup digest, never a long-term browser secret on disk.
- Requests expire **ten minutes after creation**, including approved but unclaimed requests. Approval/denial is final. Approved and denied requests are removed on successful lookup; an approval issues a Cookie **at most once**. A lost successful response requires a new authorization request. A page refresh also requires a new request; it does not recover the secret from disk.
- The page automatically polls every two seconds, retaining its in-memory secret on transient network errors and HTTP429 with bounded backoff until expiry. HTTP404/denial ends the flow. Successful approval uses a same-origin fetch response to set the Cookie and navigates to `/`; no token-bearing browser redirect is introduced.
- Native DSH signs and verifies the Cookie, with HttpOnly and SameSite=Strict. This plugin adds Secure for HTTPS origins, but not HTTP loopback. Authenticated GUI rendering uses native `webServer.renderIndex`; APIs/WebSockets keep native authentication.
- Native owner token recovery links continue to work. Their pre-existing token URL mechanism is preserved, not exposed by the new device flow. HTTPS recovery Cookies also receive Secure. Cross-site top-level navigation uses a same-origin refresh page to allow native Strict Cookies on the second request; it never grants a session itself.
- The unauthenticated page has nonce-based script CSP, no external resources, no-store, nosniff, frame-ancestors none, base-uri none and same-origin referrer policy. Application code never logs secrets. External reverse proxies/access log middleware must also avoid logging request bodies/Cookies.
- Memory is capped at **100 outstanding requests**, global creates at **one/second**, each valid request poll at **one/1.5 seconds**, and aggregate status lookups at **one/10 milliseconds**. At most16 concurrent body readers (1KiB, five seconds) and16 local socket clients (1KiB request, three seconds) are accepted. Expired requests prune on access and every30 seconds. These are bounded-resource abuse mitigations, not a guarantee against network denial of service; public deployments still need edge limits.
- The socket directory must be owned by the running user and owner-only (created0700); the socket is0600. Unsafe directory modes, symlink directory, foreign/non-socket paths and an already-live socket fail activation. A stale refused socket is reclaimed only after ownership/type/inode checks. Unload removes routes, timer, clients, socket and pending requests. One active instance is supported per DSH_HOME.

### Important limits

Request metadata is **not a verified user/device identity**. Peer addresses may identify a proxy and User-Agent is supplied by the browser. Approve only a code from a login you initiated; someone else's device code can be used to trick you into granting access. Local users/processes running as the same account (and root) are trusted and can approve requests.

This issues full native Host access, **not per-user roles or isolated settings**. It does not change the original settings plugin's remote-loopback restriction or import API keys from your terminal into a service environment. Local login allows the original local settings path; remote settings need a separate settings-policy change.

`deny` only rejects a still-pending request. Native Connection currently has stateless signed Cookies and this plugin provides **no per-device revocation of already-issued Cookies**. Existing native Cookies remain valid until their absolute expiry; changing origins/authorization method is not revocation. Clearing a browser's Cookie only logs that browser out; global native signing-key rotation, if performed separately, invalidates all signed sessions. Do not promise individual device revocation without a separate native session design.

## Tests

```sh
npm --prefix /absolute/path/to/device-code-login test
```

Tests use Node's built-in runner and the **real installed DSH Connection** implementation, loaded from `dsh` on PATH (override `DSH_BIN` with its CLI entry). Native credential records are fake in-memory records; tests do not inspect real API keys or signing secrets. Tests cover origin validation, no-auth/CSP/cross-site pages,30-day Cookies, server restart persistence/absolute expiry, HTTPS versus loopback HTTP, native recovery, tampering/authority isolation, replay, denial/expiry, limits, input/header validation, safe socket permissions, live takeover refusal, stale recovery, CLI interactive confirmation, activation failure and teardown. Temporary test directories/sockets are cleaned up.

The operational `scripts/browser-smoke.mjs` exercises an existing GUI and approves its own test browsers; it requires explicit `DSH_HOME`, `DSH_LOCAL_ORIGIN` and `DSH_LOGIN_ORIGIN`. It defaults to locally resolvable `playwright` and its bundled Chromium; set `PLAYWRIGHT_MODULE` and/or `CHROME_PATH` when needed. `--restart-service` additionally requires `DSH_SERVICE`, actually restarts that service and refuses to run inside its cgroup before login. No real deployment target is defaulted. Unit tests do not modify service configuration or restart the actual server.

Global revocation via `scripts/revoke-all.mjs` is destructive and requires `--confirm-revoke-all`, explicit `DSH_HOME`, `DSH_SERVICE` and `DSH_REVOKE_ORIGINS` (a JSON string array). `DSH_BIN` may specify an absolute DSH CLI entry; otherwise `dsh` must resolve on PATH. It snapshots non-session credentials and rotates only the browser signing key, invalidating all browser sessions; it refuses to run in the target service cgroup. **Do not run it from the agent service.** Both operational scripts support safe `--help`. Read [DEPLOYMENT.md](DEPLOYMENT.md) before either operation; these instructions are not a claim that your deployment is verified.
