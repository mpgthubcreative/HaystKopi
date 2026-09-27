// Reusable Firestore collection references.
// Import these instead of calling collection(db, "...") with a literal string
// scattered across the codebase — keeps collection names correct in one place.
//
// NOTE: this only prepares references. No documents are created or seeded here.

import { collection } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { db } from "./firebase-init.js";

export const usersCollection = collection(db, "users");
export const productsCollection = collection(db, "products");
export const ordersCollection = collection(db, "orders");
export const wholesaleInquiriesCollection = collection(db, "wholesaleInquiries");
export const inventoryLogsCollection = collection(db, "inventoryLogs");
export const settingsCollection = collection(db, "settings");
