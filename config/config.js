/**
 * config.js — GoodVibesVendoWifi Captive Portal Frontend Configuration
 *
 * Copy this file to config/config.js (keep config.example.js as a template).
 *
 * SECRETS AND CREDENTIALS MUST NEVER BE PLACED IN THIS FILE.
 * This file ships inside portal-upload.zip.
 */

(function () {
  'use strict';

  window.CONFIG = {

    // ==============================================================
    // BRANDING — GoodVibesVendoWifi
    // ==============================================================
    brandName: 'GoodVibesVendoWifi',
    brandTagline: 'Connect to our Guest Network',
    logoUrl: 'assets/images/logo.svg',
    primaryColor: '#2d6a4f',
    accentColor: '#e9f5db',
    textColor: '#2c1810',
    supportEmail: 'support@goodvibesvendowifi.com',
    supportPhone: '',

    // ==============================================================
    // AUTHENTICATION MODE — backend mode (voucher-based)
    // ==============================================================
    mode: 'backend',

    // ==============================================================
    // BACKEND MODE
    // ==============================================================
    // Base URL of your backend server (no trailing slash)
    // Update this when you deploy to Koyeb:
    // e.g. https://your-app-name.koyeb.app
    apiBaseUrl: 'https://your-app-name.koyeb.app',

    // ==============================================================
    // VOUCHER VALIDATION
    // ==============================================================
    voucher: {
      required: true,
      minLength: 8,
      maxLength: 16,
      pattern: /^[A-Z0-9\-]+$/i,
      patternHint: 'Letters, numbers, and dashes only, 8–16 characters',
    },

    // ==============================================================
    // REDIRECT ALLOWLIST
    // ==============================================================
    allowedRedirectDomains: [
      'goodvibesvendowifi.com',
      'captive.apple.com',
      'connectivitycheck.gstatic.com',
    ],

    defaultRedirectUrl: 'https://www.google.com',

    // ==============================================================
    // TERMS AND CONDITIONS
    // ==============================================================
    termsRequired: true,
    termsUrl: '#terms',
    privacyUrl: '#privacy',

    // ==============================================================
    // STATUS PAGE
    // ==============================================================
    statusPollingInterval: 30000,
    showPauseResume: true,

    // ==============================================================
    // CONTROLLER QUERY PARAMETER MAPPING
    // ==============================================================
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

    // ==============================================================
    // DEVELOPMENT / TESTING
    // ==============================================================
    mockMode: false,
    mockSuccessDelay: 800,

    // ==============================================================
    // PAGE ROUTES
    // ==============================================================
    successPage: 'success.html',
    errorPage:   'error.html',
    statusPage:  'status.html',

  };

})();
