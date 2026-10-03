// Template for the Google Places browser key.
// Copy this file to "places-config.js" (same folder) and fill in your real
// key from Google Cloud Console > APIs & Services > Credentials.
//
// This is a SEPARATE key from GOOGLE_MAPS_API_KEY (which lives only in
// Netlify's server-side environment variables and is used by the Distance
// Matrix API calls in netlify/functions/lib/delivery.js). This key:
//   - is restricted by HTTP referrer (your site's domain) in Google Cloud
//     Console, not by secrecy — it is meant to be public, the same way
//     firebase-config.js's apiKey is
//   - should be restricted to ONLY the "Places API (New)" API
//   - must never be the same key as GOOGLE_MAPS_API_KEY — that one has no
//     referrer restriction (it can't, since it's called server-side) and
//     must never be embedded in any file served to the browser
//
// One-time Google Cloud Console setup required:
//   1. Enable "Places API (New)" for the project
//   2. Credentials > Create credentials > API key
//   3. Restrict the key: Application restrictions > Websites > add your
//      site's domain(s). API restrictions > restrict to "Places API (New)"
//      only.

export const GOOGLE_PLACES_BROWSER_KEY = "YOUR_PLACES_BROWSER_KEY";
