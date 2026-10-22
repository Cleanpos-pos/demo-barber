const VAT_RATE = 0.2;
const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });

function renderPrices() {
  const incVat = document.getElementById('vat-toggle').checked;
  document.querySelectorAll('.price').forEach(el => {
    const net = Number(el.dataset.net);
    const shown = incVat ? net * (1 + VAT_RATE) : net;
    el.innerHTML = `${gbp.format(shown)} <small>/month ${incVat ? 'inc.' : 'ex.'} VAT</small>`;
  });
  document.getElementById('vat-note').textContent =
    incVat ? 'Prices include VAT at 20%.' : 'All prices exclude VAT at 20%.';
}

// Returns true if the input looks like a UK postcode (e.g. "M1 1AE", "SW1A 2AA").
function isValidPostcode(input) {
  // TODO(human)
  return input.trim().length > 0;
}

async function findBarber() {
  const value = document.getElementById('postcode').value.trim().toUpperCase();
  const msg = document.getElementById('finder-msg');
  const list = document.getElementById('results');
  list.innerHTML = '';
  if (!isValidPostcode(value)) {
    msg.textContent = "That doesn't look like a UK postcode — try something like M1 1AE.";
    return;
  }
  msg.textContent = 'Searching…';
  try {
    const shops = await BBapp.nearestShops(value);
    msg.textContent = `Barbers nearest ${value}`;
    list.innerHTML = shops.map(s => `
      <div class="shop">
        <div><b>${s.name}</b><span>${s.address} · ${s.postcode}</span></div>
        <span class="dist">${s.miles.toFixed(1)} mi</span>
        <button class="btn btn-sm ghost light-ghost" data-store="${s.id}">Shop</button>
        <button class="btn btn-sm" data-shop="${s.id}">Book</button>
      </div>`).join('');
  } catch (err) {
    msg.textContent = err.message;
  }
}

document.getElementById('results').addEventListener('click', e => {
  const id = e.target.closest('[data-shop]')?.dataset.shop;
  if (id) BBapp.openBooking(id);
  const store = e.target.closest('[data-store]')?.dataset.store;
  if (store) BBapp.openShop(store);
});

// UK GDPR/PECR: non-essential cookies stay off until the visitor opts in.
const banner = document.getElementById('cookie');
try { if (localStorage.getItem('consent')) banner.classList.add('hidden'); } catch {}
banner.querySelectorAll('[data-consent]').forEach(btn => btn.addEventListener('click', () => {
  try { localStorage.setItem('consent', btn.dataset.consent); } catch {}
  banner.classList.add('hidden');
}));

document.getElementById('vat-toggle').addEventListener('change', renderPrices);
renderPrices();
