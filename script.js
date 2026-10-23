/*
 * Stress-Tolerant Seed Varieties of India — dashboard runtime
 * (Precision Development reference catalogue)
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
    { key: 'stress_tolerance_strict', label: 'Stress Tolerant (evidence-based)' },
    { key: 'stress_types',      label: 'Stress Types (search hits)' },
    { key: 'stress_types_strict', label: 'Stress Types (evidence-based)' },
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
  const VOCAB_SOURCES = ['Seednet', 'Research Only', 'Both'];

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
        stressTols: VOCAB_STRESS_TOL.slice(),
        sources: VOCAB_SOURCES.slice()
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
    ['filter-crop', 'filter-state', 'filter-stress-tol', 'filter-evidence',
     'filter-stress-type', 'filter-source', 'filter-institution', 'filter-contact']
      .forEach(id => $(id).addEventListener('change', applyFilters));
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
      const idx = await fetch('./data/index.json' + bust, opts).catch(() => null);
      if (idx && idx.ok) {
        const parts = (await idx.json()).parts || [];
        const chunks = await Promise.all(parts.map(async p => { const r = await fetch('./' + p + bust, opts); if (!r.ok) throw new Error('HTTP ' + r.status + ' on ' + p); return r.json(); }));
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
    rec.stress_types_strict = Array.isArray(r.stress_types_strict) ? r.stress_types_strict : [];
    rec.developer_institution_csc = r.developer_institution_csc || '';
    const _cs = r.contacts_structured || {};
    rec.institution_std = String(_cs.institution || r.developer_institution_csc || '').trim();
    rec.has_contact = ((_cs.emails || []).length || (_cs.phones || []).length || (_cs.breeder_names || []).length) ? 'Yes' : 'No'; rec.developer_location_csc = r.developer_location_csc || '';
    rec.publications_count = (Number(r.publications_scholar_count) || 0) + (Number(r.publications_openalex_count) || 0);
    rec.enrichment_wave = r.enrichment_wave ? String(r.enrichment_wave).replace('enhanced_v2.1_20250808', 'Aug 2025 (Gemini)').replace(/enhanced_v3\.\d_20261022_claude/, 'Oct 2026 (Claude)') : '';
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
    rec._has_seednet = !!(rec.seednet_available && (
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
      + flattenText(rec.research_data) + ' '
      + flattenText(rec.search_metadata)
    ).toLowerCase();

    return rec;
  }

  function buildVocabularies() {
    STATE.meta.vocab.crops = uniqSorted(STATE.all.map(r => r._crop_norm || r.crop));
    STATE.meta.vocab.states = uniqSorted(STATE.all.flatMap(r => r._state_norm_tokens));
    STATE.meta.vocab.stressTypes = uniqSorted(STATE.all.flatMap(r => (r.stress_types_strict && r.stress_types_strict.length) ? r.stress_types_strict : []));
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
    fillSelect('filter-source', STATE.meta.vocab.sources);
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
    const sources = getSelectedMulti('filter-source');
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
      if (stressTypes.length && !stressTypes.some(t => (r.stress_types_strict || []).indexOf(t) !== -1)) return false;
      // 7. Source: 'Seednet' and 'Both' both require seednet_available;
      //    'Research Only' requires the negation. The OR-within-group
      //    semantics is preserved across multi-select.
      if (sources.length) {
      if (institutions.length && institutions.indexOf(r.institution_std) === -1) return false;
      if (contacts.length && contacts.indexOf(r.has_contact) === -1) return false;
        let pass = false;
        for (let i = 0; i < sources.length; i++) {
          const s = sources[i];
          if ((s === 'Seednet' || s === 'Both') && r._has_seednet) pass = true;
          else if (s === 'Research Only' && !r._has_seednet) pass = true;
          if (pass) break;
        }
        if (!pass) return false;
      }
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
    ['filter-crop', 'filter-state', 'filter-stress-tol', 'filter-evidence',
     'filter-stress-type', 'filter-source'].forEach(id => {
      const el = $(id);
      if (el) Array.from(el.options).forEach(o => o.selected = false);
    });
    $('filter-search').value = '';
    ['filter-institution', 'filter-contact'].forEach(id => { const el = $(id); if (el) el.value = ''; });
    $('filter-year-min').value = '';
    $('filter-year-max').value = '';
    STATE.sort = { key: null, dir: 'asc' };
    renderTableHead();
    applyFilters();
  }

  /* ------------------------------------------------------------------ *
   * Render: KPIs                                                       *
   * ------------------------------------------------------------------ */

  function renderKPIs() {
    const ac = $('about-count'); if (ac) ac.textContent = STATE.all.length.toLocaleString();
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
      case 'stress_tolerance_strict': {
        const v = r.stress_tolerance_strict;
        return v === 'Yes' ? '<span class="badge badge--yes">Yes</span>' : v === 'No' ? '<span class="badge badge--no">No</span>' : '<span class="muted">Unknown</span>';
      }
      case 'stress_types_strict':
        return r.stress_types_strict.length ? r.stress_types_strict.map(t => '<span class="badge badge--attr">' + esc(t) + '</span>').join(' ') : '<span class="muted">none found</span>';
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
        const display = full.length > 40 ? full.slice(0, 40).trim() + '…' : (full || code);
        return '<span class="cell-states" title="' + esc(full || code) + '">'
          + esc(display) + '</span>'
          + (r.states_acronyms ? ' <span class="muted">(' + esc(r.states_acronyms) + ')</span>' : '');
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
      } else if (key === 'stress_types') {
        av = a.stress_types[0] || '';
        bv = b.stress_types[0] || '';
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
  }

  function openAboutModal() {
    STATE.modal.mode = 'about';
    STATE.modal.lastFocus = document.activeElement;
    STATE.modal.open = true;

    const all = STATE.all;
    const total = all.length;
    const stressYes = all.filter(r => r.stress_tolerance === 'Yes').length;
    const highEv = all.filter(r => r.evidence_quality === 'High').length;
    const crops = new Set(all.map(r => r.crop).filter(Boolean)).size;
    const states = STATE.meta.vocab.states.length;
    const seednet = all.filter(r => r.seednet_available).length;

    setText('modal-title', 'About this catalogue');
    $('modal-meta').innerHTML = '';
    $('modal-tabs').innerHTML = '';
    $('modal-body').innerHTML =
      '<div class="about">'
      + '<p>This catalogue presents stress-tolerant seed varieties released in India. '
      + 'It combines official Seednet (Government of India) variety records with curated '
      + 'research evidence so that researchers, extension teams, and seed-procurement staff '
      + 'can identify climate-resilient cultivars across crops and states.</p>'
      + '<h3 class="about__h">Dataset summary</h3>'
      + '<ul class="about__list">'
      +   '<li><strong>' + total.toLocaleString() + '</strong> varieties indexed</li>'
      +   '<li><strong>' + stressYes.toLocaleString() + '</strong> flagged stress-tolerant ('
      +     (total ? Math.round(100 * stressYes / total) : 0) + '% of indexed varieties)</li>'
      +   '<li><strong>' + highEv.toLocaleString() + '</strong> records rated <em>High</em> on evidence quality</li>'
      +   '<li><strong>' + crops + '</strong> distinct crops across <strong>' + states
      +     '</strong> Indian states or union territories</li>'
      +   '<li><strong>' + seednet.toLocaleString() + '</strong> records cross-linked to Seednet portal entries</li>'
      + '</ul>'
      + '<h3 class="about__h">How the data is produced</h3>'
      + '<p>Variety listings are consolidated from Seednet and government gazette '
      + 'notifications, supplemented with structured search evidence (Google Custom Search '
      + 'and Google Scholar via SerpAPI), and synthesised by Google Gemini 2.5 Flash into '
      + 'per-variety stress-tolerance assessments and evidence-quality ratings. The result '
      + 'is exported as a static JSON file consumed directly by this page.</p>'
      + '<h3 class="about__h">External references</h3>'
      + '<ul class="about__links">'
      +   '<li><a href="https://seednet.gov.in/" target="_blank" rel="noopener">Seednet Portal</a></li>'
      +   '<li><a href="https://www.ncbi.nlm.nih.gov/" target="_blank" rel="noopener">NCBI</a></li>'
      +   '<li><a href="https://scholar.google.com/" target="_blank" rel="noopener">Google Scholar</a></li>'
      + '</ul>'
      + '</div>';

    showModal();
  }

  function renderModalMeta(rec) {
    const chips = [];
    if (rec.crop) chips.push('<span class="chip">' + esc(rec.crop) + '</span>');
    if (rec.year_of_release) chips.push('<span class="chip">Released ' + esc(rec.year_of_release) + '</span>');
    if (rec.stress_tolerance) {
      const cls = rec.stress_tolerance === 'Yes' ? 'chip--stress-yes' : 'chip--stress-no';
      chips.push('<span class="chip ' + cls + '">' + esc(rec.stress_tolerance === 'Yes'
        ? 'Stress Tolerant' : 'Standard Variety') + '</span>');
    }
    if (rec.evidence_quality) {
      chips.push('<span class="chip chip--ev-' + esc(rec.evidence_quality.toLowerCase())
        + '">Evidence: ' + esc(rec.evidence_quality) + '</span>');
    }
    $('modal-meta').innerHTML = chips.join(' ');
  }

  function renderModalTabs(rec) {
    const tabs = [];
    if (rec._has_seednet) {
      tabs.push({ id: 'seednet', label: 'Seednet record', badge: 'Govt of India portal' });
    }
    const pm = (((rec.research_data || {}).full_analysis_result || {}).processing_metadata) || {};
    const provenance = [pm.model || (rec.enrichment_wave && rec.enrichment_wave.indexOf('Gemini') !== -1 ? 'gemini-2.5-flash' : ''), pm.analysis_date ? String(pm.analysis_date).slice(0, 10) : '', (rec.search_metadata && rec.search_metadata.total_queries) ? rec.search_metadata.total_queries + ' searches' : ''].filter(Boolean).join(' · ');
    tabs.push({ id: 'research', label: 'Research & evidence', badge: 'web evidence' });

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
    const rd = rec.research_data || {};
    const sf = rec.seednet_fields || {};
    const sm = rec.search_metadata || {};
    const stressDetail = rd.stress_tolerance_detailed || {};
    const agr = rd.agronomic_details || {};
    const gen = rd.genetics_and_breeding || {};
    const com = rd.commercial_info || {};
    const enh = (Array.isArray(rd.enhancement_features) ? rd.enhancement_features : []).concat(rec.enrichment_wave ? ['wave: ' + rec.enrichment_wave] : []);
    const resultsSummary = rd.search_results_summary;
    const fieldTrials = rd.field_trials;
    const commercialSearches = rd.commercial_availability_searches;

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

    function inferStressLevel(rawLevel, rawDetail, stressLabel) {
      const lvl = rawLevel && String(rawLevel).trim() ? String(rawLevel).trim() : '';
      const detail = rawDetail && String(rawDetail).trim() ? String(rawDetail).trim() : '';
      if (lvl && lvl.toLowerCase() !== 'unknown') return { level: lvl, detail: detail || '' };
      return { level: 'unknown', detail: '' };
    }

    const drought = inferStressLevel(
      stressDetail.drought && stressDetail.drought.level,
      stressDetail.drought && stressDetail.drought.details,
      'Drought'
    );
    const heat = inferStressLevel(
      stressDetail.heat && stressDetail.heat.level,
      stressDetail.heat && stressDetail.heat.details,
      'Heat'
    );
    const salinity = inferStressLevel(
      stressDetail.salinity && stressDetail.salinity.level,
      stressDetail.salinity && stressDetail.salinity.details,
      'Salt'
    );
    const flood = inferStressLevel(
      stressDetail.flood && stressDetail.flood.level,
      stressDetail.flood && stressDetail.flood.details,
      'Flood'
    );

    function firstNonEmpty() {
      for (let i = 0; i < arguments.length; i++) {
        const v = arguments[i];
        if (v != null && String(v).trim() !== '' && String(v).trim().toLowerCase() !== 'not specified') return String(v).trim();
      }
      return '';
    }

    const stressTypeSource = (rec.trusted_stress_types && rec.trusted_stress_types.length)
      ? rec.trusted_stress_types
      : [];
    const stressTypeBadges = stressTypeSource.length
      ? stressTypeSource.map(t =>
          '<span class="badge badge--stress-type">' + esc(t) + '</span>').join(' ')
      : '<span class="muted">No structured stress types available.</span>';

    const keyAttrBadges = rec.key_attributes
      ? rec.key_attributes.split(',').map(s => s.trim()).filter(Boolean)
          .map(t => '<span class="badge badge--attr">' + esc(t) + '</span>').join(' ')
      : '<span class="muted">No key attributes recorded.</span>';

    const states = (rec.states_full && rec.states_full.length)
      ? rec.states_full.map(s => esc(s)).join(', ')
      : (rec.states_acronyms ? esc(rec.states_acronyms) : '<span class="muted">—</span>');

    function detailRow(label, value) {
      const has = value != null && String(value).trim() !== '';
      return '<div class="field-row">'
        + '<dt class="field-row__label">' + esc(label) + '</dt>'
        + '<dd class="field-row__value' + (has ? '' : ' field-row__value--muted') + '">'
        + (has ? esc(String(value)) : 'Not specified') + '</dd>'
        + '</div>';
    }

    function detailRowHtml(label, html) {
      const has = html != null && String(html).trim() !== '';
      return '<div class="field-row"><dt class="field-row__label">' + esc(label) + '</dt>'
        + '<dd class="field-row__value' + (has ? '' : ' field-row__value--muted') + '">' + (has ? html : 'Not specified') + '</dd></div>';
    }

    const stressRows = [
      detailRow('Drought Level', drought.level),
      detailRow('Drought Details', drought.detail),
      detailRow('Heat Level', heat.level),
      detailRow('Heat Details', heat.detail),
      detailRow('Salinity Level', salinity.level),
      detailRow('Salinity Details', salinity.detail),
      detailRow('Flood Level', flood.level),
      detailRow('Flood Details', flood.detail),
      detailRow('Disease Resistance Summary', stressDetail.disease_resistance && stressDetail.disease_resistance.summary),
      detailRow('Pest Resistance Summary', stressDetail.pest_resistance && stressDetail.pest_resistance.summary)
    ].join('');

    const agrRows = [
      detailRow('Yield', firstNonEmpty(agr.yield, sf['Average Yield (Kg/Ha)'])),
      detailRow('Stability', agr.stability),
      detailRow('Adaptation', firstNonEmpty(agr.adaptation, sf['Adaptation and recommended ecology'])),
      detailRow('Maturity (Research)', firstNonEmpty(agr.maturity_days, sf['Maturity (in days)'], rec.days_to_maturity)),
      detailRow('Plant Characteristics', firstNonEmpty(agr.plant_characteristics, sf['General Morphological Characteristics'], sf['Specific Morphological Characteristics'])),
      detailRow('Field Trials Notes', firstNonEmpty(agr.field_trials, stressEvidenceFromQueries('trial', ['trial', 'field trial'])))
    ].join('');

    const geneticsRows = [
      detailRow('Genetic Markers', gen.genetic_markers),
      detailRow('QTL Information', gen.qtl_information),
      detailRow('Molecular Mechanisms', gen.molecular_mechanisms)
    ].join('');

    const far = rd.full_analysis_result || {};
    const bc = far.breeder_and_contacts || {};
    const cs = rec.contacts_structured || {};
    const breederRows = [
      detailRow('Breeder / scientist name(s)', (cs.breeder_names || []).join('; ') || bc.breeder),
      detailRow('Email(s)', (cs.emails || []).join(', ')),
      detailRow('Phone(s)', (cs.phones || []).join(', ')),
      detailRow('Postal address', (cs.addresses || []).join('; ')),
      detailRow('Institution', firstNonEmpty(bc.institution, sf['Institution Responsible for developing Breeder Seed'], rec.developer_institution_csc)),
      detailRow('Contact notes (as found)', bc.contacts),
      detailRow('Publications (from search evidence)', bc.publications),
      detailRowHtml('Evidence sources', Array.isArray(bc.evidence_sources) && bc.evidence_sources.length
        ? bc.evidence_sources.map(u => '<a target="_blank" rel="noopener" href="' + esc(u) + '">' + esc(u) + '</a>').join('<br>') : '')
    ].join('');
    const pubs = Array.isArray(rec.publications_openalex) ? rec.publications_openalex : [];
    const pubRows = pubs.length
      ? '<ol class="pub-list">' + pubs.map(w =>
          '<li>' + esc((w.authors || []).slice(0, 4).join(', ') + ((w.authors || []).length > 4 ? ' et al.' : '')) + (w.year ? ' (' + esc(String(w.year)) + '). ' : '. ')
          + '<em>' + esc(w.title || '') + '</em>' + (w.venue ? '. ' + esc(w.venue) : '')
          + (w.doi ? '. <a target="_blank" rel="noopener" href="' + esc(w.doi) + '">' + esc(w.doi) + '</a>' : (w.landing_page ? '. <a target="_blank" rel="noopener" href="' + esc(w.landing_page) + '">link</a>' : ''))
          + ' <span class="muted">[mentioned in ' + esc(w.matched_on || 'abstract') + ']</span></li>').join('') + '</ol>'
        + (rec.publications_openalex_count > pubs.length ? '<p class="muted">' + esc(String(rec.publications_openalex_count - pubs.length)) + ' more in the data file.</p>' : '')
      : '<p class="muted">No OpenAlex publication mentions found for this variety name.</p>';
    const spubs = Array.isArray(rec.publications_scholar) ? rec.publications_scholar : [];
    const spubRows = spubs.length
      ? '<ol class="pub-list">' + spubs.map(w =>
          '<li>' + (w.publication_info ? esc(w.publication_info) + '. ' : '') + '<em>' + esc(w.title || '') + '</em>'
          + (w.link ? ' <a target="_blank" rel="noopener" href="' + esc(w.link) + '">link</a>' : '')
          + (w.cited_by ? ' <span class="muted">(cited by ' + esc(String(w.cited_by)) + ')</span>' : '')
          + ' <span class="muted">[name in ' + esc(w.matched_on || 'snippet') + ']</span></li>').join('') + '</ol>'
        + (rec.publications_scholar_count > spubs.length ? '<p class="muted">' + esc(String(rec.publications_scholar_count - spubs.length)) + ' more in the data file.</p>' : '')
      : '<p class="muted">No Google Scholar hits mentioning this variety name in the 2025 search results.</p>';
    const os_ = rec.official_sources || {};
    const officialRows = [
      detailRowHtml('Seednet (Govt of India) record', os_.seednet_url ? '<a target="_blank" rel="noopener" href="' + esc(os_.seednet_url) + '">' + esc(os_.seednet_url) + '</a>' : ''),
      detailRow('Seednet notification', [os_.seednet_notification_number, os_.seednet_notification_date].filter(Boolean).join(' · ')),
      detailRow('CSC meeting document', [os_.csc_meeting, os_.csc_source_document].filter(Boolean).join(' — ')),
      detailRow('Gazette reference', os_.gazette_reference),
      detailRow('Developing institution (CSC minutes)', [rec.developer_institution_csc, rec.developer_location_csc].filter(Boolean).join(', '))
    ].join('');
    const ic = rec.institution_contact || null;
    const instRows = ic ? [
      detailRow('Institution', ic.institution_official_name), detailRow('Type', ic.type),
      detailRowHtml('Website', ic.website ? '<a target="_blank" rel="noopener" href="' + esc(ic.website) + '">' + esc(ic.website) + '</a>' : ''),
      detailRowHtml('Contact page', ic.contact_page ? '<a target="_blank" rel="noopener" href="' + esc(ic.contact_page) + '">' + esc(ic.contact_page) + '</a>' : ''),
      detailRow('Emails', (ic.emails || []).join(', ')), detailRow('Phones', (ic.phones || []).join(', ')), detailRow('Address', ic.postal_address),
      detailRow('Head / director', ic.head_or_director), detailRow('Seed or variety enquiries', ic.variety_or_seed_contact),
      detailRowHtml('Sources', (ic.source_urls || []).map(u => '<a target="_blank" rel="noopener" href="' + esc(u) + '">' + esc(u) + '</a>').join('<br>'))
    ].join('') : '<div class="field-row"><dd class="field-row__value field-row__value--muted">No institution-level contact found yet.</dd></div>';
    const commercialRows = [
      detailRow('Seed Corporations', com.seed_corporations),
      detailRow('Availability Status', com.availability_status),
      detailRow('KVK', com.kvk),
      detailRow('Private Dealers', com.private_dealers)
    ].join('');

    return '<section class="tab-panel tab-panel--research" role="tabpanel">'
      + '<div class="tab-panel__head">'
      +   '<span class="badge-banner badge-banner--research">Summary written by ' + esc(((((rec.research_data || {}).full_analysis_result || {}).processing_metadata) || {}).model || 'gemini-2.5-flash') + ' on ' + esc(String(((((rec.research_data || {}).full_analysis_result || {}).processing_metadata) || {}).analysis_date || '').slice(0, 10)) + ' from ' + esc(String((rec.search_metadata || {}).total_queries || 0)) + ' web searches; every claim links to its source below.</span>'
      + '</div>'
      + '<div class="research-grid">'
      +   '<div class="research-card">'
      +     '<h3 class="research-card__h">Key attributes</h3>'
      +     '<div class="badge-row">' + keyAttrBadges + '</div>'
      +   '</div>'
      +   '<div class="research-card">'
      +     '<h3 class="research-card__h">Stress types</h3>'
      +     '<div class="badge-row">' + stressTypeBadges + '</div>'
      +   '</div>'
      +   '<div class="research-card">'
      +     '<h3 class="research-card__h">Evidence quality</h3>'
      +     (rec.evidence_quality
          ? '<span class="badge badge--ev-' + esc(rec.evidence_quality.toLowerCase())
              + '">' + esc(rec.evidence_quality) + '</span>'
          : '<span class="muted">Unrated</span>')
      +   '</div>'
      +   '<div class="research-card">'
      +     '<h3 class="research-card__h">Recommended states</h3>'
      +     '<p class="research-card__body">' + states + '</p>'
      +   '</div>'
      +   '<div class="research-card">'
      +     '<h3 class="research-card__h">Season(s)</h3>'
      +     '<p class="research-card__body">' + esc(rec.seasons || '—') + '</p>'
      +   '</div>'
      +   '<div class="research-card">'
      +     '<h3 class="research-card__h">Days to maturity</h3>'
      +     '<p class="research-card__body">'
      +       (rec._dtm_raw ? esc(rec._dtm_raw) : '<span class="muted">—</span>')
      +     '</p>'
      +   '</div>'
      +   '<div class="research-card">'
      +     '<h3 class="research-card__h">Sources</h3>'
      +     '<p class="research-card__body">'
      +       (function () {
                const urls = [];
                const seen = {};
                const push = u => { if (u && typeof u === 'string' && u.indexOf('http') === 0 && !seen[u]) { seen[u] = 1; urls.push(u); } };
                const st = (((rec.research_data || {}).full_analysis_result || {}).stress_tolerance) || {};
                Object.keys(st).forEach(k => ((st[k] || {}).evidence_sources || []).forEach(push));
                ['genetics_and_qtl', 'agronomic_performance', 'breeder_and_contacts', 'commercial_availability'].forEach(k => ((((rec.research_data || {}).full_analysis_result || {})[k] || {}).evidence_sources || []).forEach(push));
                (((rec.research_data || {}).full_analysis_result || {}).reference_links || []).forEach(push);
                (rec.direct_source_links || []).forEach(push);
                const pubs = (Number(rec.publications_scholar_count) || 0) + (Number(rec.publications_openalex_count) || 0);
                return (urls.length ? urls.slice(0, 12).map(u => '<a target="_blank" rel="noopener" href="' + esc(u) + '">' + esc(u.replace(/^https?:\/\//, '').slice(0, 60)) + '</a>').join('<br>') + (urls.length > 12 ? '<br><span class="muted">+' + (urls.length - 12) + ' more below</span>' : '') : '<span class="muted">No source URLs in the research summary.</span>')
                  + '<br><span class="muted">' + pubs + ' publication mention' + (pubs === 1 ? '' : 's') + ' listed below · ' + esc(String(resultsSummary != null ? resultsSummary : 0)) + ' search results</span>';
              })()
      +     '</p>'
      +   '</div>'
      + '</div>'
      + '<h3 class="research-card__h research-card__h--block">Detailed stress evidence</h3>'
      + '<dl class="field-grid">' + stressRows + '</dl>'
      + '<h3 class="research-card__h research-card__h--block">Agronomic details</h3>'
      + '<dl class="field-grid">' + agrRows + '</dl>'
      + '<h3 class="research-card__h research-card__h--block">Genetics and breeding</h3>'
      + '<dl class="field-grid">' + geneticsRows + '</dl>'
      + '<h3 class="research-card__h research-card__h--block">Official sources</h3>'
      + '<dl class="field-grid">' + officialRows + '</dl>'
      + '<h3 class="research-card__h research-card__h--block">Breeder and contacts (from research evidence)</h3>'
      + '<dl class="field-grid">' + breederRows + '</dl>'
      + '<h3 class="research-card__h research-card__h--block">Institution contact (official)</h3>'
      + '<dl class="field-grid">' + instRows + '</dl>'
      + '<h3 class="research-card__h research-card__h--block">Publications (Google Scholar via SerpAPI, 2025; mentions of the variety name)</h3>'
      + spubRows
      + '<h3 class="research-card__h research-card__h--block">Publications (OpenAlex, mentions of the variety name)</h3>'
      + pubRows
      + '<h3 class="research-card__h research-card__h--block">Commercial information</h3>'
      + '<dl class="field-grid">' + commercialRows + '</dl>'
      + '<h3 class="research-card__h research-card__h--block">Enhancement features</h3>'
      + '<div class="badge-row">'
      +   (enh.length
          ? enh.map(item => '<span class="badge badge--attr">' + esc(item) + '</span>').join(' ')
          : '<span class="muted">No enhancement metadata available.</span>')
      + '</div>'
      + '<h3 class="research-card__h research-card__h--block">Direct pulled source links</h3>'
      + (rec.direct_source_links && rec.direct_source_links.length
          ? '<div class="query-links">'
            + rec.direct_source_links.map(link =>
              '<div class="query-link-row">'
                + '<p class="query-link-row__query"><a target="_blank" rel="noopener" href="' + esc(link) + '">' + esc(link) + '</a></p>'
              + '</div>'
            ).join('')
            + '</div>'
          : '<p class="muted">No direct source URLs available in this record.</p>')
      + '<h3 class="research-card__h research-card__h--block">Quick research links</h3>'
      + '<div class="quick-links">'
      +   (q
          ? '<a class="btn btn--secondary" target="_blank" rel="noopener" href="https://scholar.google.com/scholar?q='
              + enc(q + ' stress tolerance') + '">Google Scholar</a>'
            + '<a class="btn btn--secondary" target="_blank" rel="noopener" href="https://www.ncbi.nlm.nih.gov/search/all/?term='
              + enc(q) + '">NCBI</a>'
          : '<span class="muted">Quick links require a variety name.</span>')
      + '</div>'
      + (
        (!rec.direct_source_links || !rec.direct_source_links.length)
          ? (
            '<h3 class="research-card__h research-card__h--block">Search query replay links (secondary)</h3>'
            + (generatedQueryLinks.length
                ? '<div class="query-links">'
                  + generatedQueryLinks.map(item =>
                    '<div class="query-link-row">'
                      + '<p class="query-link-row__query">' + esc(item.query || item.q || '') + '</p>'
                      + (item.results_count != null
                        ? '<p class="muted">Results: ' + esc(String(item.results_count)) + '</p>'
                        : '')
                      + '<div class="query-link-row__actions">'
                        + '<a class="btn btn--secondary" target="_blank" rel="noopener" href="' + esc(item.scholar_url || item.scholar || '') + '">Scholar</a>'
                        + '<a class="btn btn--secondary" target="_blank" rel="noopener" href="' + esc(item.google_url || item.google || '') + '">Google</a>'
                        + '<a class="btn btn--secondary" target="_blank" rel="noopener" href="' + esc(item.ncbi_url || item.ncbi || '') + '">NCBI</a>'
                      + '</div>'
                    + '</div>'
                  ).join('')
                  + '</div>'
                : '<p class="muted">No query-level links available in this record.</p>')
          )
          : ''
      )
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
      'evidence_quality', 'seednet_available', 'seednet_url', 'query_links_count'
    ];
    const lines = [cols.join(',')];
    STATE.filtered.forEach(r => {
      lines.push(cols.map(k => csvField(
        k === 'days_to_maturity' ? r._dtm_raw : r[k]
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
