// Reports tab. Like Kiosk's AnalyticsDashboard, figures are aggregated in the
// browser over raw rows for a date range (default: this month), grouped into
// business and stock reports, each exportable as CSV. Money comes from
// BBapp-payments (one row per tender), so cash/card/online and tips split by barber.
BBdash.tab('reports', panel => {
  const { db, esc, gbp, toast, isoDate, toMin } = BBdash;
  const shop = BBdash.shop;
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const money = p => gbp.format((p || 0) / 100);
  const pct = (a, b) => b ? `${Math.round(a / b * 100)}%` : '–';
  const SECTIONS = [['overview', 'Overview'], ['barbers', 'Barbers'], ['menu', 'Services & products'], ['clients', 'Clients'], ['busy', 'Busy times'], ['visitors', 'Visitors'], ['stock', 'Stock'], ['eod', 'End of day']];
  let section = 'overview', range = presetRange('month'), D = null;

  function presetRange(k) {
    const t = new Date(), d = n => new Date(t.getFullYear(), t.getMonth(), t.getDate() + n);
    if (k === 'today') return { from: isoDate(t), to: isoDate(t), k };
    if (k === 'week') return { from: isoDate(d(-((t.getDay() + 6) % 7))), to: isoDate(t), k };
    if (k === '30') return { from: isoDate(d(-29)), to: isoDate(t), k };
    if (k === 'lastmonth') { const a = new Date(t.getFullYear(), t.getMonth() - 1, 1), b = new Date(t.getFullYear(), t.getMonth(), 0); return { from: isoDate(a), to: isoDate(b), k }; }
    return { from: isoDate(new Date(t.getFullYear(), t.getMonth(), 1)), to: isoDate(t), k: 'month' };
  }
  const localStart = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };

  panel.innerHTML = `
    <div class="rep-bar">
      <div class="chips" id="rep-range">${[['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['lastmonth', 'Last month'], ['30', 'Last 30 days']]
        .map(([k, l]) => `<button data-r="${k}">${l}</button>`).join('')}</div>
      <div class="inline rep-dates"><input type="date" id="rep-from" aria-label="From"><span>to</span><input type="date" id="rep-to" aria-label="To"></div>
    </div>
    <nav class="subtabs" id="rep-nav">${SECTIONS.map(([k, l]) => `<button data-s="${k}">${l}</button>`).join('')}</nav>
    <div id="rep-body"><p class="small">Loading…</p></div>`;

  const body = () => BBdash.$('rep-body');

  async function load() {
    BBdash.$('rep-from').value = range.from; BBdash.$('rep-to').value = range.to;
    panel.querySelectorAll('#rep-range button').forEach(b => b.classList.toggle('on', b.dataset.r === range.k));
    body().innerHTML = '<p class="small">Crunching the numbers…</p>';
    const start = localStart(range.from), end = localStart(range.to); end.setDate(end.getDate() + 1);
    const fwdTo = new Date(); fwdTo.setDate(fwdTo.getDate() + 7);
    const [pay, bk, ord, staff, chairs, set, fwd, vis] = await Promise.all([
      db.from('BBapp-payments').select('*').eq('shop_id', shop.id).gte('taken_at', start.toISOString()).lt('taken_at', end.toISOString()),
      db.from('BBapp-bookings').select('id, date, time, duration_minutes, status, chair_id, service_id, client_id, created_at, service:"BBapp-services"(name, price_pence)')
        .eq('shop_id', shop.id).gte('date', range.from).lte('date', range.to),
      db.from('BBapp-orders').select('*').eq('shop_id', shop.id).gte('created_at', start.toISOString()).lt('created_at', end.toISOString()),
      db.from('BBapp-staff').select('*').eq('shop_id', shop.id).order('first_name'),
      db.from('BBapp-chairs').select('id, staff_id').eq('shop_id', shop.id),
      db.from('BBapp-settings').select('opening_hours').eq('shop_id', shop.id).single(),
      db.from('BBapp-bookings').select('date, status, service:"BBapp-services"(price_pence)').eq('shop_id', shop.id)
        .gte('date', isoDate(new Date())).lte('date', isoDate(fwdTo)).in('status', ['pending', 'confirmed']),
      db.from('BBapp-visits').select('visitor, event, page, created_at').eq('shop_id', shop.id)
        .gte('created_at', start.toISOString()).lt('created_at', end.toISOString()).limit(20000),
    ]);
    const err = [pay, bk, ord, staff, chairs].find(r => r.error);
    if (err) { body().innerHTML = `<p class="small">${esc(err.error.message)}</p>`; return; }
    // Client history for new-vs-returning and rebooking.
    const clientIds = [...new Set(bk.data.map(b => b.client_id).filter(Boolean))];
    const hist = clientIds.length
      ? (await db.from('BBapp-bookings').select('client_id, date, status').in('client_id', clientIds)).data || []
      : [];
    D = { pay: pay.data, bk: bk.data, ord: ord.data, staff: staff.data, chairs: chairs.data, hours: set.data?.opening_hours || [], fwd: fwd.data || [], hist, vis: vis.data || [] };
    render();
  }

  // ---------------------------------------------------------------- helpers
  const staffName = id => { const s = D.staff.find(x => x.id === id); return s ? (s.display_name || s.first_name) : 'Unassigned'; };
  const staffOfChair = id => D.chairs.find(c => c.id === id)?.staff_id || null;
  const live = b => !['cancelled', 'no_show'].includes(b.status);
  function daysInRange() {
    const out = [], d = localStart(range.from), e = localStart(range.to);
    for (; d <= e; d.setDate(d.getDate() + 1)) out.push(new Date(d));
    return out;
  }
  // Minutes a barber is available over the range: their own hours, else shop hours.
  function availableMinutes(staff) {
    const sched = staff?.availability || D.hours;
    return daysInRange().reduce((t, d) => {
      const day = sched.find(x => x.dayOfWeek === DAYS[d.getDay()]);
      return t + (day?.isOpen ? day.timeSlots.reduce((s, w) => s + (toMin(w.endTime) - toMin(w.startTime)), 0) : 0);
    }, 0);
  }
  function table(id, head, rows, foot) {
    return `<div class="table-wrap"><table class="rep" id="${id}"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${head.length}" class="small">Nothing in this period.</td></tr>`}</tbody>
      ${foot ? `<tfoot><tr>${foot.map(c => `<td>${c}</td>`).join('')}</tr></tfoot>` : ''}</table></div>
      <button class="btn btn-sm ghost csv" data-csv="${id}">Download CSV</button>`;
  }
  const tile = (label, value, sub = '') => `<div class="tile"><span>${label}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const bars = rows => {
    const max = Math.max(1, ...rows.map(r => r.v));
    return `<div class="bars">${rows.map(r => `<div class="bar" title="${esc(r.label)}: ${money(r.v)}"><i style="height:${Math.round(r.v / max * 100)}%"></i><span>${esc(r.short)}</span></div>`).join('')}</div>`;
  };

  // --------------------------------------------------------------- sections
  function overview() {
    const take = D.pay.reduce((t, p) => t + p.amount_pence, 0), tips = D.pay.reduce((t, p) => t + p.tip_pence, 0);
    const by = m => D.pay.filter(p => p.method === m).reduce((t, p) => t + p.amount_pence + p.tip_pence, 0);
    const visits = new Set(D.pay.map(p => p.booking_id || p.order_id || p.id)).size;
    const done = D.bk.filter(b => b.status === 'completed').length;
    const noShow = D.bk.filter(b => b.status === 'no_show'), cancelled = D.bk.filter(b => b.status === 'cancelled');
    const booked = D.bk.filter(live).reduce((t, b) => t + b.duration_minutes, 0);
    const avail = D.staff.filter(s => s.is_active).reduce((t, s) => t + availableMinutes(s), 0);
    const fwdVal = D.fwd.reduce((t, b) => t + (b.service?.price_pence || 0), 0);
    const daily = daysInRange().map(d => {
      const k = isoDate(d);
      return { label: d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }), short: d.getDate(),
        v: D.pay.filter(p => isoDate(new Date(p.taken_at)) === k).reduce((t, p) => t + p.amount_pence, 0) };
    });
    return `
      <div class="tiles">
        ${tile('Takings', money(take), 'excluding tips')}
        ${tile('Tips', money(tips))}
        ${tile('Average spend', money(visits ? take / visits : 0), `${visits} paid visits`)}
        ${tile('Clients served', done)}
        ${tile('Diary filled', pct(booked, avail), 'booked vs available time')}
        ${tile('No-shows', noShow.length, `${money(noShow.reduce((t, b) => t + (b.service?.price_pence || 0), 0))} lost · ${pct(noShow.length, D.bk.length)} of bookings`)}
        ${tile('Cancellations', cancelled.length, pct(cancelled.length, D.bk.length) + ' of bookings')}
        ${tile('Booked next 7 days', money(fwdVal), `${D.fwd.length} appointments`)}
      </div>
      <h3>Takings by payment type</h3>
      ${table('rep-methods', ['Paid by', 'Payments', 'Amount', 'Tips', 'Total', 'Share'],
        ['cash', 'card', 'online', 'voucher'].map(m => {
          const r = D.pay.filter(p => p.method === m), a = r.reduce((t, p) => t + p.amount_pence, 0), tp = r.reduce((t, p) => t + p.tip_pence, 0);
          return [m[0].toUpperCase() + m.slice(1), r.length, money(a), money(tp), money(a + tp), pct(by(m), take + tips)];
        }), ['Total', D.pay.length, money(take), money(tips), money(take + tips), '100%'])}
      ${daily.length > 1 ? `<h3>Takings by day</h3>${bars(daily)}` : ''}`;
  }

  function barbers() {
    const rows = D.staff.map(s => {
      const pays = D.pay.filter(p => p.staff_id === s.id);
      const take = pays.reduce((t, p) => t + p.amount_pence, 0), tips = pays.reduce((t, p) => t + p.tip_pence, 0);
      const cash = pays.filter(p => p.method === 'cash').reduce((t, p) => t + p.amount_pence + p.tip_pence, 0);
      const mine = D.bk.filter(b => staffOfChair(b.chair_id) === s.id);
      const done = mine.filter(b => b.status === 'completed').length;
      const ns = mine.filter(b => b.status === 'no_show').length;
      const util = pct(mine.filter(live).reduce((t, b) => t + b.duration_minutes, 0), availableMinutes(s));
      const visits = new Set(pays.map(p => p.booking_id || p.order_id || p.id)).size;
      const comm = Math.round(take * (Number(s.commission_pct) || 0) / 100);
      return { s, take, tips, cash, done, ns, util, avg: visits ? take / visits : 0, comm };
    }).filter(r => r.s.is_active || r.take);
    const un = D.pay.filter(p => !p.staff_id).reduce((t, p) => t + p.amount_pence, 0);
    rows.sort((a, b) => b.take - a.take);
    return `
      <p class="small">Commission is worked out on takings (excluding tips). Tips go to the barber in full. Set each barber's commission under Staff.</p>
      ${table('rep-barbers', ['Barber', 'Clients', 'Takings', 'Avg spend', 'Tips', 'Cash taken', 'Diary filled', 'No-shows', 'Commission', 'Pay out (comm. + tips)'],
        rows.map(r => [esc(r.s.display_name || r.s.first_name), r.done, money(r.take), money(r.avg), money(r.tips), money(r.cash), r.util, r.ns,
          `${money(r.comm)} <small>(${Number(r.s.commission_pct) || 0}%)</small>`, `<b>${money(r.comm + r.tips)}</b>`]),
        ['Total', rows.reduce((t, r) => t + r.done, 0), money(rows.reduce((t, r) => t + r.take, 0)), '', money(rows.reduce((t, r) => t + r.tips, 0)),
          money(rows.reduce((t, r) => t + r.cash, 0)), '', rows.reduce((t, r) => t + r.ns, 0), money(rows.reduce((t, r) => t + r.comm, 0)), money(rows.reduce((t, r) => t + r.comm + r.tips, 0))])}
      ${un ? `<p class="small">${money(un)} was taken without a barber selected.</p>` : ''}`;
  }

  function menu() {
    const svc = {};
    for (const b of D.bk.filter(x => x.status === 'completed')) {
      const k = b.service?.name || 'Unknown';
      svc[k] = svc[k] || { n: 0, v: 0 }; svc[k].n++; svc[k].v += b.service?.price_pence || 0;
    }
    const svcTotal = Object.values(svc).reduce((t, x) => t + x.v, 0);
    const prod = {};
    const liveOrders = D.ord.filter(o => o.status !== 'cancelled');
    for (const o of liveOrders) for (const i of o.items.filter(i => i.type === 'product')) {
      prod[i.name] = prod[i.name] || { n: 0, v: 0 }; prod[i.name].n += i.qty; prod[i.name].v += i.qty * i.unit_pence;
    }
    const withCut = liveOrders.filter(o => o.with_cut && o.items.some(i => i.type === 'product')).length;
    const doneCount = D.bk.filter(b => b.status === 'completed').length;
    return `
      <h3>Services</h3>
      ${table('rep-services', ['Service', 'Done', 'Value', 'Share'],
        Object.entries(svc).sort((a, b) => b[1].v - a[1].v).map(([k, x]) => [esc(k), x.n, money(x.v), pct(x.v, svcTotal)]))}
      <h3>Products sold</h3>
      <p class="small">${withCut} of ${doneCount} cuts also bought a product (${pct(withCut, doneCount)} attach rate).</p>
      ${table('rep-products', ['Product', 'Units', 'Sales'],
        Object.entries(prod).sort((a, b) => b[1].v - a[1].v).map(([k, x]) => [esc(k), x.n, money(x.v)]))}`;
  }

  function clients() {
    const seen = [...new Set(D.bk.filter(live).map(b => b.client_id).filter(Boolean))];
    const first = id => D.hist.filter(h => h.client_id === id && h.status !== 'cancelled').map(h => h.date).sort()[0];
    const fresh = seen.filter(id => first(id) >= range.from).length;
    const visited = [...new Set(D.bk.filter(b => b.status === 'completed').map(b => b.client_id).filter(Boolean))];
    const rebooked = visited.filter(id => {
      const last = D.bk.filter(b => b.client_id === id && b.status === 'completed').map(b => b.date).sort().pop();
      return D.hist.some(h => h.client_id === id && h.date > last && h.status !== 'cancelled');
    }).length;
    const walkInsOrNoEmail = D.bk.filter(b => live(b) && !b.client_id).length;
    return `
      <div class="tiles">
        ${tile('Clients', seen.length)}
        ${tile('New clients', fresh, pct(fresh, seen.length))}
        ${tile('Returning clients', seen.length - fresh, pct(seen.length - fresh, seen.length))}
        ${tile('Rebooked', pct(rebooked, visited.length), `${rebooked} of ${visited.length} who visited have another booking`)}
      </div>
      ${walkInsOrNoEmail ? `<p class="small">${walkInsOrNoEmail} bookings had no email, so they aren't linked to a client record.</p>` : ''}
      <p class="small">Tip: a strong shop rebooks 60%+ of clients before they leave the chair.</p>`;
  }

  function busy() {
    const hours = [...Array(14).keys()].map(i => i + 8); // 08:00–21:00
    const order = [1, 2, 3, 4, 5, 6, 0];
    const grid = order.map(d => hours.map(h => D.bk.filter(b => live(b) && localStart(b.date).getDay() === d && Math.floor(toMin(b.time) / 60) === h).length));
    const max = Math.max(1, ...grid.flat());
    return `
      <p class="small">Bookings by day and hour for the period. Darker means busier — use it to plan rotas and quiet-time offers.</p>
      <div class="table-wrap"><table class="heat"><thead><tr><th></th>${hours.map(h => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${order.map((d, i) => `<tr><th>${DAYS[d].slice(0, 3)}</th>${grid[i].map(n => `<td style="--a:${(n / max).toFixed(2)}" title="${n} bookings">${n || ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  async function stock() {
    const { data: prods } = await db.from('BBapp-products').select('*').eq('shop_id', shop.id).order('name');
    const tracked = (prods || []).filter(p => p.stock != null);
    const low = tracked.filter(p => p.stock <= p.low_stock_threshold);
    const atCost = tracked.reduce((t, p) => t + p.stock * (p.cost_pence ?? 0), 0);
    const atRetail = tracked.reduce((t, p) => t + p.stock * p.price_pence, 0);
    return `
      <div class="tiles">
        ${tile('Stock value at cost', money(atCost))}
        ${tile('Stock value at retail', money(atRetail), `${money(atRetail - atCost)} potential profit`)}
        ${tile('Low or out of stock', low.length, low.length ? 'see Stock tab to reorder' : 'all good')}
      </div>
      ${table('rep-stock', ['Product', 'In stock', 'Reorder at', 'Cost', 'Price', 'Margin', 'Value at cost'],
        tracked.map(p => [esc(p.name), p.stock <= p.low_stock_threshold ? `<b class="warn">${p.stock}</b>` : p.stock, p.low_stock_threshold,
          p.cost_pence != null ? money(p.cost_pence) : '–', money(p.price_pence),
          p.cost_pence != null && p.price_pence ? pct(p.price_pence - p.cost_pence, p.price_pence) : '–', money(p.stock * (p.cost_pence ?? 0))]))}`;
  }

  // ---------------------------------------------------- end of day (X / Z)
  let eod = { date: isoDate(new Date()), float: 10000, moves: [] };
  async function endOfDay() {
    const s = localStart(eod.date), e = new Date(s); e.setDate(e.getDate() + 1);
    const [{ data: pays }, { data: ups }] = await Promise.all([
      db.from('BBapp-payments').select('*').eq('shop_id', shop.id).gte('taken_at', s.toISOString()).lt('taken_at', e.toISOString()),
      db.from('BBapp-cash_ups').select('*').eq('shop_id', shop.id).order('created_at', { ascending: false }).limit(14),
    ]);
    const sum = m => (pays || []).filter(p => p.method === m).reduce((t, p) => t + p.amount_pence + p.tip_pence, 0);
    const cash = sum('cash'), card = sum('card'), online = sum('online'), tips = (pays || []).reduce((t, p) => t + p.tip_pence, 0);
    const mv = k => eod.moves.filter(m => m.type === k).reduce((t, m) => t + m.amount_pence, 0);
    const expected = eod.float + cash + mv('pay_in') - mv('pay_out') - mv('safe_drop');
    eod.calc = { cash, card, online, tips, expected };
    return `
      <div class="eod print-area">
        <div class="inline"><label>Business day<input type="date" id="eod-date" value="${eod.date}"></label>
          <label>Opening float (£)<input type="number" id="eod-float" min="0" step="0.01" value="${(eod.float / 100).toFixed(2)}"></label></div>
        <ul class="lines total">
          <li><span>Cash taken (incl. tips)</span><b>${money(cash)}</b></li>
          <li><span>Card taken (incl. tips)</span><b>${money(card)}</b></li>
          <li><span>Paid online</span><b>${money(online)}</b></li>
          <li><span>Tips within the above</span><b>${money(tips)}</b></li>
        </ul>
        <h4>Cash in and out of the till</h4>
        <div class="list">${eod.moves.map((m, i) => `<div class="row-item"><div><span>${{ pay_in: 'Pay in', pay_out: 'Pay out', safe_drop: 'Safe drop' }[m.type]}</span><span class="small">${esc(m.note || '')}</span></div><b>${money(m.amount_pence)}</b><button class="btn btn-sm ghost" data-rm="${i}">Remove</button></div>`).join('') || '<p class="small">None recorded.</p>'}</div>
        <form id="eod-move" class="inline"><select name="type"><option value="pay_out">Pay out</option><option value="pay_in">Pay in</option><option value="safe_drop">Safe drop</option></select>
          <input name="amount" type="number" min="0.01" step="0.01" placeholder="£" required><input name="note" placeholder="What for (e.g. milk, window cleaner)"><button class="btn btn-sm">Add</button></form>
        <ul class="lines total"><li class="grand"><span>Cash expected in till</span><b>${money(expected)}</b></li></ul>
        <div class="inline"><label>Cash counted (£)<input type="number" id="eod-declared" min="0" step="0.01" placeholder="Count the till"></label>
          <label>Notes<input id="eod-notes" placeholder="Optional"></label></div>
        <p id="eod-var" class="small"></p>
        <div class="inline no-print"><button class="btn ghost" data-save="X">Save X report (mid-day check)</button><button class="btn" data-save="Z">Save Z report (close the day)</button>
          <button class="btn ghost" id="eod-print">Print</button></div>
      </div>
      <h3>Recent cash-ups</h3>
      ${table('rep-cashups', ['Date', 'Type', 'Cash', 'Card', 'Online', 'Expected', 'Counted', 'Over / short'],
        (ups || []).map(u => {
          const exp = u.float_pence + u.cash_system_pence + (u.movements || []).reduce((t, m) => t + (m.type === 'pay_in' ? m.amount_pence : -m.amount_pence), 0);
          return [new Date(u.business_date).toLocaleDateString('en-GB'), u.type, money(u.cash_system_pence), money(u.card_system_pence), money(u.online_system_pence), money(exp),
            u.cash_declared_pence != null ? money(u.cash_declared_pence) : '–', u.variance_pence != null ? `<b class="${u.variance_pence < 0 ? 'warn' : ''}">${money(u.variance_pence)}</b>` : '–'];
        }))}`;
  }

  // Visitors: only people who accepted analytics cookies are counted.
  const FUNNEL = [['shop_search', 'Found you in search'], ['booking_open', 'Opened booking'], ['slot_select', 'Picked a time'], ['booking_complete', 'Booked']];

  // Returns [{ step, label, visitors }] for each FUNNEL step.
  function funnel(events) {
    // Distinct visitors who reached each step, so repeat clicks count once.
    return FUNNEL.map(([step, label]) => ({ step, label, visitors: new Set(events.filter(e => e.event === step).map(e => e.visitor)).size }));
  }

  function visitors() {
    const people = new Set(D.vis.map(v => v.visitor)).size;
    const seen = D.vis.filter(v => v.event === 'shop_search').length;
    const steps = funnel(D.vis), top = steps[0]?.visitors || 0;
    const daily = daysInRange().map(d => {
      const k = isoDate(d);
      return { label: d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }), short: d.getDate(),
        v: new Set(D.vis.filter(v => isoDate(new Date(v.created_at)) === k).map(v => v.visitor)).size };
    });
    const max = Math.max(1, ...daily.map(r => r.v));
    return `
      <div class="tiles">
        ${tile('Visitors', people, 'who accepted analytics cookies')}
        ${tile('Search appearances', seen)}
        ${tile('Booked online', steps.at(-1)?.visitors || 0, `${pct(steps.at(-1)?.visitors || 0, top)} of visitors`)}
      </div>
      <h3>Visitors per day</h3>
      <div class="bars">${daily.map(r => `<div class="bar" title="${esc(r.label)}: ${r.v}"><i style="height:${Math.round(r.v / max * 100)}%"></i><span>${esc(r.short)}</span></div>`).join('')}</div>
      <h3>Booking funnel</h3>
      ${table('rep-funnel', ['Step', 'Visitors', 'Of first step', 'Of previous step'],
        steps.map((s, i) => [esc(s.label), s.visitors, pct(s.visitors, top), i ? pct(s.visitors, steps[i - 1].visitors) : '–']))}
      <p class="small">Visitors who rejected analytics cookies are not counted, so real traffic is higher.</p>`;
  }

  // ------------------------------------------------------------------ wiring
  async function render() {
    panel.querySelectorAll('#rep-nav button').forEach(b => b.classList.toggle('on', b.dataset.s === section));
    panel.querySelector('.rep-bar').hidden = section === 'eod' || section === 'stock';
    const html = { overview, barbers, menu, clients, busy, visitors }[section];
    body().innerHTML = html ? html() : section === 'stock' ? await stock() : await endOfDay();
  }

  panel.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.r) { range = presetRange(b.dataset.r); return load(); }
    if (b.dataset.s) { section = b.dataset.s; return render(); }
    if (b.dataset.csv) return csv(b.dataset.csv);
    if (b.dataset.rm) { eod.moves.splice(Number(b.dataset.rm), 1); return render(); }
    if (b.id === 'eod-print') return window.print();
    if (b.dataset.save) return saveCashUp(b.dataset.save);
  });
  panel.addEventListener('change', e => {
    if (e.target.id === 'rep-from' || e.target.id === 'rep-to') {
      range = { from: BBdash.$('rep-from').value, to: BBdash.$('rep-to').value, k: 'custom' };
      if (range.from && range.to && range.from <= range.to) load();
    }
    if (e.target.id === 'eod-date') { eod.date = e.target.value; eod.moves = []; render(); }
    if (e.target.id === 'eod-float') { eod.float = Math.round(Number(e.target.value || 0) * 100); render(); }
  });
  panel.addEventListener('input', e => {
    if (e.target.id !== 'eod-declared') return;
    const v = Math.round(Number(e.target.value || 0) * 100) - eod.calc.expected;
    BBdash.$('eod-var').innerHTML = e.target.value === '' ? '' : v === 0 ? '<b>Till balances exactly.</b>' : `<b class="${v < 0 ? 'warn' : ''}">${v < 0 ? 'Short' : 'Over'} by ${money(Math.abs(v))}</b>`;
  });
  panel.addEventListener('submit', e => {
    if (e.target.id !== 'eod-move') return;
    e.preventDefault();
    const f = new FormData(e.target);
    eod.moves.push({ type: f.get('type'), amount_pence: Math.round(Number(f.get('amount')) * 100), note: f.get('note').trim() });
    render();
  });

  async function saveCashUp(type) {
    const decl = BBdash.$('eod-declared').value;
    if (type === 'Z' && decl === '') return toast('Count the cash in the till first.', true);
    if (type === 'Z') {
      const { data: done } = await db.from('BBapp-cash_ups').select('id').eq('shop_id', shop.id).eq('business_date', eod.date).eq('type', 'Z');
      if (done?.length && !confirm('This day already has a Z report. Save another?')) return;
    }
    const declared = decl === '' ? null : Math.round(Number(decl) * 100);
    const { error } = await db.from('BBapp-cash_ups').insert({
      shop_id: shop.id, type, business_date: eod.date, float_pence: eod.float,
      cash_system_pence: eod.calc.cash, card_system_pence: eod.calc.card, online_system_pence: eod.calc.online, tips_pence: eod.calc.tips,
      cash_declared_pence: declared, variance_pence: declared == null ? null : declared - eod.calc.expected,
      movements: eod.moves, notes: BBdash.$('eod-notes').value.trim() || null,
    });
    if (error) return toast(error.message, true);
    toast(`${type} report saved`); render();
  }

  // CSV of any report table (Kiosk-style filename: name_from_to.csv).
  function csv(id) {
    const t = document.getElementById(id); if (!t) return;
    const rows = [...t.querySelectorAll('tr')].map(tr => [...tr.children].map(c => `"${c.innerText.replace(/"/g, '""')}"`).join(','));
    const blob = new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${id.replace('rep-', '')}_${range.from}_to_${range.to}.csv` });
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
  }

  load();
});
