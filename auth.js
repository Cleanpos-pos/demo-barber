// Supabase Auth for shop owners: "Create my free site" signs up and creates
// the owner's BBapp shop; "Log in" signs in and goes to the dashboard.
(() => {
  const { db, geocodePostcode } = window.BBapp;
  const modal = document.getElementById('auth');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

  // Shop details are kept in user metadata so the shop can still be created
  // on first login when Supabase requires email confirmation before a session.
  async function ensureShop(user) {
    const pending = user.user_metadata?.bbapp_shop;
    if (!pending) return;
    const { error } = await db.rpc('bbapp_create_shop', {
      p_name: pending.name, p_postcode: pending.postcode, p_address: pending.address,
      p_lat: pending.lat, p_lng: pending.lng, p_phone: pending.phone || null,
    });
    if (error) throw error;
    await db.auth.updateUser({ data: { bbapp_shop: null } });
  }

  function open(mode) {
    const signup = mode === 'signup';
    modal.innerHTML = `
      <div class="sheet" role="dialog" aria-modal="true" aria-label="${signup ? 'Create your free site' : 'Log in'}">
        <button class="close" aria-label="Close">×</button>
        <h3>${signup ? 'Create your free site' : 'Welcome back'}</h3>
        <p class="small">${signup ? 'Free to start. No card needed.' : 'Log in to manage your shop and bookings.'}</p>
        <form id="auth-form" class="stack">
          ${signup ? `
          <input name="shop" placeholder="Shop name" required autocomplete="organization">
          <input name="address" placeholder="Street and town" autocomplete="street-address">
          <input name="postcode" placeholder="Postcode" required autocomplete="postal-code">
          <input name="phone" type="tel" placeholder="Shop phone (optional)" autocomplete="tel">` : ''}
          <input name="email" type="email" placeholder="Email" required autocomplete="email">
          <input name="password" type="password" placeholder="Password${signup ? ' (8+ characters)' : ''}" required minlength="${signup ? 8 : 1}" autocomplete="${signup ? 'new-password' : 'current-password'}">
          <button class="btn" type="submit">${signup ? 'Create my site' : 'Log in'}</button>
        </form>
        <p id="auth-msg" role="status"></p>
        <p class="small">${signup
          ? 'Already have an account? <a href="#" data-auth="login">Log in</a>'
          : 'New to BBapp? <a href="#" data-auth="signup">Create a free site</a> · <a href="#" id="forgot">Forgot password?</a>'}</p>
      </div>`;
    modal.hidden = false;
    modal.querySelector('.close').onclick = () => { modal.hidden = true; };
    modal.querySelector('#auth-form').onsubmit = e => (signup ? doSignup : doLogin)(e);
    modal.querySelector('#forgot')?.addEventListener('click', forgot);
  }

  const say = (text, ok) => {
    const m = document.getElementById('auth-msg');
    m.textContent = text; m.style.color = ok ? '#1c6b3a' : '';
  };
  const busy = (form, on) => { form.querySelector('button[type=submit]').disabled = on; };

  async function doSignup(e) {
    e.preventDefault();
    const form = e.target, f = new FormData(form);
    busy(form, true); say('Setting up your site…', true);
    try {
      const postcode = f.get('postcode').trim().toUpperCase();
      const loc = await geocodePostcode(postcode);
      if (!loc) throw new Error("We couldn't find that postcode.");
      const { data, error } = await db.auth.signUp({
        email: f.get('email').trim(), password: f.get('password'),
        options: {
          emailRedirectTo: `${location.origin}/dashboard.html`,
          data: { bbapp_shop: { name: f.get('shop').trim(), address: f.get('address').trim(), postcode, phone: f.get('phone').trim(), ...loc } },
        },
      });
      if (error) throw error;
      if (data.session) {
        await ensureShop(data.user);
        location.href = 'dashboard.html';
      } else {
        modal.querySelector('.sheet').innerHTML = `<h3>Check your inbox 📬</h3>
          <p>We've sent a confirmation link to <b>${esc(f.get('email'))}</b>. Click it and your site will be ready.</p>
          <button class="btn" onclick="document.getElementById('auth').hidden=true">OK</button>`;
      }
    } catch (err) { say(err.message); busy(form, false); }
  }

  async function doLogin(e) {
    e.preventDefault();
    const form = e.target, f = new FormData(form);
    busy(form, true); say('');
    const { data, error } = await db.auth.signInWithPassword({ email: f.get('email').trim(), password: f.get('password') });
    if (error) {
      say(error.message === 'Email not confirmed' ? 'Please confirm your email first — check your inbox.' : 'Wrong email or password.');
      return busy(form, false);
    }
    try { await ensureShop(data.user); } catch (err) { say(err.message); return busy(form, false); }
    location.href = 'dashboard.html';
  }

  async function forgot(e) {
    e.preventDefault();
    const email = modal.querySelector('[name=email]').value.trim();
    if (!email) return say('Enter your email above first.');
    const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/dashboard.html` });
    say(error ? error.message : 'If that email has an account, a reset link is on its way.', !error);
  }

  document.addEventListener('click', e => {
    const a = e.target.closest('[data-auth]');
    if (!a) return;
    e.preventDefault();
    open(a.dataset.auth);
  });

  // Signed-in owners see "Dashboard" instead of the sign-up buttons.
  db.auth.getSession().then(({ data }) => {
    const login = document.getElementById('nav-login'), start = document.getElementById('nav-start');
    if (!data.session || !login) return;
    login.removeAttribute('data-auth'); login.textContent = 'Dashboard'; login.href = 'dashboard.html';
    start.removeAttribute('data-auth'); start.textContent = 'Log out';
    start.onclick = async e => { e.preventDefault(); await db.auth.signOut(); location.reload(); };
  });

  window.BBapp.ensureShop = ensureShop;
})();
