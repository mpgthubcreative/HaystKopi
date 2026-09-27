// Settings reads for the admin Settings page — client SDK directly, same
// as Products/Inventory/Orders (Firestore rules already restrict
// settings/{settingId} reads to an active owner/admin; this page is also
// owner-only gated since Phase 2). ALL WRITES go through
// admin/settings-actions.js -> update-settings.js instead.

import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { db } from "./firebase-init.js";

async function fetchSettingsDoc(id) {
  const snap = await getDoc(doc(db, "settings", id));
  return snap.exists() ? snap.data() : null;
}

// Returns { business, orders, delivery, payments } — any of the four may
// be null if the Owner hasn't configured that section yet (this is normal,
// especially right after Phase 9 first ships — the page must render a
// clear "not yet configured" state, never crash).
export async function fetchAllSettings() {
  const [business, orders, delivery, payments] = await Promise.all([
    fetchSettingsDoc("business"),
    fetchSettingsDoc("orders"),
    fetchSettingsDoc("delivery"),
    fetchSettingsDoc("payments"),
  ]);
  return { business, orders, delivery, payments };
}
