/* Pace — Firebase over plain REST (no SDK, no build step), per the
   multi-user design: the app talks to Identity Toolkit + Firestore
   with the signed-in user's own ID token. There is no master key in
   the client, ever; the Security Rules are the wall.

   Everything here is inert until window.PACE_FB_CONFIG carries a
   real apiKey (the console sitting fills firebase-config.js). */
(function () {
  "use strict";
  var cfg = window.PACE_FB_CONFIG || {};
  var configured = typeof cfg.apiKey === "string" && cfg.apiKey.length > 10 && typeof cfg.projectId === "string" && cfg.projectId.length > 2;
  var AUTH_KEY = "pace-auth-v1";
  var session = null; // { uid, email, idToken, refreshToken, expiresAt }
  try { session = JSON.parse(localStorage.getItem(AUTH_KEY) || "null"); } catch (e) { session = null; }
  if (session && (!session.uid || !session.refreshToken)) session = null;

  function saveSession() {
    try {
      if (session) localStorage.setItem(AUTH_KEY, JSON.stringify(session));
      else localStorage.removeItem(AUTH_KEY);
    } catch (e) { /* storage full/blocked: the session just won't persist */ }
  }
  var AUTH_HOST = cfg.restAuth || "https://identitytoolkit.googleapis.com";
  var FS_HOST = cfg.restFirestore || "https://firestore.googleapis.com";
  var TOKEN_HOST = cfg.restToken || "https://securetoken.googleapis.com";
  function idpUrl(name) { return AUTH_HOST + "/v1/accounts:" + name + "?key=" + cfg.apiKey; }
  function friendly(code) {
    var map = {
      EMAIL_EXISTS: "That email already has an account. Try signing in.",
      EMAIL_NOT_FOUND: "No account with that email yet. Create one first.",
      INVALID_PASSWORD: "That password does not match. Try again.",
      INVALID_LOGIN_CREDENTIALS: "Email or password does not match. Try again.",
      USER_DISABLED: "This account has been switched off.",
      WEAK_PASSWORD: "Password needs at least 6 characters.",
      INVALID_EMAIL: "That email address does not look right.",
      TOO_MANY_ATTEMPTS_TRY_LATER: "Too many tries. Wait a little, then try again.",
      OPERATION_NOT_ALLOWED: "That sign-in door is not open yet.",
      TOKEN_EXPIRED: "Your session has expired. Sign in again.",
      USER_TOKEN_EXPIRED: "Your session has expired. Sign in again.",
      INVALID_REFRESH_TOKEN: "Your session has expired. Sign in again.",
    };
    return map[code] || "Something did not work. Check your connection and try again.";
  }
  function authCall(name, body) {
    return fetch(idpUrl(name), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { var code = (res.j && res.j.error && res.j.error.message) || "UNKNOWN"; var e = new Error(friendly(code)); e.code = code; throw e; }
        return res.j;
      });
  }
  function adopt(j, emailHint) {
    session = {
      uid: j.localId, email: j.email || emailHint || "",
      idToken: j.idToken, refreshToken: j.refreshToken,
      expiresAt: Date.now() + (parseInt(j.expiresIn, 10) || 3600) * 1000,
    };
    saveSession();
    return session;
  }
  function refresh() {
    if (!session) return Promise.reject(new Error("Not signed in."));
    return fetch(TOKEN_HOST + "/v1/token?key=" + cfg.apiKey, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=refresh_token&refresh_token=" + encodeURIComponent(session.refreshToken),
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { session = null; saveSession(); var e = new Error(friendly("TOKEN_EXPIRED")); e.code = "TOKEN_EXPIRED"; throw e; }
        session.idToken = res.j.id_token; session.refreshToken = res.j.refresh_token || session.refreshToken;
        session.expiresAt = Date.now() + (parseInt(res.j.expires_in, 10) || 3600) * 1000;
        saveSession(); return session;
      });
  }
  function token() {
    if (!session) return Promise.reject(new Error("Not signed in."));
    if (Date.now() < session.expiresAt - 60000) return Promise.resolve(session.idToken);
    return refresh().then(function (s) { return s.idToken; });
  }
  /* ---- Firestore REST (typed values for the spine's known fields;
         the state payload travels as one JSON string field) ---- */
  function fsBase() { return FS_HOST + "/v1/projects/" + cfg.projectId + "/databases/(default)/documents/"; }
  function enc(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === "string") return { stringValue: v };
    if (typeof v === "boolean") return { booleanValue: v };
    if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (v instanceof Date) return { timestampValue: v.toISOString() };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
    var f = {}; Object.keys(v).forEach(function (k) { f[k] = enc(v[k]); });
    return { mapValue: { fields: f } };
  }
  function dec(v) {
    if (!v || typeof v !== "object") return null;
    if ("stringValue" in v) return v.stringValue;
    if ("booleanValue" in v) return v.booleanValue;
    if ("integerValue" in v) return parseInt(v.integerValue, 10);
    if ("doubleValue" in v) return v.doubleValue;
    if ("timestampValue" in v) return v.timestampValue;
    if ("nullValue" in v) return null;
    if ("arrayValue" in v) return ((v.arrayValue && v.arrayValue.values) || []).map(dec);
    if ("mapValue" in v) { var o = {}; var f = (v.mapValue && v.mapValue.fields) || {}; Object.keys(f).forEach(function (k) { o[k] = dec(f[k]); }); return o; }
    return null;
  }
  function fieldsOf(obj) { var f = {}; Object.keys(obj).forEach(function (k) { f[k] = enc(obj[k]); }); return f; }
  function docToObj(doc) {
    if (!doc || !doc.fields) return null;
    var o = {}; Object.keys(doc.fields).forEach(function (k) { o[k] = dec(doc.fields[k]); });
    return o;
  }
  function fsReq(method, path, bodyObj) {
    return token().then(function (tok) {
      var opts = { method: method, headers: { "Authorization": "Bearer " + tok, "Content-Type": "application/json" } };
      if (bodyObj) opts.body = JSON.stringify(bodyObj);
      return fetch(fsBase() + path, opts).then(function (r) {
        if (r.status === 404) return null;
        return r.json().then(function (j) {
          if (!r.ok) { var e = new Error((j.error && j.error.message) || "Firestore error"); e.status = r.status; throw e; }
          return j;
        });
      });
    });
  }
  var api = {
    configured: configured,
    session: function () { return session; },
    emailSignUp: function (email, pw) { return authCall("signUp", { email: email, password: pw, returnSecureToken: true }).then(function (j) { return adopt(j, email); }); },
    emailSignIn: function (email, pw) { return authCall("signInWithPassword", { email: email, password: pw, returnSecureToken: true }).then(function (j) { return adopt(j, email); }); },
    sendPasswordReset: function (email) { return authCall("sendOobCode", { requestType: "PASSWORD_RESET", email: email }); },
    googleSignIn: function (idToken, requestUri) {
      return authCall("signInWithIdp", {
        postBody: "id_token=" + encodeURIComponent(idToken) + "&providerId=google.com",
        requestUri: requestUri || location.origin, returnIdpCredential: true, returnSecureToken: true,
      }).then(function (j) { return adopt(j); });
    },
    appleSignIn: function (idToken, requestUri) {
      return authCall("signInWithIdp", {
        postBody: "id_token=" + encodeURIComponent(idToken) + "&providerId=apple.com",
        requestUri: requestUri || location.origin, returnIdpCredential: true, returnSecureToken: true,
      }).then(function (j) { return adopt(j); });
    },
    deleteAccount: function () { return token().then(function (tok) { return authCall("delete", { idToken: tok }); }).then(function () { session = null; saveSession(); }); },
    signOut: function () { session = null; saveSession(); },
    fsGet: function (path) { return fsReq("GET", path).then(docToObj); },
    fsSet: function (path, obj, mergeFields) {
      var url = path;
      if (mergeFields && mergeFields.length) url += "?" + mergeFields.map(function (f) { return "updateMask.fieldPaths=" + encodeURIComponent(f); }).join("&");
      return fsReq("PATCH", url, { fields: fieldsOf(obj) }).then(docToObj);
    },
    fsDelete: function (path) { return fsReq("DELETE", path).then(function () { return true; }); },
    /* List a collection's documents (used ONLY for owner-readable
       counter/feed collections — never for user state). */
    fsList: function (collectionPath) {
      return token().then(function (tok) {
        return fetch(fsBase() + collectionPath + "?pageSize=1000", { headers: { "Authorization": "Bearer " + tok } })
          .then(function (r) {
            if (r.status === 404) return [];
            return r.json().then(function (j) {
              if (!r.ok) { var e = new Error((j.error && j.error.message) || "list failed"); e.status = r.status; throw e; }
              return (j.documents || []).map(function (d) {
                var o = docToObj(d) || {};
                o._id = String(d.name || "").split("/").pop();
                return o;
              });
            });
          });
      });
    },
    /* Sum one numeric field (Money's MRR estimate). */
    fsSum: function (collectionId, field, filters) {
      return token().then(function (tok) {
        var where = null;
        if (filters && filters.length) {
          var fs = filters.map(function (f) { return { fieldFilter: { field: { fieldPath: f.field }, op: f.op, value: enc(f.value) } }; });
          where = fs.length === 1 ? fs[0] : { compositeFilter: { op: "AND", filters: fs } };
        }
        var q = { structuredAggregationQuery: { aggregations: [{ sum: { field: { fieldPath: field } }, alias: "s" }], structuredQuery: { from: [{ collectionId: collectionId }] } } };
        if (where) q.structuredAggregationQuery.structuredQuery.where = where;
        return fetch(fsBase().replace(/documents\/$/, "") + "documents:runAggregationQuery", {
          method: "POST", headers: { "Authorization": "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify(q),
        }).then(function (r) {
          return r.json().then(function (j) {
            if (!r.ok) { var e = new Error((j.error && j.error.message) || "sum failed"); e.status = r.status; throw e; }
            var row = Array.isArray(j) ? j[0] : j;
            var v = row && row.result && row.result.aggregateFields && row.result.aggregateFields.s;
            return v ? (parseInt(v.integerValue, 10) || Math.round(v.doubleValue || 0)) : 0;
          });
        });
      });
    },
    /* Count-only aggregate read (the CEO dashboard's only window:
       a number comes back, never a person). filters: [{field, op, value}] */
    fsCount: function (collectionId, filters) {
      return token().then(function (tok) {
        var where = null;
        if (filters && filters.length) {
          var fs = filters.map(function (f) { return { fieldFilter: { field: { fieldPath: f.field }, op: f.op, value: enc(f.value) } }; });
          where = fs.length === 1 ? fs[0] : { compositeFilter: { op: "AND", filters: fs } };
        }
        var q = { structuredAggregationQuery: { aggregations: [{ count: {}, alias: "c" }], structuredQuery: { from: [{ collectionId: collectionId }] } } };
        if (where) q.structuredAggregationQuery.structuredQuery.where = where;
        return fetch(fsBase().replace(/documents\/$/, "") + "documents:runAggregationQuery", {
          method: "POST", headers: { "Authorization": "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify(q),
        }).then(function (r) {
          return r.json().then(function (j) {
            if (!r.ok) { var e = new Error((j.error && j.error.message) || "count failed"); e.status = r.status; throw e; }
            var row = Array.isArray(j) ? j[0] : j;
            var v = row && row.result && row.result.aggregateFields && row.result.aggregateFields.c;
            return v ? (parseInt(v.integerValue, 10) || 0) : 0;
          });
        });
      });
    },
  };
  window.PaceFB = api;
})();
