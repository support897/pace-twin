// Pace billing config — the Paid Apps sitting fills this in.
//
// Until then it stays null and the whole billing layer is inert:
// the app reads exactly as it does today (Plus exists, is described
// truthfully, and is not on sale). No keys live in this chat or in
// any message; the sitting pastes the two public SDK keys here.
//
// Shape when filled:
// window.PACE_BILLING = {
//   revenueCatIosKey: "appl_...",
//   revenueCatAndroidKey: "goog_...",
//   entitlement: "plus",
//   products: { monthly: "pace_plus_monthly", yearly: "pace_plus_yearly", lifetime: "pace_plus_lifetime" }
// };
window.PACE_BILLING = null;
