// Client shop: products → basket → tip → checkout, with or without a cut.
// Totals shown here are a preview; bbapp_create_order prices everything again
// from the database before anyone is charged.
(() => {
  const { db } = window.BBapp;
  const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
  const TIPS = [0, 10, 15, 20];
  const DEFAULT_IMG = window.BBAPP_CONFIG.defaultProductImage;
  const st = { shop: null, products: [], cart: {}, booking: null, withCut: false, tipPct: 0, tipCustom: null };

  const cartKey = id => `bbapp-cart-${id}`;
  const saveCart = () => { try { localStorage.setItem(cartKey(st.shop.id), JSON.stringify(st.cart)); } catch {} };
  const loadCart = id => { try { return JSON.parse(localStorage.getItem(cartKey(id)) || '{}'); } catch { return {}; } };

  const subtotal = () =>
    (st.withCut && st.booking ? st.booking.price_pence : 0) +
    Object.entries(st.cart).reduce((t, [id, q]) => t + (st.products.find(p => p.id === id)?.price_pence || 0) * q, 0);
  const tip = () => st.tipCustom != null ? st.tipCustom : Math.round(subtotal() * st.tipPct / 100);
  const count = () => Object.values(st.cart).reduce((a, b) => a + b, 0);

  // booking (optional): { id, service_name, price_pence, guest_name, guest_email, guest_phone }
  async function openShop(shopId, booking = null) {
    const [shop, products] = await Promise.all([
      db.from('BBapp-shops').select('id, name').eq('id', shopId).single(),
      db.from('BBapp-products').select('*').eq('shop_id', shopId).eq('active', true).order('sort'),
    ]);
    Object.assign(st, { shop: shop.data, products: products.data || [], cart: loadCart(shopId), booking, withCut: !!booking, tipPct: 0, tipCustom: null });
    // Drop basket lines for products that are gone.
    for (const id of Object.keys(st.cart)) if (!st.products.some(p => p.id === id)) delete st.cart[id];
    const m = document.getElementById('booking');
    m.innerHTML = '<div class="sheet shop-sheet" role="dialog" aria-modal="true"></div>';
    m.hidden = false;
    render();
  }

  function render() {
    const sheet = document.querySelector('#booking .shop-sheet');
    const sub = subtotal(), t = tip();
    sheet.innerHTML = `
      <button class="close" aria-label="Close">×</button>
      <h3>${esc(st.shop.name)} shop</h3>
      <p class="small">Add products to collect in the shop.</p>
      <div class="products">${st.products.map(p => {
        const q = st.cart[p.id] || 0, out = p.stock === 0;
        return `<article class="product">
          <img src="${esc(p.image_url || DEFAULT_IMG)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${DEFAULT_IMG}'">
          <b>${esc(p.name)}</b><span class="small">${esc(p.description || '')}</span>
          <div class="buy"><span>${gbp.format(p.price_pence / 100)}</span>
            ${out ? '<span class="small">Sold out</span>' : q
              ? `<span class="qty"><button data-dec="${p.id}" aria-label="One fewer">−</button>${q}<button data-inc="${p.id}" aria-label="One more">+</button></span>`
              : `<button class="btn btn-sm" data-inc="${p.id}">Add to basket</button>`}</div>
        </article>`;
      }).join('') || '<p class="small">No products yet.</p>'}</div>

      <div class="basket">
        <h4>Your basket${count() ? ` (${count()})` : ''}</h4>
        ${st.booking ? `
        <div class="seg cut-toggle" role="group" aria-label="Include your cut">
          <button data-cut="1" aria-pressed="${st.withCut}">With my cut</button>
          <button data-cut="0" aria-pressed="${!st.withCut}">Without a cut</button>
        </div>` : ''}
        <ul class="lines">
          ${st.withCut && st.booking ? `<li><span>${esc(st.booking.service_name)} (your cut)</span><b>${gbp.format(st.booking.price_pence / 100)}</b></li>` : ''}
          ${Object.entries(st.cart).map(([id, q]) => { const p = st.products.find(x => x.id === id);
            return `<li><span>${q} × ${esc(p.name)}</span><b>${gbp.format(p.price_pence * q / 100)}</b></li>`; }).join('')}
        </ul>
        ${sub ? `
        <p class="tip-label">Add a tip for the team?</p>
        <div class="chips tips">${TIPS.map(pct => `<button data-tip="${pct}" class="${st.tipCustom == null && st.tipPct === pct ? 'on' : ''}">${pct ? `${pct}% · ${gbp.format(Math.round(sub * pct / 100) / 100)}` : 'No tip'}</button>`).join('')}
          <button data-tip="custom" class="${st.tipCustom != null ? 'on' : ''}">${st.tipCustom != null ? `Tip ${gbp.format(st.tipCustom / 100)}` : 'Other amount'}</button></div>
        <ul class="lines total">
          <li><span>Subtotal</span><b>${gbp.format(sub / 100)}</b></li>
          ${t ? `<li><span>Tip</span><b>${gbp.format(t / 100)}</b></li>` : ''}
          <li class="grand"><span>Total</span><b>${gbp.format((sub + t) / 100)}</b></li>
        </ul>
        <form id="checkout" class="stack">
          <input name="name" placeholder="Full name" required autocomplete="name" value="${esc(st.booking?.guest_name || '')}">
          <input name="email" type="email" placeholder="Email for your receipt" required autocomplete="email" value="${esc(st.booking?.guest_email || '')}">
          <input name="phone" type="tel" placeholder="Mobile (optional)" autocomplete="tel" value="${esc(st.booking?.guest_phone || '')}">
          ${window.PossoPay?.isConfigured() ? `<button class="btn" type="submit" data-pay="online">Pay ${gbp.format((sub + t) / 100)} now</button>` : ''}
          <button class="btn ${window.PossoPay?.isConfigured() ? 'ghost' : ''}" type="submit" data-pay="in_shop">${st.withCut ? 'Pay in the shop on the day' : 'Reserve and pay when I collect'}</button>
        </form>` : '<p class="small">Your basket is empty.</p>'}
        <p id="shop-msg" role="status"></p>
      </div>`;

    sheet.querySelector('.close').onclick = () => { document.getElementById('booking').hidden = true; };
    const form = sheet.querySelector('#checkout');
    if (form) form.onsubmit = e => { e.preventDefault(); checkout(form, e.submitter?.dataset.pay || 'in_shop'); };
  }

  document.addEventListener('click', e => {
    const sheet = e.target.closest('.shop-sheet'); if (!sheet) return;
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.inc) {
      const p = st.products.find(x => x.id === b.dataset.inc), q = (st.cart[p.id] || 0) + 1;
      if (p.stock != null && q > p.stock) return;
      st.cart[p.id] = Math.min(q, 20);
    } else if (b.dataset.dec) {
      st.cart[b.dataset.dec] -= 1;
      if (st.cart[b.dataset.dec] <= 0) delete st.cart[b.dataset.dec];
    } else if (b.dataset.cut) {
      st.withCut = b.dataset.cut === '1';
    } else if (b.dataset.tip) {
      if (b.dataset.tip === 'custom') {
        const v = Number(prompt('Tip amount in £', st.tipCustom != null ? (st.tipCustom / 100).toFixed(2) : ''));
        if (!isFinite(v) || v < 0) return;
        st.tipCustom = Math.round(v * 100);
      } else { st.tipPct = Number(b.dataset.tip); st.tipCustom = null; }
    } else return;
    saveCart(); render();
  });

  async function checkout(form, method) {
    const f = new FormData(form), msg = document.getElementById('shop-msg');
    form.querySelectorAll('button').forEach(x => { x.disabled = true; });
    msg.textContent = 'Placing your order…';
    const { data, error } = await db.rpc('bbapp_create_order', {
      p_shop: st.shop.id,
      p_items: Object.entries(st.cart).map(([product_id, qty]) => ({ product_id, qty })),
      p_tip_pence: tip(), p_name: f.get('name'), p_email: f.get('email'), p_phone: f.get('phone') || null,
      p_booking: st.withCut && st.booking ? st.booking.id : null, p_pay_method: method,
    });
    if (error) { msg.textContent = error.message; form.querySelectorAll('button').forEach(x => { x.disabled = false; }); return; }
    const order = data[0];
    st.cart = {}; saveCart();

    if (method === 'online') {
      const back = `${location.origin}${location.pathname}?order=${order.order_id}`;
      try {
        const intent = await PossoPay.createOnlinePaymentIntent(st.shop.id, {
          amount: order.total_pence, description: `${st.shop.name} order`, customer_reference: order.order_id,
          embed_parent_origin: location.origin, return_url: `${back}&payment=success`, success_url: `${back}&payment=success`,
          cancel_url: `${back}&payment=cancel`, customer: { name: f.get('name'), phone: f.get('phone') || undefined },
          metadata: { tenant_id: st.shop.id, source: 'online', channel: 'bbapp_shop', order_id: order.order_id, with_cut: st.withCut },
        });
        if (intent.embed_url) { location.href = intent.embed_url; return; }
        throw new Error('Card payment is unavailable right now.');
      } catch (err) {
        msg.textContent = `${err.message} Your order is saved — you can pay in the shop instead.`;
        return;
      }
    }
    document.querySelector('#booking .shop-sheet').innerHTML = `
      <h3>Order placed 🛍️</h3>
      <p>Total ${gbp.format(order.total_pence / 100)}${tip() ? ' including your tip — thank you!' : '.'}
        ${st.withCut ? 'Pay in the shop on the day of your cut.' : 'Pay when you collect from the shop.'}</p>
      <button class="btn" onclick="document.getElementById('booking').hidden=true">Done</button>`;
  }

  // Back from Posso Pay checkout.
  const q = new URLSearchParams(location.search);
  if (q.get('order') && q.get('payment')) {
    window.addEventListener('DOMContentLoaded', () => {
      const m = document.getElementById('booking');
      m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><h3>${q.get('payment') === 'success' ? 'Thanks — payment received' : 'Payment cancelled'}</h3>
        <p>${q.get('payment') === 'success' ? "We're confirming your payment and the shop will have your order ready." : 'Your order is saved. You can pay in the shop instead.'}</p>
        <button class="btn" onclick="document.getElementById('booking').hidden=true">OK</button></div>`;
      m.hidden = false;
    });
  }

  window.BBapp.openShop = openShop;
})();
