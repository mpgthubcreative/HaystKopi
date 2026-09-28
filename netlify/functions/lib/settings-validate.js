// Server-side validation for each owner-editable settings document — the
// actual enforcement point. The Settings page validates the same rules
// client-side for immediate feedback, but that is never trusted on its
// own; update-settings.js runs these same checks regardless of what the
// browser already checked.
//
// Every validator returns { ok, errors, data } where `data` is the
// sanitized object to actually write — never the raw payload verbatim.

const MAX_SHORT_STRING = 200;

function str(value, maxLen = MAX_SHORT_STRING) {
  return typeof value === "string" ? value.trim().slice(0, maxLen) : "";
}

function bool(value) {
  return value === true;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ---------- settings/business ----------

function validateBusinessSettings(payload) {
  const data = {
    businessName: str(payload.businessName),
    phone: str(payload.phone, 30),
    email: str(payload.email, 100),
    facebook: str(payload.facebook, 300),
    instagram: str(payload.instagram, 300),
  };
  return { ok: true, errors: {}, data };
}

// ---------- settings/orders (acceptingOrders + pickup) ----------

function validateOrdersSettings(payload) {
  const errors = {};

  const acceptingOrders = bool(payload.acceptingOrders);

  const pickupRaw = payload.pickup && typeof payload.pickup === "object" ? payload.pickup : {};
  const pickupEnabled = bool(pickupRaw.enabled);
  const pickupAddress = str(pickupRaw.address, 300);
  const pickupHours = str(pickupRaw.hours, 200);
  const pickupInstructions = str(pickupRaw.instructions, 500);

  if (pickupEnabled && !pickupAddress) {
    errors.pickupAddress = "Pickup address is required while Pickup is enabled.";
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    data: {
      acceptingOrders,
      pickup: {
        enabled: pickupEnabled,
        address: pickupAddress,
        hours: pickupHours,
        instructions: pickupInstructions,
      },
    },
  };
}

// ---------- settings/delivery ----------
// Bracket/zone/max-distance shape validation is already fully implemented
// in lib/delivery.js's validateDeliverySettings (reused here, not
// duplicated) — this just sanitizes the raw payload into the same shape
// that function expects before handing it off.

function sanitizeDeliveryPayload(payload) {
  const origin = payload.origin && typeof payload.origin === "object" ? payload.origin : {};
  const specialZonesRaw = payload.specialZones && typeof payload.specialZones === "object" ? payload.specialZones : {};
  const distancePricingRaw = payload.distancePricing && typeof payload.distancePricing === "object" ? payload.distancePricing : {};
  const bracketsRaw = Array.isArray(distancePricingRaw.brackets) ? distancePricingRaw.brackets : [];

  return {
    enabled: bool(payload.enabled),
    origin: {
      address: str(origin.address, 300),
      lat: origin.lat === null || origin.lat === undefined || origin.lat === "" ? null : num(origin.lat),
      lng: origin.lng === null || origin.lng === undefined || origin.lng === "" ? null : num(origin.lng),
    },
    specialZones: {
      rosewood: {
        enabled: bool(specialZonesRaw.rosewood && specialZonesRaw.rosewood.enabled),
        fee: num(specialZonesRaw.rosewood && specialZonesRaw.rosewood.fee),
      },
      acacia: {
        enabled: bool(specialZonesRaw.acacia && specialZonesRaw.acacia.enabled),
        fee: num(specialZonesRaw.acacia && specialZonesRaw.acacia.fee),
      },
    },
    distancePricing: {
      enabled: bool(distancePricingRaw.enabled),
      maxDistanceKm: num(distancePricingRaw.maxDistanceKm),
      brackets: bracketsRaw.map((b) => ({
        minKm: num(b.minKm),
        maxKm: num(b.maxKm),
        fee: num(b.fee),
      })),
    },
  };
}

function validateDeliveryPayload(payload, validateDeliverySettings) {
  const sanitized = sanitizeDeliveryPayload(payload);

  // Origin must have SOMETHING usable — either an address or coordinates —
  // or driving-distance calculation has nothing to route from.
  const hasAddress = Boolean(sanitized.origin.address);
  const hasCoords = sanitized.origin.lat != null && sanitized.origin.lng != null;

  const errors = {};
  if (!hasAddress && !hasCoords) {
    errors.origin = "Enter an origin address, or both latitude and longitude.";
  }

  const shapeCheck = validateDeliverySettings(sanitized);
  if (!shapeCheck.ok) {
    errors.brackets = `Delivery pricing configuration is invalid: ${shapeCheck.errors.join(", ")}`;
  }

  return { ok: Object.keys(errors).length === 0, errors, data: sanitized };
}

// ---------- settings/payments ----------

function validatePaymentsPayload(payload) {
  const gcashRaw = payload.gcash && typeof payload.gcash === "object" ? payload.gcash : {};
  const bankRaw = payload.bankTransfer && typeof payload.bankTransfer === "object" ? payload.bankTransfer : {};
  const codPickupRaw = payload.cashOnPickup && typeof payload.cashOnPickup === "object" ? payload.cashOnPickup : {};
  const codDeliveryRaw = payload.cashOnDelivery && typeof payload.cashOnDelivery === "object" ? payload.cashOnDelivery : {};

  const errors = {};

  const gcashEnabled = bool(gcashRaw.enabled);
  const gcashAccountName = str(gcashRaw.accountName, 100);
  const gcashNumber = str(gcashRaw.number, 30);
  if (gcashEnabled && (!gcashAccountName || !gcashNumber)) {
    errors.gcash = "GCash account name and number are required while GCash is enabled.";
  }

  const bankEnabled = bool(bankRaw.enabled);
  const bankName = str(bankRaw.bankName, 100);
  const bankAccountName = str(bankRaw.accountName, 100);
  const bankAccountNumber = str(bankRaw.accountNumber, 40);
  if (bankEnabled && (!bankName || !bankAccountName || !bankAccountNumber)) {
    errors.bankTransfer = "Bank name, account name, and account number are required while Bank Transfer is enabled.";
  }

  const data = {
    gcash: {
      enabled: gcashEnabled,
      accountName: gcashAccountName,
      number: gcashNumber,
      qrImagePath: str(gcashRaw.qrImagePath, 500),
    },
    bankTransfer: {
      enabled: bankEnabled,
      bankName,
      accountName: bankAccountName,
      accountNumber: bankAccountNumber,
      qrImagePath: str(bankRaw.qrImagePath, 500),
    },
    cashOnPickup: { enabled: bool(codPickupRaw.enabled) },
    cashOnDelivery: { enabled: bool(codDeliveryRaw.enabled) },
  };

  return { ok: Object.keys(errors).length === 0, errors, data };
}

module.exports = {
  validateBusinessSettings,
  validateOrdersSettings,
  validateDeliveryPayload,
  validatePaymentsPayload,
};
