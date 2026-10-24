# Jawa Ride

Cash ride marketplace with customer and driver accounts, a responsive website, and Capacitor Android/iOS project scaffolds. This is an initial working implementation, **not a production-ready worldwide Uber equivalent**.

[View app screenshots](docs/screenshots/README.md).

The responsive interface includes dedicated Ride, Activity and Account screens, mobile bottom navigation, trip progress, driver offer cards, saved pickup places, editable account details, matching-radius controls, and cash summaries based on the driver’s loaded trip history. Fonts are served locally; the bundled Inter font license is in `public/assets/INTER-LICENSE.txt`. City artwork is decorative and explicitly labelled as an illustration.

## Run locally

Requires Python 3.12+; the server uses only the standard library.

```sh
cd /workspace/jawa_ride
python server.py
```

Default port is 3000. `PORT`, `HOST`, `JAWA_DB` and `JAWA_SECURE_COOKIE` are optional environment settings. SQLite data is retained under `data/` (ignored by Git). Use a persistent volume and verified backups for deployment. Put the server behind an HTTPS reverse proxy and set `JAWA_SECURE_COOKIE=1` in production. The Python HTTP server is intended for development; production needs a hardened application server, load testing, monitoring, a shared rate limiter and scalable database architecture.

Create separate customer and driver accounts to exercise the flow. Drivers share a current location before they can go online; requests appear only when the pickup is inside the driver’s selected matching radius, and presence expires after 75 seconds without a live update. Customer requests expire after 15 minutes if no offer is accepted. Drivers send a fare and ETA, and the customer chooses an offer, locking the driver and agreed currency/fare to that trip. The customer sees a six-digit pickup code and shares it with the driver at pickup. The driver marks arrival and enters that code to start the trip, then confirms receiving cash to finish. Five incorrect codes pause verification for one minute; the limit persists across restarts. Both participants can chat during the assigned trip; customers can rate completed rides. Either participant may cancel before the trip starts and choose a cancellation reason. Each participant sees a ride timeline for their trip. Customers can save up to eight pickup places. Completed trips provide a downloadable cash receipt to the customer and assigned driver only. A receipt records the driver's payment confirmation and is not a tax invoice. Past trips do not expose the driver's current coordinates.

No seeded accounts, synthetic rides or payment gateway are used. Email is an identifier, not verified ownership. Cash confirmation records the driver's declaration; the service does not verify physical payment.

## Checks

```sh
python -m unittest discover -s tests -v
node --check public/app.js
# Optional browser suite; requires Playwright Python package and /usr/bin/chromium.
python tests/browser_workflow.py
```

The API suite starts an isolated server/database and verifies trip progression, pickup code verification and retry limits, receipt access, location privacy, chat access, login/logout, origin checks, validation, cancellation, cash confirmation, ratings and booking conflicts. The browser suite uses its own isolated database and drives separate customer and driver browser sessions, including a 390px mobile screen, pickup verification and a real receipt download. Screenshots are saved to ignored `artifacts/`.

Regression coverage also checks that a changed driver offer requires the customer to review and accept its latest version, signing out takes a driver offline, current location and proximity are required for matching, and a large number of requests cannot hide the driver's assigned trip. The browser suite verifies that incoming chat and trip status updates remain visible while typing without erasing the draft or moving keyboard focus. It also checks saved places, navigation, preservation of booking inputs when visiting Account, expanded history across refresh, and layout at 320px and 390px mobile widths. Completed actions prevent duplicate submissions while pending. The mobile layout places active trips above the informational sidebar.

## Developing without external accounts

No hosting, domain, maps, SMS, Apple or Google account is required to run the local web application and its tests. Use two separate browser profiles (or a regular and private window) for a customer and a driver. Requests, offers, chat, pickup verification and cash receipts use the real local database. The tests use isolated databases and require no paid APIs.

Continue developing locally until you choose providers. A public backend and HTTPS are needed for real phone access; address lookup and road navigation need a routing/maps integration; SMS verification needs a phone verification service. App Store distribution requires Apple developer membership and Google Play distribution requires a Play Console account. The existing native configuration script accepts your eventual HTTPS backend origin. Do not enter invented provider keys or publish the unconfigured native projects.

## Android and iPhone

Requires Node 22+ and the dependencies pinned in `package-lock.json`:

```sh
npm ci --cache /workspace/.npm-cache
# Set this to your actual deployed backend origin; do not use a placeholder for a release.
JAWA_APP_URL=https://your-deployed-domain.example npm run native:configure
npm run native:sync
```

`native:configure` rejects insecure URLs and writes the remote HTTPS backend origin to `capacitor.config.json`. Both native apps use that origin to keep session cookies and API calls on the same origin. The default checked-in configuration has no remote backend and is not a usable native release. Do not ship it without configuring a reachable server. Restrict navigation, review remote-content policy, configure native location permission flows, and validate all native behavior on real devices before release.

- Android: open `android/` with Android Studio, install the required Android SDK (compile/target 35) and JDK 21, then build/test and configure release signing. `npm run native:android` opens the project.
- iPhone: on macOS install Xcode and CocoaPods, sync, open `ios/App/App.xcworkspace`, select your Apple development team, and test/sign. `npm run native:ios` opens the project.

Native projects were generated and synced in cloud. The attempted Android Gradle build downloaded Gradle successfully through the configured HTTPS proxy, then failed because the available Java runtime lacks the Java compiler. No Android SDK installation was found. APK/IPA compilation, device GPS, app lifecycle behavior, store submission, signing and publication have not been verified here. iOS cannot be compiled on this Linux environment.

## Current limits and production work

- No address search, road routing, actual road distance, navigation, geofencing or live map tiles. Users enter coordinate pairs plus readable labels. Distances are haversine straight-line estimates. The route graphic is explicitly illustrative. Driver GPS shares only while the page remains open and the browser permits it.
- Updates poll every three seconds while the app is open. A driver browser sends a presence heartbeat while live location sharing is active. No background matching, push notification delivery, SMS, or incoming request alerts when the app is closed. ETA is entered by the driver.
- Currency is selected per ride and retained in offers and receipts. Supporting a currency is not authorization or operational readiness in that country. No FX conversion, local pricing rules, tax handling or translated interfaces.
- No verified phone authentication, password recovery, driver identity/licence/background verification, admin moderation, fraud prevention, support operations, emergency dispatch, insurance/compliance verification or dispute resolution.
- No public deployment, domain, TLS provisioning, third-party provider credentials, store accounts or release signing credentials are supplied. A worldwide public launch requires these plus country-by-country legal and operating arrangements.
- Location and chat data require retention/deletion policies and appropriate privacy consent before launch. Use a security review before collecting real customer data.

The web workflow is suitable for development and end-to-end iteration. It must not be represented as ready for public transport operations or as feature-complete Uber parity.
