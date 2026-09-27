// Centralized Firebase initialization.
// Every other module gets its auth/db/storage handles from here — never call
// initializeApp() anywhere else in the project.
//
// SDK is loaded from Google's CDN (no npm/bundler in this project). Every
// module in this project pins the SAME version — "10.13.2" — in its import
// URLs; bump all of them together when upgrading.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-storage.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export default app;
