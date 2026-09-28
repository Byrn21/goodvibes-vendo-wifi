/* =============================================================
   portal.js — Omada captive portal core logic
   =============================================================
   - Reads Omada-provided query parameters
   - Validates voucher/credential input
   - Submits auth to backend or direct controller endpoint
   - Handles success / error / network failure states
   - Applies theming from CONFIG
   ============================================================= */

(function () {
  'use strict';

  // ===============================================================
  // CONFIG — loaded from config/config.js on the window
  // ===============================================================
  var C = window.CONFIG || {};

  // Defaults for missing config properties
  var DEFAULTS = {
    mode: 'direct',               // 'direct' or 'backend'
    authEndpoint: '',
    authMethod: 'POST',           // 'POST' or 'POST_JSON'
    apiBaseUrl: '',
    voucher: {
      required: true,
      minLength: 4,
      maxLength: 32,
      pattern: /^[A-Z0-9\-]+$/i,
      patternHint: 'Letters, numbers, and dashes',
    },
    allowedRedirectDomains: [],
    defaultRedirectUrl: '',
    termsRequired: false,
    termsUrl: '#terms',
    privacyUrl: '#privacy',
    statusPollingInterval: 30000,
    showPauseResume: true,
    brandName: 'WiFi Portal',
    brandTagline: 'Connect to the guest network',
    primaryColor: '#1a73e8',
    successPage: 'success.html',
    errorPage: 'error.html',
    statusPage: 'status.html',
    paramMap: {
      clientMac:   'clientMac',
      clientIp:    'clientIp',
      apMac:       'apMac',
      ssidName:    'ssidName',
      redirectUrl: 'redirectUrl',
      originalUrl: 'originalUrl',
      authUrl:     'authUrl',
      targetUrl:   'targetUrl',
    },
        supportEmail: 'support@example.com',
    supportPhone: '',
    mockMode: false,
    mockSuccessDelay: 800,
    pricingPlans: {
      standard: [],
      premium: [],
    },
  };

  // Merge config with defaults
  var CONFIG = {};
  for (var k in DEFAULTS) {
    if (DEFAULTS.hasOwnProperty(k)) {
      if (k === 'paramMap' || k === 'voucher') {
        CONFIG[k] = Object.assign({}, DEFAULTS[k], C[k] || {});
      } else {
        CONFIG[k] = (C[k] !== undefined) ? C[k] : DEFAULTS[k];
      }
    }
  }

  // ===============================================================
  // UTILITY
  // ===============================================================
  function $(id) { return document.getElementById(id); }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function show(el) { if (el) el.classList.remove('hidden'); }
  function hide(el) { if (el) el.classList.add('hidden'); }

  function setBanner(message, type) {
    var banner = $('status-banner');
    if (!banner) return;
    banner.textContent = message;
    banner.className = 'status-banner status-banner--' + (type || 'info');
    if (message) show(banner); else hide(banner);
  }

  function setError(inputId, msg) {
    var input = $(inputId);
    var errEl = $(inputId + '-error');
    if (input) {
      if (msg) { input.classList.add('is-error'); input.removeAttribute('aria-invalid'); input.setAttribute('aria-invalid', 'true'); }
      else     { input.classList.remove('is-error'); input.removeAttribute('aria-invalid'); }
    }
    if (errEl) {
      if (msg) { errEl.textContent = msg; show(errEl); }
      else     { errEl.textContent = '';  hide(errEl); }
    }
  }

  function setFormError(msg) {
    var box = $('form-error');
    if (!box) return;
    if (msg) { box.textContent = msg; show(box); }
    else     { box.textContent = '';  hide(box); }
  }

  // ===============================================================
  // MAC ADDRESS NORMALIZATION
  // ===============================================================
  function normalizeMac(mac) {
    if (!mac) return null;
    var cleaned = String(mac).replace(/[^0-9a-fA-F]/g, '').toLowerCase();
    if (cleaned.length !== 12) return null;
    // Re-add colons
    return cleaned.match(/.{2}/g).join(':');
  }

  // ===============================================================
  // QUERY PARAMETER PARSING
  // ===============================================================
  var queryParams = {};
  function parseQueryParams() {
    var params = new URLSearchParams(window.location.search);
    var raw = {};
    params.forEach(function (val, key) {
      raw[key] = decodeURIComponent(val);
    });

    // Map Omada param names → our standard names
    var result = { raw: raw };
    var map = CONFIG.paramMap;
    for (var ourName in map) {
      if (map.hasOwnProperty(ourName)) {
        var theirName = map[ourName];
        if (raw[theirName] !== undefined) {
          result[ourName] = raw[theirName];
        }
      }
    }
    // Save raw for passthrough (e.g., controller tokens)
    queryParams = result;
    return result;
  }

  function getRedirectDestination() {
    var candidate = queryParams.redirectUrl
      || queryParams.originalUrl
      || queryParams.targetUrl
      || '';
    candidate = decodeURIComponent(candidate);
    if (isAllowedRedirect(candidate)) return candidate;
    return CONFIG.defaultRedirectUrl;
  }

  function isAllowedRedirect(url) {
    if (!url) return false;
    try {
      var u = new URL(url);
      // http/https only
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      // Allow localhost for dev
      if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
      // Check allowlist
      var domains = CONFIG.allowedRedirectDomains || [];
      if (domains.length === 0) return true; // open if no allowlist configured
      for (var i = 0; i < domains.length; i++) {
        var d = domains[i].toLowerCase();
        var host = u.hostname.toLowerCase();
        if (host === d || host.endsWith('.' + d)) return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  // ===============================================================
  // VALIDATION
  // ===============================================================
  function validateVoucher(code) {
    var v = CONFIG.voucher || {};
    if (!code || !code.trim()) return { ok: false, message: 'Enter your voucher code.' };
    var trimmed = code.trim();
    if (v.minLength && trimmed.length < v.minLength) {
      return { ok: false, message: 'Voucher code is too short (min ' + v.minLength + ' characters).' };
    }
    if (v.maxLength && trimmed.length > v.maxLength) {
      return { ok: false, message: 'Voucher code is too long (max ' + v.maxLength + ' characters).' };
    }
    if (v.pattern && !new RegExp(v.pattern).test(trimmed)) {
      return { ok: false, message: v.patternHint || 'Invalid voucher format.' };
    }
    return { ok: true, value: trimmed };
  }

  function validateTerms(checked) {
    if (CONFIG.termsRequired && !checked) {
      return { ok: false, message: 'You must accept the terms before connecting.' };
    }
    return { ok: true };
  }

  // ===============================================================
  // THEMING
  // ===============================================================
  function applyTheming() {
    var root = document.documentElement;
    if (CONFIG.primaryColor) root.style.setProperty('--primary', CONFIG.primaryColor);
    if (CONFIG.accentColor)  root.style.setProperty('--accent',  CONFIG.accentColor);

    var brandEl = $('brand-name');
    if (brandEl && CONFIG.brandName) brandEl.textContent = CONFIG.brandName;

    var tagline = $('brand-tagline');
    if (tagline && CONFIG.brandTagline) tagline.textContent = CONFIG.brandTagline;

    // Support links
    var supportLinks = document.querySelectorAll('[id*="support-email"]');
    for (var i = 0; i < supportLinks.length; i++) {
      supportLinks[i].href = 'mailto:' + encodeURIComponent(CONFIG.supportEmail);
      supportLinks[i].textContent = CONFIG.supportEmail;
    }

    // Terms link
    var termsLink = $('terms-link');
    if (termsLink && CONFIG.termsUrl) termsLink.href = CONFIG.termsUrl;

    var privacyLink = $('privacy-link');
    if (privacyLink && CONFIG.privacyUrl) privacyLink.href = CONFIG.privacyUrl;
  }

  // ===============================================================
  // FORM SUBMISSION
  // ===============================================================
  var submitting = false;

  function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;

    // Clear previous errors
    setError('voucher-input', '');
    setError('terms-checkbox', '');
    setFormError('');
    setBanner('');

    var voucherInput = $('voucher-input');
    var termsCheckbox = $('terms-checkbox');
    var submitBtn = $('submit-btn');
    var submitLabel = $('submit-label');
    var loadingOverlay = $('loading-overlay');
    var loadingText = $('loading-text');

        var voucherVal = voucherInput ? voucherInput.value : '';
    var termsChecked = termsCheckbox ? termsCheckbox.checked : true;

        // Check if we're in paid/backend mode with plan selection
    var selectedType = getSelectedVoucherType();

    // Check for pricing table selection
    var pricingPlan = null;
    var pricingInput = document.querySelector('input[name="selectedPlan"]');
    if (pricingInput && pricingInput.value) {
      try {
        pricingPlan = JSON.parse(pricingInput.value);
      } catch (e) {
        pricingPlan = null;
      }
    }

    // ---- Paid mode: redirect to payment checkout ----
    if (CONFIG.mode === 'backend' && selectedType && selectedType.tier) {
      var checkoutUrl = (CONFIG.apiBaseUrl || '') + '/api/payment/initiate?' + [
        'voucherType=' + encodeURIComponent(selectedType.tier),
        'planId=' + encodeURIComponent(selectedType.planId),
        'plan=' + encodeURIComponent($('plan-select').value),
        'clientMac=' + encodeURIComponent(queryParams.clientMac || ''),
        'clientIp=' + encodeURIComponent(queryParams.clientIp || ''),
        'apMac=' + encodeURIComponent(queryParams.apMac || ''),
        'ssidName=' + encodeURIComponent(queryParams.ssidName || ''),
        'redirectUrl=' + encodeURIComponent(getRedirectDestination()),
      ].join('&');

            window.location.href = checkoutUrl;
      return;
    }

    // ---- Pricing table selection: redirect to payment checkout ----
    if (pricingPlan && pricingPlan.tier) {
      var pricingCheckoutUrl = (CONFIG.apiBaseUrl || '') + '/api/payment/initiate?' + [
        'voucherType=' + encodeURIComponent(pricingPlan.tier),
        'planId=' + encodeURIComponent(pricingPlan.planId),
        'duration=' + encodeURIComponent(pricingPlan.duration),
        'price=' + encodeURIComponent(pricingPlan.price),
        'clientMac=' + encodeURIComponent(queryParams.clientMac || ''),
        'clientIp=' + encodeURIComponent(queryParams.clientIp || ''),
        'apMac=' + encodeURIComponent(queryParams.apMac || ''),
        'ssidName=' + encodeURIComponent(queryParams.ssidName || ''),
        'redirectUrl=' + encodeURIComponent(getRedirectDestination()),
      ].join('&');

      window.location.href = pricingCheckoutUrl;
      return;
    }

    // ---- Voucher validation ----
    var vResult = validateVoucher(voucherVal);
    if (!vResult.ok) {
      setError('voucher-input', vResult.message);
      voucherInput.focus();
      return;
    }

    // ---- Terms validation ----
    var tResult = validateTerms(termsChecked);
    if (!tResult.ok) {
      setError('terms-checkbox', tResult.message);
      if (termsCheckbox) termsCheckbox.focus();
      return;
    }

    // ---- Begin submission ----
    submitting = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.setAttribute('aria-busy', 'true');
    }
    if (submitLabel) submitLabel.textContent = 'Connecting…';
    if (loadingOverlay) {
      loadingOverlay.setAttribute('aria-hidden', 'false');
      show(loadingOverlay);
    }
    if (loadingText) loadingText.textContent = 'Connecting…';

    var clientContext = buildClientContext();
    clientContext.voucher = vResult.value;
    clientContext.termsAccepted = termsChecked;

    var promise;
    if (CONFIG.mockMode) {
      promise = mockAuthenticate(clientContext);
    } else if (CONFIG.mode === 'backend') {
      promise = backendAuthenticate(clientContext);
    } else {
      promise = directAuthenticate(clientContext);
    }

    promise.then(handleSuccess).catch(handleFailure).then(function () {
      submitting = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.removeAttribute('aria-busy');
      }
      if (submitLabel) submitLabel.textContent = 'Connect Now';
      if (loadingOverlay) {
        loadingOverlay.setAttribute('aria-hidden', 'true');
        hide(loadingOverlay);
      }
    });
  }

  function buildClientContext() {
    return {
      clientMac: normalizeMac(queryParams.clientMac) || queryParams.clientMac || '',
      clientIp:  queryParams.clientIp  || '',
      apMac:     normalizeMac(queryParams.apMac) || queryParams.apMac || '',
      ssidName:  queryParams.ssidName  || '',
      redirectUrl: getRedirectDestination(),
      authUrl:   queryParams.authUrl   || '',
      raw:       queryParams.raw       || {},
    };
  }

  // ---- Direct mode: POST to Omada extPortal auth endpoint ----
  // NOTE: This is a best-effort adapter. Exact request format varies
  // by Omada controller version. Verify against your firmware's actual API.
  function directAuthenticate(ctx) {
    return new Promise(function (resolve, reject) {
      var endpoint = CONFIG.authEndpoint;
      if (!endpoint) {
        reject({ code: 'CONFIG_ERROR', message: 'Authentication endpoint not configured.' });
        return;
      }

      var formData = new FormData();
      formData.append('username', ctx.voucher);
      formData.append('password', ctx.voucher);
      if (ctx.clientMac)  formData.append('clientMac',  ctx.clientMac);
      if (ctx.clientIp)   formData.append('clientIp',   ctx.clientIp);
      if (ctx.apMac)      formData.append('apMac',      ctx.apMac);
      if (ctx.ssidName)   formData.append('ssidName',   ctx.ssidName);

      // Passthrough any controller-specific token params
      if (ctx.raw) {
        for (var key in ctx.raw) {
          if (ctx.raw.hasOwnProperty(key) && key.indexOf('token') !== -1) {
            formData.append(key, ctx.raw[key]);
          }
        }
      }

      // CORS note: Omada controllers often don't set CORS headers on extPortal endpoints.
      // In direct mode, the form POST is same-origin relative to the portal page that
      // the controller redirected to — but the controller is a different host.
      // For best results, use backend mode which proxies the auth call.

      fetch(endpoint, {
        method: 'POST',
        mode: 'no-cors',
        credentials: 'include',
        body: formData,
      }).then(function () {
        // With no-cors, we can't read the response.
        // We have to trust that the controller handled it.
        // Redirect to success page after a short delay.
        setTimeout(function () {
          resolve({ redirectUrl: ctx.redirectUrl });
        }, 1000);
      }).catch(function () {
        reject({ code: 'NETWORK_ERROR', message: 'Could not reach the authentication server.' });
      });
    });
  }

  // ---- Backend mode: POST to our backend proxy ----
  function backendAuthenticate(ctx) {
    return new Promise(function (resolve, reject) {
      var url = CONFIG.apiBaseUrl + '/api/auth';

      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          voucher: ctx.voucher,
          clientMac: ctx.clientMac,
          clientIp:  ctx.clientIp,
          apMac:     ctx.apMac,
          ssidName:  ctx.ssidName,
          redirectUrl: ctx.redirectUrl,
          termsAccepted: ctx.termsAccepted,
        }),
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          return { status: r.status, data: data };
        });
      }).then(function (result) {
        var data = result.data || {};
        if (result.status >= 200 && result.status < 300 && data.success) {
          resolve({
            redirectUrl: data.redirectUrl || ctx.redirectUrl,
            sessionId: data.sessionId,
          });
        } else {
          reject({
            code: data.code || 'AUTH_FAILED',
            message: data.error || data.message || 'Authentication failed.',
          });
        }
      }).catch(function (err) {
        if (err.name === 'TypeError') {
          reject({ code: 'NETWORK_ERROR', message: 'The network could not be reached. Please try again.' });
        } else {
          reject({ code: 'SERVER_ERROR', message: 'A server error occurred. Please try again.' });
        }
      });
    });
  }

  // ---- Mock mode: simulate auth for testing without controller ----
  function mockAuthenticate(ctx) {
    return new Promise(function (resolve, reject) {
      var delay = CONFIG.mockSuccessDelay || 800;
      setTimeout(function () {
        var v = ctx.voucher.toUpperCase();
        if (v === 'EXPIRED' || v === 'EXPIRED-VOUCHER') {
          reject({ code: 'EXPIRED_VOUCHER', message: 'This voucher has expired.' });
        } else if (v === 'USED' || v === 'USED-VOUCHER') {
          reject({ code: 'USED_VOUCHER', message: 'This voucher has already been used.' });
        } else if (v === 'FAIL' || v === 'INVALID') {
          reject({ code: 'INVALID_VOUCHER', message: 'Invalid voucher code.' });
        } else if (v === 'RATE' || v === 'RATE-LIMIT') {
          reject({ code: 'RATE_LIMITED', message: 'Too many attempts. Please wait.' });
        } else if (v === 'NETWORK' || v === 'NETERROR') {
          reject({ code: 'NETWORK_ERROR', message: 'Network error (mock).' });
        } else {
          resolve({
            redirectUrl: ctx.redirectUrl,
            sessionId: 'sess_mock_' + Math.random().toString(36).slice(2, 10),
          });
        }
      }, delay);
    });
  }

  // ---- Handle successful auth ----
  function handleSuccess(result) {
    // Build success URL with redirect and session info
    var params = new URLSearchParams();
    if (result.redirectUrl) params.set('redirectUrl', encodeURIComponent(result.redirectUrl));
    if (result.sessionId)   params.set('sessionId', result.sessionId);
    params.set('countdown', '3');

    window.location.href = CONFIG.successPage + '?' + params.toString();
  }

  // ---- Handle auth failure ----
  function handleFailure(err) {
    var code = err.code || 'AUTH_FAILED';
    var message = err.message || 'Authentication failed.';

    // Public-safe messages only
    var SAFE_MESSAGES = {
      INVALID_VOUCHER: 'Your voucher code was not recognized. Please check and try again.',
      EXPIRED_VOUCHER: 'This voucher has expired. Please obtain a new code.',
      USED_VOUCHER:    'This voucher has already been used.',
      SESSION_LIMIT:   'The maximum number of connected devices has been reached.',
      NETWORK_ERROR:   'The network could not be reached. Please check your connection and try again.',
      SERVER_ERROR:    'The authentication server is temporarily unavailable. Please try again shortly.',
      RATE_LIMITED:    'Too many attempts. Please wait a moment before trying again.',
      TERMS_REQUIRED:  'You must accept the terms before connecting.',
      CONFIG_ERROR:    'Portal configuration error. Please contact support.',
      AUTH_FAILED:     'Authentication failed. Please check your voucher and try again.',
    };

    var publicMsg = SAFE_MESSAGES[code] || SAFE_MESSAGES.AUTH_FAILED;

    setFormError(publicMsg);

    // If it's a voucher-specific error, highlight the field
    if (code === 'INVALID_VOUCHER' || code === 'EXPIRED_VOUCHER' || code === 'USED_VOUCHER') {
      setError('voucher-input', publicMsg);
    }
  }

  // ===============================================================
  // INPUT ENHANCEMENTS
  // ===============================================================
  function initInputEnhancements() {
    var input = $('voucher-input');
    if (!input) return;

    // Clear error as user types
    input.addEventListener('input', function () {
      setError('voucher-input', '');
      setFormError('');
    });

    // Upper-case formatting (visual only; actual validation uses trimmed value)
    input.addEventListener('blur', function () {
      if (input.value) {
        // Don't auto-modify in case the code is case-sensitive — just trim whitespace
        input.value = input.value.trim();
      }
    });

    // Terms checkbox: clear error on change
    var termsCheckbox = $('terms-checkbox');
    if (termsCheckbox) {
      termsCheckbox.addEventListener('change', function () {
        setError('terms-checkbox', '');
      });
    }

    // Enter key on terms checkbox submits form
    if (termsCheckbox) {
      termsCheckbox.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          var form = termsCheckbox.closest('form');
          if (form) form.dispatchEvent(new Event('submit', { cancelable: true }));
        }
      });
    }
  }

  // ===============================================================
  // TERMS SECTION INIT
  // ===============================================================
  function initTermsSection() {
    var termsSection = $('terms-section');
    if (!termsSection) return;
    if (CONFIG.termsRequired) {
      show(termsSection);
    }
    }

  // ---------------------------------------------------------------
  function formatPrice(amount) {
    // Amount in smallest currency unit (e.g., centavos for PHP)
    var pesos = (amount / 100).toFixed(2);
    return '₱' + pesos;
  }

  // ===============================================================
  // PLAN SELECTOR (paid mode)
  // ===============================================================
     function initPlanSelector() {
    var typeSection = $('voucher-type-section');
    var typeSelect = $('voucher-type-select');
    var planSection = $('plan-section');
    var planSelect = $('plan-select');
    if (!typeSection || !typeSelect || !planSection || !planSelect) return;

    // Paid plans only visible in backend mode with plans configured
    if (CONFIG.mode !== 'backend' || !CONFIG.plans || (!CONFIG.plans.standard && !CONFIG.plans.premium)) {
      return;
    }

    show(typeSection);
    show(planSection);

    // Populate the type selector with standard plans
    populateTypeSelect('standard');

    // When type changes, repopulate plan options
    typeSelect.addEventListener('change', function () {
      var selectedType = typeSelect.value.startsWith('premium') ? 'premium' : 'standard';
      populateTypeSelect(selectedType);
      var submitLabel = $('submit-label');
      if (submitLabel) {
        submitLabel.textContent = (planSelect.value && typeSelect.value) ? 'Pay & Connect' : 'Connect Now';
      }
    });

    // When plan changes, update submit button label
    planSelect.addEventListener('change', function () {
      var submitLabel = $('submit-label');
      if (submitLabel) {
        submitLabel.textContent = (planSelect.value && typeSelect.value) ? 'Pay & Connect' : 'Connect Now';
      }
    });
  }

  function populateTypeSelect(type) {
    var planSelect = $('plan-select');
    if (!planSelect) return;

    // Clear existing options
    planSelect.innerHTML = '<option value="">— Choose a plan —</option>';

    var plans = (CONFIG.plans[type] || []).slice();
    plans.forEach(function (plan) {
      var opt = document.createElement('option');
      opt.value = plan.duration; // minutes
      opt.textContent = plan.label + ' — ' + formatPrice(plan.price);
      planSelect.appendChild(opt);
    });
  }

  // Return the selected voucherType prefix (standard or premium)
  function getSelectedVoucherType() {
    var typeSelect = $('voucher-type-select');
    var planSelect = $('plan-select');
    if (!typeSelect || !planSelect) return null;
    if (!typeSelect.value || !planSelect.value) return null;

    // The typeSelect value is like "standard-1h" or "premium-5h"
    var parts = typeSelect.value.split('-');
    var tier = parts[0]; // "standard" or "premium"
    var planId = typeSelect.value; // full ID like "premium-5h"
    return { tier: tier, planId: planId };
  }

  // ===============================================================
  // PAYMENT TILES (backend/paid mode)
  // ===============================================================
    function initPaymentTiles() {
    var tiles = document.querySelectorAll('.payment-tile');
    if (!tiles.length) return;

    tiles.forEach(function (tile) {

      tile.addEventListener('click', function () {
        // Deselect all
        tiles.forEach(function (t) { t.classList.remove('is-selected'); });
        // Select this one
        tile.classList.add('is-selected');

        var method = tile.getAttribute('data-payment');

        // Cash: show instructions modal instead of redirecting
        if (method === 'cash') {
          showCashModal();
          return;
        }

        var typeSelect = $('voucher-type-select');
        var planSelect = $('plan-select');

        var selectedType = getSelectedVoucherType();

        // If a plan is selected, redirect to the payment checkout flow
        if (planSelect && planSelect.value && selectedType && selectedType.tier) {
          var checkoutUrl = (CONFIG.apiBaseUrl || '') + '/api/payment/initiate?' + [
            'method=' + encodeURIComponent(method),
            'voucherType=' + encodeURIComponent(selectedType.tier),
            'planId=' + encodeURIComponent(selectedType.planId),
            'plan=' + encodeURIComponent(planSelect.value),
            'clientMac=' + encodeURIComponent(queryParams.clientMac || ''),
          ].join('&');

          window.location.href = checkoutUrl;
        }
      });
    });
  }

    // ===============================================================
  // PRICING TABLE SELECT HANDLER
  // ===============================================================

  // ===============================================================
  // PLAN SELECTION MODAL POPUP
  // ===============================================================
  function showPlanModal(tier, durText) {
    var modal = $('plan-modal');
    var planEl = $('plan-modal-plan');
    var closeBtn = $('plan-modal-close');
    var okBtn = $('plan-modal-ok');
    
    if (!modal || !planEl) return;
    
    // Set the message content
    var tierName = tier.charAt(0).toUpperCase() + tier.slice(1);
    planEl.textContent = tierName + ' - ' + durText + ' plan';
    
    // Show modal
    show(modal);
    modal.focus();
    
    // Hide the status banner when modal is shown
    setBanner('');
    
    // Auto-focus OK button for keyboard users
    if (okBtn) setTimeout(function() { okBtn.focus(); }, 100);
    
    // Close handler
    function closeModal() {
      hide(modal);
      
      // Scroll payment section into view
      var paymentSection = document.querySelector('.payment-method-section');
      if (paymentSection) {
        paymentSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    
    // Remove existing listeners to avoid duplicates
    if (closeBtn) {
      closeBtn.onclick = closeModal;
    }
    if (okBtn) {
      okBtn.onclick = closeModal;
    }
    
    // Close on overlay click
    modal.onclick = function(e) {
      if (e.target === modal) closeModal();
    };
    
    // Close on Escape key
    function onEsc(e) {
      if (e.key === 'Escape') {
        closeModal();
        document.removeEventListener('keydown', onEsc);
      }
    }
    document.addEventListener('keydown', onEsc);
  }


   // ==============================================================================
   // CASH PAYMENT INSTRUCTIONS MODAL
   // ==============================================================================
   function showCashModal() {
     var modal = $('cash-modal');
     var closeBtn = $('cash-modal-close');
     var okBtn = $('cash-modal-close-btn');

     if (!modal) return;

     // Show modal
     show(modal);
     modal.focus();

     // Hide the status banner when modal is shown
     setBanner('');

     // Auto-focus Close button for keyboard users
     if (okBtn) setTimeout(function() { okBtn.focus(); }, 100);

     // Close handler
     function closeModal() {
       hide(modal);

       // Scroll payment section into view
       var paymentSection = document.querySelector('.payment-method-section');
       if (paymentSection) {
         paymentSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
       }
     }

     // Remove existing listeners to avoid duplicates
     if (closeBtn) {
       closeBtn.onclick = closeModal;
     }
     if (okBtn) {
       okBtn.onclick = closeModal;
     }

     // Close on overlay click
     modal.onclick = function(e) {
       if (e.target === modal) closeModal();
     };

     // Close on Escape key
     function onEsc(e) {
       if (e.key === 'Escape') {
         closeModal();
         document.removeEventListener('keydown', onEsc);
       }
     }
     document.addEventListener('keydown', onEsc);
   }

   function initPricingTable() {
    var selectButtons = document.querySelectorAll('.btn--select');
    if (!selectButtons.length) return;

        selectButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var row = btn.closest('tr');
        if (!row) return;

        var tier = row.getAttribute('data-tier');
        var duration = parseInt(row.getAttribute('data-duration'), 10);
        var price = parseInt(row.getAttribute('data-price'), 10);
        var planId = row.getAttribute('data-id');

        // Hide the voucher form, show payment section
        var voucherSection = $('voucher-input') ? $('voucher-input').closest('.form-group') : null;
        var paymentSection = document.querySelector('.payment-section');
        var formError = $('form-error');

        // Store selected plan in hidden field on the form
        var form = document.querySelector('form.auth-form');
        if (form) {
          // Remove any existing selectedPlan hidden input to avoid duplicates
          var existingInput = form.querySelector('input[name="selectedPlan"]');
          if (existingInput) {
            form.removeChild(existingInput);
          }
          // Store selected plan details
          var hiddenInput = document.createElement('input');
          hiddenInput.type = 'hidden';
          hiddenInput.name = 'selectedPlan';
          hiddenInput.value = JSON.stringify({
            tier: tier,
            duration: duration,
            price: price,
            planId: planId
          });
          form.appendChild(hiddenInput);
        }

        // Hide voucher input if present
        if (voucherSection) {
          voucherSection.classList.add('hidden');
        }

        // Clear any form errors
        setFormError('');
        setBanner('');

                // Show payment tiles section
        if (paymentSection) {
          paymentSection.classList.add('payment-section--visible');
        }

        // Update submit button label
        var submitLabel = $('submit-label');
        if (submitLabel) {
          submitLabel.textContent = 'Pay & Connect';
        }

        // Highlight the selected row (deselect across ALL pricing tables, not just same table)
        var allTables = document.querySelectorAll('.pricing-table');
        var allRows = [];
        allTables.forEach(function (table) {
          var rows = table.querySelectorAll('tbody tr');
          rows.forEach(function (r) { allRows.push(r); });
        });
        allRows.forEach(function (r) {
          r.classList.remove('is-selected');
        });
        row.classList.add('is-selected');

        // Show plan selection modal
        var durMin = duration;
        var durText = '';
        if (duration >= 1440) {
          durText = (duration / 1440) + ' day' + (duration / 1440 >= 2 ? 's' : '');
        } else if (duration >= 60) {
          durText = (duration / 60) + ' hour' + (duration / 60 >= 2 ? 's' : '');
        } else {
          durText = duration + ' minute' + (duration >= 2 ? 's' : '');
        }

        showPlanModal(tier, durText);
      });
    });

    // Add handlers for clear/reset buttons
    var clearButtons = document.querySelectorAll('.btn--clear');
    clearButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        // Find the parent row and remove highlight
        var row = btn.closest('tr');
        if (row) {
          row.classList.remove('is-selected');
        }

        // Remove all row highlights across the table
        var allTables = document.querySelectorAll('.pricing-table');
        allTables.forEach(function (table) {
          var rows = table.querySelectorAll('tbody tr');
          rows.forEach(function (r) {
            r.classList.remove('is-selected');
          });
        });

        // Remove the selectedPlan hidden input
        var form = document.querySelector('form.auth-form');
        if (form) {
          var hiddenInput = form.querySelector('input[name="selectedPlan"]');
          if (hiddenInput) {
            form.removeChild(hiddenInput);
          }
        }

        // Re-enable the voucher section
        var voucherSection = $('voucher-input') ? $('voucher-input').closest('.form-group') : null;
        if (voucherSection) {
          voucherSection.classList.remove('hidden');
        }

                // Hide payment section
        var paymentSection = document.querySelector('.payment-section');
        if (paymentSection) {
          paymentSection.classList.remove('payment-section--visible');
        }

        // Reset submit button label
        var submitLabel = $('submit-label');
        if (submitLabel) {
          submitLabel.textContent = 'Connect Now';
        }

        var modalEl = document.getElementById("plan-modal");
        if (modalEl) hide(modalEl);
        setBanner('');
        setFormError('');
      });
    });
  }

  // ===============================================================
  // INIT
  // ===============================================================
  function init() {
    // Parse Omada query params first (affects everything)
    parseQueryParams();

    // Apply brand theming
    applyTheming();

    // Set up terms visibility
    initTermsSection();

    // Set up plan selector (paid mode)
    initPlanSelector();

    // Set up pricing table select buttons
    initPricingTable();

    // Set up payment tile interactions
    initPaymentTiles();

    // Input UX
    initInputEnhancements();

    // Form submission
    var form = document.querySelector('form.auth-form');
    if (form) {
      form.addEventListener('submit', handleSubmit);
    }

    // Prefill hint: if SSID is known, show it
    if (queryParams.ssidName && $('card-subtitle')) {
      $('card-subtitle').textContent = 'Connect to ' + queryParams.ssidName;
    }

    // Mock mode banner
    if (CONFIG.mockMode) {
      setBanner('Mock mode enabled — authentication is simulated.', 'info');
    }
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ===============================================================
  // EXPORTS — for testing / status page
  // ===============================================================
    window.Portal = {
    parseQueryParams: parseQueryParams,
    validateVoucher:  validateVoucher,
    isAllowedRedirect: isAllowedRedirect,
    normalizeMac:     normalizeMac,
    getQueryParams:   function () { return queryParams; },
    getRedirectDestination: getRedirectDestination,
    getSelectedVoucherType: getSelectedVoucherType,
    config: CONFIG,
  };

})();
