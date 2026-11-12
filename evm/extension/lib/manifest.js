// The extension's manifest: built from operator config, and validated against the permission
// budget ADR-005 sets. Part c1 of the "Browser extension revival against v2 ABI" roadmap item.
//
// Framework free and `chrome.*` free like the rest of extension/lib. The manifest is data, so the
// rules about what it may ask the browser for can be proved without a browser: build it, validate
// it, and prove that each way of widening it is refused.
//
// Read docs/ADR-005-extension-shell.md first. The short form: v1 asked for `https://*/*` plus
// `tabs` and `scripting` to support a feature that only works on a seller's own storefront
// (ADR-003). The budget here is the seller origins, the chain RPC, the operator endpoint, and
// nothing else.

class ManifestError extends Error {}

const MANIFEST_VERSION = 3;

// The only API permission the shell may hold. `storage` is for the replay store, since an MV3
// service worker is terminated when idle and an in-memory store would forget every requestId.
// Everything else is refused by name below so a reviewer sees the reason, and by omission here so
// a permission nobody thought of is refused too.
const ALLOWED_PERMISSIONS = ['storage'];

const REFUSED_PERMISSIONS = {
  tabs: 'tabs exposes the URL and title of every open tab. The service worker learns a tab id from the message sender and needs nothing more.',
  scripting: 'scripting injects code into pages on demand. The content script is declared statically against seller origins instead.',
  activeTab: 'activeTab is not needed: the popup renders a quote it is sent, and never reads the page.',
  webRequest: 'webRequest observes traffic on every host.',
  cookies: 'cookies reads sessions on every permitted host.',
  history: 'history is browsing data the extension has no use for.',
  declarativeNetRequest: 'declarativeNetRequest rewrites traffic; the extension quotes, it does not filter.',
};

const EXACT_HTTPS_ORIGIN = /^https:\/\/([a-z0-9-]+\.)+[a-z]{2,}(:\d{1,5})?$/;

function assertOrigin(value, what) {
  if (typeof value !== 'string' || !EXACT_HTTPS_ORIGIN.test(value)) {
    throw new ManifestError(
      `${what} must be an exact https origin such as https://position.gallery (no wildcard, no path), got ${value}`,
    );
  }
  return value;
}

function toPattern(origin) {
  return `${origin}/*`;
}

/**
 * Build the manifest from operator config.
 *
 * @param {object} cfg
 * @param {string} cfg.name
 * @param {string} cfg.version                   dotted numeric, 1 to 4 parts
 * @param {string[]} cfg.sellerOrigins           storefronts that may carry a financing surface
 * @param {string[]} cfg.rpcOrigins              chain read endpoints the service worker calls
 * @param {string[]} cfg.operatorOrigins         where submitRequest POSTs
 * @param {string[]} cfg.walletOrigins           the wallet relay the popup's own provider talks to
 *                                               (ADR-006 decision 1, ADR-007). Same exact-origin rules.
 */
function buildManifest(cfg = {}) {
  const { name = 'RelicPay', version, sellerOrigins, rpcOrigins, operatorOrigins, walletOrigins } = cfg;
  if (typeof version !== 'string' || !/^\d+(\.\d+){0,3}$/.test(version)) {
    throw new ManifestError(`version must be dotted numeric, got ${version}`);
  }
  for (const [what, list] of [
    ['sellerOrigins', sellerOrigins],
    ['rpcOrigins', rpcOrigins],
    ['operatorOrigins', operatorOrigins],
    ['walletOrigins', walletOrigins],
  ]) {
    if (!Array.isArray(list) || list.length === 0) {
      throw new ManifestError(`${what} must list at least one origin`);
    }
    list.forEach((o) => assertOrigin(o, what));
  }

  const sellerPatterns = [...new Set(sellerOrigins)].map(toPattern);
  const hostPatterns = [...new Set([...sellerOrigins, ...rpcOrigins, ...operatorOrigins, ...walletOrigins])].map(toPattern);

  const manifest = {
    manifest_version: MANIFEST_VERSION,
    name,
    version,
    description: 'Quote and request installment financing for tokenized relics on a seller storefront.',
    permissions: [...ALLOWED_PERMISSIONS],
    host_permissions: hostPatterns,
    background: { service_worker: 'background.js' },
    content_scripts: [
      {
        matches: sellerPatterns,
        js: ['content.js'],
        run_at: 'document_idle',
        all_frames: false,
      },
    ],
    action: { default_popup: 'popup.html', default_title: 'RelicPay' },
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
  };

  const check = validateManifest(manifest);
  if (!check.ok) {
    throw new ManifestError(`built manifest fails its own budget: ${check.problems.map((p) => p.code).join(', ')}`);
  }
  return manifest;
}

function isExactHostPattern(pattern) {
  if (typeof pattern !== 'string') return false;
  const m = /^https:\/\/([^/*]+)\/\*$/.exec(pattern);
  return !!m && EXACT_HTTPS_ORIGIN.test(`https://${m[1]}`);
}

/**
 * Check a manifest against the permission budget. Returns every problem found, not the first, on
 * the same reasoning as request.js's matchAgreementToRequest: a reviewer widening a manifest wants
 * the whole diff of what they asked for.
 *
 * @returns {{ok: boolean, problems: {code: string, message: string}[]}}
 */
function validateManifest(manifest) {
  const problems = [];
  const add = (code, message) => problems.push({ code, message });

  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, problems: [{ code: 'NOT_AN_OBJECT', message: 'manifest must be an object' }] };
  }
  if (manifest.manifest_version !== MANIFEST_VERSION) {
    add('MANIFEST_VERSION', `manifest_version must be ${MANIFEST_VERSION}`);
  }

  for (const p of [...(manifest.permissions || []), ...(manifest.optional_permissions || [])]) {
    if (REFUSED_PERMISSIONS[p]) add('PERMISSION_REFUSED', `${p}: ${REFUSED_PERMISSIONS[p]}`);
    else if (!ALLOWED_PERMISSIONS.includes(p)) add('PERMISSION_NOT_ALLOWED', `${p} is not in the permission budget`);
  }
  if (manifest.optional_host_permissions && manifest.optional_host_permissions.length) {
    add('OPTIONAL_HOSTS', 'optional_host_permissions would let the extension widen itself at runtime');
  }

  const hosts = manifest.host_permissions || [];
  for (const h of hosts) {
    if (!isExactHostPattern(h)) {
      add('HOST_NOT_EXACT', `${h} is not an exact https origin pattern (https://host/*). Wildcard schemes and hosts are refused.`);
    }
  }

  const scripts = manifest.content_scripts || [];
  for (const cs of scripts) {
    for (const m of cs.matches || []) {
      if (m === '<all_urls>' || !isExactHostPattern(m)) {
        add('MATCH_NOT_EXACT', `content script match ${m} is not an exact https origin pattern`);
      } else if (!hosts.includes(m)) {
        add('MATCH_WITHOUT_HOST', `content script match ${m} has no matching host permission`);
      }
    }
    if (cs.all_frames === true) add('ALL_FRAMES', 'content scripts must not run in every frame of a seller page');
    if (cs.world === 'MAIN') add('MAIN_WORLD', 'a MAIN world script shares JavaScript state with the page it is meant to distrust');
    if (cs.match_about_blank || cs.match_origin_as_fallback) {
      add('MATCH_FALLBACK', 'match_about_blank and match_origin_as_fallback widen matching past the declared origins');
    }
  }
  if (scripts.length === 0) add('NO_CONTENT_SCRIPT', 'the shell declares one content script against the seller origins');

  if (manifest.externally_connectable) {
    add('EXTERNALLY_CONNECTABLE', 'externally_connectable lets a web page message the service worker directly, bypassing the content script boundary');
  }
  const war = manifest.web_accessible_resources || [];
  if (war.length) add('WEB_ACCESSIBLE_RESOURCES', 'no resource is exposed to pages: the confirmation is rendered in the popup, never in the page (ADR-003)');

  const csp = manifest.content_security_policy && manifest.content_security_policy.extension_pages;
  if (typeof csp !== 'string') add('CSP_MISSING', 'extension_pages CSP must be set explicitly');
  else if (/unsafe-eval|unsafe-inline|https?:|\*/.test(csp)) add('CSP_LOOSE', 'extension_pages CSP must allow only same-origin script');

  if (!manifest.background || typeof manifest.background.service_worker !== 'string') {
    add('NO_SERVICE_WORKER', 'quoting and chain reads run in the service worker (ADR-003)');
  }
  if (!manifest.action || typeof manifest.action.default_popup !== 'string') {
    add('NO_POPUP', 'the popup is where the buyer confirms and signs (ADR-003)');
  }

  return { ok: problems.length === 0, problems };
}

module.exports = {
  ManifestError,
  MANIFEST_VERSION,
  ALLOWED_PERMISSIONS,
  REFUSED_PERMISSIONS,
  buildManifest,
  validateManifest,
};
