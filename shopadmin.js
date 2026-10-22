// Shop tab: retail products (price, stock, photo, show/hide) and orders,
// including tips and whether the order was paid with a cut.
BBdash.tab('shop', panel => {
  const { db, esc, gbp, toast } = BBdash;
  const shop = BBdash.shop;
  const DEFAULT_IMG = window.BBAPP_CONFIG.defaultProductImage;
  let products = [];

  // Shrinks a photo to at most 800px as a JPEG, then stores it in the shop's
  // own folder of the bbapp-products bucket and returns its public URL.
  async function uploadImage(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Please choose a JPEG, PNG or WebP photo.');
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 800 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.85));
    const path = `${shop.id}/${crypto.randomUUID()}.jpg`;
    const { error } = await db.storage.from('bbapp-products').upload(path, blob, { contentType: 'image/jpeg' });
    if (error) throw new Error(`Upload failed: ${error.message}`);
    return db.storage.from('bbapp-products').getPublicUrl(path).data.publicUrl;
  }

  panel.innerHTML = `
    <div class="cols-2">
      <section>
        <div class="dash-head"><h2>Products</h2><button class="btn btn-sm" id="new-prod">Add product</button></div>
        <div id="prod-list" class="list"></div>
      </section>
      <section>
        <div class="dash-head"><h2>Orders</h2><span id="tips-total" class="small"></span></div>
        <div id="order-list" class="list"></div>
      </section>
    </div>`;

  async function loadProducts() {
    const { data, error } = await db.from('BBapp-products').select('*').eq('shop_id', shop.id).order('sort').order('name');
    if (error) return toast(error.message, true);
    products = data;
    BBdash.$('prod-list').innerHTML = data.length ? data.map(p => `
      <div class="row-item${p.active ? '' : ' off'}">
        <img class="thumb" src="${esc(p.image_url || DEFAULT_IMG)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${DEFAULT_IMG}'">
        <div><span>${esc(p.name)}${p.active ? '' : ' <em class="small">(hidden)</em>'}</span>
          <span class="small">${p.stock == null ? 'No stock limit' : p.stock === 0 ? 'Sold out' : `${p.stock} in stock`}</span></div>
        <b>${gbp.format(p.price_pence / 100)}</b>
        <button class="btn btn-sm ghost" data-edit="${p.id}">Edit</button>
      </div>`).join('') : '<p class="small">No products yet. Add the things you sell over the counter.</p>';
  }

  async function loadOrders() {
    const { data, error } = await db.from('BBapp-orders').select('*').eq('shop_id', shop.id).order('created_at', { ascending: false }).limit(50);
    if (error) return toast(error.message, true);
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const tips = data.filter(o => o.status !== 'cancelled' && new Date(o.created_at) >= monthStart).reduce((t, o) => t + o.tip_pence, 0);
    BBdash.$('tips-total').textContent = `Tips this month: ${gbp.format(tips / 100)}`;
    BBdash.$('order-list').innerHTML = data.length ? data.map(o => `
      <div class="row-item">
        <div><span>${esc(o.customer_name)} · ${o.with_cut ? 'with cut' : 'products only'}</span>
          <span class="small">${o.items.map(i => `${i.qty}× ${esc(i.name)}`).join(', ')}${o.tip_pence ? ` · tip ${gbp.format(o.tip_pence / 100)}` : ''}</span>
          <span class="small">${new Date(o.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${o.pay_method === 'online' ? 'Paying online' : 'Pay in shop'}</span></div>
        <b>${gbp.format(o.total_pence / 100)}</b>
        <span class="tag ${o.status}">${o.status}</span>
        ${o.status === 'pending' ? `<button class="btn btn-sm ghost" data-order="${o.id}" data-to="paid">Mark paid</button>` : ''}
        ${o.status === 'paid' || (o.status === 'pending' && !o.with_cut) ? `<button class="btn btn-sm ghost" data-order="${o.id}" data-to="collected">Collected</button>` : ''}
        ${o.status === 'pending' ? `<button class="btn btn-sm ghost" data-order="${o.id}" data-to="cancelled">Cancel</button>` : ''}
      </div>`).join('') : '<p class="small">No orders yet.</p>';
  }

  function edit(p = { active: true }) {
    const sheet = BBdash.sheet(`
      <h3>${p.id ? 'Edit product' : 'New product'}</h3>
      <form class="stack" id="prod-form">
        <label>Name<input name="name" required value="${esc(p.name || '')}" placeholder="e.g. Matte clay"></label>
        <label>Description<input name="description" value="${esc(p.description || '')}" placeholder="e.g. Strong hold, no shine. 75 ml."></label>
        <div class="inline">
          <label>Price (£)<input name="price" type="number" step="0.01" min="0" required value="${p.price_pence != null ? (p.price_pence / 100).toFixed(2) : ''}"></label>
          <label>Stock (blank = no limit)<input name="stock" type="number" min="0" step="1" value="${p.stock ?? ''}"></label>
        </div>
        <fieldset class="img-pick">
          <legend>Photo</legend>
          <img id="img-prev" src="${esc(p.image_url || DEFAULT_IMG)}" alt="" onerror="this.src='${DEFAULT_IMG}'">
          <div class="stack">
            <label class="btn btn-sm ghost file-btn">Upload a photo<input type="file" id="img-file" accept="image/jpeg,image/png,image/webp" hidden></label>
            <label>or paste an image link<input name="image_url" type="text" inputmode="url" value="${esc(p.image_url || '')}" placeholder="https://…"></label>
            <button type="button" class="btn btn-sm ghost" id="img-default">Use default photo</button>
            <span class="small" id="img-status">${p.image_url ? '' : 'Using the default photo.'}</span>
          </div>
        </fieldset>
        <label class="check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Show in the online shop</label>
        <div class="inline"><button class="btn">Save</button>
          ${p.id ? '<button type="button" class="btn ghost" id="del-prod">Delete</button>' : ''}</div>
      </form>`);
    const prev = sheet.querySelector('#img-prev'), urlIn = sheet.querySelector('[name=image_url]'), status = sheet.querySelector('#img-status');
    urlIn.oninput = () => { prev.src = urlIn.value.trim() || DEFAULT_IMG; status.textContent = urlIn.value.trim() ? '' : 'Using the default photo.'; };
    sheet.querySelector('#img-default').onclick = () => { urlIn.value = ''; urlIn.oninput(); };
    sheet.querySelector('#img-file').onchange = async e => {
      const file = e.target.files[0]; if (!file) return;
      const save = sheet.querySelector('#prod-form button[type=submit], #prod-form .btn:not(.ghost)');
      save.disabled = true; status.textContent = 'Uploading…';
      try {
        urlIn.value = await uploadImage(file);
        urlIn.oninput(); status.textContent = 'Photo uploaded.';
      } catch (err) { status.textContent = err.message; }
      save.disabled = false; e.target.value = '';
    };
    sheet.querySelector('#prod-form').onsubmit = async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const row = {
        name: f.get('name').trim(), description: f.get('description').trim() || null,
        price_pence: Math.round(Number(f.get('price')) * 100),
        stock: f.get('stock') === '' ? null : Number(f.get('stock')),
        image_url: f.get('image_url').trim() || null, active: f.get('active') === 'on',
      };
      const { error } = p.id
        ? await db.from('BBapp-products').update(row).eq('id', p.id)
        : await db.from('BBapp-products').insert({ ...row, shop_id: shop.id, sort: products.length + 1 });
      if (error) return toast(error.message, true);
      BBdash.closeSheet(); toast('Product saved'); loadProducts();
    };
    sheet.querySelector('#del-prod')?.addEventListener('click', async () => {
      if (!confirm(`Delete “${p.name}”? Past orders keep their details.`)) return;
      const { error } = await db.from('BBapp-products').delete().eq('id', p.id);
      if (error) return toast(error.message, true);
      BBdash.closeSheet(); loadProducts();
    });
  }

  panel.onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'new-prod') return edit();
    if (b.dataset.edit) return edit(products.find(p => p.id === b.dataset.edit));
    if (b.dataset.order) {
      const patch = { status: b.dataset.to, ...(b.dataset.to === 'paid' ? { paid_at: new Date().toISOString() } : {}) };
      const { error } = await db.from('BBapp-orders').update(patch).eq('id', b.dataset.order);
      if (error) return toast(error.message, true);
      loadOrders();
    }
  };

  loadProducts(); loadOrders();
});
