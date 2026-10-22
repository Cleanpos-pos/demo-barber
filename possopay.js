// PossoPay client — mirrors ios/lib/services/PossoPayService.ts: one edge
// function, POST {action, tenant_id, ...params}, errors as {error, message}.
(() => {
  const cfg = window.BBAPP_CONFIG;
  const TERMS_VERSION = '2026-09';

  const MESSAGES = {
    unknown_tenant: "This shop isn't registered with Posso Pay yet. Start sign-up or enter a claim code.",
    onboarding_step_failed: "That step couldn't be saved. Check the details and try again.",
    not_configured: 'Posso Pay is not configured on this site yet (missing possoPayAnonKey in config.js).',
  };

  async function call(action, tenantId, params = {}) {
    if (!cfg.possoPayUrl || !cfg.possoPayAnonKey) throw new Error(MESSAGES.not_configured);
    let res, body;
    try {
      res = await fetch(cfg.possoPayUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.possoPayAnonKey}`, apikey: cfg.possoPayAnonKey },
        body: JSON.stringify({ action, tenant_id: tenantId, ...params }),
      });
      body = await res.json().catch(() => ({}));
    } catch {
      throw new Error("Couldn't reach Posso Pay. Check your connection.");
    }
    if (!res.ok || body?.error) {
      const code = body?.error || `http_${res.status}`;
      const err = new Error(MESSAGES[code] || body?.message || 'Posso Pay request failed');
      err.code = code;
      throw err;
    }
    return body;
  }

  window.PossoPay = {
    TERMS_VERSION,
    isConfigured: () => Boolean(cfg.possoPayUrl && cfg.possoPayAnonKey),
    getTenantStatus: t => call('get_tenant_status', t),
    bootstrapOnboarding: (t, p) => call('bootstrap_onboarding', t, { payment_provider: 'ryft', ...p }),
    linkExisting: (t, claimCode) => call('link_existing', t, { claim_code: claimCode }),
    getOnboarding: t => call('get_onboarding', t),
    updateOnboardingDetails: (t, details) => call('update_onboarding_details', t, details),
    addOnboardingPerson: (t, person) => call('add_onboarding_person', t, person),
    uploadOnboardingDocument: (t, doc) => call('upload_onboarding_document', t, doc),
    updatePayoutMethod: (t, bank) => call('update_payout_method', t, bank),
    acceptOnboardingTerms: t => call('accept_onboarding_terms', t, { agreement_version: TERMS_VERSION }),
    syncOnboarding: t => call('sync_onboarding', t),
    // Online checkout, as in ios/lib/online/possoPayOnlineCheckout.ts
    createOnlinePaymentIntent: (t, p) => call('create_online_payment_intent', t, { currency: 'GBP', ...p }),
  };
})();
