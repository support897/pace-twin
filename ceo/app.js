/* Pace Calendar CEO — aggregates only. Every number below comes
   from a count/sum query or an owner-readable counter — this app
   never fetches a user's state, a name, or an email. Access rests
   on the _owner/config pin alone: the probe count either answers
   (owner) or is denied (everyone else), and the room only exists
   behind an answered probe. */
(function () {
  "use strict";
  var FB = window.PaceFB;
  var $ = function (id) { return document.getElementById(id); };
  function msg(t) { $("doorMsg").textContent = t; }
  function iso(d) { return d.toISOString(); }
  function weekStart(offset) { var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - d.getDay() - 7 * offset); return d; }

  function enter() {
    return FB.fsCount("aggSignups", []).then(function () {
      $("door").hidden = true; $("room").hidden = false;
      renderAll();
    }).catch(function () {
      msg("That account is not the owner of this room. Nothing here opens for anyone else.");
      FB.signOut();
    });
  }
  function signIn() {
    var email = $("email").value.trim(), pw = $("pass").value;
    if (!email || !pw) { msg("Add the owner email and password."); return; }
    msg("Signing in…");
    FB.emailSignIn(email, pw).then(enter).catch(function (e) { msg(e.message); });
  }
  $("signIn").addEventListener("click", signIn);
  $("googleBtn").addEventListener("click", function () {
    var cid = window.PACE_FB_CONFIG && window.PACE_FB_CONFIG.googleClientId;
    if (!cid) { msg("Google is not switched on yet — email + password works."); return; }
    var go = function () {
      window.google.accounts.id.initialize({
        client_id: cid,
        callback: function (resp) { FB.googleSignIn(resp.credential).then(enter).catch(function (e) { msg(e.message); }); },
      });
      window.google.accounts.id.prompt();
    };
    if (window.google && window.google.accounts) go();
    else { var sc = document.createElement("script"); sc.src = "https://accounts.google.com/gsi/client"; sc.onload = go; sc.onerror = function () { msg("Google did not load."); }; document.head.appendChild(sc); }
  });
  $("signOut").addEventListener("click", function () { FB.signOut(); location.reload(); });
  document.querySelectorAll("#nav button").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll("#nav button").forEach(function (x) { x.classList.toggle("is-on", x === b); });
      document.querySelectorAll("[data-panel]").forEach(function (s) { s.hidden = s.getAttribute("data-panel") !== b.getAttribute("data-sec"); });
    });
  });

  function set(id, v) { var e = $(id); if (e) e.textContent = v; }
  function money(cents) { return "$" + (cents / 100).toFixed(2); }
  function renderAll() {
    // Overview + People
    FB.fsCount("aggSignups", []).then(function (n) { set("ovJoined", n); set("pTotal", n); });
    FB.fsCount("aggSignups", [{ field: "createdAt", op: "GREATER_THAN_OR_EQUAL", value: iso(weekStart(0)) }]).then(function (n) { set("pWeek", n); });
    FB.fsCount("aggSignups", [{ field: "activatedAt", op: "GREATER_THAN", value: "1970-01-01T00:00:00.000Z" }]).then(function (a) {
      set("pAct", a);
      FB.fsCount("aggSignups", []).then(function (t) { if (t) $("pActNote").textContent += " Currently: " + a + " of " + t + " signups have activated (" + Math.round(100 * a / t) + "%)."; });
    });
    var series = $("weekSeries"); series.innerHTML = "";
    var chain = Promise.resolve();
    var rows = [];
    for (var w = 7; w >= 0; w--) {
      (function (w) {
        chain = chain.then(function () {
          return FB.fsCount("aggSignups", [
            { field: "createdAt", op: "GREATER_THAN_OR_EQUAL", value: iso(weekStart(w)) },
            { field: "createdAt", op: "LESS_THAN", value: iso(weekStart(w - 1)) },
          ]).then(function (n) { rows.push({ w: w, n: n }); });
        });
      })(w);
    }
    chain.then(function () {
      series.innerHTML = rows.map(function (r) {
        return '<div class="wk"><span>' + (r.w === 0 ? "This week" : r.w + (r.w === 1 ? " week ago" : " weeks ago")) + '</span><span>' + r.n + "</span></div>";
      }).join("");
    });
    // Money (R7 feed: this app's subscriptions only; dormant-honest until payments exist)
    var st = function (status) { return [{ field: "status", op: "EQUAL", value: status }]; };
    FB.fsCount("aggSubs", st("active")).then(function (n) { set("ovMoney", n); set("mPaying", n); });
    FB.fsCount("aggSubs", st("pending-cancel")).then(function (n) {
      set("mPending", n);
      FB.fsCount("aggSubs", st("ended")).then(function (e) { set("mEnded", e); set("ovLeaving", n + e); });
    });
    FB.fsSum("aggSubs", "amountCents", st("active")).then(function (c) { set("mMrr", money(c)); });
    FB.fsList("aggSubs").then(function (subs) {
      var reasons = subs.filter(function (s) { return s.cancelReason; }).map(function (s) { return "Cancel reason: " + s.cancelReason; });
      if (reasons.length) $("mReasons").textContent = reasons.join(" · ");
    }).catch(function () {});
    // Reviews
    FB.fsCount("reviews", []).then(function (n) { set("rTotal", n); });
    FB.fsCount("reviews", [{ field: "replied", op: "EQUAL", value: false }]).then(function (n) { set("rOpen", n); });
    FB.fsList("reviews").then(function (rows) {
      if (!rows.length) { $("reviewList").innerHTML = '<p class="hint">No reviews yet — the inbox fills from the store feeds when they connect, or rows the desk adds by hand. Never fabricated.</p>'; return; }
      $("reviewList").innerHTML = rows.map(function (r) {
        return '<div class="item"><strong>' + (r.rating || "–") + "★ · " + (r.platform || "") + '</strong> ' + (r.title || "") + '<br><span class="hint">' + (r.body || "") + "</span></div>";
      }).join("");
    }).catch(function () {});
    // Outreach + Community
    FB.fsList("outreach").then(function (rows) {
      if (!rows.length) return;
      $("outreachBody").innerHTML = rows.map(function (c) { return '<div class="item"><strong>' + c.name + '</strong> — sent ' + (c.sent || 0) + ", replies " + (c.replies || 0) + ' <span class="hint">(' + (c.status || "") + ")</span></div>"; }).join("");
    }).catch(function () {});
    FB.fsList("groups").then(function (rows) {
      if (!rows.length) return;
      $("groupList").innerHTML = rows.map(function (g) { return '<div class="item"><strong>' + g.name + '</strong> — ' + (g.members || 0) + ' members · ' + (g.postsThisWeek || 0) + ' posts this week <span class="hint">(' + (g.source || "manual") + ")</span></div>"; }).join("");
    }).catch(function () {});
    // Avatars (contracts §4: a sale counts only when the payment record names the piece)
    fetch("avatars-feed.json").then(function (r) { return r.json(); }).then(function (pieces) {
      if (!Array.isArray(pieces) || !pieces.length) return;
      var byAvatar = {};
      pieces.forEach(function (pc) {
        var a = byAvatar[pc.presenterId] || (byAvatar[pc.presenterId] = { name: pc.presenterName, views: 0, sales: 0, cents: 0, flagged: 0 });
        var railsOk = pc.disclosure === "y" && pc.aiLabel === "y" && pc.metadataZero === "y";
        if (!railsOk) { a.flagged++; return; }
        a.views += pc.views || 0;
        if (typeof pc.salesCount === "number") { a.sales += pc.salesCount; a.cents += pc.salesAmountCents || 0; }
      });
      $("avatarList").innerHTML = Object.keys(byAvatar).map(function (k) {
        var a = byAvatar[k];
        return '<div class="item' + (a.flagged ? " flag" : "") + '"><strong>' + a.name + "</strong> — " + a.views + " views · " + a.sales + " sales (" + money(a.cents) + ")" + (a.flagged ? ' <span class="hint">' + a.flagged + " piece(s) missing a trust rail — excluded from shipped counts</span>" : "") + "</div>";
      }).join("");
    }).catch(function () {});
    // Your app: import tallies (counters only)
    FB.fsList("aggImports").then(function (rows) {
      set("aImporters", rows.length);
      set("aEvents", rows.reduce(function (a, r) { return a + (r.events || 0); }, 0));
    }).catch(function () { set("aImporters", 0); set("aEvents", 0); });
  }
  if (FB.configured && FB.session()) enter();
  else if (!FB.configured) msg("This room opens when the Pace project is wired at the console sitting.");
})();
