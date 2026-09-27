// Product + inventory helpers shared by the public product page and the
// admin Products/Inventory pages — one place for "products" and
// "inventoryLogs" read/write logic instead of duplicating it per page.

import {
  getDoc,
  getDocs,
  query,
  orderBy,
  doc,
  updateDoc,
  collection,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { db } from "./firebase-init.js";
import { productsCollection } from "./collections.js";

// Returns products keyed by document id (slug), ordered by sortOrder.
// One read for the whole catalog — callers should fetch once and reuse the
// result rather than re-querying per interaction.
export async function fetchAllProducts() {
  const snap = await getDocs(query(productsCollection, orderBy("sortOrder")));
  const products = {};
  snap.forEach((docSnap) => {
    products[docSnap.id] = { id: docSnap.id, ...docSnap.data() };
  });
  return products;
}

// Fetches exactly one product fresh from Firestore — used by checkout to
// revalidate whatever slug/qty arrived via the URL. Never trust a product
// object carried over from another page for pricing or stock decisions.
export async function fetchProductBySlug(slug) {
  if (!slug) return null;
  const snap = await getDoc(doc(db, "products", slug));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function isInStock(product) {
  return Boolean(product) && (product.inventory || 0) > 0;
}

// Ordinary catalog fields only — deliberately never touches "inventory".
// Safe for OWNER or ADMIN to call; Firestore rules enforce the same
// restriction independently, so this isn't the only thing stopping an
// admin from changing inventory.
export async function updateProductDetails(productId, fields) {
  const patch = { updatedAt: serverTimestamp() };
  for (const key of ["name", "description", "price", "bottleSize", "image", "galleryImages"]) {
    if (fields[key] !== undefined) patch[key] = fields[key];
  }
  await updateDoc(doc(db, "products", productId), patch);
}

// Owner-only in practice — Firestore rules reject this from anyone else,
// including a modified client that calls it directly.
//
// mode "delta": value is the +/- change to apply (e.g. +5, -1).
// mode "set": value is the new absolute inventory count.
// Either way the result is clamped to a minimum of 0, and a matching
// inventoryLogs entry is written in the same transaction so the product
// count and its audit trail can never drift apart.
export async function applyInventoryChange(productId, { mode, value, reason, actorUid, actorName }) {
  const productRef = doc(db, "products", productId);
  const logRef = doc(collection(db, "inventoryLogs"));

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(productRef);
    if (!snap.exists()) throw new Error("product-not-found");

    // Coerce defensively: a manually-entered Firestore doc can have inventory
    // stored as a string, and the Firestore rule requires previousInventory
    // in the log to be a real int — an uncoerced string here would make the
    // whole transaction fail its own validation.
    const previous = Math.max(0, Math.floor(Number(snap.data().inventory) || 0));
    const next = mode === "set"
      ? Math.max(0, Math.floor(value))
      : Math.max(0, previous + value);

    tx.update(productRef, { inventory: next, updatedAt: serverTimestamp() });
    tx.set(logRef, {
      productId,
      productName: snap.data().name || productId,
      previousInventory: previous,
      newInventory: next,
      changeAmount: next - previous,
      reason: reason || "",
      type: "manual",
      updatedBy: actorUid,
      updatedByName: actorName || "",
      createdAt: serverTimestamp(),
    });
  });
}
