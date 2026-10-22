// Services tab: two-level categories (category › subcategory) and services
// you can add, edit, hide or remove.
BBdash.tab('services', panel => {
  const { db, esc, gbp, toast } = BBdash;
  const shop = BBdash.shop;
  let cats = [], services = [];

  panel.innerHTML = `
    <div class="cols-2">
      <section>
        <div class="dash-head"><h2>Categories</h2></div>
        <div id="cat-tree" class="list"></div>
        <form id="add-cat" class="inline">
          <input name="name" placeholder="New category" required>
          <select name="parent" aria-label="Put under"><option value="">Top level</option></select>
          <button class="btn btn-sm">Add</button>
        </form>
      </section>
      <section>
        <div class="dash-head"><h2>Services &amp; prices</h2><button class="btn btn-sm" id="new-svc">Add service</button></div>
        <div id="svc-list"></div>
      </section>
    </div>`;

  const tops = () => cats.filter(c => !c.parent_id);
  const kids = id => cats.filter(c => c.parent_id === id);
  const pathOf = id => {
    const c = cats.find(x => x.id === id); if (!c) return 'Uncategorised';
    const p = cats.find(x => x.id === c.parent_id);
    return p ? `${p.name} › ${c.name}` : c.name;
  };
  // Categories in menu order: each top-level category followed by its subcategories.
  const ordered = () => tops().flatMap(t => [t, ...kids(t.id)]);

  async function load() {
    const [c, s] = await Promise.all([
      db.from('BBapp-service_categories').select('*').eq('shop_id', shop.id).order('sort').order('name'),
      db.from('BBapp-services').select('*').eq('shop_id', shop.id).order('sort').order('name'),
    ]);
    if (c.error || s.error) return toast((c.error || s.error).message, true);
    cats = c.data; services = s.data;
    render();
  }

  function render() {
    BBdash.$('cat-tree').innerHTML = tops().length ? tops().map(t => `
      <div class="row-item"><div><span><b>${esc(t.name)}</b></span></div>
        <button class="btn btn-sm ghost" data-rename="${t.id}">Rename</button>
        <button class="btn btn-sm ghost" data-delcat="${t.id}">Delete</button></div>
      ${kids(t.id).map(k => `
      <div class="row-item sub"><div><span>↳ ${esc(k.name)}</span></div>
        <button class="btn btn-sm ghost" data-rename="${k.id}">Rename</button>
        <button class="btn btn-sm ghost" data-delcat="${k.id}">Delete</button></div>`).join('')}`).join('')
      : '<p class="small">No categories yet. Add one such as “Hair”, then a subcategory such as “Fades”.</p>';

    panel.querySelector('[name=parent]').innerHTML = '<option value="">Top level</option>' +
      tops().map(t => `<option value="${t.id}">Under ${esc(t.name)}</option>`).join('');

    const groups = [...ordered().map(c => ({ id: c.id, label: pathOf(c.id) })), { id: null, label: 'Uncategorised' }];
    BBdash.$('svc-list').innerHTML = groups.map(g => {
      const list = services.filter(s => (s.category_id || null) === g.id);
      if (!list.length) return '';
      return `<h4 class="grp">${esc(g.label)}</h4><div class="list">${list.map(s => `
        <div class="row-item${s.active ? '' : ' off'}">
          <div><span>${esc(s.name)}${s.active ? '' : ' <em class="small">(hidden)</em>'}</span>
            <span class="small">${s.duration_minutes} min${s.description ? ' · ' + esc(s.description) : ''}</span></div>
          <b>${gbp.format(s.price_pence / 100)}</b>
          <button class="btn btn-sm ghost" data-edit="${s.id}">Edit</button>
        </div>`).join('')}</div>`;
    }).join('') || '<p class="small">No services yet.</p>';
  }

  function editService(s = {}) {
    const opts = ordered().map(c => `<option value="${c.id}" ${s.category_id === c.id ? 'selected' : ''}>${esc(pathOf(c.id))}</option>`).join('');
    const sheet = BBdash.sheet(`
      <h3>${s.id ? 'Edit service' : 'New service'}</h3>
      <form id="svc-form" class="stack">
        <label>Name<input name="name" required value="${esc(s.name || '')}"></label>
        <label>Category<select name="category"><option value="">Uncategorised</option>${opts}</select></label>
        <div class="inline">
          <label>Price (£)<input name="price" type="number" step="0.50" min="0" required value="${s.price_pence != null ? (s.price_pence / 100).toFixed(2) : ''}"></label>
          <label>Minutes<input name="mins" type="number" step="5" min="5" required value="${s.duration_minutes || 30}"></label>
        </div>
        <label>Description (optional)<input name="description" value="${esc(s.description || '')}" placeholder="e.g. Includes hot towel"></label>
        <label class="check"><input type="checkbox" name="active" ${s.active === false ? '' : 'checked'}> Show on booking page</label>
        <div class="inline">
          <button class="btn" type="submit">Save</button>
          ${s.id ? '<button class="btn ghost" type="button" id="del-svc">Delete service</button>' : ''}
        </div>
      </form>`);
    sheet.querySelector('#svc-form').onsubmit = async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const row = {
        name: f.get('name').trim(), category_id: f.get('category') || null,
        price_pence: Math.round(Number(f.get('price')) * 100), duration_minutes: Number(f.get('mins')),
        description: f.get('description').trim() || null, active: f.get('active') === 'on',
      };
      const { error } = s.id
        ? await db.from('BBapp-services').update(row).eq('id', s.id)
        : await db.from('BBapp-services').insert({ ...row, shop_id: shop.id, sort: services.length + 1 });
      if (error) return toast(error.message, true);
      BBdash.closeSheet(); toast('Service saved'); load();
    };
    sheet.querySelector('#del-svc')?.addEventListener('click', async () => {
      if (!confirm(`Delete “${s.name}”? Past bookings keep their history.`)) return;
      const { error } = await db.from('BBapp-services').delete().eq('id', s.id);
      if (error) return toast(error.message, true);
      BBdash.closeSheet(); toast('Service deleted'); load();
    });
  }

  panel.onclick = async e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.id === 'new-svc') return editService();
    if (t.dataset.edit) return editService(services.find(s => s.id === t.dataset.edit));
    if (t.dataset.rename) {
      const c = cats.find(x => x.id === t.dataset.rename);
      const name = prompt('Rename category', c.name)?.trim();
      if (!name || name === c.name) return;
      const { error } = await db.from('BBapp-service_categories').update({ name }).eq('id', c.id);
      if (error) return toast(error.message, true);
      return load();
    }
    if (t.dataset.delcat) {
      const c = cats.find(x => x.id === t.dataset.delcat);
      const extra = !c.parent_id && kids(c.id).length ? ' and its subcategories' : '';
      if (!confirm(`Delete “${c.name}”${extra}? Its services become uncategorised.`)) return;
      const { error } = await db.from('BBapp-service_categories').delete().eq('id', c.id);
      if (error) return toast(error.message, true);
      return load();
    }
  };

  panel.querySelector('#add-cat').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const { error } = await db.from('BBapp-service_categories').insert({
      shop_id: shop.id, name: f.get('name').trim(), parent_id: f.get('parent') || null, sort: cats.length + 1,
    });
    if (error) return toast(error.message, true);
    e.target.reset(); load();
  };

  load();
});
