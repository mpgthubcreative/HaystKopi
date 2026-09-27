// Hayst Kopi — product page interactions
// Flavor selector, gallery, quantity stepper, pickup accordion.
// Product data (name, price, bottle size, description, images, inventory)
// comes from Firestore products/{slug} — see firebase/products-helpers.js.
// The static markup here is also the loading placeholder: it's what's on
// screen while the Firestore fetch is in flight.

import { fetchAllProducts, isInStock } from "./firebase/products-helpers.js";

document.addEventListener('DOMContentLoaded', async () => {

  const mainImage = document.getElementById('mainImage');
  const thumbnailRow = document.getElementById('thumbnailRow');
  const productTitle = document.getElementById('productTitle');
  const productNotice = document.getElementById('productNotice');
  const priceValue = document.getElementById('priceValue');
  const volumeMobile = document.getElementById('volumeMobile');
  const volumeDesktop = document.getElementById('volumeDesktop');
  const stockBadge = document.getElementById('stockBadge');
  const descriptionText = document.getElementById('descriptionText');
  const flavorButtons = document.querySelectorAll('.flavor-btn');

  const qtyValue = document.getElementById('qtyValue');
  const qtyDec = document.getElementById('qtyDec');
  const qtyInc = document.getElementById('qtyInc');
  const qtyLimitMessage = document.getElementById('qtyLimitMessage');

  const buyNowBtn = document.getElementById('buyNowBtn');
  const storeClosedNotice = document.getElementById('storeClosedNotice');
  const cartBtn = document.getElementById('cartBtn');

  const MIN_QTY = 1;

  let PRODUCTS = {};
  let currentSlug = 'hayst-kopi';
  let currentImageIndex = 0;
  let quantity = MIN_QTY;
  // Fail-closed: until get-storefront-settings actually confirms the store
  // is open, Buy Now stays disabled — see the fetch near the end of this
  // file. create-order.js independently re-checks this regardless.
  let acceptingOrders = false;

  /* ---------- Notices ---------- */

  function showProductNotice(message) {
    if (!productNotice) return;
    productNotice.textContent = message;
    productNotice.hidden = false;
  }

  function hideProductNotice() {
    if (!productNotice) return;
    productNotice.hidden = true;
    productNotice.textContent = '';
  }

  function showQtyLimitMessage(max) {
    if (!qtyLimitMessage) return;
    qtyLimitMessage.textContent = `Only ${max} bottle${max === 1 ? '' : 's'} available.`;
    qtyLimitMessage.hidden = false;
  }

  function hideQtyLimitMessage() {
    if (!qtyLimitMessage) return;
    qtyLimitMessage.hidden = true;
    qtyLimitMessage.textContent = '';
  }

  function showStoreClosedNotice() {
    if (!storeClosedNotice) return;
    storeClosedNotice.textContent = "We're currently not accepting orders.";
    storeClosedNotice.hidden = false;
  }

  function hideStoreClosedNotice() {
    if (!storeClosedNotice) return;
    storeClosedNotice.hidden = true;
    storeClosedNotice.textContent = '';
  }

  /* ---------- Rendering ---------- */

  function renderDescription(product) {
    if (!descriptionText) return;
    descriptionText.innerHTML = '';
    const lines = (product.description || '').split('\n').map((l) => l.trim()).filter(Boolean);
    lines.forEach((line) => {
      const p = document.createElement('p');
      p.textContent = line;
      descriptionText.appendChild(p);
    });
  }

  function renderGallery(product) {
    const images = (product.galleryImages && product.galleryImages.length)
      ? product.galleryImages
      : (product.image ? [product.image] : []);

    const current = images[currentImageIndex] || images[0] || '';
    mainImage.setAttribute('src', current);
    mainImage.setAttribute('alt', product.name || '');

    thumbnailRow.innerHTML = '';
    images.forEach((src, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'thumb' + (i === currentImageIndex ? ' is-active' : '');
      btn.setAttribute('aria-pressed', i === currentImageIndex ? 'true' : 'false');
      btn.setAttribute('aria-label', `Show photo ${i + 1}`);
      btn.addEventListener('click', () => {
        currentImageIndex = i;
        mainImage.setAttribute('src', src);
        thumbnailRow.querySelectorAll('.thumb').forEach((t) => {
          t.classList.remove('is-active');
          t.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('is-active');
        btn.setAttribute('aria-pressed', 'true');
      });

      const thumbImg = document.createElement('img');
      thumbImg.src = src;
      thumbImg.alt = '';
      btn.appendChild(thumbImg);
      thumbnailRow.appendChild(btn);
    });
  }

  function renderStockAndQty(product) {
    const inStock = isInStock(product);
    const max = product.inventory || 0;

    if (stockBadge) {
      stockBadge.textContent = inStock ? 'IN STOCK' : 'OUT OF STOCK';
      stockBadge.classList.toggle('in-stock', inStock);
      stockBadge.classList.toggle('out-of-stock', !inStock);
    }

    qtyValue.textContent = String(quantity);
    qtyDec.disabled = !inStock || quantity <= MIN_QTY;
    qtyInc.disabled = !inStock || quantity >= max;
    buyNowBtn.disabled = !inStock || !acceptingOrders;

    hideQtyLimitMessage();
  }

  function renderProduct(product) {
    productTitle.textContent = product.name;
    priceValue.textContent = `₱${Number(product.price).toFixed(2)}`;
    if (volumeMobile) volumeMobile.textContent = product.bottleSize || '';
    if (volumeDesktop) volumeDesktop.textContent = product.bottleSize || '';

    renderDescription(product);

    currentImageIndex = 0;
    renderGallery(product);

    quantity = isInStock(product) ? MIN_QTY : 0;
    renderStockAndQty(product);
  }

  function selectProduct(slug) {
    const product = PRODUCTS[slug];
    if (!product) return;

    currentSlug = slug;

    flavorButtons.forEach((btn) => {
      const active = btn.getAttribute('data-flavor') === slug;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    renderProduct(product);
  }

  /* ---------- Wire up controls (enabled once real data has loaded) ---------- */

  flavorButtons.forEach((btn) => {
    btn.disabled = true;
    btn.addEventListener('click', () => selectProduct(btn.getAttribute('data-flavor')));
  });

  qtyDec.disabled = true;
  qtyInc.disabled = true;
  buyNowBtn.disabled = true;

  qtyDec.addEventListener('click', () => {
    const product = PRODUCTS[currentSlug];
    if (!product || !isInStock(product)) return;
    quantity = Math.max(MIN_QTY, quantity - 1);
    renderStockAndQty(product);
  });

  qtyInc.addEventListener('click', () => {
    const product = PRODUCTS[currentSlug];
    if (!product || !isInStock(product)) return;
    const max = product.inventory || 0;
    if (quantity >= max) {
      showQtyLimitMessage(max);
      return;
    }
    quantity += 1;
    renderStockAndQty(product);
  });

  buyNowBtn.addEventListener('click', () => {
    const product = PRODUCTS[currentSlug];
    if (!product || !isInStock(product)) return;
    if (quantity < MIN_QTY || quantity > (product.inventory || 0)) return;

    // Only the slug + quantity travel to checkout — never price. Checkout
    // re-fetches the product fresh from Firestore and treats this quantity
    // as a starting point to re-validate, not as trusted data.
    const params = new URLSearchParams({ product: currentSlug, qty: String(quantity) });
    window.location.href = `checkout.html?${params.toString()}`;
  });

  /* ---------- Pickup accordion (unrelated to product data) ---------- */

  const pickupToggle = document.getElementById('pickupToggle');
  const pickupPanel = document.getElementById('pickupPanel');

  pickupToggle.addEventListener('click', () => {
    const isOpen = pickupToggle.getAttribute('aria-expanded') === 'true';
    pickupToggle.setAttribute('aria-expanded', String(!isOpen));
    pickupPanel.hidden = isOpen;
  });

  cartBtn.addEventListener('click', () => {
    // TODO: replace with your actual cart flow
    console.log('Cart icon clicked');
  });

  /* ---------- Load products from Firestore, once ---------- */

  try {
    PRODUCTS = await fetchAllProducts();
    if (!PRODUCTS['hayst-kopi'] && !PRODUCTS['hayst-choco']) {
      throw new Error('no-products');
    }
  } catch (err) {
    showProductNotice("We couldn't load product details right now. Please refresh the page.");
    return;
  }

  hideProductNotice();
  flavorButtons.forEach((btn) => { btn.disabled = false; });

  // Fail-closed: any error/missing field here leaves acceptingOrders false,
  // which keeps Buy Now disabled. Products and inventory still show either way
  // — only the ability to buy is gated.
  try {
    const settingsResponse = await fetch("/.netlify/functions/get-storefront-settings", { method: "POST" });
    const settingsResult = await settingsResponse.json();
    acceptingOrders = Boolean(settingsResult && settingsResult.success && settingsResult.acceptingOrders);
  } catch (err) {
    acceptingOrders = false;
  }

  if (acceptingOrders) {
    hideStoreClosedNotice();
  } else {
    showStoreClosedNotice();
  }

  const initialSlug = PRODUCTS[currentSlug] ? currentSlug : Object.keys(PRODUCTS)[0];
  selectProduct(initialSlug);

});
