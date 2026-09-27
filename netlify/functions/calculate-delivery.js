// POST /.netlify/functions/calculate-delivery
//
// DISPLAY-ONLY estimate for the checkout page. create-order.js calls the
// exact same resolveDelivery() independently and never trusts whatever this
// endpoint previously told the browser — see create-order.js's comments.
//
// No auth required (public checkout needs this before an order exists), but
// it's still cost/abuse-sensitive because "external" zone requests call the
// Google Distance Matrix API. checkout.js only calls this on an explicit
// "Calculate Delivery" click for the external zone (never per-keystroke),
// and cheaply for rosewood/acacia (no maps call for those). See Known
// Limitations in the phase summary for rate-limiting status.

const { db, initError } = require("./lib/firebase-admin");
const { resolveDelivery } = require("./lib/delivery");
const { respond } = require("./lib/http");

const MAX_BODY_BYTES = 5000;
const VALID_AREAS = ["rosewood", "acacia", "external"];

exports.handler = async (event) => {
  if (initError) {
    console.error("Firebase Admin not initialized:", initError);
    return respond(500, { available: false, error: "server-misconfigured", message: "We couldn't calculate delivery right now. Please try again." });
  }

  if (event.httpMethod !== "POST") {
    return respond(405, { available: false, error: "method-not-allowed", message: "Method not allowed." });
  }

  if (!event.body || Buffer.byteLength(event.body, "utf8") > MAX_BODY_BYTES) {
    return respond(400, { available: false, error: "invalid-request", message: "Please provide a complete delivery address." });
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (err) {
    return respond(400, { available: false, error: "invalid-json", message: "Please provide a complete delivery address." });
  }

  const deliveryArea = payload.deliveryArea;
  if (!VALID_AREAS.includes(deliveryArea)) {
    return respond(400, { available: false, error: "invalid-area", message: "Choose a valid delivery area." });
  }

  const deliveryAddress = payload.deliveryAddress && typeof payload.deliveryAddress === "object" ? payload.deliveryAddress : {};

  try {
    const result = await resolveDelivery({
      db,
      apiKey: process.env.GOOGLE_MAPS_API_KEY,
      deliveryArea,
      deliveryAddress,
    });
    return respond(result.httpStatus, result.body);
  } catch (err) {
    console.error("calculate-delivery failed:", err);
    return respond(500, { available: false, error: "server-error", message: "We couldn't calculate delivery right now. Please try again." });
  }
};
