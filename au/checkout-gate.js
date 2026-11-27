/*! PowerDealDesk checkout email gate — intercepts buy.stripe.com CTAs */
(function () {
  'use strict';
  if (window.__pddCheckoutGate) return;
  window.__pddCheckoutGate = true;

  var SKU = {
    '3cI00kcMO2t6fDvg9K48006': 'report',
    'aFaaEYfZ0aZCajbg9K48003': 'report',
    '8x26oI3ceebOezr6za48005': 'featured',
    '7sYdRa4gid7K3UN2iU48001': 'pro_yearly',
    '4gM8wQ146ffS9f74r248000': 'pro_monthly',
    'eVq3cwaEG1p24YR6za48002': 'team_yearly',
    '5kQdRafZ07Nqajb2iU48004': 'nsw_pack'
  };
  var LABELS = {
    report: 'Project report · US$79',
    featured: 'Featured listing · US$99/mo',
    pro_yearly: 'Pro yearly · US$1,490',
    pro_monthly: 'Pro monthly · US$149',
    team_yearly: 'Team yearly · US$3,900',
    nsw_pack: 'NSW State Pipeline Pack · US$299'
  };
  var FORMSUBMIT = 'https://formsubmit.co/ajax/deals@powerdealdesk.com';
  var pending = null; // { url, sku, slug }

  function skuFromUrl(href) {
    try {
      var u = new URL(href, location.href);
      var m = u.pathname.match(/\/([A-Za-z0-9]+)$/);
      var id = m ? m[1] : '';
      return SKU[id] || id || 'unknown';
    } catch (e) {
      return 'unknown';
    }
  }

  function slugFromUrl(href) {
    try {
      var u = new URL(href, location.href);
      return u.searchParams.get('client_reference_id') || '';
    } catch (e) {
      return '';
    }
  }

  function ensureModal() {
    var el = document.getElementById('pdd-checkout-gate');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'pdd-checkout-gate';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'pdd-cg-title');
    el.hidden = true;
    el.innerHTML =
      '<div class="pdd-cg-backdrop" data-pdd-cg-close></div>' +
      '<div class="pdd-cg-panel">' +
      '<button type="button" class="pdd-cg-x" data-pdd-cg-close aria-label="Close">×</button>' +
      '<h2 id="pdd-cg-title">Where should we send the receipt?</h2>' +
      '<p class="pdd-cg-sub">Confirm your spot, then continue to secure Stripe checkout.</p>' +
      '<p class="pdd-cg-sku" id="pdd-cg-sku"></p>' +
      '<form id="pdd-cg-form" novalidate>' +
      '<label>Work email <input type="email" name="email" id="pdd-cg-email" required autocomplete="email" placeholder="you@company.com"></label>' +
      '<label>Name <span class="pdd-cg-opt">(optional)</span> <input type="text" name="name" id="pdd-cg-name" autocomplete="name"></label>' +
      '<label>Company <span class="pdd-cg-opt">(optional)</span> <input type="text" name="company" id="pdd-cg-company" autocomplete="organization"></label>' +
      '<button type="submit" class="btn pdd-cg-go" id="pdd-cg-go">Continue to secure checkout</button>' +
      '<p class="pdd-cg-note muted">We use your email for the receipt and order follow-up. No account required.</p>' +
      '</form></div>';
    document.body.appendChild(el);
    el.addEventListener('click', function (e) {
      if (e.target && e.target.getAttribute('data-pdd-cg-close') !== null) closeModal();
    });
    document.getElementById('pdd-cg-form').addEventListener('submit', onSubmit);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !el.hidden) closeModal();
    });
    return el;
  }

  function openModal(href) {
    var sku = skuFromUrl(href);
    var slug = slugFromUrl(href);
    pending = { url: href, sku: sku, slug: slug };
    var el = ensureModal();
    var label = LABELS[sku] || sku;
    if (slug) label += ' · ' + slug;
    document.getElementById('pdd-cg-sku').textContent = label;
    el.hidden = false;
    document.documentElement.classList.add('pdd-cg-open');
    setTimeout(function () {
      var inp = document.getElementById('pdd-cg-email');
      if (inp) inp.focus();
    }, 30);
  }

  function closeModal() {
    var el = document.getElementById('pdd-checkout-gate');
    if (el) el.hidden = true;
    document.documentElement.classList.remove('pdd-cg-open');
    pending = null;
  }

  function buildStripeUrl(baseHref, email) {
    var u = new URL(baseHref, location.href);
    u.searchParams.set('prefilled_email', email);
    return u.toString();
  }

  function recordIntent(payload) {
    // 2026-11-27 fix: the old path (sendBeacon with a JSON blob, then a hidden-iframe form) never delivered.
    // sendBeacon is credentialed, so the JSON preflight fails against FormSubmit's "Access-Control-Allow-Origin: *",
    // yet sendBeacon still returns true; and the iframe POST was aborted by the Stripe redirect 180 ms later.
    // Now: multipart FormData (CORS-simple, no preflight) via fetch with keepalive, and the caller waits for it.
    var fields = {
      _subject: payload._subject,
      _captcha: 'false',
      _template: 'table',
      email: payload.email,
      name: payload.name || '',
      company: payload.company || '',
      sku: payload.sku,
      project_slug: payload.project_slug || '',
      page_url: payload.page_url,
      stripe_url: payload.stripe_url,
      timestamp: payload.timestamp,
      source: 'checkout-gate'
    };
    function fd() {
      var f = new FormData();
      Object.keys(fields).forEach(function (k) { f.append(k, fields[k]); });
      return f;
    }
    function beacon() {
      try { if (navigator.sendBeacon) return navigator.sendBeacon(FORMSUBMIT, fd()); } catch (e) {}
      return false;
    }
    var done;
    try {
      done = fetch(FORMSUBMIT, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: fd(),
        mode: 'cors',
        credentials: 'omit',
        keepalive: true
      }).then(function (r) {
        if (!r.ok) beacon();
      }, function () {
        beacon();
      });
    } catch (e) {
      beacon();
      done = Promise.resolve();
    }
    // Local mirror for same-session recovery / checkout-intent page
    try {
      var log = [];
      try {
        log = JSON.parse(sessionStorage.getItem('pdd_checkout_intents') || '[]');
      } catch (e5) {
        log = [];
      }
      log.push(payload);
      sessionStorage.setItem('pdd_checkout_intents', JSON.stringify(log.slice(-20)));
      sessionStorage.setItem('pdd_last_checkout_intent', JSON.stringify(payload));
    } catch (e6) {}
    return done;
  }

  function onSubmit(e) {
    e.preventDefault();
    if (!pending) return;
    var emailEl = document.getElementById('pdd-cg-email');
    var email = (emailEl && emailEl.value || '').trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      if (emailEl) {
        emailEl.focus();
        emailEl.setCustomValidity('Enter a valid work email');
        emailEl.reportValidity();
        emailEl.setCustomValidity('');
      }
      return;
    }
    var name = (document.getElementById('pdd-cg-name').value || '').trim();
    var company = (document.getElementById('pdd-cg-company').value || '').trim();
    var stripeUrl = buildStripeUrl(pending.url, email);
    var slug = pending.slug || '';
    var sku = pending.sku || 'unknown';
    var subject = 'Checkout intent: ' + sku + (slug ? ' | ' + slug : '');
    var payload = {
      _subject: subject,
      email: email,
      name: name,
      company: company,
      sku: sku,
      project_slug: slug,
      page_url: location.href,
      stripe_url: stripeUrl.split('?')[0],
      timestamp: new Date().toISOString(),
      source: 'checkout-gate'
    };
    var go = document.getElementById('pdd-cg-go');
    if (go) {
      go.disabled = true;
      go.textContent = 'Redirecting…';
    }
    try { sessionStorage.setItem('pdd_stripe_dest', stripeUrl); } catch (e7) {}
    var went = false;
    function go2() {
      if (went) return;
      went = true;
      location.href = stripeUrl;
    }
    // Wait for FormSubmit to accept the intent (usually <1 s), max 2.5 s, then continue to Stripe.
    var p = recordIntent(payload);
    if (p && p.then) p.then(go2, go2);
    setTimeout(go2, 2500);
  }

  function isStripeBuy(a) {
    if (!a || !a.getAttribute) return null;
    var href = a.getAttribute('href') || '';
    if (/buy\.stripe\.com\//i.test(href)) return a;
    return null;
  }

  document.addEventListener(
    'click',
    function (e) {
      var t = e.target;
      if (!t) return;
      var a = t.closest ? t.closest('a') : null;
      if (!a) {
        while (t && t !== document && t.tagName !== 'A') t = t.parentNode;
        a = t && t.tagName === 'A' ? t : null;
      }
      var link = isStripeBuy(a);
      if (!link) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;
      e.preventDefault();
      e.stopPropagation();
      openModal(link.href);
    },
    true
  );
})();
