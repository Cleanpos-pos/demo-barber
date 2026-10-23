// Calendar tab: timed day/week grid with drag-and-drop rescheduling.
// Same model as Kiosk's StaffRota onDragEnd — the drop target names the
// chair + date (+ time here), the UI updates first, then the DB — but saved
// through bbapp_move_booking so the move is re-checked for clashes.
BBdash.tab('calendar', panel => {
  const { db, esc, pad, isoDate, toMin, fromMin, toast } = BBdash;
  const shop = BBdash.shop;
  const ROW = 15;          // minutes per grid row
  const ROW_PX = 30;       // pixel height of a row
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const NEXT = { pending: ['confirmed', 'cancelled'], confirmed: ['seated', 'no_show', 'cancelled'], seated: ['completed'] };
  const LABEL = { confirmed: 'Confirm', cancelled: 'Cancel', seated: 'In the chair', no_show: 'No-show', completed: 'Done' };

  let mode = 'week', anchor = new Date(), barbers = [], schedule = [], bookings = [], range = { start: 480, end: 1200 };
  // Phones start on the day view: seven day columns don't fit a phone screen.
  const narrow = window.matchMedia('(max-width: 760px)').matches;
  try { mode = localStorage.getItem('bbapp-cal-mode') || (narrow ? 'day' : 'week'); } catch { mode = narrow ? 'day' : 'week'; }

  panel.innerHTML = `
    <div class="cal-bar">
      <div class="seg" role="group" aria-label="View">
        <button data-mode="day">Day</button><button data-mode="week">Week</button>
      </div>
      <button class="btn btn-sm ghost" data-nav="-1" aria-label="Previous">‹</button>
      <button class="btn btn-sm ghost" data-nav="0">Today</button>
      <button class="btn btn-sm ghost" data-nav="1" aria-label="Next">›</button>
      <b id="cal-title"></b>
      <span id="cal-legend" class="legend"></span>
    </div>
    <p class="small">Drag a booking to another time${''} or barber to reschedule it. Tap it for details.</p>
    <div class="cal-wrap"><div id="cal" class="cal"></div></div>`;

  const startOfWeek = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
  const days = () => {
    if (mode === 'day') return [new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())];
    const s = startOfWeek(anchor);
    return [...Array(7).keys()].map(i => new Date(s.getFullYear(), s.getMonth(), s.getDate() + i));
  };
  const barberOf = chairId => barbers.find(b => b.chair_id === chairId);
  const nameOf = b => b?.name || 'Unassigned';

  // Grid spans the earliest opening to the latest closing across the visible days.
  function computeRange(ds) {
    let s = Infinity, e = -Infinity;
    for (const d of ds) {
      const day = schedule.find(x => x.dayOfWeek === DAYS[d.getDay()]);
      if (!day?.isOpen) continue;
      for (const w of day.timeSlots) { s = Math.min(s, toMin(w.startTime)); e = Math.max(e, toMin(w.endTime)); }
    }
    for (const b of bookings) { const t = toMin(b.time); s = Math.min(s, t); e = Math.max(e, t + b.duration_minutes); }
    if (!isFinite(s)) { s = 540; e = 1080; }
    range = { start: Math.floor(s / 60) * 60, end: Math.ceil(e / 60) * 60 };
  }

  async function load() {
    const ds = days();
    const [bar, set, bk] = await Promise.all([
      barbers.length ? null : db.rpc('bbapp_public_barbers', { p_shop: shop.id }),
      schedule.length ? null : db.from('BBapp-settings').select('opening_hours').eq('shop_id', shop.id).single(),
      db.from('BBapp-bookings')
        .select('*, service:"BBapp-services"(name, price_pence), client:"BBapp-clients"(id, preferences)')
        .eq('shop_id', shop.id).gte('date', isoDate(ds[0])).lte('date', isoDate(ds[ds.length - 1]))
        .not('status', 'in', '(cancelled)').order('time'),
    ]);
    if (bar) barbers = bar.data || [];
    if (set) schedule = set.data?.opening_hours || [];
    if (bk.error) return toast(bk.error.message, true);
    bookings = bk.data;
    render();
  }

  function render() {
    const ds = days();
    computeRange(ds);
    const rows = (range.end - range.start) / ROW;
    const todayIso = isoDate(new Date());
    panel.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === mode));
    BBdash.$('cal-title').textContent = mode === 'day'
      ? ds[0].toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
      : `${ds[0].toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${ds[6].toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    BBdash.$('cal-legend').innerHTML = barbers.map(b =>
      `<span><i style="background:${esc(b.color_code || '#888')}"></i>${esc(nameOf(b))}</span>`).join('');

    // Columns: one per day (week) or one per barber chair (day).
    const cols = mode === 'day'
      ? barbers.map(b => ({ date: isoDate(ds[0]), chair: b.chair_id, label: nameOf(b) }))
      : ds.map(d => ({ date: isoDate(d), chair: null, label: d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }) }));

    const times = [...Array(rows / 4).keys()].map(i => `<div class="cal-time" style="height:${ROW_PX * 4}px">${fromMin(range.start + i * 60)}</div>`).join('');
    const cal = BBdash.$('cal');
    cal.style.setProperty('--cols', cols.length);
    cal.innerHTML = `
      <div class="cal-head"><div></div>${cols.map(c => `<div class="${c.date === todayIso && mode === 'week' ? 'today' : ''}">${esc(c.label)}</div>`).join('')}</div>
      <div class="cal-body">
        <div class="cal-gutter">${times}</div>
        ${cols.map(c => `<div class="cal-col${closed(c.date) ? ' closed' : ''}" data-date="${c.date}" data-chair="${c.chair || ''}" style="height:${rows * ROW_PX}px">${blocks(c)}</div>`).join('')}
      </div>`;
  }

  function closed(date) {
    const [y, m, d] = date.split('-').map(Number);
    return !schedule.find(x => x.dayOfWeek === DAYS[new Date(y, m - 1, d).getDay()])?.isOpen;
  }

  function blocks(col) {
    const lanes = mode === 'week' ? Math.max(barbers.length, 1) : 1;
    return bookings.filter(b => b.date === col.date && (!col.chair || b.chair_id === col.chair)).map(b => {
      const top = (toMin(b.time) - range.start) / ROW * ROW_PX;
      const h = b.duration_minutes / ROW * ROW_PX;
      const lane = mode === 'week' ? Math.max(barbers.findIndex(x => x.chair_id === b.chair_id), 0) : 0;
      const bar = barberOf(b.chair_id);
      const end = fromMin(toMin(b.time) + b.duration_minutes);
      return `<div class="bk st-${b.status}" data-id="${b.id}" tabindex="0"
          style="top:${top}px;height:${h - 2}px;left:calc(${lane * 100 / lanes}% + 2px);width:calc(${100 / lanes}% - 4px);--c:${esc(bar?.color_code || '#666')}"
          title="${b.time}–${end} ${esc(b.guest_name)} · ${esc(b.service?.name || '')} · ${esc(nameOf(bar))}">
          <b>${b.time}–${end}${b.client?.preferences || b.notes ? ' <i class="note-flag" title="Has notes">📝</i>' : ''}</b><span>${esc(b.guest_name)}</span><span class="svc">${esc(b.service?.name || '')}${mode === 'week' ? ' · ' + esc(nameOf(bar)) : ''}</span>
        </div>`;
    }).join('');
  }

  // ---- Drag and drop (pointer events: mouse, pen and touch) ---------------
  let drag = null;
  const cal = BBdash.$('cal');

  cal.addEventListener('pointerdown', e => {
    const el = e.target.closest('.bk'); if (!el || e.button > 0) return;
    const r = el.getBoundingClientRect();
    drag = { el, id: el.dataset.id, x: e.clientX, y: e.clientY, offY: e.clientY - r.top, moving: false };
    el.setPointerCapture(e.pointerId);
  });

  cal.addEventListener('pointermove', e => {
    if (!drag) return;
    if (!drag.moving) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      drag.moving = true;
      drag.ghost = drag.el.cloneNode(true);
      Object.assign(drag.ghost.style, { position: 'fixed', width: `${drag.el.offsetWidth}px`, left: '0', top: '0', pointerEvents: 'none', zIndex: 50 });
      drag.ghost.classList.add('ghost');
      document.body.appendChild(drag.ghost);
      drag.el.classList.add('dragging');
      drag.preview = document.createElement('div');
      drag.preview.className = 'drop-preview';
    }
    e.preventDefault();
    drag.ghost.style.transform = `translate(${e.clientX - drag.el.offsetWidth / 2}px, ${e.clientY - drag.offY}px)`;
    drag.target = targetAt(e.clientX, e.clientY);
    if (drag.target) {
      const b = bookings.find(x => x.id === drag.id);
      Object.assign(drag.preview.style, drag.target.box);
      drag.preview.style.height = `${b.duration_minutes / ROW * ROW_PX - 2}px`;
      drag.preview.textContent = `${drag.target.time} · ${nameOf(barberOf(drag.target.chair))}`;
      drag.target.col.appendChild(drag.preview);
    } else drag.preview.remove();
  });

  function targetAt(x, y) {
    const col = document.elementFromPoint(x, y)?.closest('.cal-col');
    if (!col) return null;
    const r = col.getBoundingClientRect();
    const rows = Math.round((y - drag.offY - r.top) / ROW_PX);
    const b = bookings.find(z => z.id === drag.id);
    const t = Math.max(range.start, Math.min(range.end - b.duration_minutes, range.start + rows * ROW));
    let chair = col.dataset.chair, left = '2px', width = 'calc(100% - 4px)';
    if (!chair) {
      const n = Math.max(barbers.length, 1);
      const lane = Math.min(n - 1, Math.max(0, Math.floor((x - r.left) / r.width * n)));
      chair = barbers[lane]?.chair_id || b.chair_id;
      left = `calc(${lane * 100 / n}% + 2px)`; width = `calc(${100 / n}% - 4px)`;
    }
    return { col, date: col.dataset.date, chair, time: fromMin(t), box: { top: `${(t - range.start) / ROW * ROW_PX}px`, left, width } };
  }

  cal.addEventListener('pointerup', async e => {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.moving) return openDetails(d.id);
    d.ghost.remove(); d.preview.remove(); d.el.classList.remove('dragging');
    const t = d.target, b = bookings.find(x => x.id === d.id);
    if (!t || (t.date === b.date && t.time === b.time && t.chair === b.chair_id)) return;
    const before = { date: b.date, time: b.time, chair_id: b.chair_id };
    Object.assign(b, { date: t.date, time: t.time, chair_id: t.chair });
    render();
    const { error } = await db.rpc('bbapp_move_booking', { p_booking: b.id, p_chair: t.chair, p_date: t.date, p_time: t.time });
    if (error) { Object.assign(b, before); render(); return toast(error.message, true); }
    const [y, m, dd] = t.date.split('-').map(Number);
    const msg = `Moved ${b.guest_name} to ${new Date(y, m - 1, dd).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} ${t.time} with ${nameOf(barberOf(t.chair))}`;
    toast(msg);
    toast(msg + BBdash.emailNote(await BBdash.sendEmail(b.id, 'bookingMoved')));
  });

  cal.addEventListener('pointercancel', () => {
    if (drag?.moving) { drag.ghost.remove(); drag.preview.remove(); drag.el.classList.remove('dragging'); }
    drag = null;
  });
  cal.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('.bk')) openDetails(e.target.dataset.id); });

  // ---- Details sheet --------------------------------------------------------
  function openDetails(id) {
    const b = bookings.find(x => x.id === id); if (!b) return;
    const bar = barberOf(b.chair_id);
    const end = fromMin(toMin(b.time) + b.duration_minutes);
    const [y, m, d] = b.date.split('-').map(Number);
    const sheet = BBdash.sheet(`
      <h3>${esc(b.guest_name)}</h3>
      <p class="small">${new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}, ${b.time}–${end}</p>
      <p>${esc(b.service?.name || '')}${b.service ? ' · ' + BBdash.gbp.format(b.service.price_pence / 100) : ''} with <b>${esc(nameOf(bar))}</b></p>
      <p class="small">${[b.guest_phone, b.guest_email].filter(Boolean).map(esc).join(' · ')}</p>
      ${b.notes ? `<div class="note-box"><b>This visit</b><p>${esc(b.notes)}</p></div>` : ''}
      ${b.client ? `<div class="note-box prefs-box"><b>Client preferences</b>
        <textarea id="pref-edit" rows="2" maxlength="500" placeholder="No preferences saved yet">${esc(b.client.preferences || '')}</textarea>
        <button class="btn btn-sm ghost" id="pref-save">Save preferences</button></div>` : ''}
      <p><span class="tag ${b.status}">${b.status.replace('_', '-')}</span></p>
      <div class="chips">${b.status !== 'cancelled' && b.status !== 'no_show' && BBdash.takePayment ? '<button data-pay class="primary-chip">Take payment</button>' : ''}
        ${(NEXT[b.status] || []).map(s => `<button data-status="${s}">${LABEL[s]}</button>`).join('')}
        ${b.service && BBdash.createPayLink ? '<button data-paylink>Send pay link</button>' : ''}</div>
      <details><summary class="small">History</summary><ul class="small">${b.communication_history.map(h => `<li>${esc(h)}</li>`).join('')}</ul></details>`);
    sheet.onclick = async e => {
      if (e.target.closest('#pref-save')) {
        const prefs = sheet.querySelector('#pref-edit').value.trim() || null;
        const { error } = await db.from('BBapp-clients').update({ preferences: prefs, preferences_updated_at: new Date().toISOString() }).eq('id', b.client.id);
        if (error) return toast(error.message, true);
        b.client.preferences = prefs; render(); return toast('Preferences saved');
      }
      if (e.target.closest('[data-pay]')) { BBdash.closeSheet(); return BBdash.takePayment(b, barberOf(b.chair_id), load); }
      if (e.target.closest('[data-paylink]')) {
        BBdash.closeSheet();
        return BBdash.createPayLink({ amount_pence: b.service.price_pence, description: `${b.service.name} at ${shop.name}`, customer_name: b.guest_name, customer_phone: b.guest_phone, customer_email: b.guest_email, booking_id: b.id });
      }
      const s = e.target.closest('[data-status]')?.dataset.status; if (!s) return;
      const { error } = await db.from('BBapp-bookings').update({
        status: s, communication_history: [...b.communication_history, `Status set to ${s}`],
      }).eq('id', b.id);
      if (error) return toast(error.message, true);
      BBdash.closeSheet(); load();
      const tpl = { confirmed: 'bookingAccepted', cancelled: 'bookingCancelled' }[s];
      toast(`${b.guest_name}: ${LABEL[s].toLowerCase()}` + (tpl ? BBdash.emailNote(await BBdash.sendEmail(b.id, tpl)) : ''));
    };
  }

  panel.querySelector('.cal-bar').onclick = e => {
    const m = e.target.closest('[data-mode]')?.dataset.mode;
    if (m) { mode = m; try { localStorage.setItem('bbapp-cal-mode', m); } catch {} return load(); }
    const n = e.target.closest('[data-nav]')?.dataset.nav;
    if (n === undefined) return;
    if (n === '0') anchor = new Date();
    else anchor = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + Number(n) * (mode === 'week' ? 7 : 1));
    load();
  };

  // Live updates, like TableMaestroService.subscribeToBookings.
  db.channel(`bbapp-bookings-${shop.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'BBapp-bookings', filter: `shop_id=eq.${shop.id}` }, () => { if (!drag) load(); })
    .subscribe();

  BBdash.reloadCalendar = () => { barbers = []; load(); };
  load();
});
