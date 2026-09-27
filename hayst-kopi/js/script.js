// Hayst Kopi — product page interactions
// Flavor selector, gallery, quantity stepper, pickup accordion.

document.addEventListener('DOMContentLoaded', () => {

  /* ---------- Flavor + gallery data ---------- */
  const FLAVORS = {
    kopi: {
      name: 'Hayst Kopi',
      images: [
        { src: 'assets/product-1.jpg', alt: 'Two Hayst Kopi bottles, Classic Mocha and Sweet Mocha, with chocolate and coffee beans' },
        { src: 'assets/product-2.jpg', alt: 'Close-up of the Hayst Kopi bottle' },
        { src: 'assets/product-4.jpg', alt: 'Hayst Kopi bottle cap with the logo sticker' }
      ]
    },
    choco: {
      name: 'Hayst Choco',
      images: [
        { src: 'assets/product-3.jpg', alt: 'Close-up of the Hayst Choco bottle' },
        { src: 'assets/event.jpg', alt: 'Iced Hayst Choco kopi with ice and foam bubbles, close up' },
        { src: 'assets/product-4.jpg', alt: 'Hayst Choco bottle cap with the logo sticker' }
      ]
    }
  };

  const mainImage = document.getElementById('mainImage');
  const thumbnailRow = document.getElementById('thumbnailRow');
  const productTitle = document.getElementById('productTitle');
  const flavorButtons = document.querySelectorAll('.flavor-btn');

  let currentFlavor = 'kopi';
  let currentImageIndex = 0;

  function renderGallery() {
    const flavor = FLAVORS[currentFlavor];
    const current = flavor.images[currentImageIndex];

    mainImage.setAttribute('src', current.src);
    mainImage.setAttribute('alt', current.alt);

    thumbnailRow.innerHTML = '';
    flavor.images.forEach((im, i) => {
      const btn = document.createElement('button');
      btn.className = 'thumb' + (i === currentImageIndex ? ' is-active' : '');
      btn.setAttribute('aria-pressed', i === currentImageIndex ? 'true' : 'false');
      btn.setAttribute('aria-label', `Show photo ${i + 1}, ${im.alt}`);
      btn.addEventListener('click', () => {
        currentImageIndex = i;
        renderGallery();
      });

      const thumbImg = document.createElement('img');
      thumbImg.src = im.src;
      thumbImg.alt = '';
      btn.appendChild(thumbImg);
      thumbnailRow.appendChild(btn);
    });
  }

  function selectFlavor(id) {
    if (!FLAVORS[id]) return;
    currentFlavor = id;
    currentImageIndex = 0;

    productTitle.textContent = FLAVORS[id].name;

    flavorButtons.forEach((btn) => {
      const active = btn.getAttribute('data-flavor') === id;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    renderGallery();
  }

  flavorButtons.forEach((btn) => {
    btn.addEventListener('click', () => selectFlavor(btn.getAttribute('data-flavor')));
  });

  renderGallery();

  /* ---------- Quantity stepper ---------- */
  const qtyValue = document.getElementById('qtyValue');
  const qtyDec = document.getElementById('qtyDec');
  const qtyInc = document.getElementById('qtyInc');
  const MIN_QTY = 1;
  const MAX_QTY = 99;

  let quantity = MIN_QTY;

  function renderQty() {
    qtyValue.textContent = String(quantity);
  }

  qtyDec.addEventListener('click', () => {
    quantity = Math.max(MIN_QTY, quantity - 1);
    renderQty();
  });

  qtyInc.addEventListener('click', () => {
    quantity = Math.min(MAX_QTY, quantity + 1);
    renderQty();
  });

  /* ---------- Pickup accordion ---------- */
  const pickupToggle = document.getElementById('pickupToggle');
  const pickupPanel = document.getElementById('pickupPanel');

  pickupToggle.addEventListener('click', () => {
    const isOpen = pickupToggle.getAttribute('aria-expanded') === 'true';
    pickupToggle.setAttribute('aria-expanded', String(!isOpen));
    pickupPanel.hidden = isOpen;
  });

  /* ---------- Buy Now (wire up to your cart / checkout) ---------- */
  const buyNowBtn = document.getElementById('buyNowBtn');
  const cartBtn = document.getElementById('cartBtn');

  buyNowBtn.addEventListener('click', () => {
    // TODO: replace with your actual checkout flow
    console.log(`Buy Now clicked — flavor: ${FLAVORS[currentFlavor].name}, quantity: ${quantity}`);
  });

  cartBtn.addEventListener('click', () => {
    // TODO: replace with your actual cart flow
    console.log('Cart icon clicked');
  });

});
