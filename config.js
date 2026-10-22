// Public, browser-safe values only. The publishable key is gated by RLS.
window.BBAPP_CONFIG = {
  supabaseUrl: 'https://mjxmdimsktbydteepfym.supabase.co',
  supabaseKey: 'sb_publishable_szSnZtv1OJd7UpCcZos9dA_ze7u8qup',
  // Same Geocoding API as Kiosk's handleAddressLookup. Restrict this key to
  // your domain (HTTP referrer) in Google Cloud Console.
  googleMapsApiKey: '',
  // Kiosk's fallback when no Google key is set.
  osPlacesApiKey: '',
  // PossoPay edge function (same endpoint as ios PossoPayService.ts) and the
  // anon key of the project that hosts it. BBapp shop ids are sent as tenant_id.
  possoPayUrl: 'https://nfscekqqsbbwysttugbl.supabase.co/functions/v1/possopay-payment',
  possoPayAnonKey: '',
  // Shown for any shop product without its own photo.
  defaultProductImage: 'img/products/default.jpg',
};
