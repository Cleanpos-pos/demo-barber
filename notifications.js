// Shop notifications bell: waitlist offers and refills, clients confirming or
// cancelling from their reminder. Live via Supabase realtime.
(() => {
  const { db, esc, toast } = BBdash;
  let items = [];

  const ago = t => { const m = Math.round((Date.now() - new Date(t)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(t).toLocaleDateString('en-GB'); };

  function badge() {
    const n = items.filter(i => i.status === 'unread').length;
    const el = BBdash.$('bell-n');
    el.hidden = !n; el.textContent = n > 9 ? '9+' : n;
  }

  async function load() {
    const { data } = await db.from('BBapp-notifications').select('*').eq('shop_id', BBdash.shop.id).eq('audience', 'shop')
      .order('created_at', { ascending: false }).limit(40);
    items = data || []; badge();
  }

  function open() {
    BBdash.sheet(`<h3>Notifications</h3><div class="list">${items.map(n => `
      <div class="row-item note ${n.status}"><div><span>${esc(n.title)}</span><span class="small">${esc(n.body || '')}</span></div>
        <span class="small">${ago(n.created_at)}</span></div>`).join('') || '<p class="small">Nothing yet.</p>'}</div>`);
    const unread = items.filter(i => i.status === 'unread').map(i => i.id);
    if (unread.length) {
      db.from('BBapp-notifications').update({ status: 'read' }).in('id', unread).then(() => {
        items.forEach(i => { if (i.status === 'unread') i.status = 'read'; }); badge();
      });
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    BBdash.$('bell').onclick = () => {
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
      open();
    };
    // Wait for the shell to load the shop.
    const t = setInterval(() => {
      if (!BBdash.shop) return;
      clearInterval(t);
      load();
      db.channel(`bbapp-notes-${BBdash.shop.id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'BBapp-notifications', filter: `shop_id=eq.${BBdash.shop.id}` }, ({ new: n }) => {
          if (n.audience !== 'shop') return;
          items.unshift(n); badge(); toast(`🔔 ${n.title}: ${n.body || ''}`);
          if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
            try { new Notification(n.title, { body: n.body || '', tag: n.id }); } catch {}
          }
          BBdash.reloadCalendar?.();
        })
        .subscribe();
    }, 200);
  });
})();
