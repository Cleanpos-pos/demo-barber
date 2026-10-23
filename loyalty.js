// Loyalty tab: the stamp card programme, modelled on Kiosk's Loyalty & Rewards
// (Programme / Accounts). Stamps are earned server-side when a booking is marked
// completed, so this tab only sets the rules, shows cards and handles rewards.
// Every change goes through the ledger RPCs, so balances always have a history.
BBdash.tab('loyalty', panel => {
  const { db, esc, gbp, toast } = BBdash;
  const shop = BBdash.shop;
  const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const EVENT = { earn: 'Visit', reversal: 'Visit undone', reward_issued: 'Card full · reward issued', reward_redeemed: 'Reward used', manual_adjustment: 'Adjusted by staff' };
  let cfg = null, clients = [];

  panel.innerHTML = `
    <div class="dash-head"><h2>Stamp card</h2><span class="small" id="loy-state"></span></div>
    <form class="card stack" id="loy-form"></form>
    <h2>Customers' cards</h2>
    <input type="search" id="loy-q" placeholder="Search by name, email or phone" aria-label="Search customers">
    <div id="loy-list" class="list"></div>`;

  function cardDots(n, of) {
    return `<span class="stamps" aria-label="${n} of ${of} stamps">${[...Array(of).keys()].map(i => `<i class="${i < n ? 'on' : ''}">✂</i>`).join('')}</span>`;
  }

  function renderForm() {
    const s = cfg, money = p => p != null ? (p / 100).toFixed(2) : '';
    BBdash.$('loy-state').textContent = s.enabled ? 'On · customers are collecting stamps' : 'Off';
    BBdash.$('loy-form').innerHTML = `
      <label class="inline"><input type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''}> Stamp card is on</label>
      <label>Stamps to fill a card<input name="stamps_required" type="number" min="2" max="30" value="${s.stamps_required}" required></label>
      <label>How customers earn stamps
        <select name="earning_type">
          <option value="per_visit" ${s.earning_type === 'per_visit' ? 'selected' : ''}>One stamp per completed visit</option>
          <option value="per_spend" ${s.earning_type === 'per_spend' ? 'selected' : ''}>One stamp for every £ amount spent</option>
        </select></label>
      <label data-show="per_spend">One stamp for every (£)<input name="spend_threshold" type="number" min="1" step="0.01" value="${money(s.spend_threshold_pence)}"></label>
      <label>Minimum spend to earn (£)<input name="min_spend" type="number" min="0" step="0.01" value="${money(s.min_spend_pence)}"></label>
      <label>Reward
        <select name="reward_type">
          <option value="free_service" ${s.reward_type === 'free_service' ? 'selected' : ''}>Free service</option>
          <option value="amount_off" ${s.reward_type === 'amount_off' ? 'selected' : ''}>£ off</option>
          <option value="percent_off" ${s.reward_type === 'percent_off' ? 'selected' : ''}>% off</option>
        </select></label>
      <label>Reward name customers see<input name="reward_name" value="${esc(s.reward_name)}" required maxlength="60"></label>
      <label data-show-reward="value">Reward value<input name="reward_value" type="number" min="0" step="0.01" value="${s.reward_value ?? ''}"></label>
      <label>Reward expires after (days, blank = never)<input name="reward_expiry_days" type="number" min="1" value="${s.reward_expiry_days ?? ''}"></label>
      <fieldset><legend>Double stamp days</legend><div class="chips">${DAYS.map(d =>
        `<label class="chip"><input type="checkbox" name="double" value="${d}" ${s.double_stamp_days.includes(d) ? 'checked' : ''}> ${d[0].toUpperCase() + d.slice(1, 3)}</label>`).join('')}</div>
        <p class="small">Fill quiet days: visits on these days earn twice the stamps.</p></fieldset>
      <button class="btn">Save stamp card</button>`;
    syncForm();
  }

  function syncForm() {
    const f = BBdash.$('loy-form');
    f.querySelector('[data-show]').hidden = f.earning_type.value !== 'per_spend';
    f.querySelector('[data-show-reward]').hidden = f.reward_type.value === 'free_service';
  }

  async function save(e) {
    e.preventDefault();
    const f = e.target, pence = v => v === '' ? null : Math.round(Number(v) * 100);
    const row = {
      shop_id: shop.id, enabled: f.enabled.checked, stamps_required: Number(f.stamps_required.value),
      earning_type: f.earning_type.value, spend_threshold_pence: pence(f.spend_threshold.value),
      min_spend_pence: pence(f.min_spend.value) ?? 0, reward_type: f.reward_type.value,
      reward_name: f.reward_name.value.trim(), reward_value: f.reward_value.value === '' ? null : Number(f.reward_value.value),
      reward_expiry_days: f.reward_expiry_days.value ? Number(f.reward_expiry_days.value) : null,
      double_stamp_days: [...f.querySelectorAll('[name=double]:checked')].map(x => x.value), updated_at: new Date().toISOString(),
    };
    if (row.earning_type === 'per_spend' && !row.spend_threshold_pence) return toast('Set how much a customer spends per stamp', true);
    const { error } = await db.from('BBapp-loyalty_settings').upsert(row);
    if (error) return toast(error.message, true);
    cfg = row; renderForm(); toast('Stamp card saved'); renderList();
  }

  async function load() {
    const [{ data: s }, { data: cl }, { data: led }, { data: rw }] = await Promise.all([
      db.from('BBapp-loyalty_settings').select('*').eq('shop_id', shop.id).maybeSingle(),
      db.from('BBapp-clients').select('id, name, email_norm, phone').eq('shop_id', shop.id).order('name'),
      db.from('BBapp-loyalty_ledger').select('client_id, balance_after, created_at').eq('shop_id', shop.id).order('created_at', { ascending: false }),
      db.from('BBapp-loyalty_rewards').select('*').eq('shop_id', shop.id).eq('status', 'available'),
    ]);
    cfg = s || { enabled: false, stamps_required: 8, earning_type: 'per_visit', spend_threshold_pence: null, min_spend_pence: 0,
      reward_type: 'free_service', reward_name: 'Free haircut', reward_value: null, reward_expiry_days: null, double_stamp_days: [] };
    const bal = {}; (led || []).forEach(l => { if (!(l.client_id in bal)) bal[l.client_id] = l.balance_after; });
    const now = Date.now();
    clients = (cl || []).map(c => ({ ...c, stamps: bal[c.id] || 0,
      rewards: (rw || []).filter(r => r.client_id === c.id && (!r.expires_at || new Date(r.expires_at) > now)) }));
    renderForm(); renderList();
  }

  function renderList() {
    const q = BBdash.$('loy-q').value.trim().toLowerCase();
    const rows = clients.filter(c => !q || [c.name, c.email_norm, c.phone].some(v => (v || '').toLowerCase().includes(q)))
      .sort((a, b) => b.rewards.length - a.rewards.length || b.stamps - a.stamps);
    BBdash.$('loy-list').innerHTML = rows.length ? rows.slice(0, 100).map(c => `
      <div class="row-item">
        <div><span>${esc(c.name || c.email_norm)}</span><span class="small">${esc(c.email_norm || '')}${c.phone ? ' · ' + esc(c.phone) : ''}</span></div>
        ${cardDots(Math.min(c.stamps, cfg.stamps_required), cfg.stamps_required)}
        ${c.rewards.map(r => `<button class="btn btn-sm" data-redeem="${r.id}" title="${r.expires_at ? 'Expires ' + new Date(r.expires_at).toLocaleDateString('en-GB') : ''}">Use: ${esc(r.reward_name)}</button>`).join('')}
        <button class="btn btn-sm ghost" data-adjust="${c.id}">Adjust</button>
        <button class="btn btn-sm ghost" data-history="${c.id}">History</button>
      </div>`).join('') : '<p class="small">No customers yet. Anyone who books with an email gets a card.</p>';
  }

  function adjust(c) {
    const sheet = BBdash.sheet(`
      <h3>Adjust ${esc(c.name || c.email_norm)}'s card</h3><p class="small">Currently ${c.stamps} of ${cfg.stamps_required} stamps.</p>
      <form class="stack" id="adj-form">
        <label>Stamps to add (use a minus to take away)<input name="n" type="number" step="1" required inputmode="numeric"></label>
        <label>Reason<input name="note" required placeholder="e.g. paper card brought in"></label>
        <button class="btn">Save</button>
      </form>`);
    sheet.querySelector('#adj-form').onsubmit = async e => {
      e.preventDefault();
      const { data, error } = await db.rpc('bbapp_loyalty_adjust', { p_shop: shop.id, p_client: c.id, p_delta: Number(e.target.n.value), p_note: e.target.note.value.trim() });
      if (error) return toast(error.message, true);
      BBdash.closeSheet(); toast(`${c.name || 'Card'}: now ${data} stamps`); load();
    };
  }

  async function history(c) {
    const { data } = await db.from('BBapp-loyalty_ledger').select('*').eq('client_id', c.id).order('created_at', { ascending: false }).limit(50);
    BBdash.sheet(`<h3>${esc(c.name || c.email_norm)} · stamp history</h3><div class="list">${(data || []).map(l => `
      <div class="row-item"><div><span>${EVENT[l.event_type]}</span>
        <span class="small">${new Date(l.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${l.note ? ' · ' + esc(l.note) : ''}</span></div>
        <b class="${l.stamp_delta < 0 ? 'warn' : 'good'}">${l.stamp_delta > 0 ? '+' : ''}${l.stamp_delta || ''}</b><span class="small">→ ${l.balance_after}</span></div>`).join('') || '<p class="small">No stamps yet.</p>'}</div>`);
  }

  panel.addEventListener('change', e => { if (e.target.form?.id === 'loy-form') syncForm(); });
  panel.addEventListener('submit', e => { if (e.target.id === 'loy-form') save(e); });
  BBdash.$('loy-q').oninput = renderList;
  panel.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    const c = clients.find(x => x.id === (b.dataset.adjust || b.dataset.history));
    if (b.dataset.adjust) return adjust(c);
    if (b.dataset.history) return history(c);
    if (b.dataset.redeem) {
      if (!confirm('Mark this reward as used?')) return;
      const { error } = await db.rpc('bbapp_loyalty_redeem', { p_reward: b.dataset.redeem });
      if (error) return toast(error.message, true);
      toast('Reward used'); load();
    }
  });

  load();
});
