// Storage path helpers.
// Centralizes the folder layout so upload/download code always agrees on
// where things live.

import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-storage.js";
import { storage } from "./firebase-init.js";

// Product catalog + gallery images — public read, admin write (see storage.rules)
export const productImageRef = (path) => ref(storage, `products/${path}`);

// Customer payment proof uploads — fully closed to every client SDK as of
// Phase 7; upload/read both go through Netlify Functions using the Admin
// SDK instead (see storage.rules). Kept here only as a path-shape reference.
export const paymentProofRef = (path) => ref(storage, `paymentProofs/${path}`);

// GCash QR code, logos, and other general business imagery — public read,
// OWNER-only write as of Phase 9 (see storage.rules).
export const businessImageRef = (path) => ref(storage, `business/${path}`);

// Uploads one image for a product and returns its public download URL.
// Stored at products/{productId}/{timestamp}-{sanitized filename} so repeat
// uploads never collide and stay grouped per product.
export async function uploadProductImage(productId, file) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const fileRef = productImageRef(`${productId}/${Date.now()}-${safeName}`);
  await uploadBytes(fileRef, file);
  return getDownloadURL(fileRef);
}

// Uploads a business image (e.g. the GCash QR) to a FIXED path — a repeat
// upload at the same `path` simply overwrites, so replacing the QR never
// leaves an orphaned old file behind. Returns the public download URL,
// which is what settings/payments.gcash.qrImagePath actually needs to be
// (a browsable URL, not a bare Storage path) for <img src> to work.
export async function uploadBusinessImage(path, file) {
  const fileRef = businessImageRef(path);
  await uploadBytes(fileRef, file);
  return getDownloadURL(fileRef);
}
