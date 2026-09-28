// Trusted delivery pricing — the ONLY place delivery fee logic lives.
// Both calculate-delivery.js (live checkout estimate) and create-order.js
// (final, authoritative) call resolveDelivery() from here, so there is
// exactly one implementation to keep in sync, and create-order.js never
// trusts whatever calculate-delivery previously told the browser.
//
// Settings come from Firestore settings/delivery — see firestore.rules
// (owner-write, admin-read, no public access; unchanged from Phase 1's
// generic settings/{settingId} rule, which already covers this exactly).
// Nothing here is hardcoded pricing: change settings/delivery in Firestore
// and the NEXT request uses the new numbers, no code change needed.

const SPECIAL_ZONES = ["rosewood", "acacia"];

// ---------- Settings loading + validation ----------

// Never assume Firestore settings are valid just because they exist — a
// hand-edited or partially-migrated document could have negative fees,
// overlapping brackets, gaps, etc. This is checked on every read, not just
// when a Settings UI eventually writes one.
function validateDeliverySettings(settings) {
  const errors = [];

  if (!settings || typeof settings !== "object") {
    return { ok: false, errors: ["missing-settings"] };
  }

  const specialZones = settings.specialZones || {};
  SPECIAL_ZONES.forEach((zone) => {
    const z = specialZones[zone];
    if (!z || typeof z !== "object") {
      errors.push(`missing-zone-${zone}`);
      return;
    }
    const fee = Number(z.fee);
    if (!Number.isFinite(fee) || fee < 0) errors.push(`invalid-fee-${zone}`);
  });

  const dp = settings.distancePricing || {};
  const maxDistanceKm = Number(dp.maxDistanceKm);
  if (!Number.isFinite(maxDistanceKm) || maxDistanceKm <= 0) {
    errors.push("invalid-max-distance");
  }

  const brackets = Array.isArray(dp.brackets) ? dp.brackets : [];
  if (brackets.length === 0) {
    errors.push("no-brackets");
  }

  const sorted = [...brackets].sort((a, b) => Number(a.minKm) - Number(b.minKm));
  let previousMax = null;

  sorted.forEach((bracket, i) => {
    const minKm = Number(bracket.minKm);
    const maxKm = Number(bracket.maxKm);
    const fee = Number(bracket.fee);

    if (!Number.isFinite(minKm) || minKm < 0) errors.push(`bracket-${i}-invalid-min`);
    if (!Number.isFinite(maxKm) || maxKm <= minKm) errors.push(`bracket-${i}-invalid-max`);
    if (!Number.isFinite(fee) || fee < 0) errors.push(`bracket-${i}-invalid-fee`);

    // Brackets must be contiguous with no gap and no overlap: each one's
    // minKm must equal the previous one's maxKm exactly.
    if (previousMax !== null && minKm !== previousMax) {
      errors.push(`bracket-${i}-gap-or-overlap`);
    }
    previousMax = maxKm;
  });

  // The configured brackets must exactly partition [0, maxDistanceKm]: no
  // gap (some in-range distance would have no matching fee) and no excess
  // (Phase 9's Settings UI explicitly rejects a final bracket that extends
  // past maxDistanceKm, tightened from Phase 5's original "unreachable
  // brackets are harmless" stance — the Owner-facing editor should never
  // let maxDistanceKm and the bracket table disagree about the service
  // boundary).
  if (Number.isFinite(maxDistanceKm) && previousMax !== null) {
    if (previousMax < maxDistanceKm) {
      errors.push("brackets-dont-cover-max-distance");
    } else if (previousMax > maxDistanceKm) {
      errors.push("brackets-exceed-max-distance");
    }
  }

  return { ok: errors.length === 0, errors };
}

async function getDeliverySettings(db) {
  const snap = await db.collection("settings").doc("delivery").get();
  if (!snap.exists) {
    return { ok: false, errors: ["settings-not-found"] };
  }

  const settings = snap.data();
  const validation = validateDeliverySettings(settings);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }

  return { ok: true, settings };
}

// ---------- Bracket matching ----------

// Boundary convention (documented per the spec's own example):
//   first bracket (lowest minKm):  minKm <= distance <= maxKm   (inclusive both ends)
//   every other bracket:           minKm <  distance <= maxKm   (exclusive min, inclusive max)
// This guarantees a distance matches EXACTLY one bracket, with no overlap
// ambiguity at shared boundaries (e.g. 4km is only ever in the "0–4" bracket,
// never also in "4–6"). Applies to however many brackets are configured,
// not just the 3 seeded defaults.
function findBracket(distanceKm, brackets) {
  const sorted = [...brackets].sort((a, b) => Number(a.minKm) - Number(b.minKm));

  for (let i = 0; i < sorted.length; i++) {
    const minKm = Number(sorted[i].minKm);
    const maxKm = Number(sorted[i].maxKm);
    const inLowerBound = i === 0 ? distanceKm >= minKm : distanceKm > minKm;
    if (inLowerBound && distanceKm <= maxKm) {
      return { minKm, maxKm, fee: Number(sorted[i].fee) };
    }
  }

  return null;
}

// ---------- Distance calculation (Google Distance Matrix API) ----------

function buildAddressString(deliveryAddress) {
  const parts = [deliveryAddress.addressLine, deliveryAddress.barangay, deliveryAddress.city, "Philippines"]
    .map((p) => (p || "").trim())
    .filter(Boolean);
  return parts.join(", ");
}

async function calculateDrivingDistanceKm({ origin, destinationAddress, apiKey }) {
  if (!apiKey) {
    return { ok: false, reason: "no-api-key" };
  }

  const originParam = origin.lat != null && origin.lng != null
    ? `${origin.lat},${origin.lng}`
    : origin.address;

  if (!originParam) {
    return { ok: false, reason: "no-origin-configured" };
  }

  const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  url.searchParams.set("origins", originParam);
  url.searchParams.set("destinations", destinationAddress);
  url.searchParams.set("mode", "driving");
  url.searchParams.set("units", "metric");
  url.searchParams.set("key", apiKey);

  let response;
  try {
    response = await fetch(url.toString());
  } catch (err) {
    return { ok: false, reason: "network-error" };
  }

  if (!response.ok) {
    return { ok: false, reason: "http-error" };
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    return { ok: false, reason: "invalid-response" };
  }

  if (data.status !== "OK") {
    // Logged deliberately — this previously discarded Google's own status/
    // error_message (e.g. "REQUEST_DENIED" + "This API project is not
    // authorized to use this API"), collapsing every distinct failure into
    // one generic "provider-error" reason that was impossible to diagnose
    // from the logs alone.
    return { ok: false, reason: "provider-error", providerStatus: data.status, providerMessage: data.error_message };
  }

  const element = data.rows?.[0]?.elements?.[0];
  if (!element || element.status !== "OK" || !element.distance) {
    return { ok: false, reason: "unresolvable-address" };
  }

  return { ok: true, distanceKm: element.distance.value / 1000 };
}

// ---------- Orchestration ----------

// The single function both endpoints call. Returns { httpStatus, body } —
// body is exactly what calculate-delivery.js returns to the browser, and
// what create-order.js reads to build the trusted order snapshot.
async function resolveDelivery({ db, apiKey, deliveryArea, deliveryAddress }) {
  const settingsResult = await getDeliverySettings(db);
  if (!settingsResult.ok) {
    console.error("Delivery settings invalid or missing:", settingsResult.errors);
    return {
      httpStatus: 503,
      body: { available: false, error: "delivery-config-error", message: "We couldn't calculate delivery right now. Please try again." },
    };
  }

  const settings = settingsResult.settings;

  if (settings.enabled === false) {
    return {
      httpStatus: 503,
      body: { available: false, error: "delivery-disabled", message: "Delivery is currently unavailable." },
    };
  }

  if (deliveryArea === "rosewood" || deliveryArea === "acacia") {
    const zone = settings.specialZones[deliveryArea];
    if (!zone || zone.enabled === false) {
      return {
        httpStatus: 503,
        body: { available: false, error: "zone-disabled", message: "This delivery area is currently unavailable." },
      };
    }
    return {
      httpStatus: 200,
      body: {
        available: true,
        distanceKm: null,
        deliveryFee: Number(zone.fee),
        pricingType: "special-zone",
        zone: deliveryArea,
        pricingSnapshot: { fee: Number(zone.fee) },
      },
    };
  }

  if (deliveryArea !== "external") {
    return { httpStatus: 400, body: { available: false, error: "invalid-area", message: "Choose a valid delivery area." } };
  }

  if (!settings.distancePricing || settings.distancePricing.enabled === false) {
    return {
      httpStatus: 503,
      body: { available: false, error: "distance-pricing-disabled", message: "We couldn't calculate delivery right now. Please try again." },
    };
  }

  const destinationAddress = buildAddressString(deliveryAddress || {});
  if (!destinationAddress) {
    return { httpStatus: 400, body: { available: false, error: "invalid-address", message: "Please provide a complete delivery address." } };
  }

  const distanceResult = await calculateDrivingDistanceKm({
    origin: settings.origin || {},
    destinationAddress,
    apiKey,
  });

  if (!distanceResult.ok) {
    console.error(
      "Distance calculation failed:",
      distanceResult.reason,
      distanceResult.providerStatus || "",
      distanceResult.providerMessage || ""
    );
    return {
      httpStatus: 503,
      body: { available: false, error: "distance-unavailable", message: "We couldn't calculate delivery right now. Please try again." },
    };
  }

  const distanceKm = Math.round(distanceResult.distanceKm * 10) / 10; // one decimal place
  const maxDistanceKm = Number(settings.distancePricing.maxDistanceKm);

  if (distanceKm > maxDistanceKm) {
    return {
      httpStatus: 200,
      body: {
        available: false,
        distanceKm,
        reason: "outside-service-area",
        message: "This address is outside our current automatic delivery area. Please contact us for delivery arrangements.",
      },
    };
  }

  const bracket = findBracket(distanceKm, settings.distancePricing.brackets);
  if (!bracket) {
    // Settings passed validation (brackets cover 0..maxDistanceKm with no
    // gaps) so this should be unreachable — but never silently invent a fee.
    console.error("No bracket matched a valid distance:", distanceKm);
    return {
      httpStatus: 503,
      body: { available: false, error: "no-matching-bracket", message: "We couldn't calculate delivery right now. Please try again." },
    };
  }

  return {
    httpStatus: 200,
    body: {
      available: true,
      distanceKm,
      deliveryFee: bracket.fee,
      pricingType: "distance",
      zone: "external",
      pricingSnapshot: { minKm: bracket.minKm, maxKm: bracket.maxKm, fee: bracket.fee },
    },
  };
}

module.exports = {
  validateDeliverySettings,
  getDeliverySettings,
  findBracket,
  buildAddressString,
  calculateDrivingDistanceKm,
  resolveDelivery,
};
