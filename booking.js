// BBapp booking engine — a port of Table Maestro (ios/lib/services/tmSlots.ts
// and findFreeTables in TableMaestroService.ts) with chairs in place of tables.
const cfg = window.BBAPP_CONFIG;
const db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toMin = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };

// TM semantics: strict `<` on window end, strict `>` against now + minAdvance.
function generateSlots(date, schedule, rules, now = new Date()) {
  const day = schedule.find(d => d.dayOfWeek === DAYS[date.getDay()]);
  if (!day || !day.isOpen) return [];
  const min = new Date(now.getTime() + rules.minAdvanceReservationHours * 3600e3);
  const slots = [];
  for (const w of day.timeSlots) {
    const [sh, sm] = w.startTime.split(':').map(Number);
    const [eh, em] = w.endTime.split(':').map(Number);
    let cur = new Date(date.getFullYear(), date.getMonth(), date.getDate(), sh, sm);
    const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), eh, em);
    while (cur < end) {
      if (cur > min) slots.push(`${pad(cur.getHours())}:${pad(cur.getMinutes())}`);
      cur = new Date(cur.getTime() + rules.timeSlotIntervalMinutes * 60e3);
    }
  }
  return slots;
}

// A chair is busy when an active booking on it overlaps [time, time + duration).
function findFreeChairs(chairs, busy, time, duration) {
  const start = toMin(time), end = start + duration;
  const busyIds = new Set(busy
    .filter(b => { const s = toMin(b.time); return s !== null && start < s + b.duration_minutes && end > s; })
    .map(b => b.chair_id));
  return chairs.filter(c => !busyIds.has(c.id));
}

// ---------------------------------------------------------------------------
// Postcode → coordinates (Kiosk: Google Geocoding, OS Places fallback), plus
// postcodes.io so the demo still works with no keys configured.
// ---------------------------------------------------------------------------
async function geocodePostcode(postcode) {
  const pc = encodeURIComponent(postcode);
  if (cfg.googleMapsApiKey) {
    const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${pc}&region=uk&key=${cfg.googleMapsApiKey}`);
    const loc = (await r.json()).results?.[0]?.geometry?.location;
    return loc ? { lat: loc.lat, lng: loc.lng } : null;
  }
  if (cfg.osPlacesApiKey) {
    const r = await fetch(`https://api.os.uk/search/places/v1/postcode?postcode=${pc}&output_srs=WGS84&key=${cfg.osPlacesApiKey}`);
    const dpa = (await r.json()).results?.[0]?.DPA;
    return dpa ? { lat: dpa.LAT, lng: dpa.LNG } : null;
  }
  const r = await fetch(`https://api.postcodes.io/postcodes/${pc}`);
  const res = (await r.json()).result;
  return res ? { lat: res.latitude, lng: res.longitude } : null;
}

const miles = (a, b) => {
  const rad = x => x * Math.PI / 180, R = 3958.8;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

async function nearestShops(postcode) {
  const here = await geocodePostcode(postcode);
  if (!here) throw new Error("We couldn't find that postcode.");
  const { data, error } = await db.from('BBapp-shops').select('*');
  if (error) throw error;
  return data.map(s => ({ ...s, miles: miles(here, s) })).sort((a, b) => a.miles - b.miles);
}

// ---------------------------------------------------------------------------
// Booking modal
// ---------------------------------------------------------------------------
const gbpFmt = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const state = {};

async function openBooking(shopId) {
  const [shop, settings, barbers, services, cats] = await Promise.all([
    db.from('BBapp-shops').select('*').eq('id', shopId).single(),
    db.from('BBapp-settings').select('*').eq('shop_id', shopId).single(),
    db.rpc('bbapp_public_barbers', { p_shop: shopId }),
    db.from('BBapp-services').select('*').eq('shop_id', shopId).eq('active', true).order('sort'),
    db.from('BBapp-service_categories').select('*').eq('shop_id', shopId).order('sort'),
  ]);
  // Each chair carries its barber (if any): id = chair id, as findFreeChairs expects.
  const chairs = barbers.data.map(b => ({ id: b.chair_id, staff_id: b.staff_id, name: b.name, availability: b.availability }));
  Object.assign(state, {
    shop: shop.data, rules: settings.data.booking_rules, schedule: settings.data.opening_hours,
    chairs, services: services.data, cats: cats.data || [], staffId: '', service: null, date: null, time: null,
  });
  BBtrack.event('booking_open', { shop_id: shopId });
  const named = [...new Map(chairs.filter(c => c.staff_id).map(c => [c.staff_id, c])).values()];
  const dates = [...Array(state.rules.bookingLeadTimeDays || 28).keys()].map(i => {
    const d = new Date(); d.setDate(d.getDate() + i); return d;
  });
  const m = document.getElementById('booking');
  m.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Book at ${esc(state.shop.name)}">
      <button class="close" aria-label="Close">×</button>
      <h3>${esc(state.shop.name)}</h3><p class="small">${esc(state.shop.address)}, ${esc(state.shop.postcode)}</p>
      <h4>1. Choose a service</h4>
      <div id="svc">${serviceMenu()}</div>
      ${named.length ? `<h4>2. Choose your barber</h4>
      <div class="chips" id="barber"><button data-staff="" class="on">Any barber</button>${named.map(c =>
        `<button data-staff="${c.staff_id}">${esc(c.name)}</button>`).join('')}</div>` : ''}
      <h4>${named.length ? 3 : 2}. Pick a day</h4>
      <div class="chips scroll" id="days">${dates.map(d =>
        `<button data-date="${isoDate(d)}">${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</button>`).join('')}</div>
      <h4>${named.length ? 4 : 3}. Pick a time</h4>
      <div class="chips" id="slots"><p class="small">Choose a service and day first.</p></div>
      <form id="guest" hidden>
        <h4>${named.length ? 5 : 4}. Your details</h4>
        <input name="name" placeholder="Full name" required autocomplete="name">
        <input name="email" type="email" placeholder="Email" required autocomplete="email">
        <input name="phone" type="tel" placeholder="Mobile (07…)" autocomplete="tel">
        <div id="prefs" class="prefs"></div>
        <label class="small">Anything else for this visit? (optional)
          <input name="notes" maxlength="300" placeholder="e.g. running 5 minutes late, bringing my son"></label>
        <button class="btn" type="submit">Confirm booking</button>
      </form>
      <p id="book-msg" role="status"></p>
    </div>`;
  m.hidden = false;
  m.querySelector('.close').onclick = () => { m.hidden = true; };
  m.querySelector('#svc').onclick = e => pick(e, 'svc', b => { state.service = state.services.find(s => s.id === b.dataset.id); });
  m.querySelector('#barber')?.addEventListener('click', e => pick(e, 'barber', b => { state.staffId = b.dataset.staff; }));
  m.querySelector('#days').onclick = e => pick(e, 'days', b => { state.date = b.dataset.date; });
  m.querySelector('#guest').onsubmit = submitBooking;
  const guest = m.querySelector('#guest');
  state.savedPrefs = null;
  renderPrefs();
  guest.email.addEventListener('change', lookupPrefs);
  guest.name.addEventListener('change', lookupPrefs);
}

// Standing preferences: new clients are asked once; returning clients see what
// they told us last time and choose to keep, change or remove it.
async function lookupPrefs() {
  const g = document.getElementById('guest');
  const email = g.email.value.trim(), name = g.name.value.trim();
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;
  const { data } = await db.rpc('bbapp_client_prefs', { p_shop: state.shop.id, p_email: email, p_name: name });
  state.savedPrefs = data?.[0]?.preferences || null;
  renderPrefs();
}

function renderPrefs() {
  const el = document.getElementById('prefs');
  if (!el) return;
  if (!state.savedPrefs) {
    el.innerHTML = `<label class="small">Any preferences or requests for your barber? We'll remember them for next time.
      <textarea name="preferences" rows="2" maxlength="500" placeholder="e.g. grade 2 on the sides, keep length on top, sensitive skin"></textarea></label>
      <input type="hidden" name="prefs_action" value="set">`;
    return;
  }
  el.innerHTML = `
    <p class="small"><b>Last time you told us:</b></p>
    <blockquote class="saved-prefs">${esc(state.savedPrefs)}</blockquote>
    <div class="chips" role="radiogroup" aria-label="Your preferences">
      <label class="chip-radio"><input type="radio" name="prefs_action" value="keep" checked> Keep these</label>
      <label class="chip-radio"><input type="radio" name="prefs_action" value="set"> Add or change</label>
      <label class="chip-radio"><input type="radio" name="prefs_action" value="clear"> Remove them</label>
    </div>
    <textarea name="preferences" rows="2" maxlength="500" hidden>${esc(state.savedPrefs)}</textarea>`;
  el.querySelectorAll('[name=prefs_action]').forEach(r => r.onchange = () => {
    el.querySelector('[name=preferences]').hidden = el.querySelector('[name=prefs_action]:checked').value !== 'set';
  });
}

// Services grouped as "Category › Subcategory", uncategorised last.
function serviceMenu() {
  const { cats, services } = state;
  const path = id => {
    const c = cats.find(x => x.id === id); if (!c) return null;
    const p = cats.find(x => x.id === c.parent_id);
    return p ? `${p.name} › ${c.name}` : c.name;
  };
  const order = cats.filter(c => !c.parent_id).flatMap(t => [t, ...cats.filter(k => k.parent_id === t.id)]).map(c => c.id);
  const groups = [...order, null].map(id => ({ label: id ? path(id) : (cats.length ? 'Other' : ''), list: services.filter(s => (s.category_id || null) === id) }))
    .filter(g => g.list.length);
  return groups.map(g => `${g.label ? `<p class="grp">${esc(g.label)}</p>` : ''}<div class="chips">${g.list.map(s =>
    `<button data-id="${s.id}">${esc(s.name)} · ${gbpFmt.format(s.price_pence / 100)} · ${s.duration_minutes} min</button>`).join('')}</div>`).join('');
}

// Chairs that can take this booking: the requested barber (or any), and only
// while that barber is working — their own availability, else shop hours.
function candidateChairs(date, time, duration) {
  const start = toMin(time), end = start + duration;
  return state.chairs.filter(c => {
    if (state.staffId && c.staff_id !== state.staffId) return false;
    const day = (c.availability || state.schedule).find(d => d.dayOfWeek === DAYS[date.getDay()]);
    return day?.isOpen && day.timeSlots.some(w => toMin(w.startTime) <= start && end <= toMin(w.endTime));
  });
}

function pick(e, groupId, apply) {
  const b = e.target.closest('button'); if (!b) return;
  document.querySelectorAll(`#${groupId} button`).forEach(x => x.classList.toggle('on', x === b));
  apply(b);
  if (groupId !== 'slots') renderSlots();
}

async function renderSlots() {
  const el = document.getElementById('slots');
  state.time = null; document.getElementById('guest').hidden = true;
  if (!state.service || !state.date) return;
  const [y, mo, d] = state.date.split('-').map(Number);
  const { data: busy, error } = await db.rpc('bbapp_busy', { p_shop: state.shop.id, p_date: state.date });
  if (error) { el.innerHTML = `<p class="small">${esc(error.message)}</p>`; return; }
  const day = new Date(y, mo - 1, d), dur = state.service.duration_minutes;
  const open = generateSlots(day, state.schedule, state.rules)
    .filter(t => findFreeChairs(candidateChairs(day, t, dur), busy, t, dur).length);
  el.innerHTML = (open.length
    ? open.map(t => `<button data-time="${t}">${t}</button>`).join('')
    : '<p class="small">No times left that day.</p>') +
    `<p class="wl-ask small">${open.length ? 'None of these suit?' : 'Would you like to go on the waitlist?'}
      <button type="button" class="linkish" id="wl-open">Join the waitlist for ${day.toLocaleDateString('en-GB', { weekday: 'long' })}</button> and we'll offer you the first spot that frees up.</p>`;
  document.getElementById('wl-open').onclick = e => { e.stopPropagation(); openWaitlist(); };
  el.onclick = e => pick(e, 'slots', b => { state.time = b.dataset.time; document.getElementById('guest').hidden = false;
    BBtrack.event('slot_select', { shop_id: state.shop.id }); });
}

// Waitlist: the client picks a time window on the chosen day; if a matching
// slot frees up (a cancellation or a "can't make it"), it's offered to them.
function openWaitlist() {
  const [y, mo, d] = state.date.split('-').map(Number);
  const dayName = DAYS[new Date(y, mo - 1, d).getDay()];
  const hours = (state.schedule.find(x => x.dayOfWeek === dayName)?.timeSlots || []);
  const s = hours.length ? Math.min(...hours.map(w => toMin(w.startTime))) : 540;
  const e = hours.length ? Math.max(...hours.map(w => toMin(w.endTime))) : 1080;
  const opts = sel => { let o = ''; for (let m = s; m <= e; m += 30) { const t = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; o += `<option ${t === sel ? 'selected' : ''}>${t}</option>`; } return o; };
  const fmt = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const g = document.getElementById('guest');
  const box = document.createElement('form');
  box.id = 'wl-form'; box.className = 'stack wl-form';
  box.innerHTML = `
    <h4>Join the waitlist</h4>
    <p class="small">${esc(state.service.name)}${state.staffId ? ' with ' + esc(state.chairs.find(c => c.staff_id === state.staffId)?.name || '') : ''} on ${new Date(y, mo - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
    <div class="inline"><label class="small">From<select name="from">${opts(fmt(s))}</select></label><label class="small">To<select name="to">${opts(fmt(e))}</select></label></div>
    <input name="name" placeholder="Full name" required autocomplete="name" value="${esc(g?.name.value || '')}">
    <input name="email" type="email" placeholder="Email" required autocomplete="email" value="${esc(g?.email.value || '')}">
    <input name="phone" type="tel" placeholder="Mobile (optional)" autocomplete="tel" value="${esc(g?.phone.value || '')}">
    <button class="btn">Add me to the waitlist</button>`;
  document.getElementById('wl-form')?.remove();
  document.getElementById('slots').after(box);
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  box.onsubmit = async ev => {
    ev.preventDefault();
    const f = new FormData(box);
    const { data: tok, error } = await db.rpc('bbapp_join_waitlist', {
      p_shop: state.shop.id, p_service: state.service.id, p_staff: state.staffId || null, p_date: state.date,
      p_from: f.get('from'), p_to: f.get('to'), p_name: f.get('name'), p_email: f.get('email'), p_phone: f.get('phone') || null,
    });
    if (error) { document.getElementById('book-msg').textContent = error.message; return; }
    try { localStorage.setItem('bbapp-my-token', tok); } catch {}
    document.querySelector('#booking .sheet').innerHTML = `
      <h3>You're on the waitlist 🕒</h3>
      <p>If a ${esc(state.service.name)} slot opens between ${f.get('from')} and ${f.get('to')}, we'll alert you on your My booking page — first to tap gets it.</p>
      <div class="inline"><a class="btn" href="my.html?t=${tok}">Open My booking</a>
      <button class="btn ghost" onclick="document.getElementById('booking').hidden=true">Done</button></div>`;
  };
}

async function submitBooking(e) {
  e.preventDefault();
  const f = new FormData(e.target), msg = document.getElementById('book-msg');
  const { data: busy } = await db.rpc('bbapp_busy', { p_shop: state.shop.id, p_date: state.date });
  const [yy, mm, dd] = state.date.split('-').map(Number);
  const dur = state.service.duration_minutes;
  const chair = findFreeChairs(candidateChairs(new Date(yy, mm - 1, dd), state.time, dur), busy || [], state.time, dur)[0];
  if (!chair) { msg.textContent = 'Sorry, that time has just gone.'; return renderSlots(); }
  const { data: bookingId, error } = await db.rpc('bbapp_create_booking', {
    p_shop: state.shop.id, p_chair: chair.id, p_service: state.service.id, p_date: state.date, p_time: state.time,
    p_name: f.get('name'), p_email: f.get('email'), p_phone: f.get('phone') || null,
    p_notes: f.get('notes') || null,
    p_preferences: f.get('preferences') || null,
    // A new client who leaves the box empty has nothing to save.
    p_prefs_action: f.get('prefs_action') === 'set' && !String(f.get('preferences') || '').trim() && !state.savedPrefs ? 'keep' : (f.get('prefs_action') || 'keep'),
  });
  if (error) { msg.textContent = error.message; return renderSlots(); }
  BBtrack.event('booking_complete', { shop_id: state.shop.id });
  // "We have your booking" email; fire and forget so a mail hiccup never blocks the booking.
  fetch(`${cfg.supabaseUrl}/functions/v1/bbapp-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: cfg.supabaseKey },
    body: JSON.stringify({ booking_id: bookingId, template_id: 'bookingReceived' }),
  }).catch(() => {});
  const [y, mo, d] = state.date.split('-').map(Number);
  const when = new Date(y, mo - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  document.querySelector('#booking .sheet').innerHTML =
    `<h3>You're booked in ✂️</h3><p>${esc(state.service.name)} with ${esc(chair.name || 'one of our barbers')} at ${esc(state.shop.name)}, ${when} at ${state.time}.</p>
     <p class="small">We'll send a reminder to your <a id="my-link" href="my.html">My booking</a> page 30 minutes before.</p>
     <p class="small">Want to pay now, add a product to collect, or leave a tip?</p>
     <div class="inline"><button class="btn" id="pay-cut">Pay now &amp; add products</button>
     <button class="btn ghost" onclick="document.getElementById('booking').hidden=true">Pay in the shop</button></div>`;
  db.rpc('bbapp_manage_token', { p_booking: bookingId }).then(({ data: tok }) => {
    if (!tok) return;
    try { localStorage.setItem('bbapp-my-token', tok); } catch {}
    const a = document.getElementById('my-link'); if (a) a.href = `my.html?t=${tok}`;
  });
  document.getElementById('pay-cut').onclick = () => window.BBapp.openShop?.(state.shop.id, {
    id: bookingId, service_name: state.service.name, price_pence: state.service.price_pence,
    guest_name: f.get('name'), guest_email: f.get('email'), guest_phone: f.get('phone') || '',
  });
}

window.BBapp = { db, geocodePostcode, nearestShops, openBooking };
