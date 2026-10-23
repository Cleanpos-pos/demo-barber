// Visitor analytics, stored in BBapp-visits and shown on the dashboard's
// Reports > Visitors tab. UK GDPR/PECR: the visitor id is only created and
// nothing is sent until the visitor accepts on the cookie banner. Events fired
// before that are held in memory and sent if they accept; dropped on reject.
// Only an anonymous id, the event name, shop and page path are stored.
(() => {
  const cfg = window.BBAPP_CONFIG;
  let queue = [];

  const consent = () => { try { return localStorage.getItem('consent'); } catch { return null; } };
  function visitorId() {
    try {
      let v = localStorage.getItem('bbapp-visitor');
      if (!v) { v = crypto.randomUUID(); localStorage.setItem('bbapp-visitor', v); }
      return v;
    } catch { return null; }
  }

  function send(rows) {
    const visitor = visitorId(); if (!visitor || !rows.length) return;
    fetch(`${cfg.supabaseUrl}/rest/v1/BBapp-visits`, {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', apikey: cfg.supabaseKey, Prefer: 'return=minimal' },
      body: JSON.stringify(rows.map(r => ({ ...r, visitor }))),
    }).catch(() => {});
  }

  window.BBtrack = {
    event(event, { shop_id = null } = {}) {
      const row = { event, shop_id, page: location.pathname.slice(0, 100) };
      const c = consent();
      if (c === 'accept') send([row]);
      else if (!c) queue.push(row);
    },
    // The cookie banner calls this with 'accept' or 'reject'.
    consent(choice) { if (choice === 'accept') send(queue); queue = []; },
  };

  const shop = new URLSearchParams(location.search).get('shop');
  BBtrack.event('page_view', { shop_id: /^[0-9a-f-]{36}$/i.test(shop || '') ? shop : null });
})();
