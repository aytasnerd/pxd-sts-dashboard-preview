/*
 * Seed Varieties of India — seed variety dashboard runtime
 * (Precision Development)
 *
 * Design notes:
 *   - Single IIFE; no module imports, no globals beyond `window` listeners.
 *   - varieties_complete.json is the only source of truth. Filter options,
 *     KPI numbers, and table rows all derive from STATE.all (never embedded
 *     in HTML).
 *   - Normalization happens once at load. Internal "_year_int" / "_dtm_int"
 *     fields are added so sort and range filters can run against numbers
 *     even though the source schema mixes integer and free-text values.
 *   - All DOM mutation goes through a small set of named render functions
 *     so the call graph stays auditable: applyFilters → renderTable +
 *     renderPagination + updateResultCount + renderKPIs (idempotent).
 *   - Tailwind is intentionally NOT loaded; style.css carries the full
 *     design system. This keeps the page fully usable offline of any CDN.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Constants                                                          *
   * ------------------------------------------------------------------ */

  const JSON_PATH = './final_varieties_hyperlinked.json';

  // Column registry. The order here is the table render order, and the
  // `key` is the canonical schema field used for sort + visibility toggle.
  // Variety Name is marked alwaysVisible so the toggle UI hides it from
  // the togglable list per spec (rows must always identify themselves).
  // legacy search-hit columns stay available in the Columns menu but start hidden
  const HIDDEN_BY_DEFAULT = new Set(['stress_tolerance', 'stress_types', 'seasons', 'days_to_maturity', 'evidence_quality', 'enrichment_wave']);
  const COLUMNS = [
    { key: 'crop',              label: 'Crop' },
    { key: 'variety_name',      label: 'Variety Name', alwaysVisible: true },
    { key: 'year_of_release',   label: 'Year' },
    { key: 'stress_tolerance',  label: 'Stress Tolerant (search hits)' },
    { key: '_stress_evidence', label: 'Stress evidence' },
    { key: 'stress_types',      label: 'Stress Types (search hits)' },
    { key: '_stress_types_display', label: 'Stress types' },
    { key: 'publications_count', label: 'Publications' },
    { key: 'enrichment_wave',   label: 'Data wave' },
    { key: 'states_acronyms',   label: 'States' },
    { key: 'seasons',           label: 'Seasons' },
    { key: 'days_to_maturity',  label: 'Days to Maturity' },
    { key: 'evidence_quality',  label: 'Evidence' },
    { key: 'seednet_available', label: 'Seednet' }
  ];

  // Stable filter vocabularies for the small fixed-domain filters. Kept in
  // JS (not HTML) so the spec rule "no hardcoded option values in HTML"
  // is satisfied while still presenting a predictable UI.
  const VOCAB_EVIDENCES = ['High', 'Medium', 'Low'];
  const VOCAB_STRESS_TOL = ['Yes', 'No'];
  const VOCAB_STRESS_EVIDENCE = ['Confirmed by 2+ sources', 'Single source', 'Claimed, not confirmed', 'No stress tolerance claimed', 'Not checked', 'Not researched'];
  const VOCAB_RESEARCH = ['Researched', 'Official data only'];
  const VOCAB_SEEDNET = ['Linked', 'Not linked'];
  const STRESS_KEYS = ['drought', 'heat', 'salinity', 'flood', 'submergence'];
  const STRESS_NAME = { drought: 'Drought', heat: 'Heat', salinity: 'Salinity', salt: 'Salinity', flood: 'Flood', submergence: 'Submergence' };
  const SEEDNET_CONFIRMED = new Set(['confirmed_exact', 'confirmed_spelling']);
  const SELECT_FILTER_IDS = ['filter-crop', 'filter-state', 'filter-stress-tol', 'filter-evidence',
    'filter-stress-type', 'filter-stress-evidence', 'filter-research', 'filter-seednet',
    'filter-institution', 'filter-contact'];

  const STATE_CODE_TO_NAME = {
    AP: 'Andhra Pradesh', AR: 'Arunachal Pradesh', AS: 'Assam', BR: 'Bihar',
    CG: 'Chhattisgarh', DL: 'Delhi', GA: 'Goa', GJ: 'Gujarat', HR: 'Haryana',
    HP: 'Himachal Pradesh', JH: 'Jharkhand', JK: 'Jammu & Kashmir',
    KA: 'Karnataka', KL: 'Kerala', LA: 'Ladakh', MH: 'Maharashtra',
    ML: 'Meghalaya', MN: 'Manipur', MP: 'Madhya Pradesh', MZ: 'Mizoram',
    NL: 'Nagaland', OR: 'Odisha', PB: 'Punjab', PY: 'Puducherry', RJ: 'Rajasthan',
    SK: 'Sikkim', TG: 'Telangana', TN: 'Tamil Nadu', TR: 'Tripura',
    UK: 'Uttarakhand', UP: 'Uttar Pradesh', WB: 'West Bengal',
    AN: 'Andaman & Nicobar Islands', CH: 'Chandigarh',
    DD: 'Dadra & Nagar Haveli and Daman & Diu',
    LD: 'Lakshadweep'
  };

  // Seednet sub-fields we deliberately suppress in the modal: source/audit
  // metadata that adds noise without informing the end user, plus duplicate
  // identifiers already shown at the variety header.
  const SEEDNET_SKIP_KEYS = new Set([
    'source_file', 'consolidation_group', 'consolidation_timestamp',
    'variety_id', 'variety_name', 'source_url'
  ]);

  // Curated seednet field display order so the dialog reads like a spec
  // sheet rather than a hash dump. Any keys not listed here are appended
  // at the end alphabetically — preserves "render ALL fields" requirement.
  const SEEDNET_FIELD_ORDER = [
    'Group Name', 'Crop Name', 'Notification Number', 'Notification Date',
    'State Central Variety', 'Year of Release',
    'Institution Responsible for developing Breeder Seed', 'Parentage',
    'Resemblence to Variety', 'Adaptation and recommended ecology',
    'Maturity (in days)', 'Agronomic Features', 'Seed Rate (Kg/Ha)',
    'Specific Morphological Characteristics',
    'General Morphological Characteristics', 'Reaction to Stress',
    'Reaction to Major Diseases', 'Reaction to Major Pests',
    'Average Yield (Kg/Ha)', 'Spacing (in Cms)', 'Fertiliser Dosage (Kg/Ha)',
    'Recommended States'
  ];

  /* ------------------------------------------------------------------ *
   * State                                                              *
   * ------------------------------------------------------------------ */

  const STATE = {
    all: [],
    filtered: [],
    sort: { key: null, dir: 'asc' },
    page: { size: 25, index: 1 },
    columns: COLUMNS.reduce((acc, c) => { acc[c.key] = !HIDDEN_BY_DEFAULT.has(c.key); return acc; }, {}),
    modal: { open: false, record: null, tab: 'seednet', lastFocus: null, mode: 'variety' },
    meta: {
      loadedAt: null,
      vocab: {
        crops: [], states: [], stressTypes: [],
        evidences: VOCAB_EVIDENCES.slice(),
        stressTols: VOCAB_STRESS_TOL.slice()
      }
    }
  };

  /* ------------------------------------------------------------------ *
   * DOM helpers                                                        *
   * ------------------------------------------------------------------ */

  const $ = (id) => document.getElementById(id);

  // textContent setter that gracefully no-ops if the element vanished.
  const setText = (id, value) => { const el = $(id); if (el) el.textContent = value; };

  // Minimal HTML-escaping for any user/data-derived string we interpolate
  // into HTML. We render most things via textContent, but a few badges /
  // multi-line cells use innerHTML for layout — those go through this.
  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const uniqSorted = (arr) =>
    Array.from(new Set(arr.filter(v => v !== '' && v != null))).sort((a, b) =>
      String(a).localeCompare(String(b), undefined, { sensitivity: 'base' })
    );

  function toTitleCase(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/\b([a-z])/g, (m, c) => c.toUpperCase());
  }

  function normalizeStateToken(token) {
    const raw = String(token || '').trim().toUpperCase();
    if (!raw) return '';
    // Drop obvious parser junk / placeholders.
    if (/^\[\]$/.test(raw) || /UNKNOWN|UNK|NAN|NOT|INF/.test(raw)) return '';
    if (/[\[\]'"]/g.test(raw)) return '';
    if (raw.length > 4) return '';

    const alias = {
      TS: 'TG', TEL: 'TG', UTT: 'UK', UTR: 'UK', JAM: 'JK', NCR: 'DL', NCT: 'DL'
    };
    const code = alias[raw] || raw;
    return STATE_CODE_TO_NAME[code] ? code : '';
  }

  function normalizeCropName(name) {
    const raw = String(name || '').trim();
    if (!raw) return '';
    let v = toTitleCase(raw)
      .replace(/\s+/g, ' ')
      .replace(/\s*\(Hybrid\)\s*/gi, ' Hybrid')
      .replace(/\/\s*/g, '/');
    const alias = {
      'Bread wheat': 'Bread Wheat',
      'Durum wheat': 'Durum Wheat',
      'Pearl millet': 'Pearl Millet',
      'Finger millet': 'Finger Millet',
      'Indian mustard': 'Indian Mustard',
      'Ground nut': 'Groundnut',
      'Ground Nut': 'Groundnut',
      'Green gram': 'Green Gram',
      'Black gram': 'Black Gram',
      'Mung bean': 'Mungbean',
      'Field pea': 'Field Pea',
      'Pigeon pea': 'Pigeonpea',
      'Gobhi sarson': 'Gobhi Sarson'
    };
    return alias[v] || v;
  }

  // Deep stringify helper used to build a single searchable blob per record.
  // This keeps filter latency low (one precomputed string lookup) while
  // allowing full-text search to cover nested research + seednet details.
  function flattenText(value) {
    if (value == null) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (Array.isArray(value)) return value.map(flattenText).join(' ');
    if (typeof value === 'object') {
      return Object.values(value).map(flattenText).join(' ');
    }
    return '';
  }

  function normStressName(s) {
    const k = String(s || '').trim().toLowerCase();
    if (!k) return '';
    return STRESS_NAME[k] || (k.charAt(0).toUpperCase() + k.slice(1));
  }
  function uniq(arr) { return Array.from(new Set(arr.filter(Boolean))); }

  // True for values that carry no information: empty, placeholders such as
  // "Not specified" / "N/A" / "-", and the extraction stubs found in the CSC
  // minutes ("Not explicitly stated in provided fragment").
  function isBlankish(v) {
    if (v == null) return true;
    if (Array.isArray(v)) return v.every(isBlankish);
    if (typeof v === 'object') return Object.keys(v).length === 0 || Object.values(v).every(isBlankish);
    const t = String(v).trim();
    if (!t) return true;
    return /^(nan|none|null|undefined|n\/a|na|-|—|–|not specified|unknown|not found\.?)$/i.test(t)
      || /^not (specified|explicitly stated|available|extracted|stated)\b/i.test(t)
      || /^n\/a\b/i.test(t);
  }
  function humanKey(k) {
    const t = String(k || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  // Plain-text rendering of any value (string, number, list, object).
  function asText(v) {
    if (v == null) return '';
    if (Array.isArray(v)) return v.filter(x => !isBlankish(x)).map(asText).join('; ');
    if (typeof v === 'object') return Object.keys(v).filter(k => !isBlankish(v[k])).map(k => humanKey(k) + ': ' + asText(v[k])).join('; ');
    return String(v).replace(/\s+/g, ' ').trim();
  }
  function linkHtml(u, label) {
    return u ? '<a target="_blank" rel="noopener" href="' + esc(u) + '">' + esc(label || u) + '</a>' : '';
  }

  /* ------------------------------------------------------------------ *
   * Bootstrap                                                          *
   * ------------------------------------------------------------------ */

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bindStaticHandlers();
    await loadData();
  }

  function bindStaticHandlers() {
    $('btn-reload').addEventListener('click', loadData);
    $('btn-retry').addEventListener('click', loadData);
    $('btn-error-dismiss').addEventListener('click', () => $('error-banner').hidden = true);
    $('btn-about').addEventListener('click', openAboutModal);
    $('btn-reset').addEventListener('click', resetFilters);

    // Table controls
    $('select-page-size').addEventListener('change', (e) => {
      STATE.page.size = parseInt(e.target.value, 10) || 25;
      STATE.page.index = 1;
      renderTable();
      renderPagination();
    });
    $('btn-prev').addEventListener('click', () => goToPage(STATE.page.index - 1));
    $('btn-next').addEventListener('click', () => goToPage(STATE.page.index + 1));
    $('btn-export-csv').addEventListener('click', exportFilteredCSV);

    // Columns dropdown — toggle open/close, with outside-click to dismiss.
    const colsBtn = $('btn-columns');
    const colsMenu = $('columns-menu');
    colsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const opening = colsMenu.hidden;
      colsMenu.hidden = !opening;
      colsBtn.setAttribute('aria-expanded', String(opening));
    });
    document.addEventListener('click', (e) => {
      if (!$('columns-wrap').contains(e.target)) {
        colsMenu.hidden = true;
        colsBtn.setAttribute('aria-expanded', 'false');
      }
    });

    // Filter inputs — debounce search to keep render cheap on key-mash.
    $('filter-search').addEventListener('input', debounce(applyFilters, 120));
    SELECT_FILTER_IDS.forEach(id => $(id).addEventListener('change', applyFilters));
    $('filter-year-min').addEventListener('input', debounce(applyFilters, 200));
    $('filter-year-max').addEventListener('input', debounce(applyFilters, 200));

    // Modal — backdrop and × buttons share a data-modal-close marker so we
    // can attach a single delegated handler per the spec's keyboard rules.
    $('detail-modal').addEventListener('click', (e) => {
      if (e.target.closest('[data-modal-close]')) closeModal();
    });
    document.addEventListener('keydown', onModalKeydown);
  }

  function debounce(fn, ms) {
    let t;
    return function () {
      clearTimeout(t);
      const args = arguments;
      t = setTimeout(() => fn.apply(null, args), ms);
    };
  }

  /* ------------------------------------------------------------------ *
   * Data load + normalization                                          *
   * ------------------------------------------------------------------ */

  async function loadData() {
    showLoading();
    hideError();
    try {
      // Cache-bust on reload so users always see the freshest JSON without
      // forcing a hard refresh; one-time fetch on load benefits from cache.
      const bust = STATE.meta.loadedAt ? '?t=' + Date.now() : '';
      const opts = { cache: STATE.meta.loadedAt ? 'no-store' : 'default' };
      let data;
      // Sharded data (GitHub keeps files under 100 MB): data/index.json lists the parts. Single-file fallback kept.
      const DATA_VERSION = (document.currentScript && document.currentScript.src.split('v=')[1]) || String(Date.now());
      const idx = await fetch('./data/index.json?v=' + DATA_VERSION + (bust ? '&t=' + Date.now() : ''), opts).catch(() => null);
      if (idx && idx.ok) {
        const meta = await idx.json(); STATE.meta.built = meta.built || ''; const parts = meta.parts || []; const built = encodeURIComponent(meta.built || DATA_VERSION);
        const chunks = await Promise.all(parts.map(async p => { const r = await fetch('./' + p + '?v=' + built + (bust ? '&t=' + Date.now() : ''), opts); if (!r.ok) throw new Error('HTTP ' + r.status + ' on ' + p); return r.json(); }));
        data = [].concat(...chunks);
      } else {
        const res = await fetch(JSON_PATH + bust, opts);
        if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText);
        data = await res.json();
      }
      if (!Array.isArray(data)) throw new Error('Expected JSON array, got ' + typeof data);

      STATE.all = data.map(normalizeRecord);
      STATE.meta.loadedAt = new Date();
      buildVocabularies();

      // First-load wiring: filter options + column toggles are populated
      // from STATE.all so the UI cannot present a value the data lacks.
      populateFilterOptions();
      renderColumnsMenu();
      renderTableHead();
      renderKPIs();

      applyFilters();         // also calls renderTable + renderPagination
      stampLastUpdated();
    } catch (err) {
      console.error('[STS Dashboard] data load failed:', err);
      showError(err && err.message ? err.message : String(err));
      STATE.all = [];
      STATE.filtered = [];
      renderTable();
      renderPagination();
      updateResultCount();
    } finally {
      hideLoading();
    }
  }

  // Idempotent: re-running normalizeRecord on its own output is a no-op.
  // The synthetic underscore-prefixed fields exist only for sort/filter use
  // and are never persisted back to the source JSON.
  function normalizeRecord(r) {
    const rec = Object.assign({}, r);

    rec.variety_id = String(r.variety_id || '');
    rec.crop_raw = String(r.crop || '').trim();
    rec.crop = String(r.crop_clean || r.crop || '').trim();  // canonical crop label (standardize.py); raw CSC/Seednet spelling kept in crop_raw
    rec._crop_norm = normalizeCropName(r.crop_clean || rec.crop);
    rec.variety_name = String(r.variety_name || '').trim();

    // Year: keep original string for display, derive integer for math.
    const yRaw = r.year_of_release == null ? '' : String(r.year_of_release).trim();
    rec.year_of_release = yRaw;
    const yInt = parseInt(yRaw, 10);
    rec._year_int = Number.isFinite(yInt) ? yInt : NaN;

    rec.stress_tolerance = (r.stress_tolerance === 'Yes' || r.stress_tolerance === 'No')
      ? r.stress_tolerance : '';
    rec.key_attributes = String(r.key_attributes || '').trim();
    rec.states_acronyms = String(r.states_acronyms_clean || r.states_acronyms || '').trim();
    rec._state_tokens = rec.states_acronyms
      ? rec.states_acronyms.split(',').map(s => s.trim()).filter(Boolean)
      : [];
    rec._state_norm_tokens = rec._state_tokens.map(normalizeStateToken).filter(Boolean);

    rec.states_full = Array.isArray(r.states_full_clean)
      ? r.states_full_clean.slice()
      : (Array.isArray(r.states_full) ? r.states_full.slice() : []);
    rec.seasons = String(r.seasons || '').trim();

    // days_to_maturity: schema documented as integer; reality is mixed
    // free-text. Preserve raw for display, parse first integer for sort.
    const dRaw = r.days_to_maturity;
    if (dRaw == null || dRaw === '') {
      rec._dtm_raw = '';
      rec._dtm_int = null;
    } else if (typeof dRaw === 'number' && Number.isFinite(dRaw)) {
      rec._dtm_raw = String(dRaw);
      rec._dtm_int = Math.trunc(dRaw);
    } else {
      const s = String(dRaw).trim();
      rec._dtm_raw = s;
      const m = s.match(/\d+/);
      rec._dtm_int = m ? parseInt(m[0], 10) : null;
    }
    // Override the visible field to use the raw (string-safe) value so the
    // table cell renderer can stay identical for both numeric and text data.
    rec.days_to_maturity = rec._dtm_raw;

    rec.stress_tolerance_strict = (r.stress_tolerance_strict === 'Yes' || r.stress_tolerance_strict === 'No' || r.stress_tolerance_strict === 'Unknown') ? r.stress_tolerance_strict : '';
    rec.stress_types_strict = uniq((Array.isArray(r.stress_types_strict) ? r.stress_types_strict : []).map(normStressName));
    rec.stress_confirmation_level = String(r.stress_confirmation_level || 'Not checked');
    rec.stress_types_confirmed = uniq((Array.isArray(r.stress_types_confirmed) ? r.stress_types_confirmed : []).map(normStressName));
    rec.stress_types_multi_source = uniq((Array.isArray(r.stress_types_multi_source) ? r.stress_types_multi_source : []).map(normStressName));
    rec.stress_confirmation = (r.stress_confirmation && typeof r.stress_confirmation === 'object') ? r.stress_confirmation : {};
    rec.research_refers_to = String(r.research_refers_to || '');
    rec.csc_fields = (r.csc_fields && typeof r.csc_fields === 'object') ? r.csc_fields : {};
    rec.official_sources = (r.official_sources && typeof r.official_sources === 'object') ? r.official_sources : {};
    rec.contacts_structured = (r.contacts_structured && typeof r.contacts_structured === 'object') ? r.contacts_structured : {};
    rec.enrichment_wave_raw = String(r.enrichment_wave || '');
    rec._researched = !!rec.enrichment_wave_raw && rec.enrichment_wave_raw !== 'not_researched';
    // Table stress column + stress-type filter: independently confirmed types;
    // until the confirmation pass has run, the research-level list.
    rec._stress_graded = rec.stress_confirmation_level !== 'Not checked' && rec.stress_confirmation_level !== 'Not researched';
    rec._stress_types_display = rec._stress_graded ? rec.stress_types_confirmed : rec.stress_types_strict;
    rec._stress_evidence = rec._stress_graded ? rec.stress_confirmation_level
      : !rec._researched ? 'Not researched'
      : (rec.stress_types_strict.length ? 'Reported in research' : 'None found');
    rec.developer_institution_csc = r.developer_institution_csc || '';
    const _cs = r.contacts_structured || {};
    rec.institution_std = String(_cs.institution || r.developer_institution_csc || '').trim();
    rec.has_contact = ((_cs.emails || []).length || (_cs.phones || []).length || (_cs.breeder_names || []).length) ? 'Yes' : 'No'; rec.developer_location_csc = r.developer_location_csc || '';
    rec.publications_count = (Number(r.publications_scholar_count) || 0) + (Number(r.publications_openalex_count) || 0);
    rec.enrichment_wave = !rec.enrichment_wave_raw ? '' : !rec._researched ? 'Official data only'
      : rec.enrichment_wave_raw.replace('enhanced_v2.1_20250808', 'Aug 2025').replace(/enhanced_v3\.\d_20261022_claude/, 'Oct–Nov 2026');
    rec.evidence_quality = (r.evidence_quality === 'High' || r.evidence_quality === 'Medium'
      || r.evidence_quality === 'Low') ? r.evidence_quality : '';

    // stress_types: spec says "if array empty, split key_attributes". This
    // protects the stress-type badges and filter even when upstream omits.
    if (Array.isArray(r.stress_types) && r.stress_types.length) {
      rec.stress_types = r.stress_types.map(s => String(s).trim()).filter(Boolean);
    } else if (rec.key_attributes) {
      rec.stress_types = rec.key_attributes.split(',').map(s => s.trim()).filter(Boolean);
    } else {
      rec.stress_types = [];
    }

    rec.seednet_match = String(r.seednet_match || '');
    rec.seednet_match_status = String(r.seednet_match_status || '');
    rec.seednet_candidate = (r.seednet_candidate && typeof r.seednet_candidate === 'object') ? r.seednet_candidate : null;
    rec.seednet_rematched = r.seednet_rematched === true;
    rec.seednet_available = !!r.seednet_available;
    rec.seednet_url = String(r.seednet_url || '').trim();
    rec.seednet_variety_id = String(r.seednet_variety_id || '').trim();
    rec.seednet_fields = (r.seednet_fields && typeof r.seednet_fields === 'object')
      ? r.seednet_fields : {};
    rec.research_data = (r.research_data && typeof r.research_data === 'object')
      ? r.research_data : {};
    rec.search_metadata = (r.search_metadata && typeof r.search_metadata === 'object')
      ? r.search_metadata : {};
    rec.query_links = Array.isArray(r.query_links) ? r.query_links.slice() : [];
    rec.direct_source_links = Array.isArray(r.direct_source_links) ? r.direct_source_links.slice() : [];
    rec.trusted_stress_types = Array.isArray(r.trusted_stress_types)
      ? r.trusted_stress_types.slice()
      : [];

    // Synthesised flag — kept distinct from seednet_available so the UI can
    // remain usable even if the upstream JSON omits the optional nested
    // `seednet_fields` object. We treat Seednet as \"available\" only when:
    //   - seednet_available is true AND
    //   - there is either a usable seednet_fields payload OR a portal link.
    const seednetFieldKeys = Object.keys(rec.seednet_fields || {})
      .filter(k => !SEEDNET_SKIP_KEYS.has(k));
    rec._has_seednet = !!(rec.seednet_available
      && (!rec.seednet_match_status || SEEDNET_CONFIRMED.has(rec.seednet_match_status)) && (
      seednetFieldKeys.length > 0 || rec.seednet_url || rec.seednet_variety_id
    ));
    rec._has_research = !!(r.research_data && typeof r.research_data === 'object');
    rec._search_blob = (
      rec.variety_name + ' ' + rec.crop + ' ' + rec.key_attributes + ' '
      + rec.states_acronyms + ' ' + rec.stress_tolerance + ' '
      + rec.evidence_quality + ' ' + rec.seasons + ' '
      + flattenText(rec.states_full) + ' '
      + flattenText(rec.stress_types) + ' '
      + flattenText(rec.seednet_fields) + ' '
      + flattenText(rec.csc_fields) + ' '
      + String(rec.contacts_structured.institution || '') + ' '
      + flattenText(rec.research_data) + ' '
      + flattenText(rec.search_metadata)
    ).toLowerCase();

    return rec;
  }

  function buildVocabularies() {
    STATE.meta.vocab.crops = uniqSorted(STATE.all.map(r => r._crop_norm || r.crop));
    STATE.meta.vocab.states = uniqSorted(STATE.all.flatMap(r => r._state_norm_tokens));
    STATE.meta.vocab.stressTypes = uniqSorted(STATE.all.flatMap(r => r._stress_types_display));
    STATE.meta.vocab.institutions = uniqSorted(STATE.all.map(r => r.institution_std).filter(Boolean));
  }

  /* ------------------------------------------------------------------ *
   * Filter UI population                                               *
   * ------------------------------------------------------------------ */

  function populateFilterOptions() {
    fillSelect('filter-crop', STATE.meta.vocab.crops);
    fillSelect('filter-state', STATE.meta.vocab.states);
    fillSelect('filter-stress-tol', STATE.meta.vocab.stressTols);
    fillSelect('filter-evidence', STATE.meta.vocab.evidences);
    fillSelect('filter-stress-type', STATE.meta.vocab.stressTypes);
    // Fixed order for the known levels, then any other level present in the data.
    const levels = new Set(STATE.all.map(r => r.stress_confirmation_level));
    fillSelect('filter-stress-evidence', VOCAB_STRESS_EVIDENCE.filter(l => levels.has(l))
      .concat(uniqSorted(Array.from(levels).filter(l => VOCAB_STRESS_EVIDENCE.indexOf(l) === -1))));
    fillSelect('filter-research', VOCAB_RESEARCH);
    fillSelect('filter-seednet', VOCAB_SEEDNET);
    fillSelect('filter-institution', STATE.meta.vocab.institutions);
    fillSelect('filter-contact', ['Yes', 'No']);

    // Seed the year-range placeholders with the actual min/max so users
    // know the legitimate bounds without us having to label them inline.
    const years = STATE.all.map(r => r._year_int).filter(Number.isFinite);
    if (years.length) {
      const yMin = Math.min(...years), yMax = Math.max(...years);
      $('filter-year-min').placeholder = 'From (' + yMin + ')';
      $('filter-year-max').placeholder = 'To (' + yMax + ')';
    }
  }

  function fillSelect(id, values) {
    const el = $(id);
    if (!el) return;
    if (id === 'filter-state') {
      el.innerHTML = (el.multiple ? '' : '<option value="">All</option>') + values
        .map(v => '<option value="' + esc(v) + '">' + esc((STATE_CODE_TO_NAME[v] || v) + ' (' + v + ')') + '</option>')
        .join('');
      return;
    }
    const allOpt = el.multiple ? '' : '<option value="">All</option>';
    el.innerHTML = allOpt + values.map(v => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join('');
  }

  function getSelectedMulti(id) {
    const el = $(id);
    return el ? Array.from(el.selectedOptions).map(o => o.value).filter(v => v !== '') : [];
  }

  /* ------------------------------------------------------------------ *
   * Filter pipeline                                                    *
   * ------------------------------------------------------------------ */

  function applyFilters() {
    const q = ($('filter-search').value || '').trim().toLowerCase();
    const qTokens = q ? q.split(/\s+/).filter(Boolean) : [];
    const crops = getSelectedMulti('filter-crop');
    const states = getSelectedMulti('filter-state');
    const stressTols = getSelectedMulti('filter-stress-tol');
    const evidences = getSelectedMulti('filter-evidence');
    const stressTypes = getSelectedMulti('filter-stress-type');
    const stressEv = getSelectedMulti('filter-stress-evidence');
    const research = getSelectedMulti('filter-research');
    const seednet = getSelectedMulti('filter-seednet');
    const institutions = getSelectedMulti('filter-institution');
    const contacts = getSelectedMulti('filter-contact');
    const yMin = parseInt($('filter-year-min').value, 10);
    const yMax = parseInt($('filter-year-max').value, 10);
    const yMinSet = Number.isFinite(yMin);
    const yMaxSet = Number.isFinite(yMax);

    STATE.filtered = STATE.all.filter(r => {
      // 1. Search.
      if (q) {
        // "Nicer" search semantics:
        // - single term behaves broad (substring anywhere in prebuilt blob)
        // - multiple terms are AND-combined, improving precision for long
        //   queries like "rice drought Punjab high evidence".
        const hay = r._search_blob || '';
        if (qTokens.length <= 1) {
          if (hay.indexOf(q) === -1) return false;
        } else {
          for (let i = 0; i < qTokens.length; i++) {
            if (hay.indexOf(qTokens[i]) === -1) return false;
          }
        }
      }
      // 2. Crop.
      if (crops.length && crops.indexOf(r._crop_norm || r.crop) === -1) return false;
      // 3. State (any token match).
      if (states.length && !r._state_norm_tokens.some(t => states.indexOf(t) !== -1)) return false;
      // 4. Stress tolerance.
      if (stressTols.length && stressTols.indexOf(r.stress_tolerance) === -1) return false;
      // 5. Evidence quality.
      if (evidences.length && evidences.indexOf(r.evidence_quality) === -1) return false;
      // 6. Stress type (any match).
      if (stressTypes.length && !stressTypes.some(t => r._stress_types_display.indexOf(t) !== -1)) return false;
      // 7. Stress evidence level, research status, Seednet link.
      if (stressEv.length && stressEv.indexOf(r.stress_confirmation_level) === -1) return false;
      if (research.length && research.indexOf(r._researched ? 'Researched' : 'Official data only') === -1) return false;
      if (seednet.length && seednet.indexOf(r._has_seednet ? 'Linked' : 'Not linked') === -1) return false;
      if (institutions.length && institutions.indexOf(r.institution_std) === -1) return false;
      if (contacts.length && contacts.indexOf(r.has_contact) === -1) return false;
      // 8. Year range. Records with no parseable year drop out only when
      //    a bound is set, so the default "no range" view shows everything.
      if (yMinSet || yMaxSet) {
        if (!Number.isFinite(r._year_int)) return false;
        if (yMinSet && r._year_int < yMin) return false;
        if (yMaxSet && r._year_int > yMax) return false;
      }
      return true;
    });

    STATE.page.index = 1;
    renderTable();
    renderPagination();
    updateResultCount();
  }

  function resetFilters() {
    SELECT_FILTER_IDS.forEach(id => { const el = $(id); if (el) el.value = ''; });
    $('filter-search').value = '';
    $('filter-year-min').value = '';
    $('filter-year-max').value = '';
    STATE.sort = { key: null, dir: 'asc' };
    renderTableHead();
    applyFilters();
  }

  /* ------------------------------------------------------------------ *
   * Render: KPIs                                                       *
   * ------------------------------------------------------------------ */

  // Counts shared by the intro paragraph and the About dialog. Always
  // derived from the loaded records, never hard-coded.
  function datasetStats() {
    const all = STATE.all;
    const years = all.map(r => r._year_int).filter(Number.isFinite);
    const researched = all.filter(r => r._researched);
    const checked = researched.filter(r => r._stress_graded);
    const lvl = {};
    VOCAB_STRESS_EVIDENCE.forEach(l => { lvl[l] = researched.filter(r => r.stress_confirmation_level === l).length; });
    return {
      total: all.length,
      yMin: years.length ? Math.min(...years) : '',
      yMax: years.length ? Math.max(...years) : '',
      crops: new Set(all.map(r => r._crop_norm || r.crop).filter(Boolean)).size,
      states: STATE.meta.vocab.states.length,
      seednet: all.filter(r => r._has_seednet).length,
      seednetSpelling: all.filter(r => r._has_seednet && r.seednet_match_status === 'confirmed_spelling').length,
      differentVariety: all.filter(r => r.seednet_match_status === 'different_variety').length,
      researched: researched.length,
      waveAug: researched.filter(r => r.enrichment_wave === 'Aug 2025').length,
      waveOct: researched.filter(r => r.enrichment_wave === 'Oct–Nov 2026').length,
      notResearched: all.length - researched.length,
      checked: checked.length,
      stressOne: researched.filter(r => r.stress_confirmation_level === 'Confirmed by 2+ sources' || r.stress_confirmation_level === 'Single source').length,
      stressTwo: researched.filter(r => r.stress_confirmation_level === 'Confirmed by 2+ sources').length,
      stressReported: researched.filter(r => r.stress_types_strict.length).length,
      levels: lvl,
      officialGraded: all.filter(r => !r._researched && r._stress_graded).length,
      withContact: all.filter(r => r.has_contact === 'Yes').length
    };
  }

  function renderIntro() {
    const el = $('intro-text');
    if (!el || !STATE.all.length) return;
    const s = datasetStats();
    const n = v => Number(v).toLocaleString();
    const span = s.yMin && s.yMax ? ', ' + s.yMin + '–' + s.yMax : '';
    const stress = s.checked
      ? n(s.stressOne) + ' of those have stress tolerance (drought, heat, salinity, flood, submergence) supported by at least one source naming the variety, ' + n(s.stressTwo) + ' by two or more.'
      : n(s.stressReported) + ' of those report stress tolerance (drought, heat, salinity, flood, submergence) in the cited research; the independent-source check has not been run on this build.';
    el.innerHTML = 'Seed variety dashboard of <strong id="about-count">' + n(s.total) + '</strong> crop varieties considered by the Central Sub-Committee on Crop Standards, Notification and Release of Varieties (CSC)' + esc(span) + '. '
      + n(s.seednet) + ' are linked to their Seednet (Government of India) record by exact name and crop; '
      + n(s.researched) + ' have web research (two waves, Aug 2025 and Oct–Nov 2026) and ' + esc(stress) + ' '
      + 'Every record names its official source document, and contact details of the developing institution where published.';
  }

  function renderKPIs() {
    renderIntro();
    const all = STATE.all;
    const total = all.length;
    const stressYes = all.filter(r => r.stress_tolerance === 'Yes').length;
    const stressStrict = all.filter(r => r.stress_tolerance_strict === 'Yes').length;
    const highEv = all.filter(r => r.evidence_quality === 'High').length;
    const crops = new Set(all.map(r => r.crop).filter(Boolean)).size;
    const withPubs = all.filter(r => r.publications_count > 0).length;

    [['kpi-total', total], ['kpi-stress', stressYes], ['kpi-stress-strict', stressStrict], ['kpi-pubs', withPubs],
     ['kpi-high-ev', highEv], ['kpi-crops', crops]].forEach(([id, val]) => {
      const el = $(id);
      if (el) {
        el.textContent = val.toLocaleString();
        el.removeAttribute('aria-busy');
      }
    });
  }

  function stampLastUpdated() {
    if (!STATE.meta.loadedAt) return;
    const d = STATE.meta.loadedAt;
    const el = $('last-updated');
    if (!el) return;
    el.dateTime = d.toISOString();
    el.textContent = d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  }

  function updateResultCount() {
    const total = STATE.all.length;
    const shown = STATE.filtered.length;
    if (!total) {
      setText('result-count', 'No varieties loaded.');
    } else if (shown === total) {
      setText('result-count', 'Showing all ' + total.toLocaleString() + ' varieties');
    } else {
      setText('result-count',
        'Showing ' + shown.toLocaleString() + ' of ' + total.toLocaleString() + ' varieties');
    }
  }

  /* ------------------------------------------------------------------ *
   * Render: Columns menu + table head                                  *
   * ------------------------------------------------------------------ */

  function renderColumnsMenu() {
    const menu = $('columns-menu');
    menu.innerHTML = COLUMNS.map(c => {
      const checked = STATE.columns[c.key] ? 'checked' : '';
      const disabled = c.alwaysVisible ? 'disabled' : '';
      return '<label class="dropdown__item">'
        + '<input type="checkbox" data-col="' + esc(c.key) + '" ' + checked + ' ' + disabled + ' />'
        + ' ' + esc(c.label) + (c.alwaysVisible ? ' <span class="dropdown__pin">always on</span>' : '')
        + '</label>';
    }).join('');
    menu.querySelectorAll('input[data-col]').forEach(cb => {
      cb.addEventListener('change', () => {
        STATE.columns[cb.dataset.col] = cb.checked;
        renderTableHead();
        renderTable();
      });
    });
  }

  function renderTableHead() {
    const thead = $('tbl-varieties').querySelector('thead');
    thead.innerHTML = '<tr>' + COLUMNS
      .filter(c => STATE.columns[c.key])
      .map(c => {
        const isSorted = STATE.sort.key === c.key;
        const ariaSort = isSorted ? (STATE.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
        const indicator = isSorted ? (STATE.sort.dir === 'asc' ? '▲' : '▼') : '';
        return '<th scope="col" data-key="' + esc(c.key) + '" tabindex="0" '
          + 'role="columnheader" aria-sort="' + ariaSort + '" class="th-sort">'
          + '<span class="th-sort__label">' + esc(c.label) + '</span>'
          + '<span class="th-sort__indicator" aria-hidden="true">' + indicator + '</span>'
          + '</th>';
      }).join('') + '</tr>';

    thead.querySelectorAll('th[data-key]').forEach(th => {
      th.addEventListener('click', () => onSortClick(th.dataset.key));
      th.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSortClick(th.dataset.key);
        }
      });
    });
  }

  function onSortClick(key) {
    if (STATE.sort.key === key) {
      STATE.sort.dir = STATE.sort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      STATE.sort = { key: key, dir: 'asc' };
    }
    renderTableHead();
    renderTable();
  }

  /* ------------------------------------------------------------------ *
   * Render: table body + pagination                                    *
   * ------------------------------------------------------------------ */

  function renderTable() {
    const tbody = $('tbl-varieties').querySelector('tbody');
    let data = STATE.filtered.slice();
    if (STATE.sort.key) data = sortData(data, STATE.sort.key, STATE.sort.dir);

    const visibleCols = COLUMNS.filter(c => STATE.columns[c.key]);

    if (!STATE.all.length) {
      tbody.innerHTML = '<tr><td class="empty-row" colspan="' + visibleCols.length + '">'
        + 'No data loaded.</td></tr>';
      return;
    }
    if (!data.length) {
      tbody.innerHTML = '<tr><td class="empty-row" colspan="' + visibleCols.length + '">'
        + '<div class="empty-row__inner">'
        + '<p class="empty-row__title">No varieties match the current filters.</p>'
        + '<button id="btn-empty-reset" type="button" class="btn btn--primary">Reset filters</button>'
        + '</div></td></tr>';
      const reset = $('btn-empty-reset');
      if (reset) reset.addEventListener('click', resetFilters);
      return;
    }

    const start = (STATE.page.index - 1) * STATE.page.size;
    const pageItems = data.slice(start, start + STATE.page.size);

    tbody.innerHTML = pageItems.map((r, i) =>
      '<tr class="data-row" data-record-id="' + esc(r.variety_id) + '" tabindex="0" '
      + 'aria-label="Open details for ' + esc(r.variety_name || 'variety') + '">'
      + visibleCols.map(c => '<td class="td-' + esc(c.key) + '">' + renderCell(c.key, r) + '</td>').join('')
      + '</tr>'
    ).join('');

    tbody.querySelectorAll('.data-row').forEach(tr => {
      tr.addEventListener('click', () => openVarietyModal(tr.dataset.recordId));
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openVarietyModal(tr.dataset.recordId);
        }
      });
    });
  }

  function renderCell(key, r) {
    switch (key) {
      case 'crop':            return esc(r.crop || '—');
      case 'variety_name':    return '<span class="cell-variety">' + esc(r.variety_name || '—') + '</span>';
      case 'year_of_release': return r.year_of_release ? esc(r.year_of_release) : '—';
      case '_stress_evidence': {
        const v = r._stress_evidence;
        if (v === 'Confirmed by 2+ sources' || v === 'Single source' || v === 'Reported in research') return '<span class="badge badge--yes">' + esc(v) + '</span>';
        if (v === 'Claimed, not confirmed') return '<span class="badge">' + esc(v) + '</span>';
        return '<span class="muted">' + esc(v) + '</span>';
      }
      case '_stress_types_display':
        return r._stress_types_display.length ? r._stress_types_display.map(t => '<span class="badge badge--attr">' + esc(t) + '</span>').join(' ') : '<span class="muted">' + (r._researched ? 'none found' : '—') + '</span>';
      case 'publications_count':
        return r.publications_count ? esc(String(r.publications_count)) : '<span class="muted">0</span>';
      case 'enrichment_wave':
        return esc(r.enrichment_wave || '');
      case 'stress_tolerance': {
        const v = r.stress_tolerance;
        const cls = v === 'Yes' ? 'badge--stress-yes'
                  : v === 'No'  ? 'badge--stress-no'
                                : 'badge--neutral';
        return '<span class="badge ' + cls + '">' + esc(v || 'Unknown') + '</span>';
      }
      case 'stress_types': {
        if (!r.stress_types.length) return '<span class="muted">—</span>';
        const head = r.stress_types.slice(0, 3)
          .map(t => '<span class="badge badge--stress-type">' + esc(t) + '</span>').join(' ');
        const more = r.stress_types.length > 3
          ? ' <span class="badge badge--more" title="' + esc(r.stress_types.slice(3).join(', ')) + '">'
              + '+' + (r.stress_types.length - 3) + ' more</span>'
          : '';
        return head + more;
      }
      case 'states_acronyms': {
        // Show full state names truncated to ~40 chars, with the full set
        // available as title text for accessibility/discovery.
        const full = (r.states_full || []).join(', ');
        const code = r.states_acronyms || '—';
        const names = r.states_full || [];
        const display = names.length > 4 ? names.slice(0, 4).join(', ') + ' +' + (names.length - 4) + ' more' : (full || code);
        return '<span class="cell-states" title="' + esc(full || code) + '">' + esc(display) + '</span>';
      }
      case 'seasons':           return r.seasons ? esc(r.seasons) : '—';
      case 'days_to_maturity': {
        const raw = r._dtm_raw;
        if (!raw) return '<span class="muted">—</span>';
        // If the raw value is a "Not specified…" sentinel, render muted
        // so the reader can quickly distinguish absent vs informative data.
        const muted = /not specified/i.test(raw);
        return muted ? '<span class="muted">' + esc(raw) + '</span>' : esc(raw);
      }
      case 'evidence_quality': {
        const v = r.evidence_quality;
        const cls = v === 'High' ? 'badge--ev-high'
                  : v === 'Medium' ? 'badge--ev-medium'
                  : v === 'Low' ? 'badge--ev-low'
                                : 'badge--neutral';
        return '<span class="badge ' + cls + '">' + esc(v || 'Unknown') + '</span>';
      }
      case 'seednet_available':
        return r._has_seednet
          ? '<span class="dot dot--seednet" title="Seednet record available" aria-label="Seednet available"></span>'
          : '<span class="dot dot--off" aria-label="No Seednet record"></span>';
      default:
        return esc(r[key] != null ? r[key] : '—');
    }
  }

  // Sort with stable null-to-bottom semantics regardless of direction.
  // Numeric keys (year, dtm) compare as numbers; everything else collates
  // case-insensitively via Intl.
  function sortData(data, key, dir) {
    const mul = dir === 'desc' ? -1 : 1;
    const numericKey = key === 'year_of_release' ? '_year_int'
                     : key === 'days_to_maturity' ? '_dtm_int' : null;
    const isBool = key === 'seednet_available';
    const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

    return data.slice().sort((a, b) => {
      let av, bv, aNull, bNull;
      if (numericKey) {
        av = a[numericKey]; bv = b[numericKey];
        aNull = av == null || (typeof av === 'number' && !Number.isFinite(av));
        bNull = bv == null || (typeof bv === 'number' && !Number.isFinite(bv));
      } else if (isBool) {
        av = a[key] ? 1 : 0; bv = b[key] ? 1 : 0;
        aNull = false; bNull = false;
      } else if (Array.isArray(a[key]) || Array.isArray(b[key])) {
        av = (a[key] || []).join(', ');
        bv = (b[key] || []).join(', ');
        aNull = !av; bNull = !bv;
      } else {
        av = a[key]; bv = b[key];
        aNull = av == null || av === ''; bNull = bv == null || bv === '';
      }
      // Null-to-bottom irrespective of direction (spec).
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      if (numericKey || isBool) return (av - bv) * mul;
      return collator.compare(String(av), String(bv)) * mul;
    });
  }

  function renderPagination() {
    const total = STATE.filtered.length;
    const size = STATE.page.size;
    const pages = Math.max(1, Math.ceil(total / size));
    if (STATE.page.index > pages) STATE.page.index = pages;
    setText('page-info', 'Page ' + STATE.page.index + ' of ' + pages
      + ' · ' + total.toLocaleString() + ' record' + (total === 1 ? '' : 's'));
    $('btn-prev').disabled = STATE.page.index <= 1;
    $('btn-next').disabled = STATE.page.index >= pages;
  }

  function goToPage(n) {
    const pages = Math.max(1, Math.ceil(STATE.filtered.length / STATE.page.size));
    STATE.page.index = Math.min(Math.max(1, n), pages);
    renderTable();
    renderPagination();
  }

  /* ------------------------------------------------------------------ *
   * Modal: open/close + tabs + focus trap                              *
   * ------------------------------------------------------------------ */

  function openVarietyModal(id) {
    const rec = STATE.all.find(r => r.variety_id === id);
    if (!rec) return;
    STATE.modal.mode = 'variety';
    STATE.modal.record = rec;
    STATE.modal.tab = rec._has_seednet ? 'seednet' : 'research';
    STATE.modal.lastFocus = document.activeElement;
    STATE.modal.open = true;

    setText('modal-title', rec.variety_name || '(unnamed variety)');
    renderModalMeta(rec);
    renderModalTabs(rec);
    renderModalBody();

    showModal();
    const panel = document.querySelector('#detail-modal .modal__panel');
    if (panel) panel.scrollTop = 0;
  }

  function openAboutModal() {
    STATE.modal.mode = 'about';
    STATE.modal.lastFocus = document.activeElement;
    STATE.modal.open = true;

    const s = datasetStats();
    const n = v => Number(v).toLocaleString();
    const lv = s.levels;
    const grading = s.checked
      ? '<p>Current counts among the ' + n(s.researched) + ' researched varieties: ' + n(lv['Confirmed by 2+ sources']) + ' varieties confirmed by 2+ sources, ' + n(lv['Single source']) + ' single source, ' + n(lv['Claimed, not confirmed']) + ' claimed but not confirmed, ' + n(lv['No stress tolerance claimed']) + ' with no stress tolerance claimed' + (lv['Not checked'] ? ', ' + n(lv['Not checked']) + ' not yet checked' : '') + '.</p>'
      : '<p>The second pass has not been run on this build, so the stress types shown come from the research level alone (' + n(s.stressReported) + ' researched varieties report at least one).</p>';

    setText('modal-title', 'About the data');
    $('modal-meta').innerHTML = '';
    $('modal-tabs').innerHTML = '';
    $('modal-body').innerHTML =
      '<div class="about">'
      + '<h3 class="about__h">What this is</h3>'
      + '<p>A seed variety dashboard of ' + n(s.total) + ' crop varieties considered by the Central Sub-Committee on Crop Standards, Notification and Release of Varieties (CSC)' + (s.yMin ? ', ' + s.yMin + '–' + s.yMax : '') + ', across ' + n(s.crops) + ' crops and ' + n(s.states) + ' states and union territories. It is not a list of stress-tolerant varieties: stress tolerance is one attribute, shown only where there is evidence for it. Each row is one variety, with its official record, its Seednet record where one exists, research evidence where research has been run, publications that mention it, and contact details of the developing institution. Maintained by Precision Development (PxD).</p>'
      + '<h3 class="about__h">Where the data comes from</h3>'
      + '<ul class="about__list">'
      + '<li>CSC meeting minutes (PDFs): variety, crop, meeting, approval status and developing institution, and where the minutes state them, parentage, breeding method and special traits. Every record names its source document.</li>'
      + '<li>Seednet (seednet.gov.in), the Government of India seed portal: notification number and date, parentage, recommended ecology, yield and other official fields, for the ' + n(s.seednet) + ' varieties linked to a Seednet record.</li>'
      + '<li>Google Scholar results, archived in 2025 via SerpAPI, and OpenAlex works that mention the variety name. These are mentions, not necessarily studies of the variety.</li>'
      + '<li>Institution websites, for the contact details of the developing institution.</li>'
      + '<li>Language-model web research with cited sources, for ' + n(s.researched) + ' varieties in two waves (Aug 2025: ' + n(s.waveAug) + '; Oct–Nov 2026: ' + n(s.waveOct) + '), covering stress tolerance, agronomy, genetics and breeding, and seed availability.</li>'
      + '</ul>'
      + '<h3 class="about__h">How the Seednet link is decided</h3>'
      + '<p>A variety is linked to a Seednet record only when the crop is the same and the name is the same, including the variety number; small spelling differences are accepted (' + n(s.seednetSpelling) + ' links). A fuzzy name match used in 2025 had linked some varieties to the Seednet record of a different variety; it was replaced in Nov 2026. Where the nearest Seednet entry is a different variety (' + n(s.differentVariety) + ' records), the record says so in a note and that entry is not used.</p>'
      + '<h3 class="about__h">How stress tolerance is graded</h3>'
      + '<p>First, the research summary gives a level for drought, heat, salinity, flood and submergence from its cited sources. Second, a separate pass counts the independent sources that name the exact variety and support each claim:</p>'
      + '<ul class="about__list">'
      + '<li>Confirmed by 2+ sources: two or more independent sources naming the variety support it.</li>'
      + '<li>Single source: one such source.</li>'
      + '<li>Claimed, not confirmed: the research claimed tolerance, but no source naming the variety supports it.</li>'
      + '</ul>'
      + grading
      + (s.officialGraded ? '<p>' + n(s.officialGraded) + ' varieties without web research also have a level, graded from the official Seednet text alone.</p>' : '')
      + '<p>No stress tolerance claimed means none was found, not that the variety is susceptible.</p>'
      + '<h3 class="about__h">Limitations</h3>'
      + '<ul class="about__list">'
      + '<li>Research summaries are written by a language model: they are leads to verify against the linked sources, not official data.</li>'
      + '<li>' + n(s.notResearched) + ' varieties have official data only so far; web research has not been run for them.</li>'
      + '<li>The OpenAlex lookup is incomplete.</li>'
      + '<li>Contact details are for the institution, not the individual breeder, and may be out of date.</li>'
      + '<li>Seasons are not populated.</li>'
      + '</ul>'
      + '<h3 class="about__h">Data and code</h3>'
      + '<p>The dataset, the pipeline and the documentation are in the repository linked as Source in the header.' + (STATE.meta.built ? ' Data build: ' + esc(String(STATE.meta.built)) + '.' : '') + '</p>'
      + '</div>';

    showModal();
  }

  function renderModalMeta(rec) {
    const chips = [];
    if (rec.crop) chips.push('<span class="chip">' + esc(rec.crop) + '</span>');
    if (rec.year_of_release) chips.push('<span class="chip">Year ' + esc(rec.year_of_release) + '</span>');
    if (!rec._researched) chips.push('<span class="chip">Official data only</span>');
    if (rec._stress_graded) {
      const yes = rec.stress_confirmation_level === 'Confirmed by 2+ sources' || rec.stress_confirmation_level === 'Single source';
      chips.push('<span class="chip' + (yes ? ' chip--stress-yes' : '') + '">Stress evidence: ' + esc(rec.stress_confirmation_level) + '</span>');
    } else if (rec._researched && rec.stress_types_strict.length) {
      chips.push('<span class="chip chip--stress-yes">Stress tolerance reported in research</span>');
    }
    if (rec.evidence_quality) {
      chips.push('<span class="chip chip--ev-' + esc(rec.evidence_quality.toLowerCase())
        + '">Evidence: ' + esc(rec.evidence_quality) + '</span>');
    }
    chips.push('<span class="chip">Seednet: ' + (rec._has_seednet ? 'linked' : 'not linked') + '</span>');
    $('modal-meta').innerHTML = chips.join(' ');
  }

  function renderModalTabs(rec) {
    const tabs = [];
    if (rec._has_seednet) {
      tabs.push({ id: 'seednet', label: 'Seednet record', badge: 'Govt of India portal' });
    }
    const pm = (((rec.research_data || {}).full_analysis_result || {}).processing_metadata) || {};
    const provenance = [pm.model || (rec.enrichment_wave && rec.enrichment_wave.indexOf('Gemini') !== -1 ? 'gemini-2.5-flash' : ''), pm.analysis_date ? String(pm.analysis_date).slice(0, 10) : '', (rec.search_metadata && rec.search_metadata.total_queries) ? rec.search_metadata.total_queries + ' searches' : ''].filter(Boolean).join(' · ');
    tabs.push({ id: 'research', label: 'Record and evidence', badge: rec._researched ? 'official record and research' : 'official record' });

    const tabBar = $('modal-tabs');
    tabBar.innerHTML = tabs.map(t =>
      '<button type="button" class="tab tab--' + esc(t.id)
      + (STATE.modal.tab === t.id ? ' is-active' : '')
      + '" role="tab" aria-selected="' + (STATE.modal.tab === t.id ? 'true' : 'false')
      + '" data-tab="' + esc(t.id) + '">'
      + '<span>' + esc(t.label) + '</span>'
      + '<span class="tab__badge">' + esc(t.badge) + '</span>'
      + '</button>'
    ).join('');
    tabBar.querySelectorAll('.tab').forEach(btn => {
      btn.addEventListener('click', () => {
        STATE.modal.tab = btn.dataset.tab;
        const panel = document.querySelector('#detail-modal .modal__panel');
        if (panel) panel.scrollTop = 0;
        renderModalTabs(rec);
        renderModalBody();
      });
    });
  }

  function renderModalBody() {
    const rec = STATE.modal.record;
    const body = $('modal-body');
    if (!rec) { body.innerHTML = ''; return; }
    body.innerHTML = STATE.modal.tab === 'seednet'
      ? renderSeednetTab(rec)
      : renderResearchTab(rec);

    // Wire any post-render handlers (e.g., copy buttons inside the tab).
    body.querySelectorAll('[data-copy]').forEach(btn => {
      btn.addEventListener('click', () => copyToClipboard(btn.dataset.copy, btn));
    });
  }

  function renderSeednetTab(rec) {
    const sf = rec.seednet_fields || {};
    const sfUsableKeys = Object.keys(sf).filter(k => !SEEDNET_SKIP_KEYS.has(k));
    // Build the ordered list: curated keys first, then any extras present
    // in the data but not in the curated order.
    const orderedKeys = SEEDNET_FIELD_ORDER
      .filter(k => Object.prototype.hasOwnProperty.call(sf, k));
    const extraKeys = Object.keys(sf)
      .filter(k => !SEEDNET_FIELD_ORDER.includes(k) && !SEEDNET_SKIP_KEYS.has(k))
      .sort((a, b) => a.localeCompare(b));
    const allKeys = orderedKeys.concat(extraKeys);

    const rows = allKeys.map(k => {
      const raw = sf[k];
      const v = (raw == null || raw === '') ? 'Not specified' : String(raw);
      const muted = /not specified|^none$/i.test(v) ? ' field-row__value--muted' : '';
      return '<div class="field-row">'
        + '<dt class="field-row__label">' + esc(k) + '</dt>'
        + '<dd class="field-row__value' + muted + '">' + esc(v) + '</dd>'
        + '</div>';
    }).join('');

    const portalUrl = rec.seednet_url
      || (rec.seednet_variety_id
          ? 'https://seednet.gov.in/SeedVarieties/ssrsVarietydetail.aspx?varietycd='
              + encodeURIComponent(rec.seednet_variety_id)
          : '');

    const emptySeednet = sfUsableKeys.length === 0;
    const fallbackFields = emptySeednet
      ? (
        '<dl class="field-grid">'
          + '<div class="field-row">'
          +   '<dt class="field-row__label">Seednet Match</dt>'
          +   '<dd class="field-row__value">' + esc(rec.seednet_match || 'Not specified') + '</dd>'
          + '</div>'
          + '<div class="field-row">'
          +   '<dt class="field-row__label">Seednet Variety ID</dt>'
          +   '<dd class="field-row__value">' + esc(rec.seednet_variety_id || 'Not specified') + '</dd>'
          + '</div>'
          + '<div class="field-row">'
          +   '<dt class="field-row__label">Seednet URL</dt>'
          +   '<dd class="field-row__value">' + (portalUrl
                ? '<a href="' + esc(portalUrl) + '" target="_blank" rel="noopener">' + esc(portalUrl) + '</a>'
                : '<span class="muted">Not specified</span>') + '</dd>'
          + '</div>'
        + '</dl>'
        + '<p class="muted seednet-note">This dataset does not include the full Seednet field grid (`seednet_fields`). Showing available official identifiers only.</p>'
      )
      : '';

    return '<section class="tab-panel tab-panel--seednet" role="tabpanel">'
      + '<div class="tab-panel__head">'
      +   '<span class="badge-banner badge-banner--seednet">Source: seednet.gov.in (Government of India), scraped 2025-07-26</span>'
      +   (portalUrl
          ? '<a class="btn btn--seednet" href="' + esc(portalUrl) + '" target="_blank" rel="noopener">'
              + 'View on Seednet Portal ↗</a>'
          : '')
      + '</div>'
      + (emptySeednet ? fallbackFields : ('<dl class="field-grid">' + rows + '</dl>'))
      + '</section>';
  }

  function renderResearchTab(rec) {
    const v = rec.variety_name || '';
    const c = rec.crop || '';
    const q = (v + (c ? ' ' + c : '')).trim();
    const enc = encodeURIComponent;
    const researched = rec._researched;
    const rd = rec.research_data || {};
    const far = (rd.full_analysis_result && typeof rd.full_analysis_result === 'object') ? rd.full_analysis_result : {};
    // Official Seednet fields are used only when the link is confirmed.
    const sf = rec._has_seednet ? (rec.seednet_fields || {}) : {};
    const csc = rec.csc_fields || {};
    const sm = rec.search_metadata || {};
    const stressDetail = rd.stress_tolerance_detailed || {};
    const stressFar = (far.stress_tolerance && typeof far.stress_tolerance === 'object') ? far.stress_tolerance : {};
    const agr = rd.agronomic_details || {};
    const com = rd.commercial_info || {};
    const enh = (Array.isArray(rd.enhancement_features) ? rd.enhancement_features : []).concat(rec.enrichment_wave ? ['wave: ' + rec.enrichment_wave] : []);

    const queryResults = Array.isArray(sm.query_results) ? sm.query_results : [];
    const positiveQueries = queryResults.filter(qr => (qr && Number(qr.results_count || 0) > 0));
    const generatedQueryLinks = (Array.isArray(rec.query_links) && rec.query_links.length)
      ? rec.query_links
      : positiveQueries
        .map(qr => String(qr.query || '').trim())
        .filter(Boolean)
        .slice(0, 50)
        .map(q => ({
          query: q,
          results_count: 0,
          scholar_url: 'https://scholar.google.com/scholar?q=' + encodeURIComponent(q),
          google_url: 'https://www.google.com/search?q=' + encodeURIComponent(q),
          ncbi_url: 'https://www.ncbi.nlm.nih.gov/search/all/?term=' + encodeURIComponent(q)
        }));

    function stressEvidenceFromQueries(stressKey, aliases) {
      const hits = positiveQueries.filter(qr => {
        const q = String((qr && qr.query) || '').toLowerCase();
        return aliases.some(a => q.indexOf(a) !== -1);
      });
      if (!hits.length) return '';
      return hits.length + ' positive query hit' + (hits.length > 1 ? 's' : '') + ' in search metadata';
    }

    function firstNonEmpty() {
      for (let i = 0; i < arguments.length; i++) {
        const v = arguments[i];
        if (!isBlankish(v) && (typeof v !== 'object')) return String(v).trim();
      }
      return '';
    }

    function detailRow(label, value) {
      const has = !isBlankish(value);
      return '<div class="field-row">'
        + '<dt class="field-row__label">' + esc(label) + '</dt>'
        + '<dd class="field-row__value' + (has ? '' : ' field-row__value--muted') + '">'
        + (has ? esc(asText(value)) : 'Not specified') + '</dd>'
        + '</div>';
    }
    function detailRowHtml(label, html) {
      const has = html != null && String(html).trim() !== '';
      return '<div class="field-row"><dt class="field-row__label">' + esc(label) + '</dt>'
        + '<dd class="field-row__value' + (has ? '' : ' field-row__value--muted') + '">' + (has ? html : 'Not specified') + '</dd></div>';
    }
    // Optional rows: rendered only when there is something to show.
    function optRow(label, value) { return isBlankish(value) ? '' : detailRow(label, value); }
    function optRowHtml(label, html) { return (html != null && String(html).trim() !== '') ? detailRowHtml(label, html) : ''; }
    // Researched records keep the established "Not specified" rows; official-only
    // records show only rows that carry data, so no section is empty.
    const row = researched ? detailRow : optRow;
    function section(title, inner) {
      return inner ? '<h3 class="research-card__h research-card__h--block">' + esc(title) + '</h3>' + inner : '';
    }
    function grid(rows) { return rows ? '<dl class="field-grid">' + rows + '</dl>' : ''; }
    function linkList(urls) {
      return uniq((urls || []).filter(u => typeof u === 'string' && /^https?:/i.test(u))).map(u => linkHtml(u)).join('<br>');
    }
    function withShowAll(items, n, label) {
      if (!items.length) return '<p class="muted">' + esc(label) + '</p>';
      const head = items.slice(0, n).join(''); const rest = items.slice(n).join('');
      return head + (rest ? '<details class="more"><summary>Show all ' + items.length + '</summary>' + rest + '</details>' : '');
    }

    /* --- head: provenance banner or the official-only line --- */
    const pm = far.processing_metadata || {};
    const model = pm.model || (rec.enrichment_wave_raw.indexOf('20250808') !== -1 ? 'gemini-2.5-flash' : 'a language model');
    const when = pm.analysis_date ? ' on ' + String(pm.analysis_date).slice(0, 10) : '';
    const nq = Number(sm.total_queries) || 0;
    const head = researched
      ? '<div class="tab-panel__head"><span class="badge-banner badge-banner--research">Research summary written by ' + esc(model) + esc(when)
          + (nq ? ' from ' + esc(String(nq)) + ' web searches' : '') + '; every claim links to its source below.</span></div>'
      : '<p class="plain-line">Web research has not been run for this variety yet.</p>';
    const caution = researched && (rec.research_refers_to === 'other_variety' || rec.research_refers_to === 'mixed')
      ? '<p class="plain-line plain-line--caution">Part of the research text below may describe a similarly named variety; see the confirmation notes.</p>'
      : '';

    /* --- summary cards --- */
    const stressList = rec._stress_types_display;
    const keyAttrBadges = stressList.length
      ? stressList.map(t => '<span class="badge badge--attr">' + esc(t) + '</span>').join(' ')
      : (rec.stress_confirmation_level === 'Claimed, not confirmed' && rec.stress_types_strict.length)
        ? '<span class="muted">Claimed in the research but not confirmed: ' + esc(rec.stress_types_strict.join(', ')) + '.</span>'
        : '<span class="muted">No stress tolerance found in the evidence.</span>';
    const _lv = rec.stress_levels_gemini || {};
    const stressLevelBadges = STRESS_KEYS.map(k => '<span class="badge ' + ((_lv[k] || 'unknown') === 'unknown' ? '' : 'badge--attr') + '">' + esc(STRESS_NAME[k]) + ': ' + esc(_lv[k] || 'unknown') + '</span>').join(' ');
    const states = (rec.states_full && rec.states_full.length)
      ? rec.states_full.map(s => esc(s)).join(', ')
      : (rec.states_acronyms ? esc(rec.states_acronyms) : '');
    const card = (h, body) => '<div class="research-card"><h3 class="research-card__h">' + esc(h) + '</h3>' + body + '</div>';
    const cards = researched
      ? card('Stress tolerance', '<div class="badge-row">' + keyAttrBadges + '</div>')
        + card('Stress levels (from research)', '<div class="badge-row">' + stressLevelBadges + '</div>')
        + card('Evidence quality', rec.evidence_quality
            ? '<span class="badge badge--ev-' + esc(rec.evidence_quality.toLowerCase()) + '">' + esc(rec.evidence_quality) + '</span>'
            : '<span class="muted">Unrated</span>')
        + card('Recommended states', '<p class="research-card__body">' + (states || '<span class="muted">—</span>') + '</p>')
        + card('Season(s)', '<p class="research-card__body">' + esc(rec.seasons || '—') + '</p>')
        + card('Days to maturity', '<p class="research-card__body">' + (rec._dtm_raw ? esc(rec._dtm_raw) : '<span class="muted">—</span>') + '</p>')
      : (states ? card('Recommended states', '<p class="research-card__body">' + states + '</p>') : '')
        + (rec._dtm_raw ? card('Days to maturity', '<p class="research-card__body">' + esc(rec._dtm_raw) + '</p>') : '');
    const cardsBlock = cards ? '<div class="research-grid">' + cards + '</div>' : '';

    /* --- official sources + Seednet link status --- */
    const os_ = rec.official_sources || {};
    const seednetUrl = rec._has_seednet ? (os_.seednet_url || rec.seednet_url) : '';
    const statusText = {
      confirmed_exact: 'Linked: same crop and same name',
      confirmed_spelling: 'Linked: same crop, same name with a small spelling difference',
      different_variety: 'Not linked: no Seednet record with this name and crop',
      no_seednet: 'Not linked: no Seednet record found'
    }[rec.seednet_match_status] || (rec._has_seednet ? 'Linked' : 'Not linked');
    const officialRows = [
      detailRow('Seednet match', statusText + (rec._has_seednet && rec.seednet_rematched ? ' (link corrected Nov 2026)' : '')),
      optRowHtml('Seednet (Govt of India) record', seednetUrl ? linkHtml(seednetUrl) : ''),
      optRow('Seednet notification', rec._has_seednet ? [os_.seednet_notification_number, os_.seednet_notification_date].filter(x => !isBlankish(x)).join(' · ') : ''),
      optRow('CSC meeting document', [os_.csc_meeting, os_.csc_source_document].filter(x => !isBlankish(x)).join(' — ')),
      optRow('Gazette reference', os_.gazette_reference),
      optRow('Developing institution (CSC minutes)', [rec.developer_institution_csc, rec.developer_location_csc].filter(x => !isBlankish(x)).join(', '))
    ].join('');
    const cand = rec.seednet_candidate;
    const candNote = (rec.seednet_match_status === 'different_variety' && cand && !isBlankish(cand.variety_name))
      ? '<p class="small-note">Nearest Seednet entry is a different variety: '
        + (cand.url ? linkHtml(cand.url, asText(cand.variety_name)) : esc(asText(cand.variety_name)))
        + (isBlankish(cand.crop) ? '' : ' (' + esc(asText(cand.crop)) + ')') + ' — not used</p>'
      : '';

    /* --- official record from the CSC minutes --- */
    const CSC_ORDER = [
      ['approval_status', 'Approval status'], ['meeting_number', 'Meeting'], ['approval_date', 'Meeting date'],
      ['meeting_title', 'Minutes'], ['source_document_filename', 'Source document'], ['page_reference', 'Page'],
      ['year', 'Year'], ['variety_code', 'Variety code'], ['institution', 'Institution'],
      ['institution_location', 'Institution location'], ['principal_investigator', 'Principal investigator'],
      ['state_zone', 'States or zone'], ['agro_climatic_zones', 'Agro-climatic zones'], ['maturity_group', 'Maturity group'],
      ['yield_performance', 'Yield performance'], ['special_traits', 'Special traits'], ['parent_material', 'Parent material'],
      ['breeding_method', 'Breeding method'], ['meetings_considered', 'Number of meetings considered'], ['additional_notes', 'Notes']
    ];
    const CSC_SKIP = new Set(['crop', 'variety_name', 'similarity_score', 'csc_raw_id', 'manual_review_status', 'manual_match']);
    const cscKnown = new Set(CSC_ORDER.map(x => x[0]));
    const cscRows = CSC_ORDER.map(([k, l]) => optRow(l, csc[k])).join('')
      + Object.keys(csc).filter(k => !cscKnown.has(k) && !CSC_SKIP.has(k)).sort().map(k => optRow(humanKey(k), csc[k])).join('');

    /* --- stress evidence --- */
    let stressBlock = '';
    if (researched || rec._stress_graded) {
      const sc = rec.stress_confirmation || {};
      const checked = rec._stress_graded;
      const summary = checked
        ? [detailRow('Stress evidence', rec.stress_confirmation_level),
           optRow('Confirmed stress types', rec.stress_types_confirmed.join(', ')),
           optRow('Supported by 2+ sources', rec.stress_types_multi_source.join(', ')),
           optRow('Confirmation note', rec.stress_confirmation_note)].join('')
        : '';
      const per = STRESS_KEYS.map(k => {
        const d = stressFar[k] || stressDetail[k] || {};
        const conf = (sc[k] && typeof sc[k] === 'object') ? sc[k] : null;
        const lvl = !isBlankish(d.level) ? String(d.level).trim() : 'unknown';
        // Submergence is only in the newer schema; skip it when absent everywhere.
        if (k === 'submergence' && !stressFar[k] && !stressDetail[k] && !conf) return '';
        let confLine = '';
        if (conf) {
          const nSrc = Number(conf.independent_sources);
          confLine = [asText(conf.label || conf.verdict),
            Number.isFinite(nSrc) && conf.independent_sources != null ? nSrc + ' independent source' + (nSrc === 1 ? '' : 's') : '',
            asText(conf.basis)].filter(Boolean).join(' — ');
        }
        if (!researched) return confLine ? detailRow(STRESS_NAME[k], confLine) : '';
        return detailRow(STRESS_NAME[k] + ' level', lvl)
          + detailRow(STRESS_NAME[k] + ' details', lvl === 'unknown' && isBlankish(d.details) ? '' : d.details)
          + (confLine ? detailRow(STRESS_NAME[k] + ' confirmation', confLine) : '');
      }).join('');
      const dis = (stressFar.disease_resistance && stressFar.disease_resistance.summary) || (stressDetail.disease_resistance && stressDetail.disease_resistance.summary);
      const pest = (stressFar.pest_resistance && stressFar.pest_resistance.summary) || (stressDetail.pest_resistance && stressDetail.pest_resistance.summary);
      stressBlock = (checked ? '' : '<p class="small-note">The independent-source check has not been run for this variety yet; levels below are from the research summary.</p>')
        + grid(summary + per + (researched ? detailRow('Disease resistance summary', dis) + detailRow('Pest resistance summary', pest) : ''));
    }

    /* --- sources cited by the research --- */
    const srcUrls = (function () {
      const urls = []; const seen = {};
      const push = u => { if (u && typeof u === 'string' && u.indexOf('http') === 0 && !seen[u]) { seen[u] = 1; urls.push(u); } };
      Object.keys(stressFar).forEach(k => ((stressFar[k] || {}).evidence_sources || []).forEach(push));
      ['genetics_and_qtl', 'agronomic_performance', 'breeder_and_contacts', 'commercial_availability'].forEach(k => ((far[k] || {}).evidence_sources || []).forEach(push));
      (far.reference_links || []).forEach(push);
      (rec.direct_source_links || []).forEach(push);
      return urls;
    })();
    function srcLabel(u) { try { const x = new URL(u); const p = x.pathname.replace(/\/+$/, ''); const last = decodeURIComponent(p.split('/').filter(Boolean).pop() || '').replace(/[-_]+/g, ' ').replace(/\.(pdf|html?|aspx|php)$/i, ''); return { host: x.hostname.replace(/^www\./, ''), title: last ? last.slice(0, 80) : x.hostname }; } catch (e) { return { host: u, title: u }; } }
    const sourceItems = srcUrls.map(u => { const l = srcLabel(u); return '<li>' + linkHtml(u, l.title) + ' <span class="muted">' + esc(l.host) + '</span></li>'; });
    const sourcesBlock = researched ? '<ol class="src-list">' + withShowAll(sourceItems, 6, 'No source URLs in the research summary.') + '</ol>' : '';

    /* --- agronomy --- */
    const agrRows = [
      row('Yield', firstNonEmpty(agr.yield, sf['Average Yield (Kg/Ha)'], csc.yield_performance)),
      row('Stability', agr.stability),
      row('Adaptation', firstNonEmpty(agr.adaptation, sf['Adaptation and recommended ecology'])),
      row('Maturity', firstNonEmpty(agr.maturity_days, sf['Maturity (in days)'], rec.days_to_maturity, csc.maturity_group)),
      row('Plant characteristics', firstNonEmpty(agr.plant_characteristics, sf['General Morphological Characteristics'], sf['Specific Morphological Characteristics'])),
      row('Field trials notes', firstNonEmpty(agr.field_trials, stressEvidenceFromQueries('trial', ['trial', 'field trial'])))
    ].join('');

    /* --- genetics and breeding --- */
    const gq = (far.genetics_and_qtl && typeof far.genetics_and_qtl === 'object') ? far.genetics_and_qtl : {};
    const legacyGen = rd.genetics_and_breeding || {};
    const GEN_STD = [['genetic_markers', 'Genetic markers'], ['qtl_information', 'QTL information'], ['molecular_mechanisms', 'Molecular mechanisms']];
    const genStdKeys = new Set(GEN_STD.map(x => x[0]).concat(['evidence_sources']));
    const geneticsRows = (researched ? GEN_STD.map(([k, l]) => detailRow(l, firstNonEmpty(gq[k], legacyGen[k]))).join('') : '')
      + Object.keys(gq).filter(k => !genStdKeys.has(k)).map(k => optRow(humanKey(k), gq[k])).join('')
      + optRow('Parentage (Seednet)', sf['Parentage'])
      + optRow('Parent material (CSC minutes)', csc.parent_material)
      + optRow('Breeding method (CSC minutes)', csc.breeding_method)
      + optRowHtml('Genetics sources', linkList(gq.evidence_sources));

    /* --- contacts --- */
    const cs = rec.contacts_structured || {};
    const ic = rec.institution_contact || {};
    const bc = far.breeder_and_contacts || {};
    const lines = arr => uniq((arr || []).map(x => asText(x)).filter(x => !isBlankish(x)));
    const emails = lines([].concat(cs.emails || [], ic.emails || []));
    const phones = lines([].concat(cs.phones || [], ic.phones || []));
    const addresses = lines([].concat(cs.addresses || [], ic.postal_address ? [ic.postal_address] : []));
    const breeders = lines(cs.breeder_names || (bc.breeder ? [bc.breeder] : []));
    const mail = e => {
      const m = e.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
      return m ? '<a href="mailto:' + esc(m[0]) + '">' + esc(e) + '</a>' : esc(e);
    };
    const website = firstNonEmpty(cs.website, ic.website);
    const contactPage = firstNonEmpty(cs.contact_page, ic.contact_page);
    let contactRows = [
      optRow('Institution', firstNonEmpty(cs.institution, ic.institution_official_name, csc.institution, rec.developer_institution_csc)),
      optRow('Institution type', firstNonEmpty(cs.institution_type, ic.type)),
      optRow('Location (CSC minutes)', firstNonEmpty(cs.institution_location_csc, rec.developer_location_csc)),
      optRow('Head or director', firstNonEmpty(cs.head_or_director, ic.head_or_director)),
      optRow('Seed or variety enquiries', firstNonEmpty(cs.variety_or_seed_contact, ic.variety_or_seed_contact)),
      optRow('Breeder seed institution (Seednet)', firstNonEmpty(cs.breeder_seed_institution_seednet, sf['Institution Responsible for developing Breeder Seed'])),
      optRowHtml('Breeder or scientist', breeders.map(esc).join('<br>')),
      optRowHtml('Email', emails.map(mail).join('<br>')),
      optRowHtml('Phone', phones.map(esc).join('<br>')),
      optRowHtml('Postal address', addresses.map(esc).join('<br>')),
      optRowHtml('Website', website && /^https?:/i.test(website) ? linkHtml(website) : esc(website)),
      optRowHtml('Contact page', contactPage && /^https?:/i.test(contactPage) ? linkHtml(contactPage) : esc(contactPage)),
      optRowHtml('Contact sources', linkList([].concat(cs.contact_source_urls || [], ic.source_urls || []))),
      optRow('Notes', cs.notes),
      researched ? optRow('Contact notes (research)', bc.contacts) : '',
      researched ? optRow('Publications noted in research', bc.publications) : '',
      researched ? optRowHtml('Research evidence sources', linkList(bc.evidence_sources)) : ''
    ].join('');
    if (!contactRows) contactRows = '';
    const contactsBlock = contactRows ? grid(contactRows) : '<p class="muted">No contact details found yet.</p>';

    /* --- publications --- */
    const authorsText = a => { const l = (Array.isArray(a) ? a : []).filter(x => !isBlankish(x)).map(String); return l.slice(0, 4).join(', ') + (l.length > 4 ? ' et al.' : ''); };
    const pubs = Array.isArray(rec.publications_openalex) ? rec.publications_openalex.filter(w => w && typeof w === 'object') : [];
    const pubRows = pubs.length
      ? '<ol class="pub-list">' + withShowAll(pubs.map(w => {
          const au = authorsText(w.authors);
          const link = w.doi || w.landing_page;
          return '<li>' + (au ? esc(au) + ' ' : '') + (w.year ? '(' + esc(String(w.year)) + '). ' : (au ? '. ' : ''))
            + '<em>' + esc(w.title || 'Untitled') + '</em>' + (isBlankish(w.venue) ? '' : '. ' + esc(w.venue))
            + (link ? '. ' + linkHtml(link, w.doi ? w.doi : 'link') : '')
            + (Number(w.cited_by_count) ? ' <span class="muted">(cited by ' + esc(String(w.cited_by_count)) + ')</span>' : '')
            + ' <span class="muted">[mentioned in ' + esc(w.matched_on || 'abstract') + ']</span></li>';
        }), 5, '') + '</ol>'
        + (rec.publications_openalex_count > pubs.length ? '<p class="muted">' + esc(String(rec.publications_openalex_count - pubs.length)) + ' more in the data file.</p>' : '')
      : '<p class="muted">No OpenAlex publication mentions found for this variety name.</p>';
    const spubs = Array.isArray(rec.publications_scholar) ? rec.publications_scholar.filter(w => w && typeof w === 'object') : [];
    const spubRows = spubs.length
      ? '<ol class="pub-list">' + withShowAll(spubs.map(w =>
          '<li>' + (isBlankish(w.publication_info) ? '' : esc(w.publication_info) + '. ') + '<em>' + esc(w.title || 'Untitled') + '</em>'
          + (w.link ? ' ' + linkHtml(w.link, 'link') : '')
          + (Number(w.cited_by) ? ' <span class="muted">(cited by ' + esc(String(w.cited_by)) + ')</span>' : '')
          + ' <span class="muted">[name in ' + esc(w.matched_on || 'snippet') + ']</span></li>'), 5, '') + '</ol>'
        + (rec.publications_scholar_count > spubs.length ? '<p class="muted">' + esc(String(rec.publications_scholar_count - spubs.length)) + ' more in the data file.</p>' : '')
      : '<p class="muted">No Google Scholar hits mentioning this variety name in the 2025 search results.</p>';

    /* --- research-only extras --- */
    const commercialRows = researched ? [
      detailRow('Seed corporations', com.seed_corporations),
      detailRow('Availability status', com.availability_status),
      detailRow('KVK', com.kvk),
      detailRow('Private dealers', com.private_dealers)
    ].join('') : '';
    const enhBlock = researched
      ? '<div class="badge-row">' + (enh.length ? enh.map(item => '<span class="badge badge--attr">' + esc(item) + '</span>').join(' ') : '<span class="muted">No enhancement metadata available.</span>') + '</div>'
      : '';
    const directLinks = (rec.direct_source_links && rec.direct_source_links.length)
      ? '<div class="query-links">' + rec.direct_source_links.map(link =>
          '<div class="query-link-row"><p class="query-link-row__query">' + linkHtml(link) + '</p></div>').join('') + '</div>'
      : (researched ? '<p class="muted">No direct source URLs available in this record.</p>' : '');
    const quick = q
      ? '<div class="quick-links">'
        + '<a class="btn btn--secondary" target="_blank" rel="noopener" href="https://scholar.google.com/scholar?q=' + enc(q + ' stress tolerance') + '">Google Scholar</a>'
        + '<a class="btn btn--secondary" target="_blank" rel="noopener" href="https://www.ncbi.nlm.nih.gov/search/all/?term=' + enc(q) + '">NCBI</a>'
        + '</div>'
      : '';
    const replay = (researched && (!rec.direct_source_links || !rec.direct_source_links.length))
      ? (generatedQueryLinks.length
          ? '<div class="query-links">' + generatedQueryLinks.map(item =>
              '<div class="query-link-row">'
                + '<p class="query-link-row__query">' + esc(item.query || item.q || '') + '</p>'
                + (item.results_count != null ? '<p class="muted">Results: ' + esc(String(item.results_count)) + '</p>' : '')
                + '<div class="query-link-row__actions">'
                  + '<a class="btn btn--secondary" target="_blank" rel="noopener" href="' + esc(item.scholar_url || item.scholar || '') + '">Scholar</a>'
                  + '<a class="btn btn--secondary" target="_blank" rel="noopener" href="' + esc(item.google_url || item.google || '') + '">Google</a>'
                  + '<a class="btn btn--secondary" target="_blank" rel="noopener" href="' + esc(item.ncbi_url || item.ncbi || '') + '">NCBI</a>'
                + '</div>'
              + '</div>').join('') + '</div>'
          : '<p class="muted">No query-level links available in this record.</p>')
      : '';

    return '<section class="tab-panel tab-panel--research" role="tabpanel">'
      + head + caution
      + cardsBlock
      + section('Official sources', grid(officialRows) + candNote)
      + section('Official record (CSC minutes)', grid(cscRows))
      + section('Stress tolerance evidence', stressBlock)
      + (researched ? section('Sources cited by the research (' + srcUrls.length + ')', sourcesBlock) : '')
      + section('Agronomic details', grid(agrRows))
      + section('Genetics and breeding', grid(geneticsRows))
      + section('Contacts', contactsBlock)
      + section('Publications (Google Scholar via SerpAPI, 2025; mentions of the variety name)', spubRows)
      + section('Publications (OpenAlex, mentions of the variety name)', pubRows)
      + section('Commercial information', grid(commercialRows))
      + section('Enhancement features', enhBlock)
      + section('Direct pulled source links', directLinks)
      + section('Quick research links', quick)
      + section('Search query replay links (secondary)', replay)
      + '</section>';
  }

  function showModal() {
    const m = $('detail-modal');
    m.hidden = false;
    document.body.classList.add('modal-open');
    // Focus first focusable in panel for screen-reader hand-off.
    requestAnimationFrame(() => {
      const focusable = m.querySelectorAll(focusableSelector());
      if (focusable.length) focusable[0].focus();
    });
  }

  function closeModal() {
    const m = $('detail-modal');
    m.hidden = true;
    document.body.classList.remove('modal-open');
    STATE.modal.open = false;
    STATE.modal.record = null;
    STATE.modal.mode = 'variety';
    if (STATE.modal.lastFocus && typeof STATE.modal.lastFocus.focus === 'function') {
      try { STATE.modal.lastFocus.focus(); } catch (_) { /* element may have detached */ }
    }
  }

  function onModalKeydown(e) {
    if (!STATE.modal.open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
      return;
    }
    if (e.key !== 'Tab') return;
    // Focus trap: keep tab navigation inside the modal panel only.
    const panel = $('detail-modal').querySelector('.modal__panel');
    const focusable = Array.prototype.filter.call(
      panel.querySelectorAll(focusableSelector()),
      (el) => !el.disabled && el.offsetParent !== null
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }

  function focusableSelector() {
    return 'a[href], button:not([disabled]), input:not([disabled]), '
      + 'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  }

  function copyToClipboard(text, btn) {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(() => {
      const prev = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = prev; }, 1200);
    });
  }

  /* ------------------------------------------------------------------ *
   * CSV export (RFC 4180)                                              *
   * ------------------------------------------------------------------ */

  function exportFilteredCSV() {
    if (!STATE.filtered.length) {
      // Better than silently producing an empty file.
      alert('No varieties to export. Adjust filters and try again.');
      return;
    }
    const cols = [
      'variety_id', 'crop', 'variety_name', 'year_of_release', 'stress_tolerance',
      'key_attributes', 'states_acronyms', 'seasons', 'days_to_maturity',
      'evidence_quality', 'seednet_available', 'seednet_url', 'query_links_count',
      'seednet_match_status', 'enrichment_wave', 'stress_confirmation_level', '_stress_types_display'
    ];
    const lines = [cols.join(',')];
    STATE.filtered.forEach(r => {
      lines.push(cols.map(k => csvField(
        k === 'days_to_maturity' ? r._dtm_raw : k === 'seednet_available' ? r._has_seednet : Array.isArray(r[k]) ? r[k].join('; ') : r[k]
      )).join(','));
    });
    // Excel-friendly UTF-8 BOM + CRLF line endings per RFC 4180.
    const csv = '\uFEFF' + lines.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = 'pxd_sts_varieties_' + date + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // RFC 4180: quote any field containing comma, double-quote, CR, or LF.
  // Internal double-quotes are escaped by doubling. Booleans serialised
  // as 'true'/'false' so the export round-trips through Excel cleanly.
  function csvField(v) {
    if (v == null) return '';
    let s = (typeof v === 'boolean') ? (v ? 'true' : 'false') : String(v);
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  /* ------------------------------------------------------------------ *
   * Loading + error UI                                                 *
   * ------------------------------------------------------------------ */

  function showLoading() { $('loading-overlay').hidden = false; }
  function hideLoading() { $('loading-overlay').hidden = true; }

  function showError(detail) {
    const banner = $('error-banner');
    const fileHint = window.location.protocol === 'file:'
      ? ' This page was opened via file://. Browsers block local fetch() under that scheme — start a local server (e.g., `python -m http.server`) and reopen at http://127.0.0.1:8000/ instead.'
      : '';
    setText('error-banner-detail', (detail || 'Unknown fetch error.') + fileHint);
    banner.hidden = false;
    setText('result-count', 'Data unavailable');
  }
  function hideError() { $('error-banner').hidden = true; }

})();
