// Staff tab: barbers (Kiosk staff fields + display name/colour), weekly
// availability in the TM schedule shape, and PIN clock in/out (kiosk_punches).
BBdash.tab('staff', panel => {
  const { db, esc, toast, isoDate } = BBdash;
  const shop = BBdash.shop;
  const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  let staff = [], chairs = [], shopHours = [];

  panel.innerHTML = `
    <div class="cols-2">
      <section>
        <h2>Clock in / out</h2>
        <form id="clock" class="clock">
          <input name="pin" inputmode="numeric" pattern="\\d{4,6}" maxlength="6" placeholder="Enter PIN" required autocomplete="off" aria-label="Staff PIN">
          <button class="btn">Clock in / out</button>
        </form>
        <h4>On shift now</h4>
        <div id="on-shift" class="list"></div>
        <h4>This week</h4>
        <div id="hours" class="list"></div>
      </section>
      <section>
        <div class="dash-head"><h2>Barbers</h2><button class="btn btn-sm" id="new-staff">Add barber</button></div>
        <div id="staff-list" class="list"></div>
        <p class="small">The display name is what clients see when they choose a barber. Leave it blank to use the first name.</p>
      </section>
    </div>`;

  const shown = s => (s.display_name || '').trim() || s.first_name;
  const hm = mins => `${Math.floor(mins / 60)}h ${String(Math.round(mins % 60)).padStart(2, '0')}m`;

  async function load() {
    const [s, c, h] = await Promise.all([
      db.from('BBapp-staff').select('*').eq('shop_id', shop.id).order('first_name'),
      db.from('BBapp-chairs').select('*').eq('shop_id', shop.id).order('name'),
      shopHours.length ? null : db.from('BBapp-settings').select('opening_hours').eq('shop_id', shop.id).single(),
    ]);
    if (s.error) return toast(s.error.message, true);
    staff = s.data; chairs = c.data || [];
    if (h) shopHours = h.data?.opening_hours || [];
    BBdash.$('staff-list').innerHTML = staff.length ? staff.map(m => `
      <div class="row-item${m.is_active ? '' : ' off'}">
        <i class="dot" style="background:${esc(m.color_code)}"></i>
        <div><span>${esc(shown(m))}${m.display_name && m.display_name !== m.first_name ? ` <span class="small">(${esc(m.first_name)} ${esc(m.last_name || '')})</span>` : ''}</span>
          <span class="small">${esc(m.role)} · ${m.availability ? 'Own hours' : 'Shop hours'}${m.pin_code ? ' · PIN set' : ''}${m.is_active ? '' : ' · inactive'}</span></div>
        <button class="btn btn-sm ghost" data-edit="${m.id}">Edit</button>
      </div>`).join('') : '<p class="small">No barbers yet.</p>';
    loadPunches();
  }

  async function loadPunches() {
    const now = new Date();
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    const { data, error } = await db.from('BBapp-punches').select('*').eq('shop_id', shop.id)
      .gte('clock_in', monday.toISOString()).order('clock_in', { ascending: false });
    if (error) return toast(error.message, true);
    const open = data.filter(p => !p.clock_out);
    const t = d => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    BBdash.$('on-shift').innerHTML = open.length
      ? open.map(p => `<div class="row-item"><div><span>${esc(p.employee_name)}</span><span class="small">since ${t(p.clock_in)}</span></div><span class="tag seated">On shift</span></div>`).join('')
      : '<p class="small">Nobody is clocked in.</p>';
    // Hours this week per person; an open punch counts up to now.
    const totals = {};
    for (const p of data) {
      const mins = ((p.clock_out ? new Date(p.clock_out) : now) - new Date(p.clock_in)) / 60000;
      totals[p.employee_name] = (totals[p.employee_name] || 0) + mins;
    }
    BBdash.$('hours').innerHTML = Object.keys(totals).length
      ? Object.entries(totals).map(([n, m]) => `<div class="row-item"><div><span>${esc(n)}</span></div><b>${hm(m)}</b></div>`).join('')
      : '<p class="small">No hours recorded this week.</p>';
  }

  panel.querySelector('#clock').onsubmit = async e => {
    e.preventDefault();
    const pin = e.target.pin.value.trim();
    const { data, error } = await db.rpc('bbapp_clock', { p_shop: shop.id, p_pin: pin });
    e.target.reset();
    if (error) return toast(error.message, true);
    const r = data[0];
    toast(`${r.employee_name} clocked ${r.action} at ${new Date(r.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`);
    loadPunches();
  };

  // Availability editor uses the same 7-day shape as opening hours (one window a day).
  function availabilityRows(av) {
    const src = av || shopHours;
    return DAYS.map(d => {
      const day = src.find(x => x.dayOfWeek === d) || { isOpen: false, timeSlots: [] };
      const w = day.timeSlots[0] || { startTime: '09:00', endTime: '18:00' };
      return `<div class="av-row" data-day="${d}">
        <label class="check"><input type="checkbox" ${day.isOpen ? 'checked' : ''}> ${d[0].toUpperCase() + d.slice(1, 3)}</label>
        <input type="time" step="900" value="${w.startTime}" aria-label="${d} start">
        <span>–</span>
        <input type="time" step="900" value="${w.endTime}" aria-label="${d} end">
      </div>`;
    }).join('');
  }

  function readAvailability(sheet) {
    return [...sheet.querySelectorAll('.av-row')].map(r => {
      const [on, start, end] = r.querySelectorAll('input');
      return { dayOfWeek: r.dataset.day, isOpen: on.checked, timeSlots: on.checked ? [{ name: 'Shift', startTime: start.value, endTime: end.value }] : [] };
    });
  }

  function edit(m = { is_active: true, color_code: '#012169', role: 'Barber' }) {
    const chair = chairs.find(c => c.staff_id === m.id);
    const sheet = BBdash.sheet(`
      <h3>${m.id ? 'Edit barber' : 'New barber'}</h3>
      <form id="staff-form" class="stack">
        <div class="inline">
          <label>First name<input name="first_name" required value="${esc(m.first_name || '')}" autocomplete="off"></label>
          <label>Last name<input name="last_name" value="${esc(m.last_name || '')}" autocomplete="off"></label>
        </div>
        <label>Display name (shown to clients)<input name="display_name" value="${esc(m.display_name || '')}" placeholder="e.g. Tommy Blades"></label>
        <div class="inline">
          <label>Role<select name="role">${['Barber', 'Senior barber', 'Apprentice', 'Manager'].map(r => `<option ${m.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
          <label>Colour<input name="color_code" type="color" value="${esc(m.color_code)}"></label>
          <label>Commission %<input name="commission_pct" type="number" min="0" max="100" step="0.5" value="${m.commission_pct ?? ''}" placeholder="e.g. 50"></label>
          <label>Clock-in PIN<input name="pin_code" inputmode="numeric" pattern="\\d{4,6}" maxlength="6" value="${esc(m.pin_code || '')}" placeholder="4–6 digits" autocomplete="off"></label>
        </div>
        <div class="inline">
          <label>Mobile<input name="phone" type="tel" value="${esc(m.phone || '')}"></label>
          <label>Email<input name="email" type="email" value="${esc(m.email || '')}"></label>
        </div>
        <fieldset>
          <legend>Availability</legend>
          <label class="check"><input type="checkbox" name="follow" ${m.availability ? '' : 'checked'}> Same as shop opening hours</label>
          <div id="av" ${m.availability ? '' : 'hidden'}>${availabilityRows(m.availability)}</div>
        </fieldset>
        <label class="check"><input type="checkbox" name="is_active" ${m.is_active ? 'checked' : ''}> Active (takes bookings)</label>
        <p class="small">${chair ? `Works from ${esc(chair.name)}.` : 'A chair will be added for this barber.'}</p>
        <button class="btn" type="submit">Save</button>
      </form>`);
    sheet.querySelector('[name=follow]').onchange = e => { sheet.querySelector('#av').hidden = e.target.checked; };
    sheet.querySelector('#staff-form').onsubmit = async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const row = {
        first_name: f.get('first_name').trim(), last_name: f.get('last_name').trim() || null,
        display_name: f.get('display_name').trim() || null, role: f.get('role'), color_code: f.get('color_code'),
        pin_code: f.get('pin_code').trim() || null, phone: f.get('phone').trim() || null, email: f.get('email').trim() || null,
        availability: f.get('follow') === 'on' ? null : readAvailability(sheet), is_active: f.get('is_active') === 'on',
        commission_pct: f.get('commission_pct') === '' ? null : Number(f.get('commission_pct')),
      };
      const res = m.id
        ? await db.from('BBapp-staff').update(row).eq('id', m.id).select().single()
        : await db.from('BBapp-staff').insert({ ...row, shop_id: shop.id }).select().single();
      if (res.error) return toast(res.error.code === '23505' ? 'Another barber already uses that PIN.' : res.error.message, true);
      if (chair) await db.from('BBapp-chairs').update({ active: row.is_active, barber_name: shown(res.data) }).eq('id', chair.id);
      else {
        // Reuse a free chair before adding a new one.
        const free = chairs.find(c => !c.staff_id);
        if (free) await db.from('BBapp-chairs').update({ staff_id: res.data.id, barber_name: shown(res.data), active: row.is_active }).eq('id', free.id);
        else await db.from('BBapp-chairs').insert({ shop_id: shop.id, name: `Chair ${chairs.length + 1}`, staff_id: res.data.id, barber_name: shown(res.data), active: row.is_active });
      }
      BBdash.closeSheet(); toast('Barber saved'); load();
      BBdash.reloadCalendar?.();
    };
  }

  panel.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'new-staff') edit();
    if (b.dataset.edit) edit(staff.find(s => s.id === b.dataset.edit));
  };

  load();
});
