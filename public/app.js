const $ = (s) => document.querySelector(s);
let state = null,
  mode = "login",
  refreshTask = null,
  lastRender = "",
  locationWatch = null,
  sessionEpoch = 0,
  mutating = false;
const drafts = new Map();
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (n, currency) =>
  currency
    ? new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
        Number(n),
      )
    : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
const shortTime = (seconds) => {
  const minutes = Math.max(0, Math.ceil(Number(seconds || 0) / 60));
  return minutes > 1 ? `${minutes} min` : "under a minute";
};
let currencies = ["USD", "EUR", "GBP", "INR", "LKR", "CAD", "AUD", "JPY"];
function toast(message, error = false) {
  const n = $("#notice");
  n.textContent = message;
  n.className = error ? "error" : "";
  n.style.display = "block";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (n.style.display = "none"), 6000);
}
async function api(path, data) {
  const r = await fetch("/api/" + path, {
    method: data === undefined ? "GET" : "POST",
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const j = await r.json();
  if (!r.ok) {
    const e = new Error(j.error || "Request failed");
    e.status = r.status;
    throw e;
  }
  return j;
}
function values(form) {
  return Object.fromEntries(new FormData(form));
}
const symbols = {
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  car: '<path d="m5 7 2-3h10l2 3 2 4v8h-3v-3H6v3H3v-8l2-4Z"/><path d="M5 7h14M3 12h18m-15 1h1m10 0h1"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  cash: '<rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="12" cy="12" r="3"/><path d="M6 9v6m12-6v6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  history: '<path d="M3 10a9 9 0 1 1 1 7M3 4v6h6m3-3v5l4 2"/>',
  shield:
    '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  chat: '<path d="M21 11a9 9 0 0 1-9 9H4l-3 2 1-7a9 9 0 1 1 19-4Z"/><path d="M7 10h10M7 14h6"/>',
  target:
    '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 1v4m0 14v4M1 12h4m14 0h4"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  logout: '<path d="M10 4H4v16h6m-1-8h12m-4-4 4 4-4 4"/>',
};
function icon(name) {
  return `<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${symbols[name] || symbols.arrow}</svg>`;
}
const initials = (name) =>
  esc(
    String(name)
      .split(/\s+/)
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase(),
  );
let currentView = "ride";
function navMarkup() {
  return [
    ["ride", "car", "Ride"],
    ["activity", "history", "Activity"],
    ["account", "user", "Account"],
  ]
    .map(
      ([view, symbol, title]) =>
        `<button class="nav-item ${currentView === view ? "active" : ""}" data-view="${view}" ${currentView === view ? 'aria-current="page"' : ""}>${icon(symbol)}<span>${title}</span></button>`,
    )
    .join("");
}
function setView(view) {
  currentView = view;
  render();
  window.scrollTo({ top: 0, behavior: "instant" });
}
function header() {
  $("#primary-nav").hidden = $("#mobile-nav").hidden = false;
  $("#primary-nav").innerHTML = $("#mobile-nav").innerHTML = navMarkup();
  $("#account").innerHTML =
    `<button class="profile-button" data-view="account"><span class="avatar tiny">${initials(state.user.name)}</span><span>${esc(state.user.name.split(" ")[0])}</span></button><button id="logout" class="icon-button" aria-label="Sign out" title="Sign out">${icon("logout")}</button>`;
  document
    .querySelectorAll("[data-view]")
    .forEach((b) => (b.onclick = () => setView(b.dataset.view)));
  $("#logout").onclick = async () => {
    try {
      await api("logout", {});
      auth();
    } catch (e) {
      toast(e.message, true);
    }
  };
}
function streetArt() {
  return `<svg viewBox="0 0 760 470" class="street-art" role="img" aria-label="Stylized city illustration, not a live map"><defs><pattern id="cityblocks" width="130" height="110" patternUnits="userSpaceOnUse" patternTransform="rotate(-18)"><rect x="8" y="8" width="114" height="94" rx="14" fill="#e2e6dc"/><rect x="18" y="18" width="43" height="74" rx="8" fill="#edf0e8"/><rect x="69" y="18" width="43" height="30" rx="7" fill="#d9e0d4"/></pattern><filter id="carshadow"><feDropShadow dx="8" dy="12" stdDeviation="10" flood-opacity=".18"/></filter></defs><rect width="760" height="470" fill="#f4f4ee"/><rect width="760" height="470" fill="url(#cityblocks)"/><path d="M620-40c-65 100-10 145-80 215S380 310 430 510" fill="none" stroke="#c5d9cf" stroke-width="75"/><path d="M620-40c-65 100-10 145-80 215S380 310 430 510" fill="none" stroke="#dce9e0" stroke-width="53"/><path d="m-20 350 210-55 95-25 0-90 150-42 140 0 130-35" fill="none" stroke="#fff" stroke-width="28" stroke-linejoin="round"/><path d="m190 295 95-25 0-90 150-42 140 0" fill="none" stroke="#181f1b" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="190" cy="295" r="18" fill="#fff"/><circle cx="190" cy="295" r="9" fill="#252d26"/><circle cx="575" cy="138" r="24" fill="#d2f169"/><circle cx="575" cy="138" r="7" fill="#20271f"/><g transform="translate(360 154) rotate(-16)" filter="url(#carshadow)"><rect x="-25" y="-47" width="50" height="96" rx="19" fill="#1a211e"/><rect x="-22" y="-18" width="44" height="44" rx="10" fill="#343f37"/><path d="m-17-18 4-13h26l4 13Z" fill="#a2b8ab"/><path d="m-17 26 4 10h26l4-10Z" fill="#6f8577"/><rect x="-20" y="-39" width="9" height="5" rx="2" fill="#f4f3dc"/><rect x="11" y="-39" width="9" height="5" rx="2" fill="#f4f3dc"/><path d="M-24 0h-7m55 0h7" stroke="#222c25" stroke-width="5" stroke-linecap="round"/></g><g fill="#bdcdb5"><circle cx="90" cy="125" r="28"/><circle cx="120" cy="111" r="22"/><circle cx="90" cy="97" r="18"/><circle cx="660" cy="340" r="32"/><circle cx="695" cy="320" r="23"/></g></svg>`;
}
function artPanel() {
  return `<div class="city-scene">${streetArt()}<div class="scene-caption"><span class="live-dot"></span> YOUR NEXT CHAPTER STARTS HERE</div><div class="scene-label origin">${icon("pin")} Your starting point</div><div class="scene-label destination">Somewhere good ${icon("arrow")}</div><span class="scene-disclaimer">City illustration · not a live map</span></div>`;
}
function auth() {
  sessionEpoch++;
  stopLocation();
  drafts.clear();
  state = null;
  lastRender = "";
  currentView = "ride";
  document.body.className = "auth-page";
  $("#primary-nav").hidden = $("#mobile-nav").hidden = true;
  $("#account").innerHTML =
    `<span class="header-note">A little more freedom.</span><span class="cash-badge">${icon("cash")} Cash rides</span>`;
  $("#app").innerHTML =
    `<div class="hero"><section class="hero-story"><span class="eyebrow"><span class="accent-line"></span> GO YOUR OWN WAY</span><h1>Your city.<br>Your ride.<br><span>Your call.</span></h1><p class="hero-description">More freedom in every journey. Choose your ride,<br class="desktop-only"> agree on a fair fare, and pay in cash.</p><div class="hero-features"><span>${icon("cash")} Your fare</span><span>${icon("car")} Your driver</span><span>${icon("arrow")} Your way</span></div>${artPanel()}<div class="hero-caption"><span>Less hassle.<br><b>More living.</b></span><span class="round-arrow">${icon("arrow")}</span></div></section><section class="auth-column"><div class="card auth"><div class="auth-top"><span class="eyebrow">THE GOOD PART STARTS HERE</span><span class="mini-brand">j.</span></div><h2>${mode === "login" ? "Welcome back." : "Make your move."}</h2><p>${mode === "login" ? "Your next journey is just a sign-in away." : "A little about you. A world of possibilities."}</p><div class="tabs"><button data-mode="login" class="${mode === "login" ? "selected" : ""}">Sign in</button><button data-mode="register" class="${mode === "register" ? "selected" : ""}">Create account</button></div><form id="auth-form">${mode === "register" ? '<label for="name">Full name</label><input id="name" name="name" autocomplete="name" placeholder="Your name" required maxlength="80"><label for="role">I want to</label><select id="role" name="role"><option value="customer">Book a ride</option><option value="driver">Drive with Jawa Ride</option></select><div id="driver-fields" hidden><label for="vehicle">Vehicle model & colour</label><input id="vehicle" name="vehicle" placeholder="e.g. Blue hatchback" maxlength="80"><label for="plate">Registration plate</label><input id="plate" name="plate" maxlength="30"></div>' : ""}<label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required maxlength="254"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="${mode === "login" ? "current-password" : "new-password"}" placeholder="${mode === "login" ? "Enter your password" : "At least 10 characters"}" minlength="${mode === "register" ? 10 : 1}" maxlength="200" required><button class="wide primary auth-submit">${mode === "login" ? "Sign in →" : "Create account →"}</button><div id="auth-error" class="error-box" role="alert"></div></form><div class="auth-assurance">${icon("cash")} No card details. Just your next destination.</div></div><p class="auth-footnote">The fare is agreed before the journey.<br>Pay your driver directly when you arrive.</p></section></div>`;
  document.querySelectorAll("[data-mode]").forEach(
    (b) =>
      (b.onclick = () => {
        mode = b.dataset.mode;
        auth();
      }),
  );
  if ($("#role"))
    $("#role").onchange = (e) => {
      $("#driver-fields").hidden = e.target.value !== "driver";
      $("#vehicle").required = $("#plate").required =
        e.target.value === "driver";
    };
  $("#auth-form").onsubmit = async (e) => {
    e.preventDefault();
    const b = e.target.querySelector("button");
    b.disabled = true;
    try {
      await api(mode, values(e.target));
      await refresh(true);
    } catch (err) {
      if ($("#auth-error")) $("#auth-error").textContent = err.message;
    } finally {
      b.disabled = false;
    }
  };
}
function rideForm() {
  const saved = (state.places || []).map((p) => `<button type="button" class="saved-place" data-place="${p.id}" data-label="${esc(p.location)}" data-lat="${p.lat}" data-lng="${p.lng}"><b>${esc(p.label)}</b><span>${esc(p.location)}</span></button>`).join("");
  return `<section class="card booking-card"><div class="card-heading"><span class="square-icon">${icon("car")}</span><div><span class="eyebrow">LET'S GET GOING</span><h2>Where to?</h2></div></div>${saved ? `<div class="saved-place-row"><span>Saved places</span>${saved}</div>` : ""}<form id="ride-form"><div class="location-entry"><span class="location-dot"></span><div><label for="pickup">Pickup location</label><input id="pickup" name="pickup" placeholder="Enter your pickup" required maxlength="200"></div></div><div class="coordinate-row"><div><label for="plat">Pickup latitude</label><input id="plat" name="plat" type="number" step="any" min="-90" max="90" required placeholder="Latitude"></div><div><label for="plng">Pickup longitude</label><input id="plng" name="plng" type="number" step="any" min="-180" max="180" required placeholder="Longitude"></div></div><button type="button" id="pickup-gps" class="location-button">${icon("target")} Use my current location</button><div class="location-entry destination-entry"><span class="location-dot square"></span><div><label for="destination">Destination</label><input id="destination" name="destination" placeholder="Where are you heading?" required maxlength="200"></div></div><div class="coordinate-row"><div><label for="dlat">Destination latitude</label><input id="dlat" name="dlat" type="number" step="any" min="-90" max="90" required placeholder="Latitude"></div><div><label for="dlng">Destination longitude</label><input id="dlng" name="dlng" type="number" step="any" min="-180" max="180" required placeholder="Longitude"></div></div><div class="fare-section"><div class="section-title"><h3>Make it your fare.</h3><span class="soft-badge">${icon("cash")} Cash</span></div><div class="fare-inputs"><div><label for="currency">Ride currency</label><select id="currency" name="currency">${currencies.map((c) => `<option value="${c}" ${c === "USD" ? "selected" : ""}>${c}</option>`).join("")}</select></div><div><label for="budget">Your cash offer</label><input id="budget" name="budget" type="number" min="1" max="100000" step="0.01" placeholder="0.00" required></div></div><p class="hint">Drivers can accept your price or send a counteroffer.</p></div><button class="primary wide">Find a driver ${icon("arrow")}</button><p class="form-note">Coordinates are needed for pickup and destination. Address search is not connected yet.</p></form><form data-place-form class="save-place-form"><div><b>Keep this pickup handy</b><span>Save a landmark for your next ride.</span></div><label for="place-label" class="sr-only">Saved place name</label><input id="place-label" name="label" maxlength="60" placeholder="e.g. Home"><button class="ghost small">Save place</button></form></section>`;
}
function route(r) {
  return `<div class="route"><div><span class="route-node"></span><small>PICKUP</small><strong>${esc(r.pickup)}</strong></div><div><span class="route-node end"></span><small>DESTINATION</small><strong>${esc(r.destination)}</strong></div></div>`;
}
function offerCard(r, o) {
  return `<div class="offer"><div class="offer-person"><span class="avatar">${initials(o.name)}</span><div><b>${esc(o.name)}</b><small>${esc(o.vehicle)} <span class="plate">${esc(o.plate)}</span></small><span class="eta">${icon("clock")} ${o.eta} min to pickup · driver estimate</span></div></div><div class="offer-bottom"><div><span class="eyebrow">CASH FARE</span><strong>${money(o.fare, r.currency)}</strong></div><button class="primary small" data-accept="${r.id}" data-offer="${o.id}" data-version="${o.version}" ${o.available ? "" : "disabled"}>${o.available ? "Accept" : "Unavailable"}</button></div></div>`;
}
function progress(r) {
  if (["requested", "cancelled"].includes(r.status)) return "";
  const index = ["accepted", "arrived", "in_progress", "completed"].indexOf(
    r.status,
  );
  return `<ol class="trip-progress" aria-label="Trip progress">${["Matched", "At pickup", "On the way", "Arrived"].map((label, i) => `<li class="${i <= index ? "done" : ""}"><span>${i < index ? icon("check") : i + 1}</span><small>${label}</small></li>`).join("")}</ol>`;
}
function rideTimeline(r) {
  if (!r.events?.length) return "";
  return `<section class="ride-timeline"><div class="section-title"><h3>Ride timeline</h3><span>${r.events.length} update${r.events.length === 1 ? "" : "s"}</span></div><ol>${r.events.map((event) => `<li><span></span><div><b>${esc(event.kind)}</b><p>${esc(event.detail)}</p><time>${new Date(event.created * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time></div></li>`).join("")}</ol></section>`;
}
function trip(r) {
  const customer = state.user.role === "customer",
    mine = r.driver_id === state.user.id,
    active = !["completed", "cancelled"].includes(r.status);
  const title =
    r.status === "requested"
      ? customer
        ? "Find your kind of ride."
        : "A new journey awaits."
      : r.status === "completed"
        ? "Another good journey."
        : r.status === "cancelled"
          ? "Ride cancelled."
          : customer
            ? "You’re in good company."
            : "Your next stop awaits.";
  return `<article class="card trip-card"><div class="ride-head"><span class="eyebrow">JAWA RIDE <span class="ride-number">#${String(r.id).padStart(4, "0")}</span></span><span class="status status-${r.status}"><span></span>${esc(r.status.replaceAll("_", " "))}</span></div><h2>${title}</h2>${progress(r)}${route(r)}<div class="metrics"><div><small>${icon("pin")} Direct distance</small><strong>${r.distance}<span> km</span></strong></div><div><small>${icon("cash")} ${r.fare ? "Agreed fare" : "Customer offer"}</small><strong>${money(r.fare ?? r.budget, r.currency)}</strong></div>${r.pickup_distance !== null ? `<div><small>${icon("car")} To pickup · direct</small><strong>${r.pickup_distance}<span> km</span></strong></div>` : ""}</div><p class="distance-note">Distances are straight-line estimates, not driving distances.</p>${r.driver ? `<div class="person-strip"><span class="avatar">${initials(customer ? r.driver.name : r.customer_name)}</span><div><small>${customer ? "YOUR DRIVER" : "YOUR CUSTOMER"}</small><b>${esc(customer ? r.driver.name : r.customer_name)}</b>${customer ? `<span>${esc(r.driver.vehicle)} · ${esc(r.driver.plate)}</span>` : ""}</div>${icon("car")}</div>` : !customer ? `<div class="request-person"><span class="avatar tiny">${initials(r.customer_name)}</span> Requested by <b>${esc(r.customer_name)}</b></div>` : ""}${!customer ? `<details class="location-details"><summary>View exact coordinates ${icon("chevron")}</summary><p class="hint">Pickup: ${r.plat}, ${r.plng}<br>Destination: ${r.dlat}, ${r.dlng}</p></details>` : ""}${r.status === "requested" ? (customer ? `<div class="section-title offers-heading"><h3>Choose your driver</h3><span class="count-badge">${r.offers.length} offer${r.offers.length === 1 ? "" : "s"}</span></div>${r.offers.length ? r.offers.map((o) => offerCard(r, o)).join("") : `<div class="waiting"><span class="waiting-ring">${icon("car")}</span><div><b>Your request is out there.</b><p>Offers appear here as drivers respond.</p></div></div>`}` : `<form data-offer-form="${r.id}" class="offer-form"><h3>Your ride. Your rate.</h3><div class="cols"><div><label>Cash fare<input aria-label="Cash fare" name="fare" type="number" min="1" max="100000" step=".01" value="${r.offers[0]?.fare ?? r.budget}" required></label></div><div><label>Arrival · minutes<input aria-label="Arrival minutes" name="eta" type="number" min="1" max="180" value="${r.offers[0]?.eta ?? 5}" required></label></div></div><button class="wide primary">${r.offers.length ? "Update offer" : "Send offer"} ${icon("arrow")}</button></form>`) : ""}${customer && r.pickup_pin ? `<section class="pickup-code"><div><span class="eyebrow">YOUR PICKUP CODE</span><strong data-pickup-code>${esc(r.pickup_pin)}</strong></div><span class="code-shield">${icon("shield")}</span><p>Share with your driver when you meet at pickup.</p></section>` : ""}${mine && active ? `<div class="trip-actions">${r.status === "accepted" ? `<button class="primary wide" data-status="arrived" data-ride="${r.id}">I’ve arrived at pickup ${icon("pin")}</button>` : r.status === "arrived" ? `<form data-start="${r.id}"><label>Customer pickup code<input aria-label="Customer pickup code" name="pickup_pin" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="off" placeholder="Enter the 6-digit code" required></label><button class="primary wide">Start trip ${icon("arrow")}</button></form>` : r.status === "in_progress" ? `<form data-complete="${r.id}"><label class="check"><input type="checkbox" name="cash" required> I received ${money(r.fare, r.currency)} in cash</label><button class="primary wide">Complete trip ${icon("check")}</button></form>` : ""}</div>` : ""}${r.cash_confirmed ? `<div class="receipt-banner"><span class="square-icon">${icon("check")}</span><div><b>All settled. In cash.</b><small>Your driver confirmed payment.</small></div></div><button class="ghost wide" data-receipt="${r.id}">${icon("cash")} Download cash receipt</button>` : ""}${r.driver_id && (customer || mine) ? chat(r, active) : ""}${customer && r.status === "completed" ? (r.rating ? `<div class="rating-thanks"><span>${"★".repeat(r.rating)}</span><p>Your rating: ${r.rating}/5 · Thanks for riding with us.</p></div>` : `<form data-rating="${r.id}" class="rating-form"><label for="rating-${r.id}">How was your ride?</label><select id="rating-${r.id}" aria-label="Rate trip" name="stars"><option value="5">★★★★★ · Excellent</option><option value="4">★★★★ · Good</option><option value="3">★★★ · Okay</option><option value="2">★★ · Poor</option><option value="1">★ · Bad</option></select><button class="ghost wide">Rate trip</button></form>`) : ""}${active && (customer || mine) && r.status !== "in_progress" ? `<div class="cancel-row"><button class="text-button danger" data-status="cancelled" data-ride="${r.id}">Cancel ride</button><span>Change of plans? We understand.</span></div>` : ""}</article>`;
}
function trip(r) {
  const customer = state.user.role === "customer";
  const mine = r.driver_id === state.user.id;
  const active = !["completed", "cancelled"].includes(r.status);
  const driverControls = mine && active ? r.status === "accepted" ? `<button class="primary wide" data-status="arrived" data-ride="${r.id}">I’ve arrived at pickup ${icon("pin")}</button>` : r.status === "arrived" ? `<form data-start="${r.id}"><label>Customer pickup code<input aria-label="Customer pickup code" name="pickup_pin" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="off" placeholder="Enter the 6-digit code" required></label><button class="primary wide">Start trip ${icon("arrow")}</button></form>` : r.status === "in_progress" ? `<form data-complete="${r.id}"><label class="check"><input type="checkbox" name="cash" required> I received ${money(r.fare, r.currency)} in cash</label><button class="primary wide">Complete trip ${icon("check")}</button></form>` : "" : "";
  const matching = !customer && r.status === "requested" ? `<form data-offer-form="${r.id}" class="offer-form"><h3>Make an offer</h3><p class="hint">${r.pickup_distance} km away · within your ${state.user.matching_radius} km matching radius.</p><div class="cols"><label>Cash fare<input aria-label="Cash fare" name="fare" type="number" min="1" max="100000" step=".01" value="${r.offers[0]?.fare ?? r.budget}" required></label><label>Arrival · minutes<input aria-label="Arrival minutes" name="eta" type="number" min="1" max="180" value="${r.offers[0]?.eta ?? 5}" required></label></div><button class="wide primary">${r.offers.length ? "Update offer" : "Send offer"} ${icon("arrow")}</button></form>` : "";
  const customerOffers = customer && r.status === "requested" ? `<div class="section-title offers-heading"><h3>Choose your driver</h3><span class="count-badge">${r.offers.length} offer${r.offers.length === 1 ? "" : "s"}</span></div>${r.offers.length ? r.offers.map((o) => offerCard(r, o)).join("") : `<div class="waiting"><span class="waiting-ring">${icon("car")}</span><div><b>Your request is out there.</b><p>Only nearby drivers with a current live location can respond.</p></div></div>`}` : "";
  const person = r.driver ? `<div class="person-strip"><span class="avatar">${initials(customer ? r.driver.name : r.customer_name)}</span><div><small>${customer ? "YOUR DRIVER" : "YOUR CUSTOMER"}</small><b>${esc(customer ? r.driver.name : r.customer_name)}</b>${customer ? `<span>${esc(r.driver.vehicle)} · ${esc(r.driver.plate)}</span>` : ""}</div>${icon("car")}</div>` : !customer ? `<div class="request-person"><span class="avatar tiny">${initials(r.customer_name)}</span> Requested by <b>${esc(r.customer_name)}</b></div>` : "";
  const title = r.status === "requested" ? customer ? "Finding your kind of ride." : "A nearby request." : r.status === "completed" ? "Another good journey." : r.status === "cancelled" ? "Ride cancelled." : customer ? "You’re in good company." : "Your next stop awaits.";
  return `<article class="card trip-card"><div class="ride-head"><span class="eyebrow">JAWA RIDE <span class="ride-number">#${String(r.id).padStart(4,"0")}</span></span><span class="status status-${r.status}"><span></span>${esc(r.status.replaceAll("_"," "))}</span></div><h2>${title}</h2>${customer && r.status === "requested" && r.expires_in !== null ? `<div class="request-window">${icon("clock")} Request stays open for ${shortTime(r.expires_in)}. Choose an offer when it feels right.</div>` : ""}${progress(r)}${route(r)}<div class="metrics"><div><small>${icon("pin")} Direct distance</small><strong>${r.distance}<span> km</span></strong></div><div><small>${icon("cash")} ${r.fare ? "Agreed fare" : "Customer offer"}</small><strong>${money(r.fare ?? r.budget,r.currency)}</strong></div>${r.pickup_distance !== null ? `<div><small>${icon("car")} To pickup · direct</small><strong>${r.pickup_distance}<span> km</span></strong></div>` : ""}</div><p class="distance-note">Distances are straight-line estimates, not driving distances.</p>${person}${!customer ? `<details class="location-details"><summary>View exact coordinates ${icon("chevron")}</summary><p class="hint">Pickup: ${r.plat}, ${r.plng}<br>Destination: ${r.dlat}, ${r.dlng}</p></details>` : ""}${customerOffers}${matching}${customer && r.pickup_pin ? `<section class="pickup-code"><div><span class="eyebrow">YOUR PICKUP CODE</span><strong data-pickup-code>${esc(r.pickup_pin)}</strong></div><span class="code-shield">${icon("shield")}</span><p>Share with your driver when you meet at pickup.</p></section>` : ""}${driverControls}${r.cash_confirmed ? `<div class="receipt-banner"><span class="square-icon">${icon("check")}</span><div><b>All settled. In cash.</b><small>Your driver confirmed payment.</small></div></div><button class="ghost wide" data-receipt="${r.id}">${icon("cash")} Download cash receipt</button>` : ""}${r.driver_id && (customer || mine) ? chat(r,active) : ""}${rideTimeline(r)}${customer && r.status === "completed" ? (r.rating ? `<div class="rating-thanks"><span>${"★".repeat(r.rating)}</span><p>Your rating: ${r.rating}/5 · Thanks for riding with us.</p></div>` : `<form data-rating="${r.id}" class="rating-form"><label for="rating-${r.id}">How was your ride?</label><select id="rating-${r.id}" aria-label="Rate trip" name="stars"><option value="5">★★★★★ · Excellent</option><option value="4">★★★★ · Good</option><option value="3">★★★ · Okay</option><option value="2">★★ · Poor</option><option value="1">★ · Bad</option></select><button class="ghost wide">Rate trip</button></form>`) : ""}${r.status === "cancelled" && r.cancel_reason ? `<p class="cancellation-note"><b>Cancellation note:</b> ${esc(r.cancel_reason)}</p>` : ""}${active && (customer || mine) && r.status !== "in_progress" ? `<form class="cancel-row" data-cancel="${r.id}"><label>Need to cancel?<select aria-label="Cancellation reason" name="cancel_reason"><option>Changed plans</option><option>Waiting too long</option><option>Found another ride</option><option>Other</option></select></label><button class="text-button danger">Cancel ride</button></form>` : ""}</article>`;
}
function chat(r, active) {
  return `<div class="chat"><div class="section-title"><h3>${icon("chat")} Trip chat</h3><span class="chat-label">${active ? "Just you two" : "Conversation closed"}</span></div><div class="messages" aria-live="polite">${r.messages.length ? r.messages.map((m) => `<div class="bubble ${m.user_id === state.user.id ? "mine" : ""}"><small>${esc(m.name)}<time>${new Date(m.created * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></small>${esc(m.body)}</div>`).join("") : '<div class="chat-empty">A quick hello makes pickup easier.<br>Send a message to get started.</div>'}</div>${active ? `<form data-chat="${r.id}"><input name="body" aria-label="Message" placeholder="Write a message…" maxlength="1000" required><button aria-label="Send">${icon("arrow")}</button></form>` : ""}</div>`;
}
function driverPanel(u, active, history) {
  const busy = active.some((r) => r.driver_id === u.id);
  const paid = history.filter((r) => r.status === "completed");
  const totals = {};
  for (const r of paid) totals[r.currency] = (totals[r.currency] || 0) + r.fare;
  return `<section class="card driver-panel"><div class="driver-avatar">${initials(u.name)}<span class="availability-dot ${u.online ? "online" : ""}"></span></div><span class="eyebrow">YOUR DRIVER WORKSPACE</span><h2>${busy ? "Good things ahead." : u.online ? "You’re ready to roll." : "Ready when you are."}</h2><p>${busy ? "Focus on this journey. New requests will be here when you finish." : u.online ? "You’re online. Choose a request and make an offer that works for you." : "Go online to see ride requests and find your next journey."}</p><button id="availability" class="${u.online ? "ghost" : "primary"} wide">${u.online ? "Go offline" : "Go online →"}</button><button id="share-location" class="location-button wide">${icon("target")} Share live location</button><p class="hint" id="location-state"></p><div class="vehicle-tag">${icon("car")}<div><b>${esc(u.vehicle)}</b><span>${esc(u.plate)}</span></div></div></section><section class="card earnings-card"><div class="section-title"><h3>Good work adds up.</h3>${icon("cash")}</div><span class="eyebrow">CASH FROM RECENT TRIPS</span>${
    Object.keys(totals).length
      ? Object.entries(totals)
          .map(
            ([currency, total]) => `<strong>${money(total, currency)}</strong>`,
          )
          .join("")
      : "<strong>Getting started</strong>"
  }<p>${paid.length} completed trip${paid.length === 1 ? "" : "s"} in your loaded history</p></section>`;
}
function driverPanel(u, active, history) {
  const busy = active.some((r) => r.driver_id === u.id);
  const paid = history.filter((r) => r.status === "completed");
  const totals = {};
  for (const r of paid) totals[r.currency] = (totals[r.currency] || 0) + r.fare;
  const ready = state.matching?.ready || state.matching?.location_current;
  return `<section class="card driver-panel"><div class="driver-avatar">${initials(u.name)}<span class="availability-dot ${ready ? "online" : ""}"></span></div><span class="eyebrow">YOUR DRIVER WORKSPACE</span><h2>${busy ? "Good things ahead." : u.online && ready ? "You’re ready to roll." : "Ready when you are."}</h2><p>${busy ? "Focus on this journey. New requests will be here when you finish." : u.online && ready ? "Your live location is current. Nearby requests are ready to review." : "Share a current location, then go online to receive nearby requests."}</p><div class="matching-status ${ready ? "ready" : ""}">${icon("target")} <span>${ready ? `Matching within ${u.matching_radius} km` : "Location is needed for matching"}</span></div><button id="share-location" class="location-button wide">${icon("target")} ${ready ? "Refresh live location" : "Share live location"}</button><button id="availability" class="${u.online ? "ghost" : "primary"} wide">${u.online ? "Go offline" : "Go online →"}</button><p class="hint" id="location-state"></p><div class="vehicle-tag">${icon("car")}<div><b>${esc(u.vehicle)}</b><span>${esc(u.plate)}</span></div></div></section><section class="card earnings-card"><div class="section-title"><h3>Good work adds up.</h3>${icon("cash")}</div><span class="eyebrow">CASH FROM RECENT TRIPS</span>${Object.keys(totals).length ? Object.entries(totals).map(([currency,total]) => `<strong>${money(total,currency)}</strong>`).join("") : "<strong>Getting started</strong>"}<p>${paid.length} completed trip${paid.length === 1 ? "" : "s"} in your loaded history</p></section>`;
}
function journeyPanel(r) {
  return `<section class="journey-panel"><span class="eyebrow">YOUR JOURNEY, YOUR WAY</span><h2>${r.status === "requested" ? "A good ride<br>is on the way." : "Let’s make<br>this a good trip."}</h2>${artPanel()}<div class="journey-tip">${icon("cash")}<span>Agree on the fare.<br><b>Pay in cash when you arrive.</b></span></div></section>`;
}
function homeCanvas() {
  return `<section class="explore-panel"><div class="explore-copy"><span class="eyebrow">THERE'S A WHOLE CITY OUT THERE</span><h2>Make room for<br><em>somewhere new.</em></h2><p>The everyday commute. The overdue catch-up.<br>Wherever life takes you, make it your ride.</p></div>${artPanel()}<div class="explore-bottom"><span>${icon("cash")} No cards. No complications.</span><b>Just a better way there.</b></div></section><div class="how-it-works">${[
    ["01", "Choose your route", "A start, a finish, a little possibility."],
    ["02", "Find your fare", "Choose the offer that works for you."],
    ["03", "Go. Enjoy. Pay cash.", "Simple, from hello to goodbye."],
  ]
    .map(
      ([n, title, body]) =>
        `<div><span>${n}</span><h3>${title}</h3><p>${body}</p></div>`,
    )
    .join("")}</div>`;
}
function activityPage(history) {
  return `<div class="page-heading"><span class="eyebrow">EVERY JOURNEY HAS A STORY</span><h1>Your activity.</h1><p>Your completed and cancelled journeys, all in one place.</p></div><section class="activity-list">${history.length ? history.map((r) => `<details class="history-item" data-history-id="${r.id}"><summary><span class="square-icon">${icon("car")}</span><div><b>${esc(r.destination)}</b><span>${new Date(r.created * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} · ${esc(r.status)}</span></div><strong>${money(r.fare ?? r.budget, r.currency)}</strong>${icon("chevron")}</summary>${trip(r)}</details>`).join("") : `<div class="card empty"><span class="empty-icon">${icon("history")}</span><h2>Your story starts here.</h2><p>Finished journeys will appear here.</p><button class="primary" data-view="ride">Find your next ride ${icon("arrow")}</button></div>`}</section>`;
}
function accountPage(u) {
  return `<div class="page-heading"><span class="eyebrow">A LITTLE ABOUT YOU</span><h1>Your account.</h1><p>All set for wherever you’re going next.</p></div><section class="card account-card"><span class="driver-avatar">${initials(u.name)}</span><h2>${esc(u.name)}</h2><span class="soft-badge">${icon(u.role === "driver" ? "car" : "user")} ${u.role === "driver" ? "Driver account" : "Customer account"}</span><dl><div><dt>Email</dt><dd>${esc(u.email)}</dd></div><div><dt>Payment</dt><dd>Cash, paid directly to your driver</dd></div>${u.role === "driver" ? `<div><dt>Vehicle</dt><dd>${esc(u.vehicle)}</dd></div><div><dt>Registration</dt><dd>${esc(u.plate)}</dd></div>` : ""}</dl><p class="hint">Email is used for sign-in. Phone and identity verification are not connected.</p></section>`;
}
function accountPage(u) {
  const places = (state.places || []).map((p) => `<li><div><b>${esc(p.label)}</b><span>${esc(p.location)}</span></div><button class="text-button danger" data-delete-place="${p.id}">Remove</button></li>`).join("");
  return `<div class="page-heading"><span class="eyebrow">A LITTLE ABOUT YOU</span><h1>Your account.</h1><p>Keep the details that help each ride run smoothly up to date.</p></div><section class="card account-card"><span class="driver-avatar">${initials(u.name)}</span><h2>${esc(u.name)}</h2><span class="soft-badge">${icon(u.role === "driver" ? "car" : "user")} ${u.role === "driver" ? "Driver account" : "Customer account"}</span><form data-profile class="profile-form"><label>Display name<input aria-label="Display name" name="name" maxlength="80" value="${esc(u.name)}" required></label><label>Email address<input aria-label="Email address" value="${esc(u.email)}" disabled></label>${u.role === "driver" ? `<label>Vehicle<input aria-label="Vehicle" name="vehicle" maxlength="80" value="${esc(u.vehicle)}" required></label><label>Registration plate<input aria-label="Registration plate" name="plate" maxlength="30" value="${esc(u.plate)}" required></label><label>Matching radius<select aria-label="Matching radius" name="matching_radius">${[3,5,10,15,25,50,100].map((n) => `<option value="${n}" ${Number(u.matching_radius) === n ? "selected" : ""}>${n} km from pickup</option>`).join("")}</select></label>` : ""}<button class="primary wide">Save account changes</button></form><p class="hint">Email is used for sign-in. Phone and identity verification are not connected.</p></section>${u.role === "customer" ? `<section class="card saved-places-card"><div class="section-title"><h2>Saved places</h2><span>${state.places?.length || 0}/8</span></div>${places ? `<ul>${places}</ul>` : `<p class="hint">Save a pickup location from the Ride screen to get started.</p>`}</section>` : ""}`;
}
function render() {
  const focus = rememberFocus(),
    scrollY = window.scrollY,
    u = state.user,
    customer = u.role === "customer";
  const expanded = new Set(
    Array.from(
      document.querySelectorAll("[data-history-id][open]"),
      (el) => el.dataset.historyId,
    ),
  );
  document.body.className = "app-page";
  header();
  const active = state.rides.filter(
      (r) => !["completed", "cancelled"].includes(r.status),
    ),
    history = state.rides.filter((r) =>
      ["completed", "cancelled"].includes(r.status),
    );
  if (currentView === "account") $("#app").innerHTML = accountPage(u);
  else if (currentView === "activity")
    $("#app").innerHTML = activityPage(history);
  else
    $("#app").innerHTML =
      `<div class="intro"><div><span class="greeting">Good to see you, ${esc(u.name.split(" ")[0])}.</span><h1>${customer ? (active.length ? "Let’s get you there." : "Where are we heading?") : "Your next opportunity awaits."}</h1></div><span class="cash-badge">${icon("cash")} Cash rides. Your choice.</span></div><div class="workspace ${active.length ? "has-trip" : ""} ${customer ? "customer-workspace" : "driver-workspace"}"><aside class="stack">${customer ? (active.length ? journeyPanel(active[0]) : rideForm()) : driverPanel(u, active, history)}<div class="support-note">${icon("shield")}<p>For an emergency, contact your local emergency services. Jawa Ride does not provide emergency dispatch.</p></div></aside><section class="stack content-column">${active.length ? `<div class="section-title workspace-title"><h2>${customer ? "Your ride" : "Ride requests"}</h2><span class="subtle-label"><span class="live-dot"></span> Updates automatically</span></div>${active.map(trip).join("")}` : customer ? homeCanvas() : `<div class="card driver-empty"><span class="empty-icon">${icon("car")}</span><span class="eyebrow">A NEW DAY. A NEW DIRECTION.</span><h2>${u.online ? "Good rides come<br>to those who are ready." : "Your next journey<br>starts with you."}</h2><p>${u.online ? "New requests will appear here. Keep this screen open while you’re available." : "Go online when you’re ready to receive ride requests."}</p>${artPanel()}</div>`}${history.length ? `<div class="section-title recent-heading"><h2>Your latest journey</h2><button class="text-button" data-view="activity">View activity ${icon("arrow")}</button></div>${trip(history[0])}` : ""}</section></div>`;
  document.querySelectorAll("[data-history-id]").forEach((el) => {
    el.open = expanded.has(el.dataset.historyId);
  });
  bind();
  document
    .querySelectorAll("[data-view]")
    .forEach((b) => (b.onclick = () => setView(b.dataset.view)));
  restoreDrafts(focus);
  window.scrollTo({ top: scrollY, behavior: "instant" });
}
function formKey(form) {
  if (!form || form.id === "auth-form") return null;
  return (
    form.id ||
    Array.from(form.attributes)
      .filter((a) => a.name.startsWith("data-"))
      .map((a) => `${a.name}:${a.value}`)
      .join("|")
  );
}
function rememberFocus() {
  const el = document.activeElement;
  if (!el?.form || !el.name) return null;
  return {
    form: formKey(el.form),
    name: el.name,
    start: el.selectionStart,
    end: el.selectionEnd,
  };
}
function restoreDrafts(focus) {
  const present = new Set();
  document.querySelectorAll("#app form").forEach((form) => {
    const key = formKey(form);
    present.add(key);
    for (const [name, value] of Object.entries(drafts.get(key) || {})) {
      const input = form.elements.namedItem(name);
      if (!input) continue;
      if (input.type === "checkbox") input.checked = value;
      else input.value = value;
    }
    if (focus?.form === key) {
      const el = form.elements.namedItem(focus.name);
      if (el) {
        el.focus({ preventScroll: true });
        if (
          typeof focus.start === "number" &&
          typeof el.setSelectionRange === "function"
        )
          el.setSelectionRange(focus.start, focus.end);
      }
    }
  });
  if (currentView === "ride")
    for (const key of drafts.keys()) if (!present.has(key)) drafts.delete(key);
}
function saveDraft(event) {
  const form = event.target.form,
    key = formKey(form);
  if (!key) return;
  const data = {};
  for (const el of form.elements)
    if (el.name) data[el.name] = el.type === "checkbox" ? el.checked : el.value;
  drafts.set(key, data);
}
$("#app").addEventListener("input", saveDraft);
$("#app").addEventListener("change", saveDraft);
function busyButtons(busy) {
  document
    .querySelectorAll("#app button, #app input, #app select, #app textarea")
    .forEach((b) => {
      if (busy && !b.disabled) {
        b.dataset.pending = "1";
        b.disabled = true;
      } else if (!busy && b.dataset.pending) {
        delete b.dataset.pending;
        b.disabled = false;
      }
    });
}
async function perform(path, data, message, form = null) {
  if (mutating) return;
  mutating = true;
  busyButtons(true);
  try {
    await api(path, data);
    if (form) {
      drafts.delete(formKey(form));
      form.reset();
    }
    lastRender = "";
    await refresh(true);
    if (message) toast(message);
  } catch (e) {
    if (e.status === 409) await refresh(true);
    if (e.status === 401) auth();
    toast(e.message, true);
  } finally {
    mutating = false;
    busyButtons(false);
  }
}
function stopLocation() {
  if (locationWatch !== null && navigator.geolocation)
    navigator.geolocation.clearWatch(locationWatch);
  locationWatch = null;
}
function locationText() {
  const label = $("#location-state"),
    button = $("#share-location");
  if (label)
    label.textContent =
      locationWatch !== null
        ? "Live location sharing is active while this page is open."
        : state?.matching?.ready
          ? "Your latest location is ready for matching. Keep sharing while you drive."
          : "Share a current location before you go online.";
  if (button)
    button.textContent =
      locationWatch !== null ? "Stop sharing location" : "Share live location";
}
function toggleLocation() {
  if (!navigator.geolocation) return toast("Location unavailable.", true);
  if (locationWatch !== null) {
    stopLocation();
    locationText();
    return toast("Live location sharing stopped.");
  }
  const epoch = sessionEpoch;
  locationWatch = navigator.geolocation.watchPosition(
    (p) => {
      if (epoch !== sessionEpoch || locationWatch === null) return;
      api("location", {
        lat: p.coords.latitude,
        lng: p.coords.longitude,
      }).then(() => refresh(true)).catch((e) => {
        if (e.status === 401) {
          stopLocation();
          locationText();
        }
        toast(e.message, true);
      });
      locationText();
    },
    (e) => {
      if (epoch !== sessionEpoch) return;
      stopLocation();
      locationText();
      toast(e.message, true);
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
  );
  locationText();
  toast("Requesting live location permission…");
}
function gps(success) {
  if (!navigator.geolocation)
    return toast("Geolocation is not supported by this browser.", true);
  navigator.geolocation.getCurrentPosition(
    success,
    (e) => toast(e.message || "Location permission is required.", true),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
  );
}
async function downloadReceipt(id) {
  try {
    const { receipt: r } = await api(`rides/${id}/receipt`);
    const content = [
      "JAWA RIDE · CASH RECEIPT",
      r.number,
      `Completed: ${new Date(r.completed_at * 1000).toISOString()}`,
      `Customer: ${r.customer}`,
      `Driver: ${r.driver}`,
      `Pickup: ${r.pickup}`,
      `Destination: ${r.destination}`,
      `Cash fare: ${money(r.amount, r.currency)}`,
      r.confirmation,
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/plain;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${r.number}.txt`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    toast(e.message, true);
  }
}
function bind() {
  document
    .querySelectorAll("[data-receipt]")
    .forEach((b) => (b.onclick = () => downloadReceipt(b.dataset.receipt)));
  document.querySelectorAll("[data-start]").forEach(
    (f) =>
      (f.onsubmit = (e) => {
        e.preventDefault();
        perform(
          `rides/${f.dataset.start}/status`,
          { status: "in_progress", pickup_pin: values(f).pickup_pin },
          "Pickup confirmed. Trip started.",
          f,
        );
      }),
  );
  if ($("#ride-form"))
    $("#ride-form").onsubmit = (e) => {
      e.preventDefault();
      perform(
        "rides",
        values(e.target),
        "Ride request sent to online drivers.",
        e.target,
      );
    };
  if ($("#pickup-gps"))
    $("#pickup-gps").onclick = () =>
      gps((p) => {
        if (!$("#plat") || !$("#plng")) return;
        $("#plat").value = p.coords.latitude;
        $("#plng").value = p.coords.longitude;
        saveDraft({ target: $("#plng") });
        toast("Pickup coordinates updated. Add your street or landmark.");
      });
  if ($("#availability"))
    $("#availability").onclick = () => {
      if (state.user.online) return perform("availability", { online: false });
      if (state.matching?.location_current) return perform("availability", { online: true }, "You’re online for nearby requests.");
      gps(async (p) => {
        try {
          await api("location", { lat: p.coords.latitude, lng: p.coords.longitude });
          await perform("availability", { online: true }, "You’re online for nearby requests.");
        } catch (e) {
          toast(e.message, true);
        }
      });
      toast("Getting your location before going online…");
    };
  if ($("#share-location")) $("#share-location").onclick = toggleLocation;
  locationText();
  document.querySelectorAll("[data-offer-form]").forEach(
    (f) =>
      (f.onsubmit = (e) => {
        e.preventDefault();
        perform(
          `rides/${f.dataset.offerForm}/offer`,
          values(f),
          "Offer sent.",
          f,
        );
      }),
  );
  document
    .querySelectorAll("[data-accept]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          perform(
            `rides/${b.dataset.accept}/accept`,
            {
              offer_id: Number(b.dataset.offer),
              offer_version: Number(b.dataset.version),
            },
            "Driver booked. Your cash fare is agreed.",
          )),
    );
  document.querySelectorAll("[data-status]").forEach(
    (b) =>
      (b.onclick = () => {
        if (b.dataset.status === "cancelled" && !confirm("Cancel this ride?"))
          return;
        perform(`rides/${b.dataset.ride}/status`, { status: b.dataset.status });
      }),
  );
  document.querySelectorAll("[data-complete]").forEach(
    (f) =>
      (f.onsubmit = (e) => {
        e.preventDefault();
        perform(
          `rides/${f.dataset.complete}/status`,
          { status: "completed", cash_received: f.elements.cash.checked },
          "Trip completed. Cash payment recorded.",
          f,
        );
      }),
  );
  document.querySelectorAll("[data-chat]").forEach(
    (f) =>
      (f.onsubmit = (e) => {
        e.preventDefault();
        perform(`rides/${f.dataset.chat}/chat`, values(f), null, f);
      }),
  );
  document.querySelectorAll("[data-rating]").forEach(
    (f) =>
      (f.onsubmit = (e) => {
        e.preventDefault();
        perform(
          `rides/${f.dataset.rating}/rate`,
          values(f),
          "Thanks for your feedback.",
          f,
        );
      }),
  );
  document.querySelectorAll("[data-cancel]").forEach(
    (f) =>
      (f.onsubmit = (e) => {
        e.preventDefault();
        if (confirm("Cancel this ride?"))
          perform(`rides/${f.dataset.cancel}/status`, { status: "cancelled", cancel_reason: values(f).cancel_reason }, "Ride cancelled.", f);
      }),
  );
  document.querySelectorAll("[data-place]").forEach(
    (b) =>
      (b.onclick = () => {
        if (!$("#pickup")) return;
        $("#pickup").value = b.dataset.label;
        $("#plat").value = b.dataset.lat;
        $("#plng").value = b.dataset.lng;
        saveDraft({ target: $("#pickup") });
        toast(`${b.textContent.trim()} set as pickup.`);
      }),
  );
  document.querySelectorAll("[data-place-form]").forEach(
    (f) =>
      (f.onsubmit = (e) => {
        e.preventDefault();
        const pickup = $("#pickup"), lat = $("#plat"), lng = $("#plng");
        if (!pickup?.value || !lat?.value || !lng?.value) return toast("Add a pickup name and coordinates before saving it.", true);
        perform("places", { ...values(f), location: pickup.value, lat: lat.value, lng: lng.value }, "Saved place added.", f);
      }),
  );
  document.querySelectorAll("[data-delete-place]").forEach(
    (b) => (b.onclick = () => perform(`places/${b.dataset.deletePlace}`, {}, "Saved place removed.")),
  );
  document.querySelectorAll("[data-profile]").forEach(
    (f) =>
      (f.onsubmit = (e) => {
        e.preventDefault();
        perform("profile", values(f), "Account updated.", f);
      }),
  );
  busyButtons(mutating);
}
async function refresh(force = false) {
  while (refreshTask) {
    await refreshTask;
    if (!force) return;
  }
  const epoch = sessionEpoch;
  const task = (async () => {
    try {
      const next = await api("state");
      if (epoch !== sessionEpoch) return;
      const fingerprint = JSON.stringify(next);
      state = next;
      if (force || fingerprint !== lastRender) {
        render();
        lastRender = fingerprint;
      }
    } catch (e) {
      if (epoch !== sessionEpoch) return;
      if (e.status === 401) {
        if (state || !$("#auth-form")) auth();
      } else if (force) toast(e.message, true);
    }
  })();
  refreshTask = task;
  try {
    await task;
  } finally {
    if (refreshTask === task) refreshTask = null;
  }
}
api("config")
  .then((config) => {
    currencies = config.currencies;
  })
  .catch(() => {})
  .finally(() => refresh(true));
setInterval(() => {
  if (state) refresh();
}, 3000);
setInterval(() => {
  if (state?.user.role === "driver" && state.user.online && locationWatch !== null)
    api("presence", {}).catch(() => {});
}, 20000);
