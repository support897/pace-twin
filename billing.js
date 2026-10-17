// Pace billing layer — the seam the Paid Apps sitting switches on.
//
// GROUNDWORK (built 17 Oct 2026, behind Ilse's lock): while
// window.PACE_BILLING is null this layer is inert and every answer
// it gives is today's truth — Plus is not on sale and nothing in
// the app calls a purchase. The wiring the sitting activates:
//   1. Fill billing-config.js (public SDK keys + product ids).
//   2. The native bridge (RevenueCat) answers plusActive() for the
//      signed-in user; the bridge, not this file, holds the truth.
//   3. The CEO mirror (aggSubs/{uid}) is written by the payment
//      path only — the firestore rules deny client writes there
//      by design, so this layer never writes it.
//   4. Only then do the popup + Plans words flip from the future
//      tense to live copy, through Quality's copy gate + SR-G7.
(function () {
  "use strict";
  var cfg = window.PACE_BILLING || null;

  // The products of record (Finance's locked pricing, 15 Oct):
  // A$4.99/mo · A$39.99/yr, first month free · A$99.99 lifetime.
  var PRODUCTS = { monthly: "pace_plus_monthly", yearly: "pace_plus_yearly", lifetime: "pace_plus_lifetime" };
  var ENTITLEMENT = "plus";

  function billingLive() { return !!cfg; }

  // Until the bridge is wired, Plus is not active for anyone and
  // the honest line stands. The sitting replaces the body of this
  // function with the bridge call; callers never change.
  function plusActive() { return false; }

  // The price words the Plans surface speaks today. When the layer
  // goes live these read from the store's own localised prices for
  // the user's storefront (never a desk-side conversion).
  function priceLine() { return "A$4.99 a month, or A$39.99 a year. First month free."; }

  window.PaceBilling = { live: billingLive, plusActive: plusActive, priceLine: priceLine, products: PRODUCTS, entitlement: ENTITLEMENT };
})();
