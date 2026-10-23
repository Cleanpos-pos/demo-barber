// Payments tab (Posso Pay sign-up, online card payments, pay by link) and
// Integrations tab (email, Teya, Dojo, HubRise, Voipay). Processor settings use
// Kiosk's store_settings.payment_processors shape, saved per shop.
(() => {
  const { db, esc, gbp, toast } = BBdash;
  let settings = null;

  async function loadSettings() {
    const shop = BBdash.shop;
    const { data } = await db.from('BBapp-payment_settings').select('*').eq('shop_id', shop.id).maybeSingle();
    settings = data || { shop_id: shop.id, payment_processors: {}, integrations: {} };
    return settings;
  }
  // Saves straight away (no Save button), like CardPaymentProcessorsForm.
  async function saveSettings(patch) {
    Object.assign(settings, patch, { updated_at: new Date().toISOString() });
    const { error } = await db.from('BBapp-payment_settings').upsert(settings);
    if (error) toast(error.message, true); else toast('Saved');
  }
  const pp = () => settings.payment_processors || {};

  // ---------------------------------------------------------------- Payments
  BBdash.tab('payments', async panel => {
    const shop = BBdash.shop;
    await loadSettings();
    panel.innerHTML = `
      <div class="cols-2">
        <section class="card">
          <h2>Posso Pay</h2>
          <div id="pp-status"><p class="small">Checking…</p></div>
          <label class="check"><input type="checkbox" id="pp-online" ${pp().online?.provider === 'possopay' ? 'checked' : ''}> Take card payments online with Posso Pay (pay links and online deposits)</label>
        </section>
        <section class="card">
          <div class="dash-head"><h2>Pay by link</h2><button class="btn btn-sm" id="new-link">New pay link</button></div>
          <p class="small">Send a client a secure link to pay by card — for deposits, no-show fees or paying ahead.</p>
          <div id="links" class="list"></div>
        </section>
      </div>`;

    BBdash.$('pp-online').onchange = e => saveSettings({
      payment_processors: { ...pp(), online: { provider: e.target.checked ? 'possopay' : 'none', card_enabled: e.target.checked } },
    });
    BBdash.$('new-link').onclick = () => BBdash.createPayLink({});
    renderPossoPay();
    loadLinks();

    async function renderPossoPay() {
      const el = BBdash.$('pp-status');
      if (!PossoPay.isConfigured()) {
        el.innerHTML = `<p class="small">Posso Pay isn't switched on for this site yet. Once it is, you can sign up here in a few minutes: business details, owners, ID, bank account.</p>
          <button class="btn" disabled>Sign up for Posso Pay</button>`;
        return;
      }
      try {
        const s = await PossoPay.getTenantStatus(shop.id);
        if (s.linked) {
          await saveSettings({ payment_processors: { ...pp(), possopay: { ...(pp().possopay || {}), connected: true } } });
          const steps = (s.steps || []).map(st => `<li class="${esc(st.status)}">${esc(st.label || st.key || st.id)}</li>`).join('');
          el.innerHTML = `<p><span class="tag ${s.merchant?.kyc_complete ? 'completed' : 'pending'}">${esc(s.state || 'linked')}</span>
            ${esc(s.merchant?.display_name || '')}</p>${steps ? `<ul class="steps">${steps}</ul>` : ''}
            ${s.merchant?.kyc_complete ? '' : '<button class="btn btn-sm" id="pp-continue">Continue sign-up</button>'}`;
          BBdash.$('pp-continue')?.addEventListener('click', () => wizard(shop));
          return;
        }
      } catch (err) {
        if (err.code !== 'unknown_tenant') { el.innerHTML = `<p class="small">${esc(err.message)}</p>`; return; }
      }
      el.innerHTML = `<p class="small">Accept cards in the shop and online, with next-day payouts to your UK bank account.</p>
        <div class="inline"><button class="btn" id="pp-signup">Sign up for Posso Pay</button>
        <button class="btn ghost" id="pp-claim">I have a claim code</button></div>`;
      BBdash.$('pp-signup').onclick = () => wizard(shop);
      BBdash.$('pp-claim').onclick = async () => {
        const code = prompt('Enter your Posso Pay claim code')?.trim();
        if (!code) return;
        try { await PossoPay.linkExisting(shop.id, code); toast('Posso Pay linked'); renderPossoPay(); }
        catch (err) { toast(err.message, true); }
      };
    }

    // Steps follow ios PossoPayOnboardingWizard: Business, People (skipped for
    // sole traders), Documents, Bank, Submit.
    function wizard(shop) {
      const STEPS = ['Business', 'People', 'Documents', 'Bank', 'Submit'];
      let step = 0, soleTrader = false;
      const sheet = BBdash.sheet('<div id="wiz"></div>');
      const wiz = sheet.querySelector('#wiz');
      const fields = {
        Business: `
          <label>Trading name<input name="company_name" required value="${esc(shop.name)}"></label>
          <label class="check"><input type="checkbox" name="sole_trader"> I'm a sole trader</label>
          <label>Company number (Companies House)<input name="company_number" pattern="[A-Za-z0-9]{8}" placeholder="e.g. 01234567"></label>
          <label>Address<input name="address" required value="${esc(shop.address || '')}"></label>
          <div class="inline"><label>Town / city<input name="city" required></label>
          <label>Postcode<input name="postcode" required value="${esc(shop.postcode)}"></label></div>
          <div class="inline"><label>Email<input name="email" type="email" required value="${esc(shop.email || '')}"></label>
          <label>Phone<input name="phone" type="tel" required value="${esc(shop.phone || '')}"></label></div>`,
        People: `
          <p class="small">Add each director and anyone owning 25% or more.</p>
          <div class="inline"><label>First name<input name="first_name" required></label><label>Last name<input name="last_name" required></label></div>
          <div class="inline"><label>Date of birth<input name="dob" placeholder="DD/MM/YYYY" pattern="\\d{2}/\\d{2}/\\d{4}" required></label>
          <label>Email<input name="email" type="email" required></label></div>
          <label>Role<select name="role"><option value="Director">Director</option><option value="UltimateBeneficialOwner">Owner (25%+)</option><option value="BusinessContact">Business contact</option></select></label>`,
        Documents: `
          <label>Document<select name="document_type"><option value="Passport">Passport</option><option value="DriversLicense">UK driving licence</option>
            <option value="UtilityBill">Utility bill</option><option value="BankStatement">Bank statement</option>
            <option value="BusinessRegistration">Certificate of incorporation</option></select></label>
          <label>File (photo or PDF, up to 8 MB)<input name="file" type="file" accept="image/*,application/pdf" required></label>`,
        Bank: `
          <label>Account holder name<input name="account_holder_name" required></label>
          <div class="inline"><label>Sort code<input name="sort_code" inputmode="numeric" pattern="\\d{2}-?\\d{2}-?\\d{2}" placeholder="00-00-00" required></label>
          <label>Account number<input name="account_number" inputmode="numeric" pattern="\\d{8}" maxlength="8" required></label></div>`,
        Submit: `
          <p>By submitting you agree to the Posso Pay merchant terms (version ${PossoPay.TERMS_VERSION}) and confirm the details are correct.</p>
          <label class="check"><input type="checkbox" name="agree" required> I agree</label>`,
      };
      const draw = () => {
        const name = STEPS[step];
        wiz.innerHTML = `
          <h3>Sign up for Posso Pay</h3>
          <ol class="wiz-steps">${STEPS.map((s, i) => `<li class="${i === step ? 'on' : i < step ? 'done' : ''}">${s}</li>`).join('')}</ol>
          <form class="stack">${fields[name]}
            <div class="inline">${name === 'People' ? '<button type="button" class="btn ghost" data-more>Save &amp; add another</button>' : ''}
            <button class="btn" type="submit">${name === 'Submit' ? 'Submit for review' : 'Save & continue'}</button></div>
          </form>`;
        const form = wiz.querySelector('form');
        form.onsubmit = e => { e.preventDefault(); save(name, form, false); };
        wiz.querySelector('[data-more]')?.addEventListener('click', () => form.reportValidity() && save(name, form, true));
      };
      const toBase64 = file => new Promise((ok, bad) => {
        const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = bad; r.readAsDataURL(file);
      });
      async function save(name, form, again) {
        const f = new FormData(form);
        const btns = form.querySelectorAll('button'); btns.forEach(b => { b.disabled = true; });
        try {
          if (name === 'Business') {
            soleTrader = f.get('sole_trader') === 'on';
            await PossoPay.bootstrapOnboarding(shop.id, { company_name: f.get('company_name'), contact_email: f.get('email') });
            await PossoPay.updateOnboardingDetails(shop.id, {
              business_data: {
                trading_name: f.get('company_name'), company_number: f.get('company_number') || null, business_type: soleTrader ? 'sole_trader' : 'limited_company',
                address: f.get('address'), city: f.get('city'), postcode: f.get('postcode').toUpperCase(), email: f.get('email'), phone: f.get('phone'), country: 'GB',
              },
            });
          } else if (name === 'People') {
            await PossoPay.addOnboardingPerson(shop.id, {
              first_name: f.get('first_name'), last_name: f.get('last_name'), date_of_birth: f.get('dob'), email: f.get('email'), roles: [f.get('role')],
            });
            if (again) { toast('Person added'); form.reset(); btns.forEach(b => { b.disabled = false; }); return; }
          } else if (name === 'Documents') {
            const file = f.get('file');
            if (file.size > 8 * 1024 * 1024) throw new Error('That file is over 8 MB.');
            await PossoPay.uploadOnboardingDocument(shop.id, {
              document_type: f.get('document_type'), file_name: file.name, content_type: file.type, content_base64: await toBase64(file),
            });
          } else if (name === 'Bank') {
            await PossoPay.updatePayoutMethod(shop.id, {
              account_holder_name: f.get('account_holder_name'), sort_code: f.get('sort_code').replace(/-/g, ''), account_number: f.get('account_number'), currency: 'GBP', country: 'GB',
            });
          } else {
            await PossoPay.acceptOnboardingTerms(shop.id);
            await PossoPay.syncOnboarding(shop.id);
            BBdash.closeSheet(); toast("Submitted. Posso Pay will review your details — usually within a day."); return renderPossoPay();
          }
          step += 1;
          if (STEPS[step] === 'People' && soleTrader) step += 1;
          draw();
        } catch (err) { toast(err.message, true); btns.forEach(b => { b.disabled = false; }); }
      }
      draw();
    }

    async function loadLinks() {
      const { data, error } = await db.from('BBapp-pay_links').select('*').eq('shop_id', shop.id).order('created_at', { ascending: false }).limit(30);
      if (error) return toast(error.message, true);
      BBdash.$('links').innerHTML = data.length ? data.map(l => `
        <div class="row-item"><div><span>${esc(l.description)}</span>
          <span class="small">${esc(l.customer_name || 'No name')} · ${new Date(l.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span></div>
          <b>${gbp.format(l.amount_pence / 100)}</b><span class="tag ${l.status === 'paid' ? 'completed' : l.status}">${l.status}</span>
          ${l.status === 'pending' ? `<button class="btn btn-sm ghost" data-share="${l.id}">Share</button><button class="btn btn-sm ghost" data-cancel="${l.id}">Cancel</button>` : ''}
        </div>`).join('') : '<p class="small">No pay links yet.</p>';
      BBdash.$('links').onclick = async e => {
        const share = e.target.closest('[data-share]')?.dataset.share;
        if (share) return shareSheet(data.find(l => l.id === share));
        const cancel = e.target.closest('[data-cancel]')?.dataset.cancel;
        if (cancel && confirm('Cancel this pay link? The client will no longer be able to pay it.')) {
          await db.from('BBapp-pay_links').update({ status: 'cancelled' }).eq('id', cancel); loadLinks();
        }
      };
    }
    BBdash.reloadLinks = loadLinks;
  });

  const linkUrl = id => `${location.origin}${location.pathname.replace(/[^/]*$/, '')}pay.html?id=${id}`;

  function shareSheet(l) {
    const url = linkUrl(l.id);
    const text = `Hi${l.customer_name ? ' ' + l.customer_name.split(' ')[0] : ''}, here's your secure link to pay ${gbp.format(l.amount_pence / 100)} to ${BBdash.shop.name}: ${url}`;
    const phone = (l.customer_phone || '').replace(/\D/g, '').replace(/^0/, '44');
    const sheet = BBdash.sheet(`
      <h3>Send pay link</h3>
      <p>${esc(l.description)} · <b>${gbp.format(l.amount_pence / 100)}</b></p>
      <input class="link-box" readonly value="${esc(url)}" aria-label="Pay link">
      <div class="chips">
        ${l.customer_phone ? '<button data-sms>Send text now</button>' : ''}
        <button data-copy>Copy link</button>
        <a class="chip" href="https://wa.me/${phone}?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">WhatsApp</a>
        <a class="chip" href="sms:${esc(l.customer_phone || '')}?&body=${encodeURIComponent(text)}">Text message</a>
        <a class="chip" href="mailto:${esc(l.customer_email || '')}?subject=${encodeURIComponent('Pay ' + BBdash.shop.name)}&body=${encodeURIComponent(text)}">Email</a>
      </div>`);
    const smsBtn = sheet.querySelector('[data-sms]');
    if (smsBtn) smsBtn.onclick = async () => {
      smsBtn.disabled = true;
      const r = await BBdash.callFn('bbapp-sms', { pay_link_id: l.id, kind: 'payLink' });
      smsBtn.disabled = false;
      if (r.smsSent) return toast(`Text sent to ${l.customer_phone}`);
      toast({ sms_not_configured: 'Texts are not set up yet (Plivo)', no_phone: 'That phone number does not look right' }[r.smsError] || 'Text failed to send', true);
    };
    sheet.querySelector('[data-copy]').onclick = async () => {
      try { await navigator.clipboard.writeText(url); toast('Link copied'); }
      catch { sheet.querySelector('.link-box').select(); toast('Press Ctrl+C to copy'); }
    };
  }

  // Also used by the calendar's "Send pay link" button on a booking.
  BBdash.createPayLink = prefill => {
    if (!settings) loadSettings();
    const sheet = BBdash.sheet(`
      <h3>New pay link</h3>
      <form class="stack" id="link-form">
        <div class="inline"><label>Amount (£)<input name="amount" type="number" min="0.30" step="0.01" required value="${prefill.amount_pence ? (prefill.amount_pence / 100).toFixed(2) : ''}"></label>
        <label>What for<input name="description" required value="${esc(prefill.description || '')}" placeholder="e.g. Deposit for Saturday"></label></div>
        <label>Client name<input name="customer_name" value="${esc(prefill.customer_name || '')}"></label>
        <div class="inline"><label>Mobile<input name="customer_phone" type="tel" value="${esc(prefill.customer_phone || '')}"></label>
        <label>Email<input name="customer_email" type="email" value="${esc(prefill.customer_email || '')}"></label></div>
        <button class="btn" type="submit">Create link</button>
      </form>`);
    sheet.querySelector('#link-form').onsubmit = async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const { data, error } = await db.from('BBapp-pay_links').insert({
        shop_id: BBdash.shop.id, booking_id: prefill.booking_id || null,
        amount_pence: Math.round(Number(f.get('amount')) * 100), description: f.get('description').trim(),
        customer_name: f.get('customer_name').trim() || null, customer_phone: f.get('customer_phone').trim() || null,
        customer_email: f.get('customer_email').trim() || null, provider: 'possopay',
      }).select().single();
      if (error) return toast(error.message, true);
      BBdash.reloadLinks?.();
      shareSheet(data);
    };
  };

  // ------------------------------------------------------------ Integrations
  const EMAILS = {
    bookingReceived: { label: 'Booking received', subject: 'We have your booking request at {{shopName}}', body: 'Hi {{guestName}},\n\nThanks for booking with {{shopName}}. We have your request for:\n\n{{serviceName}} with {{barberName}}\n{{bookingDate}} at {{bookingTime}}\n\nWe will email you again once it is confirmed.\n{{#if notes}}\nYour notes: {{notes}}\n{{/if}}\nSee you soon,\n{{shopName}}\n{{shopAddress}}' },
    bookingAccepted: { label: 'Booking confirmed', subject: 'Your booking at {{shopName}} is confirmed', body: 'Hi {{guestName}},\n\nYou are booked in at {{shopName}}:\n\n{{serviceName}} with {{barberName}}\n{{bookingDate}} at {{bookingTime}}\n{{#if notes}}\nYour notes: {{notes}}\n{{/if}}\nIf you need to change or cancel, just reply to this email or call us on {{shopPhone}}.\n\nSee you soon,\n{{shopName}}\n{{shopAddress}}' },
    bookingMoved: { label: 'Booking moved', subject: 'Your booking at {{shopName}} has moved', body: 'Hi {{guestName}},\n\nAs requested, your booking at {{shopName}} has moved to:\n\n{{serviceName}} with {{barberName}}\n{{bookingDate}} at {{bookingTime}}\n\nAny problems, reply to this email or call {{shopPhone}}.\n\n{{shopName}}' },
    bookingCancelled: { label: 'Booking cancelled', subject: 'Your booking at {{shopName}} has been cancelled', body: 'Hi {{guestName}},\n\nYour booking for {{serviceName}} on {{bookingDate}} at {{bookingTime}} has been cancelled.\n\nYou can book again any time. Sorry for any inconvenience.\n\n{{shopName}}' },
  };
  const PLACEHOLDERS = ['{{manageLink}}', '{{guestName}}', '{{serviceName}}', '{{barberName}}', '{{bookingDate}}', '{{bookingTime}}', '{{shopName}}', '{{shopAddress}}', '{{shopPhone}}', '{{notes}}'];

  BBdash.tab('integrations', async panel => {
    const shop = BBdash.shop;
    if (!settings) await loadSettings();
    const ints = () => settings.integrations || {};
    const { data: custom } = await db.from('BBapp-email_templates').select('*').eq('shop_id', shop.id);
    const tpl = id => custom?.find(t => t.template_id === id) || EMAILS[id];

    panel.innerHTML = `
      <div class="cols-2">
        <section class="card">
          <h2>Booking emails</h2>
          <p class="small">Clients get an email when they book, when you confirm, move or cancel. Replies go to your shop email.</p>
          <form id="reply-to" class="inline"><input name="email" type="email" placeholder="Shop email for replies" value="${esc(shop.email || '')}" aria-label="Shop email"><button class="btn btn-sm">Save</button></form>
          <div class="list">${Object.entries(EMAILS).map(([id, t]) => `
            <div class="row-item"><div><span>${t.label}</span><span class="small">${esc(tpl(id).subject)}</span></div>
              <span class="tag ${custom?.some(c => c.template_id === id) ? 'confirmed' : ''}">${custom?.some(c => c.template_id === id) ? 'Custom' : 'Default'}</span>
              <button class="btn btn-sm ghost" data-tpl="${id}">Edit</button></div>`).join('')}</div>
        </section>
        <section class="card">
          <h2>Card terminals</h2>
          <p class="small">Posso Pay is set up under Payments. Already use another provider in the shop? Add it here.</p>
          <form class="stack" data-proc="teya">
            <label class="check"><input type="checkbox" name="enabled" ${pp().teya?.enabled ? 'checked' : ''}> <b>Teya</b></label>
            <input name="client_id" placeholder="Teya client ID" value="${esc(pp().teya?.client_id || '')}" autocomplete="off">
            <button class="btn btn-sm">Save Teya</button>
          </form>
          <form class="stack" data-proc="dojo">
            <label class="check"><input type="checkbox" name="enabled" ${pp().dojo?.enabled ? 'checked' : ''}> <b>Dojo</b></label>
            <input name="merchant_id" placeholder="Dojo merchant ID" value="${esc(pp().dojo?.merchant_id || '')}" autocomplete="off">
            <input name="api_key" type="password" placeholder="${pp().dojo?.api_key ? 'API key saved — enter to replace' : 'Dojo API key'}" autocomplete="off">
            <button class="btn btn-sm">Save Dojo</button>
          </form>
        </section>
        <section class="card">
          <h2>Channels</h2>
          ${[['hubrise', 'HubRise', 'Sync bookings and customers with your other systems.'], ['voipay', 'Voipay', 'Take bookings and payments over the phone.']].map(([k, n, d]) => `
          <form class="stack" data-int="${k}">
            <label class="check"><input type="checkbox" name="enabled" ${ints()[k]?.enabled ? 'checked' : ''}> <b>${n}</b></label>
            <span class="small">${d}</span>
            <input name="api_key" type="password" placeholder="${ints()[k]?.api_key ? 'Key saved — enter to replace' : `${n} API key`}" autocomplete="off">
            <button class="btn btn-sm">Save ${n}</button>
          </form>`).join('')}
        </section>
      </div>`;

    panel.querySelector('#reply-to').onsubmit = async e => {
      e.preventDefault();
      const email = e.target.email.value.trim() || null;
      const { error } = await db.from('BBapp-shops').update({ email }).eq('id', shop.id);
      if (error) return toast(error.message, true);
      shop.email = email; toast('Saved');
    };

    panel.querySelectorAll('[data-proc]').forEach(form => form.onsubmit = e => {
      e.preventDefault();
      const k = form.dataset.proc, f = new FormData(form), prev = pp()[k] || {};
      const next = { ...prev, enabled: f.get('enabled') === 'on' };
      for (const [name, v] of f.entries()) if (name !== 'enabled' && String(v).trim()) next[name] = String(v).trim();
      saveSettings({ payment_processors: { ...pp(), [k]: next } });
      form.querySelector('[name=api_key]')?.value && (form.querySelector('[name=api_key]').value = '');
    });

    panel.querySelectorAll('[data-int]').forEach(form => form.onsubmit = e => {
      e.preventDefault();
      const k = form.dataset.int, f = new FormData(form), prev = ints()[k] || {};
      const next = { ...prev, enabled: f.get('enabled') === 'on' };
      if (f.get('api_key').trim()) next.api_key = f.get('api_key').trim();
      saveSettings({ integrations: { ...ints(), [k]: next } });
      form.api_key.value = '';
    });

    panel.onclick = e => {
      const id = e.target.closest('[data-tpl]')?.dataset.tpl; if (!id) return;
      const t = tpl(id);
      const sheet = BBdash.sheet(`
        <h3>${EMAILS[id].label} email</h3>
        <form class="stack" id="tpl-form">
          <label>Subject<input name="subject" required value="${esc(t.subject)}"></label>
          <label>Message<textarea name="body" rows="12" required>${esc(t.body)}</textarea></label>
          <p class="small">You can use: ${PLACEHOLDERS.join(' ')}. Wrap optional lines in {{#if notes}}…{{/if}}.</p>
          <div class="inline"><button class="btn">Save</button><button type="button" class="btn ghost" id="tpl-reset">Reset to default</button></div>
        </form>`);
      sheet.querySelector('#tpl-form').onsubmit = async ev => {
        ev.preventDefault();
        const f = new FormData(ev.target);
        const { error } = await db.from('BBapp-email_templates').upsert({ shop_id: shop.id, template_id: id, subject: f.get('subject'), body: f.get('body'), updated_at: new Date().toISOString() });
        if (error) return toast(error.message, true);
        BBdash.closeSheet(); toast('Email saved'); reRender();
      };
      sheet.querySelector('#tpl-reset').onclick = async () => {
        await db.from('BBapp-email_templates').delete().eq('shop_id', shop.id).eq('template_id', id);
        BBdash.closeSheet(); toast('Back to the default'); reRender();
      };
    };
    const reRender = () => { BBdash.retab('integrations'); };
  });
})();
