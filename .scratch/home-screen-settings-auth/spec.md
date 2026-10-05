Status: ready-for-agent

# Home Screen, visitor Wi-Fi handoff, Settings, and administrator security

## Outcome

Vinyl Inventory opens to a tablet-friendly **Home Screen** at `/`. A visitor can browse the
collection on that device or open it on a phone. The phone handoff asks whether the phone is
already connected to the configured Visitor Wi-Fi Network, shows a Wi-Fi QR code when needed,
then shows a collection QR code that opens `/browse` directly.

The app also gains a protected `/settings` page and real server-validated administrator
authorization. Browsing remains public. Editing, Settings, Discogs operations, and every
server-side mutation require an Admin Session. Authentication and Edit Mode remain separate:
signing in permits administrative actions, while Edit Mode is still an explicit UI state.

## Domain language

The canonical terms are recorded in `CONTEXT.md`:

- A **Visitor** browses without administrative access.
- A **Collection Display** is the shared tablet or similar device.
- The **Home Screen** is the Collection Display's default visitor surface.
- An **Administrator** may change collection data and Site Settings.
- An **Admin Session** grants administrative permission without enabling Edit Mode.
- **Edit Mode** exposes collection-editing controls and requires an Admin Session.
- The **Visitor Wi-Fi Network** is the one network shared through the visitor handoff.
- A **Site Setting** controls site behavior or the visitor experience.

## Visitor navigation

### Addressable views

| Path | Behavior |
| --- | --- |
| `/` | Home Screen and phone-handoff flow |
| `/browse` | Collection browsing, bypassing the Home Screen |
| `/settings` | Protected Settings page; signed-out visitors receive an admin sign-in challenge |

Do not add React Router. `App.jsx` owns a small History API navigation layer and lifted view
state. The Express SPA fallback and Workbox navigation fallback already support these paths.

The installed PWA continues to start at `/`, so it opens the Home Screen.

### Home Screen

The Home Screen has two primary actions:

1. **Browse on this device** - opens the existing collection UI in Collection Display mode.
2. **Open on my phone** - starts the phone handoff.

Settings is not linked from the Home Screen. An administrator reaches it by selecting **Browse
on this device** and using the existing three-dot menu.

Collection Display mode is ephemeral state associated with `/`, not a direct `/browse`
navigation. Browser Back and refresh return to the Home Screen. A visitor who loads `/browse`
directly is in ordinary phone browsing and is not subject to Collection Display reset behavior.

### Phone handoff

When a Visitor Wi-Fi Network is configured:

1. Ask **Is your phone connected to {SSID}?**
2. **Yes** shows the collection QR.
3. **No** shows the Wi-Fi QR, SSID, and a hidden password fallback.
4. **Show password** reveals the passphrase and enables **Copy password**.
5. **I'm connected - continue** advances to the collection QR.
6. The collection QR encodes `window.location.origin + "/browse"`.

Every step after the Home Screen has **Start over**. The handoff is visitor-operated; wording
must not assume a host is tapping controls for someone else.

When Wi-Fi is not configured, **Open on my phone** immediately shows the collection QR. Visitors
never see configuration warnings, setup hints, or Settings links.

The Collection Display must itself be opened through a LAN-reachable IP address or hostname.
Opening it through `localhost` would create a phone-unreachable collection QR and is an operator
configuration error; this effort does not add a canonical URL setting.

### Display reset

`visitorDisplay.idleTimeoutMinutes` defaults to `3` and accepts whole values from `1` through
`30`. It cannot be disabled.

The timeout applies to:

- phone-handoff steps on the Home Screen;
- collection browsing entered through **Browse on this device**.

It does not apply to ordinary direct `/browse` sessions.

Touch, pointer, keyboard, scroll, search/filter changes, and dialog interactions reset the
Collection Display timer. During the final 10 seconds, show a visible reset countdown. On
expiry, close visitor dialogs, clear transient handoff state, and return to the Home Screen.
Treat timeout expiry as the same safe public handoff as selecting **Home Screen**: exit Edit
Mode, end the Admin Session, and clear pending administrator intent before rendering Home.

Keeping the physical display awake is an operator responsibility. The HTTP LAN deployment
cannot rely on the browser Screen Wake Lock API. Deployment documentation should explain how
to open `/` in standalone/full-screen mode and configure the tablet not to sleep.

## Collection menu

The collection three-dot menu always includes:

- **Home Screen**
- **Edit mode** or **View mode**
- **Settings**
- **Share-independent collection controls already present**

When signed out, Edit Mode and Settings open the admin sign-in challenge. Authentication resumes
the initiating intent:

- generic Sign in leaves the app in View Mode;
- Edit mode -> sign in -> Edit Mode;
- Settings -> sign in -> `/settings`.

When signed in, the menu also includes **Sign out**. Add Record and Sync with Discogs remain
visible only in Edit Mode.

Selecting **Home Screen** is a safe public handoff: it exits Edit Mode, signs out the Admin
Session, and navigates to `/`.

## Administrator threat model

This is server-validated authorization for a trusted home LAN, not internet-grade access
control. Public browsing remains intentional. TLS, user accounts, remote access, password reset,
and protection from a hostile device capable of intercepting HTTP LAN traffic are out of scope.

The deployment must continue to warn operators not to expose the service through port
forwarding, a public reverse proxy, or a public hostname.

### Runtime credential

Add optional `ADMIN_PASSWORD` runtime configuration:

- trim nothing; passwords are compared exactly;
- require at least 10 characters when present;
- never return, persist, or log it;
- source it from the protected deployment `.env`;
- changing it requires a server restart and invalidates all sessions because sessions are
  in-memory.

If `ADMIN_PASSWORD` is absent, the service still starts in public read-only mode. Sign-in returns
a clear **Administrator access is not configured** error, and all protected operations remain
unavailable. There is no built-in development password.

The Settings page does not display or change the administrator password.

### Admin Sessions

Use opaque random session identifiers stored in server memory:

- send the identifier in an `HttpOnly`, `SameSite=Strict`, `Path=/` cookie;
- omit `Max-Age`/`Expires`, making it a browser-session cookie;
- set `Secure` when the request is served over HTTPS, but do not require HTTPS for the LAN
  deployment;
- allow multiple concurrent sessions;
- expire a session after 30 minutes without an authenticated server request;
- reset `lastActivity` only when a request successfully authenticates;
- do not send background keepalives for typing, pointer movement, or an open tab;
- invalidate on explicit sign out and process restart.

An administrator who types locally for more than 30 minutes without touching the server may
need to sign in again when saving. The client retains pending form input where practical and
resumes the requested action after re-authentication.

The client must not predict server expiry from a local timer. Keep the browser's last-known
authenticated state distinct from server-authoritative session validity: the browser can still
look signed in after the server session expires, then learns of expiry only when an authenticated
request returns `401`.

### Authentication endpoints

Add:

- `GET /api/auth/session` -> `{ configured, authenticated }`
- `POST /api/auth/login` with `{ password }`
- `POST /api/auth/logout`

Failed login responses do not distinguish malformed, short, or incorrect submitted passwords.
After five failed attempts within five minutes, apply a 30-second server-wide cooldown. A
successful login clears the failure window. There is no permanent lockout.

Compare credentials using a fixed-length digest and `crypto.timingSafeEqual`; never compare raw
variable-length strings with early-return equality.

Authenticated state-changing requests must pass a same-origin request check in addition to the
SameSite cookie policy. Unauthorized requests return JSON `401`; configured-but-forbidden
resource states return `403` or `409` as appropriate.

### Authorization policy

Public endpoints remain:

- `GET /health`
- `GET /api/records`
- `GET /api/genre-options`
- `GET /api/visitor-settings`
- authentication status/login/logout as required by their contracts

Require an Admin Session for:

- every records and genre-options mutation;
- full Site Settings reads and every Site Settings mutation;
- Discogs credential reads/mutations;
- Discogs collection/search/release proxy calls;
- any future state-changing endpoint unless explicitly designed as public.

Client-side control visibility is not authorization. Middleware must enforce this policy.

## Persistence and API

### Site Settings document

Add optional `data/siteSettings.json`, stored through the existing atomic JSON store:

```json
{
  "schemaVersion": 1,
  "visitorDisplay": {
    "idleTimeoutMinutes": 3
  },
  "wifi": null
}
```

A configured Wi-Fi section is:

```json
{
  "security": "wpa",
  "ssid": "Example network",
  "password": "example passphrase",
  "hidden": false
}
```

`security` is `wpa` or `open`. Open networks persist an empty password. WPA-family networks
accept an 8-63 character passphrase or a 64-character hexadecimal key. Validate SSIDs by their
UTF-8 byte length (1-32 bytes), not JavaScript character count.

Missing `siteSettings.json` means schema version 1 defaults. Create the file only after the
administrator saves a section. Invalid stored settings are an explicit server/storage error, not
a silent reset.

### Site Settings endpoints

Use section-specific writes so independent resources cannot partially succeed behind one
page-wide Save:

- `GET /api/site-settings` - authenticated full editable document
- `PUT /api/site-settings/visitor-display`
- `PUT /api/site-settings/wifi`
- `DELETE /api/site-settings/wifi`

The Wi-Fi delete requires a confirmation in the UI. Deleting it preserves Visitor Display
settings and returns the phone handoff to direct collection QR behavior.

### Public visitor projection

`GET /api/visitor-settings` returns only data used by the Home Screen and Collection Display:

```json
{
  "idleTimeoutMinutes": 3,
  "wifi": {
    "ssid": "Example network",
    "password": "example passphrase",
    "security": "wpa",
    "hidden": false,
    "qrPayload": "WIFI:T:WPA;S:Example network;P:example passphrase;H:false;;"
  }
}
```

`wifi` is `null` when unconfigured. This projection intentionally exposes the configured
network credential because the visitor-facing QR and manual fallback are public by product
decision. It must never grow by serializing the complete Site Settings document; future private
settings require explicit projection decisions.

Build the Wi-Fi payload in one pure utility that correctly escapes backslash, semicolon, comma,
colon, and quotation-mark characters. Support WPA-family, open, and hidden networks. The UI
passes the payload to `QRCodeSVG`.

## Settings page

`/settings` is directly addressable. A signed-out direct visit opens sign-in and resumes
Settings after success. Cancel from a direct visit returns to `/browse`; in-app navigation
returns to the originating view.

Settings is a general page shell with three sections:

### Visitor display

- whole-minute idle timeout;
- range 1-30;
- default 3;
- independent **Save** action.

### Wi-Fi

- security: password-protected WPA-family or open;
- SSID;
- passphrase, masked and prefilled, with reveal control;
- hidden-network flag;
- independent **Save** action;
- confirmed **Remove Wi-Fi network** action.

Switching to open security clears/disables the password before save. Validation errors remain
next to their fields. Successful and failed saves are explicit.

### Discogs

Settings becomes the sole Discogs credential editor. Remove credential editing from the Sync
flow.

Preserve the existing source contract:

- environment credentials are authoritative and read-only;
- saved credentials are editable;
- no complete credential means unconfigured.

For saved credentials:

- prefill username;
- show whether a token exists;
- never return or prefill the token;
- blank token means keep the existing token;
- require a token for first-time setup or explicit replacement;
- support confirmed removal of saved credentials.

Environment-managed credentials show read-only source/status without returning either secret.
Sync with Discogs shows readiness and links to `/settings#discogs` when configuration is missing,
then allows the administrator to return to Sync.

Add `DELETE /api/discogs-config`. Update `POST /api/discogs-config` so an authenticated request
may preserve the saved token when the token field is blank and an existing saved credential is
present. Environment-managed credentials continue to reject mutations with `409`.

### Dirty navigation

Each section saves independently. The page tracks dirty state per section. **Cancel**, in-app
navigation, browser Back, refresh, and close must warn before discarding any dirty section.
After all changes are saved or discarded, return to the view that opened Settings.

### Client transition model

The validated logic prototype uses one pure transition function over lifted App state rather than
independent booleans that can drift into contradictory combinations. Keep these concerns
orthogonal:

- navigation: path, visible surface, Collection Display versus direct `/browse`, and Settings
  return target;
- visitor display: phone-handoff step and whether the display timer applies;
- administrator: last-known authentication, Edit Mode, sign-in challenge, and a tagged pending
  intent;
- Settings: dirty sections, retained draft/action payload, and dirty-navigation prompt.

Authentication success resumes only the tagged initiating intent: generic sign-in remains in View
Mode, Edit Mode intent enables editing, Settings intent opens Settings, and a retained idempotent
Settings save resumes with its exact draft. A timeout transition exists only for Home Screen
handoff and Collection Display states; direct `/browse` must reject or ignore that event without
navigating Home.

## Reliable authenticated writes

Remove the records auto-POST effect guarded by `initialized.current`. For records and genre
options:

1. Compute the complete next value.
2. Send the authorized request.
3. Await success.
4. Commit the next value to App state only after success.

Disable duplicate submission while saving and surface failures in the UI. A rejected request
must not leave browser state looking successfully persisted.

When a protected request returns `401`:

1. clear authenticated client state;
2. turn off Edit Mode;
3. preserve pending form values where practical;
4. open the sign-in challenge with a session-expired explanation;
5. retry or resume the initiating action only after successful authentication.

Do not silently retry non-idempotent writes without retaining the exact intended payload.

## Discogs Sync behavior

Discogs proxy endpoints and Sync are administrative. A signed-out visitor cannot use the
server's Discogs credential or consume Discogs requests.

The Sync flow no longer owns credential fields. If credentials are absent, it shows a clear
configuration-required state and navigates the administrator to the Discogs section in Settings.
Existing collection import, matching, and review behavior is otherwise unchanged.

## Testing

Automated coverage should use existing repository seams:

- `server/config.test.js`
  - absent, valid, and too-short `ADMIN_PASSWORD`;
  - password secrecy in returned/public values.
- a focused session/auth module test
  - opaque token creation;
  - 30-minute idle expiration with an injected clock;
  - authenticated-request activity reset;
  - logout/restart semantics;
  - failed-login cooldown;
  - timing-safe credential verification behavior.
- `server/json-store.test.js`
  - missing Site Settings defaults;
  - validated read/write;
  - atomic replacement and backup behavior.
- `server/api-handler.test.js`
  - public reads remain public;
  - every protected route rejects missing/expired sessions;
  - login/logout cookie contracts;
  - same-origin enforcement;
  - Site Settings validation and public visitor projection;
  - Wi-Fi and saved Discogs credential removal;
  - blank Discogs token preserves an existing saved token;
  - environment-managed Discogs credentials remain immutable.
- a pure Wi-Fi payload utility test
  - WPA, open, hidden, Unicode SSIDs, UTF-8 byte limits, and reserved-character escaping.
- `server/app.test.js`
  - `/`, `/browse`, and `/settings` navigation fallback behavior remains correct.

Do not add component-level or DOM-unit test infrastructure. Manually verify:

- direct `/browse` bypasses Home;
- Browse on this device resets to Home after the configured idle time;
- phone browsing does not reset;
- the conditional Wi-Fi flow and both QR codes scan on representative iOS and Android devices;
- browser Back/refresh behavior;
- Settings dirty-navigation prompts;
- sign-in intent resumption;
- session expiry during an unsaved form;
- environment- and saved-Discogs credential states;
- Home Screen safe handoff signs out and exits Edit Mode.

Run targeted tests while implementing, then `npm test`, `npm run lint`, and `npm run build`.

## Deployment and documentation

Update:

- `.env.example` with an empty `ADMIN_PASSWORD`;
- `compose.yaml` with `ADMIN_PASSWORD: "${ADMIN_PASSWORD:-}"`;
- Docker/systemd instructions for setting a unique 10+ character password and restarting;
- deployment threat-model language: authorization is real, transport remains trusted-LAN HTTP;
- backup guidance: `siteSettings.json` contains the Wi-Fi passphrase and makes volume backups
  secrets;
- tablet setup: use the LAN-reachable `/` URL, standalone/full-screen mode, and OS-level
  screen-awake configuration;
- guest-network troubleshooting: router client isolation may let a phone join Wi-Fi while still
  preventing access to the collection host;
- README feature/API tables and first-run behavior.

## Out of scope

- TLS/HTTPS provisioning or a reverse proxy.
- Internet exposure, remote access, or hardened multi-tenant security.
- Usernames, multiple administrator roles, account recovery, or password changes in Settings.
- Persistent sessions, remember-me cookies, or a shared session store.
- More than one Visitor Wi-Fi Network.
- WEP support.
- A canonical collection URL setting.
- Router configuration or automatic Wi-Fi provisioning beyond generating a standard QR payload.
- Guaranteed screen wake lock.
- React Router.
- Component-level or DOM-unit test infrastructure.

## Prototype gates

Implementation begins only after three throwaway prototypes answer the design questions and their
verdicts are folded back into this spec:

1. A self-contained logic prototype validates navigation, visitor handoff, authentication, Edit
   Mode, timeout, dirty-form, and session-expiry transitions.
2. A three-variant UI prototype selects the Home Screen and phone-handoff direction.
3. A separate three-variant UI prototype selects the Settings and sign-in direction.

Prototype code is not production code. Each prototype is captured on a throwaway branch as a
primary source, linked from its ticket, and removed from the implementation branch after the
validated decisions update this spec and the downstream tickets.

## Implementation order

1. Prototype the visitor/admin/navigation state model.
2. Prototype Home Screen and phone-handoff UI variants.
3. Prototype Settings and sign-in UI variants.
4. Implement runtime admin configuration and the server session/authentication primitive.
5. Implement API authorization and reliable unauthorized/error contracts.
6. Implement Site Settings storage, validation, and Wi-Fi QR payload utility.
7. Implement Site Settings, visitor projection, and Discogs credential API changes.
8. Implement client navigation, authentication state, Settings shell, and section forms.
9. Move Discogs credential editing into Settings and wire the Sync handoff.
10. Implement the Home Screen, visitor phone handoff, and Collection Display timeout.
11. Convert collection/genre writes to server-first persistence and add session-expiry recovery.
12. Update deployment documentation, complete end-to-end manual acceptance, and run full
    validation.

## Decision record

The trusted-LAN authentication/session trade-off is recorded in
`docs/adr/0002-trusted-lan-administrator-sessions.md`.
