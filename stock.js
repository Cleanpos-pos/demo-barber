// Stock tab: levels against each product's reorder point, restock / stock
// count / waste with a reason, and the full movement history. Every change
// goes through bbapp_adjust_stock, so the history always explains the count.
BBdash.tab('stock', panel => {
  const { db, esc, gbp, toast } = BBdash;
  const shop = BBdash.shop;
  const DEFAULT_IMG = window.BBAPP_CONFIG.defaultProductImage;
  const REASON = { sale: 'Sold', restock: 'Restocked', adjust: 'Stock count', waste: 'Waste / damaged', return: 'Returned', cancelled_order: 'Order cancelled' };
  let products = [];

  panel.innerHTML = `
    <div id="low-banner"></div>
    <div class="dash-head"><h2>Stock levels</h2><span class="small" id="stock-value"></span></div>
    <div id="stock-list" class="list"></div>
    <p class="small">Untracked products (no stock number) are left out. Set a stock number, cost and reorder level in Shop → Edit.</p>
    <h2>Stock history</h2>
    <div id="moves" class="list"></div>`;

  const status = p => p.stock === 0 ? ['Out of stock', 'cancelled'] : p.stock <= p.low_stock_threshold ? ['Low — reorder', 'pending'] : ['OK', 'completed'];

  async function load() {
    const [{ data: prods, error }, { data: moves }] = await Promise.all([
      db.from('BBapp-products').select('*').eq('shop_id', shop.id).not('stock', 'is', null).order('name'),
      db.from('BBapp-stock_movements').select('*, product:"BBapp-products"(name)').eq('shop_id', shop.id).order('created_at', { ascending: false }).limit(60),
    ]);
    if (error) return toast(error.message, true);
    products = prods;
    const low = prods.filter(p => p.stock <= p.low_stock_threshold);
    BBdash.$('low-banner').innerHTML = low.length
      ? `<div class="banner warn-banner"><b>${low.length} product${low.length > 1 ? 's' : ''} to reorder:</b> ${low.map(p => `${esc(p.name)} (${p.stock} left)`).join(', ')}</div>` : '';
    const cost = prods.reduce((t, p) => t + p.stock * (p.cost_pence ?? 0), 0);
    BBdash.$('stock-value').textContent = `Value at cost ${gbp.format(cost / 100)}`;
    BBdash.$('stock-list').innerHTML = prods.length ? prods.map(p => {
      const [label, cls] = status(p);
      return `<div class="row-item">
        <img class="thumb" src="${esc(p.image_url || DEFAULT_IMG)}" alt="" onerror="this.onerror=null;this.src='${DEFAULT_IMG}'">
        <div><span>${esc(p.name)}${p.sku ? ` <span class="small">· ${esc(p.sku)}</span>` : ''}</span>
          <span class="small">${p.supplier ? esc(p.supplier) + ' · ' : ''}reorder at ${p.low_stock_threshold}${p.cost_pence != null ? ` · cost ${gbp.format(p.cost_pence / 100)}` : ''}</span></div>
        <b class="stock-n">${p.stock}</b><span class="tag ${cls}">${label}</span>
        <button class="btn btn-sm" data-act="restock" data-id="${p.id}">Restock</button>
        <button class="btn btn-sm ghost" data-act="adjust" data-id="${p.id}">Count</button>
        <button class="btn btn-sm ghost" data-act="waste" data-id="${p.id}">Waste</button>
      </div>`;
    }).join('') : '<p class="small">No tracked stock yet.</p>';
    BBdash.$('moves').innerHTML = (moves || []).length ? moves.map(m => `
      <div class="row-item"><div><span>${esc(m.product?.name || 'Deleted product')} · ${REASON[m.reason]}</span>
        <span class="small">${new Date(m.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${m.note ? ' · ' + esc(m.note) : ''}</span></div>
        <b class="${m.change < 0 ? 'warn' : 'good'}">${m.change > 0 ? '+' : ''}${m.change}</b><span class="small">→ ${m.stock_after ?? '–'}</span></div>`).join('')
      : '<p class="small">No stock changes yet.</p>';
  }

  function act(kind, p) {
    const title = { restock: `Restock ${p.name}`, adjust: `Stock count · ${p.name}`, waste: `Waste / damaged · ${p.name}` }[kind];
    const sheet = BBdash.sheet(`
      <h3>${esc(title)}</h3><p class="small">Currently ${p.stock} in stock.</p>
      <form class="stack" id="stock-form">
        <label>${kind === 'adjust' ? 'Actual number on the shelf' : kind === 'restock' ? 'How many arrived' : 'How many to write off'}
          <input name="n" type="number" min="${kind === 'adjust' ? 0 : 1}" step="1" required inputmode="numeric"></label>
        <label>Note (optional)<input name="note" placeholder="${kind === 'restock' ? 'e.g. invoice 1042' : kind === 'waste' ? 'e.g. dropped, out of date' : 'e.g. monthly count'}"></label>
        <button class="btn">Save</button>
      </form>`);
    sheet.querySelector('#stock-form').onsubmit = async e => {
      e.preventDefault();
      const n = Number(e.target.n.value), note = e.target.note.value.trim() || null;
      const args = kind === 'adjust'
        ? { p_product: p.id, p_change: 0, p_reason: 'adjust', p_note: note, p_set_to: n }
        : { p_product: p.id, p_change: kind === 'waste' ? -n : n, p_reason: kind, p_note: note };
      const { data, error } = await db.rpc('bbapp_adjust_stock', args);
      if (error) return toast(error.message, true);
      BBdash.closeSheet(); toast(`${p.name}: now ${data} in stock`); load();
    };
  }

  panel.onclick = e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    act(b.dataset.act, products.find(p => p.id === b.dataset.id));
  };

  BBdash.reloadStock = load;
  load();
});
