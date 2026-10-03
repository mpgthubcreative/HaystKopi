// Google Places Autocomplete (New) — a small, framework-free wrapper
// around the REST endpoints (places:autocomplete + place Details), used
// instead of the Maps JavaScript SDK widget so the suggestions list can be
// styled consistently with the rest of HAYST KOPI and so this stays in the
// same plain fetch()-based style as every other API call in this project.
//
// Uses the "New" Places API endpoints (places.googleapis.com/v1/...),
// which — unlike the older Places Web Service — support CORS for direct
// browser requests when the API key is HTTP-referrer restricted. See
// places-config.example.js for the required one-time Google Cloud Console
// setup (enable "Places API (New)", create a referrer-restricted key).
//
// TRUST BOUNDARY: this module only ever hands the caller a place the
// customer actually SELECTED from a real suggestion (placeId + real
// coordinates, both present). Typed text that was never turned into a
// selection is never treated as a destination — see onInvalidate below,
// which fires on every keystroke after a selection, and the backend's own
// independent check in lib/validate-order.js / lib/delivery.js, which
// rejects a request lacking both placeId and coordinates regardless of
// what the client claims.

const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const PLACE_DETAILS_BASE = "https://places.googleapis.com/v1/places/";
const MIN_INPUT_LENGTH = 3;
const DEBOUNCE_MS = 300;

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// onSelect({ placeId, formattedAddress, lat, lng }) — fires once a real
// suggestion is chosen and its Place Details have been fetched.
// onInvalidate(message) — fires the moment the input changes after a prior
// selection (message is null for a plain edit, or a string if the
// invalidation came from a failed Details lookup).
export function createPlaceAutocomplete({ inputEl, suggestionsEl, apiKey, onSelect, onInvalidate }) {
  if (!apiKey || apiKey === "YOUR_PLACES_BROWSER_KEY") {
    inputEl.disabled = true;
    inputEl.placeholder = "Address search is not configured yet — contact the site admin.";
    return { reset() {} };
  }

  // One session token per search session (cleared once a place is picked,
  // or when the field is reset) — this is Google's documented billing
  // model for Autocomplete + the matching Details call.
  let sessionToken = crypto.randomUUID();
  let activeRequestId = 0;

  function closeSuggestions() {
    suggestionsEl.innerHTML = "";
    suggestionsEl.hidden = true;
  }

  function renderSuggestions(predictions) {
    if (!predictions.length) {
      closeSuggestions();
      return;
    }

    suggestionsEl.innerHTML = "";
    predictions.forEach((prediction) => {
      const main = prediction.structuredFormat?.mainText?.text || prediction.text?.text || "";
      const secondary = prediction.structuredFormat?.secondaryText?.text || "";

      const item = document.createElement("button");
      item.type = "button";
      item.className = "place-suggestion";

      const mainEl = document.createElement("span");
      mainEl.className = "place-suggestion-main";
      mainEl.textContent = main;
      item.appendChild(mainEl);

      if (secondary) {
        const secondaryEl = document.createElement("span");
        secondaryEl.className = "place-suggestion-secondary";
        secondaryEl.textContent = secondary;
        item.appendChild(secondaryEl);
      }

      // mousedown (not click) fires before the input's blur handler closes
      // the list, so a tap on a suggestion always registers.
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        selectPrediction(prediction);
      });

      suggestionsEl.appendChild(item);
    });
    suggestionsEl.hidden = false;
  }

  async function fetchSuggestions(input) {
    const requestId = ++activeRequestId;

    let response;
    try {
      response = await fetch(AUTOCOMPLETE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey },
        body: JSON.stringify({ input, includedRegionCodes: ["ph"], sessionToken }),
      });
    } catch (err) {
      return; // transient network error — leave whatever list was already showing
    }

    if (requestId !== activeRequestId) return; // superseded by a newer keystroke

    let data;
    try {
      data = await response.json();
    } catch (err) {
      return;
    }

    if (requestId !== activeRequestId || !response.ok) return;

    const predictions = (data.suggestions || []).map((s) => s.placePrediction).filter(Boolean);
    renderSuggestions(predictions);
  }

  const debouncedFetch = debounce(fetchSuggestions, DEBOUNCE_MS);

  async function selectPrediction(prediction) {
    const placeId = prediction.placeId;
    closeSuggestions();
    inputEl.value = prediction.text?.text || "";

    let response;
    try {
      response = await fetch(`${PLACE_DETAILS_BASE}${placeId}`, {
        headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "id,formattedAddress,location" },
      });
    } catch (err) {
      onInvalidate("We couldn't load that address. Please try again.");
      return;
    }

    let details;
    try {
      details = await response.json();
    } catch (err) {
      onInvalidate("We couldn't load that address. Please try again.");
      return;
    }

    if (!response.ok || !details.formattedAddress || !details.location) {
      onInvalidate("We couldn't load that address. Please try again.");
      return;
    }

    inputEl.value = details.formattedAddress;
    // A session ends once a place is selected — the next search starts a
    // fresh one.
    sessionToken = crypto.randomUUID();

    onSelect({
      placeId: details.id || placeId,
      formattedAddress: details.formattedAddress,
      lat: details.location.latitude,
      lng: details.location.longitude,
    });
  }

  inputEl.addEventListener("input", () => {
    // Any edit immediately invalidates a prior selection — the displayed
    // text must never silently stay attached to stale coordinates.
    onInvalidate(null);

    const value = inputEl.value.trim();
    if (value.length < MIN_INPUT_LENGTH) {
      closeSuggestions();
      return;
    }
    debouncedFetch(value);
  });

  inputEl.addEventListener("blur", () => {
    closeSuggestions();
  });

  return {
    // Lets the caller force a clean slate (e.g. switching delivery areas) —
    // starts a fresh session token and clears any open suggestion list.
    reset() {
      sessionToken = crypto.randomUUID();
      closeSuggestions();
    },
  };
}
