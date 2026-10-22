// Owner dashboard shell. Every read/write is limited to the owner's shop by RLS.
// Each tab script registers itself with BBdash.tab(name, render).
(() => {
  const { db, ensureShop } = window.BBapp;
  const $ = id => document.getElementById(id);
  const tabs = {};

  const ctx = window.BBdash = {
    db, $,
    esc: s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`),
    gbp: new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }),
    pad: n => String(n).padStart(2, '0'),
    isoDate: d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    toMin: t => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; },
    fromMin: m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`,
    shop: null,
    tab(name, render) { tabs[name] = { render, done: false }; },
    retab(name) { if (tabs[name]) { tabs[name].done = false; show(name); } },
    toast(text, bad) {
      const t = $('toast'); t.textContent = text; t.className = bad ? 'bad' : ''; t.hidden = false;
      clearTimeout(t._h); t._h = setTimeout(() => { t.hidden = true; }, 3500);
    },
    sheet(html) {
      const m = $('sheet');
      m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><button class="close" aria-label="Close">×</button>${html}</div>`;
      m.hidden = false;
      m.querySelector('.close').onclick = () => { m.hidden = true; };
      return m.querySelector('.sheet');
    },
    closeSheet() { $('sheet').hidden = true; },
    // Guest email via the bbapp-email edge function (Brevo), signed as the owner.
    async sendEmail(bookingId, templateId) {
      const { data: { session } } = await db.auth.getSession();
      try {
        const res = await fetch(`${window.BBAPP_CONFIG.supabaseUrl}/functions/v1/bbapp-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: window.BBAPP_CONFIG.supabaseKey, Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({ booking_id: bookingId, template_id: templateId }),
        });
        return await res.json();
      } catch { return { emailSent: false, emailError: 'network' }; }
    },
    emailNote(r) {
      if (r?.emailSent) return ' · email sent';
      return { no_guest_email: ' · no email on file', email_not_configured: ' · email not set up yet' }[r?.emailError] || ' · email failed';
    },
  };

  function show(name) {
    document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === name));
    document.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== name; });
    const t = tabs[name];
    if (t && !t.done) { t.done = true; t.render(document.querySelector(`[data-panel="${name}"]`)); }
    try { localStorage.setItem('bbapp-tab', name); } catch {}
  }

  document.querySelector('.tabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); };

  window.addEventListener('DOMContentLoaded', async () => {
    // supabase-js picks up the session from an email-confirmation link itself.
    const { data: { session } } = await db.auth.getSession();
    if (!session) { location.href = 'index.html'; return; }
    $('who').textContent = session.user.email;
    $('logout').onclick = async e => { e.preventDefault(); await db.auth.signOut(); location.href = 'index.html'; };

    try { await ensureShop(session.user); } catch (err) { $('dash-msg').textContent = err.message; return; }
    const { data: shop } = await db.from('BBapp-shops').select('*').eq('owner_id', session.user.id).maybeSingle();
    if (!shop) { $('dash-msg').textContent = 'No shop found for this account.'; return; }
    ctx.shop = shop;

    $('shop-name').textContent = shop.name;
    $('shop-addr').textContent = [shop.address, shop.postcode].filter(Boolean).join(', ');
    $('dash-msg').hidden = true; $('dash').hidden = false;

    let first = 'calendar';
    try { first = localStorage.getItem('bbapp-tab') || first; } catch {}
    show(tabs[first] ? first : 'calendar');
  });
})();
