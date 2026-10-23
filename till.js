// Till: record how a booking or shop order was paid (cash / card / online /
// voucher, tip, barber) as BBapp-payments rows — the source for every report.
(() => {
  const { db, esc, gbp, toast } = BBdash;
  const METHODS = [['card', 'Card'], ['cash', 'Cash'], ['online', 'Paid online'], ['voucher', 'Gift voucher']];
  let staffCache = null;

  async function staffList() {
    if (!staffCache) {
      const { data } = await db.from('BBapp-staff').select('id, first_name, display_name, is_active').eq('shop_id', BBdash.shop.id).order('first_name');
      staffCache = data || [];
    }
    return staffCache;
  }
  const pounds = p => (p / 100).toFixed(2);

  function paySheet({ title, amount, staffId, showStaff, onSave }) {
    let method = 'card', tipPct = 0, tipCustom = null;
    const sheet = BBdash.sheet(`
      <h3>${esc(title)}</h3>
      <form class="stack" id="pay-form">
        <label>Amount (£)<input name="amount" type="number" min="0" step="0.01" required value="${pounds(amount)}"></label>
        <div><p class="tip-label">Paid by</p><div class="chips" id="pm">${METHODS.map(([k, l]) => `<button type="button" data-m="${k}" class="${k === method ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        <div><p class="tip-label">Tip</p><div class="chips" id="tp"></div></div>
        ${showStaff ? '<label>Barber<select name="staff"></select></label>' : ''}
        <ul class="lines total" id="pay-total"></ul>
        <button class="btn" type="submit">Record payment</button>
      </form>`);
    const form = sheet.querySelector('#pay-form');
    const amt = () => Math.round(Number(form.amount.value || 0) * 100);
    const tip = () => tipCustom != null ? tipCustom : Math.round(amt() * tipPct / 100);
    const draw = () => {
      sheet.querySelector('#tp').innerHTML = [0, 10, 15, 20].map(p =>
        `<button type="button" data-t="${p}" class="${tipCustom == null && tipPct === p ? 'on' : ''}">${p ? `${p}% · ${gbp.format(Math.round(amt() * p / 100) / 100)}` : 'No tip'}</button>`).join('') +
        `<button type="button" data-t="custom" class="${tipCustom != null ? 'on' : ''}">${tipCustom != null ? `Tip ${gbp.format(tipCustom / 100)}` : 'Other'}</button>`;
      sheet.querySelector('#pay-total').innerHTML = `<li class="grand"><span>Total taken</span><b>${gbp.format((amt() + tip()) / 100)}</b></li>`;
    };
    form.amount.oninput = draw;
    sheet.querySelector('#pm').onclick = e => {
      const b = e.target.closest('[data-m]'); if (!b) return;
      method = b.dataset.m; sheet.querySelectorAll('#pm button').forEach(x => x.classList.toggle('on', x === b));
    };
    sheet.querySelector('#tp').onclick = e => {
      const b = e.target.closest('[data-t]'); if (!b) return;
      if (b.dataset.t === 'custom') {
        const v = Number(prompt('Tip amount in £', tipCustom != null ? pounds(tipCustom) : ''));
        if (!isFinite(v) || v < 0) return;
        tipCustom = Math.round(v * 100);
      } else { tipPct = Number(b.dataset.t); tipCustom = null; }
      draw();
    };
    if (showStaff) staffList().then(list => {
      form.staff.innerHTML = '<option value="">No barber</option>' + list.filter(s => s.is_active || s.id === staffId)
        .map(s => `<option value="${s.id}" ${s.id === staffId ? 'selected' : ''}>${esc(s.display_name || s.first_name)}</option>`).join('');
    });
    form.onsubmit = async e => {
      e.preventDefault();
      form.querySelector('[type=submit]').disabled = true;
      const ok = await onSave({ method, amount_pence: amt(), tip_pence: tip(), staff_id: showStaff ? form.staff.value || null : staffId || null });
      if (!ok) form.querySelector('[type=submit]').disabled = false;
    };
    draw();
  }

  // Booking at the till: records payment, marks the booking done.
  BBdash.takePayment = async (b, barber, after) => {
    const { data: prior } = await db.from('BBapp-payments').select('amount_pence, tip_pence').eq('booking_id', b.id);
    const paid = (prior || []).reduce((t, p) => t + p.amount_pence, 0);
    const due = Math.max((b.service?.price_pence || 0) - paid, 0);
    paySheet({
      title: `Take payment · ${b.guest_name}${paid ? ` (already paid ${gbp.format(paid / 100)})` : ''}`,
      amount: due, staffId: barber?.staff_id, showStaff: true,
      onSave: async p => {
        const { error } = await db.from('BBapp-payments').insert({ ...p, shop_id: BBdash.shop.id, booking_id: b.id });
        if (error) { toast(error.message, true); return false; }
        if (b.status !== 'completed') {
          await db.from('BBapp-bookings').update({
            status: 'completed', communication_history: [...b.communication_history, `Paid ${gbp.format((p.amount_pence + p.tip_pence) / 100)} by ${p.method}`],
          }).eq('id', b.id);
        }
        BBdash.closeSheet(); toast(`${gbp.format((p.amount_pence + p.tip_pence) / 100)} taken by ${p.method}`);
        after?.(); return true;
      },
    });
  };

  // Shop order collected and paid in the shop.
  BBdash.takeOrderPayment = (o, after) => paySheet({
    title: `Order payment · ${o.customer_name}`, amount: o.subtotal_pence, staffId: null, showStaff: true,
    onSave: async p => {
      const { error } = await db.from('BBapp-payments').insert({ ...p, tip_pence: p.tip_pence || o.tip_pence, shop_id: BBdash.shop.id, order_id: o.id });
      if (error) { toast(error.message, true); return false; }
      await db.from('BBapp-orders').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', o.id);
      BBdash.closeSheet(); toast('Order paid'); after?.(); return true;
    },
  });
})();
