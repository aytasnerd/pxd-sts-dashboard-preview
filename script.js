/*
 * Seed Varieties of India (Precision Development)
 *
 * A static data publication. All numbers on the page are computed from the
 * loaded records; nothing is hard-coded in HTML. Blank always means "not
 * stated": placeholder strings in the source data are treated as blank and
 * never rendered.
 *
 * Call graph: loadData -> normalizeRecord -> populateFilters / renderIntro ->
 * applyFilters -> renderTable + renderPagination. Records open from the URL
 * hash (#slug, #slug/evidence, #slug/contacts, #slug/sources, #about).
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Constants                                                          *
   * ------------------------------------------------------------------ */

  const COLUMNS = [
    { key: 'crop', label: 'Crop' },
    { key: 'variety', label: 'Variety', alwaysVisible: true },
    { key: 'year', label: 'Year considered' },
    { key: 'outcome', label: 'Outcome' },
    { key: 'stress', label: 'Stress tolerance' },
    { key: 'states', label: 'States' },
    { key: 'seednet', label: 'Seednet record', optional: true },
    { key: 'institution', label: 'Developing institution', optional: true },
    { key: 'pubs', label: 'Publications', optional: true }
  ];
  const OUTCOMES = ['Approved', 'Deferred', 'Rejected', 'Not stated', 'Not in the CSC minutes held'];
  const SOURCES = ['CSC minutes and Seednet', 'CSC minutes only', 'Seednet only'];
  const DEFAULT_VIEW = { crop: 'Rice', researched: 'Yes' };
  const STRESS_KEYS = ['drought', 'heat', 'salinity', 'flood', 'submergence'];
  const STRESS_NAME = { drought: 'Drought', heat: 'Heat', salinity: 'Salinity', salt: 'Salinity', flood: 'Flood', submergence: 'Submergence' };
  const EVIDENCE_LABEL = {
    'Confirmed by 2+ sources': 'Two or more sources',
    'Single source': 'One source',
    'Claimed, not confirmed': 'Claimed, not confirmed',
    'No stress tolerance claimed': 'None found',
    'None found': 'None found'
  };
  const EVIDENCE_ORDER = ['Two or more sources', 'One source', 'Claimed, not confirmed', 'None found', 'Not graded'];
  const SEEDNET_CONFIRMED = new Set(['confirmed_exact', 'confirmed_spelling']);
  const TABS = [
    { id: 'record', label: 'Record' },
    { id: 'evidence', label: 'Stress evidence' },
    { id: 'contacts', label: 'Contacts' },
    { id: 'sources', label: 'Publications and sources' }
  ];
  const SELECT_FILTERS = ['filter-crop', 'filter-state', 'filter-stress-type', 'filter-stress-evidence',
    'filter-outcome', 'filter-source', 'filter-contact', 'filter-research', 'filter-seednet'];
  // Filter state kept in the query string so a filtered view can be shared.
  const URL_KEYS = [['q', 'filter-search'], ['crop', 'filter-crop'], ['state', 'filter-state'], ['stress', 'filter-stress-type'],
    ['evidence', 'filter-stress-evidence'], ['outcome', 'filter-outcome'], ['source', 'filter-source'], ['institution', 'filter-institution'],
    ['contact', 'filter-contact'], ['researched', 'filter-research'], ['seednet', 'filter-seednet'], ['from', 'filter-year-min'], ['to', 'filter-year-max'], ['minutes', 'filter-minutes']];

  const STATE_CODE_TO_NAME = {
    AP: 'Andhra Pradesh', AR: 'Arunachal Pradesh', AS: 'Assam', BR: 'Bihar',
    CG: 'Chhattisgarh', DL: 'Delhi', GA: 'Goa', GJ: 'Gujarat', HR: 'Haryana',
    HP: 'Himachal Pradesh', JH: 'Jharkhand', JK: 'Jammu and Kashmir',
    KA: 'Karnataka', KL: 'Kerala', LA: 'Ladakh', MH: 'Maharashtra',
    ML: 'Meghalaya', MN: 'Manipur', MP: 'Madhya Pradesh', MZ: 'Mizoram',
    NL: 'Nagaland', OR: 'Odisha', PB: 'Punjab', PY: 'Puducherry', RJ: 'Rajasthan',
    SK: 'Sikkim', TG: 'Telangana', TN: 'Tamil Nadu', TR: 'Tripura',
    UK: 'Uttarakhand', UP: 'Uttar Pradesh', WB: 'West Bengal',
    AN: 'Andaman and Nicobar Islands', CH: 'Chandigarh',
    DD: 'Dadra and Nagar Haveli and Daman and Diu', LD: 'Lakshadweep'
  };

  // Seednet fields shown in the record, in order, with sentence-case labels.
  const SEEDNET_FIELDS = [
    ['Variety Name', 'Name on Seednet'], ['Crop Name', 'Crop on Seednet'], ['Group Name', 'Crop group'],
    ['Notification Number', 'Notification number'], ['Notification Date', 'Notification date'],
    ['Year of Release', 'Year of release'], ['State Central Variety', 'State or central variety'],
    ['Institution Responsible for developing Breeder Seed', 'Institution responsible for breeder seed'],
    ['Parentage', 'Parentage'], ['Resemblence to Variety', 'Resemblance to variety'],
    ['Adaptation and recommended ecology', 'Adaptation and recommended ecology'],
    ['Recommended States', 'Recommended states'], ['Maturity (in days)', 'Maturity (days)'],
    ['Average Yield (Kg/Ha)', 'Average yield (kg/ha)'], ['Seed Rate (Kg/Ha)', 'Seed rate (kg/ha)'],
    ['Spacing (in Cms)', 'Spacing (cm)'], ['Fertiliser Dosage (Kg/Ha)', 'Fertiliser dose (kg/ha)'],
    ['Agronomic Features', 'Agronomic features'],
    ['General Morphological Characteristics', 'General morphology'],
    ['Specific Morphological Characteristics', 'Specific morphology'],
    ['Reaction to Stress', 'Reaction to stress'], ['Reaction to Major Diseases', 'Reaction to major diseases'],
    ['Reaction to Major Pests', 'Reaction to major pests']
  ];
  const CSC_FIELDS = [
    ['approval_status', 'Decision as written in the minutes'], ['meeting_number', 'Meeting'], ['approval_date', 'Meeting date'],
    ['meeting_title', 'Title of the minutes'], ['source_document_filename', 'Source document'], ['page_reference', 'Page'],
    ['variety_code', 'Variety code'], ['institution', 'Developing institution'],
    ['institution_location', 'Institution location'], ['principal_investigator', 'Principal investigator'],
    ['state_zone', 'States or zone'], ['agro_climatic_zones', 'Agro-climatic zones'], ['maturity_group', 'Maturity group'],
    ['yield_performance', 'Yield performance'], ['special_traits', 'Special traits'], ['additional_notes', 'Notes']
  ];

  /* ------------------------------------------------------------------ *
   * State                                                              *
   * ------------------------------------------------------------------ */

  const STATE = {
    all: [], filtered: [], bySlug: new Map(),
    sort: { key: 'crop', dir: 'asc' }, sorted: null, coverage: null, minutesByKey: new Map(),
    page: { size: 25, index: 1 },
    columns: COLUMNS.reduce((a, c) => { a[c.key] = !c.optional; return a; }, {}),
    modal: { open: false, record: null, tab: 'record', lastFocus: null, mode: 'variety' },
    meta: { built: '', vocab: {} }
  };

  /* ------------------------------------------------------------------ *
   * Helpers                                                            *
   * ------------------------------------------------------------------ */

  const $ = (id) => document.getElementById(id);
  const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const n = (v) => Number(v).toLocaleString('en-IN');
  const uniq = (arr) => Array.from(new Set(arr.filter(Boolean)));
  const uniqSorted = (arr) => uniq(arr).sort((a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base' }));
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // Placeholder strings that carry no information. They are never rendered.
  const PLACEHOLDER_EXACT = /^(nan|none|null|undefined|n\/?a|na|nil|-+|—|–|\?|0000|unknown|unspecified|not specified|not available|not applicable|not stated|not found|not known|not mentioned|not reported|not recorded|not given|not provided|not found in searched sources|no information available from search results|no information available|no data|no data available|information not available|\[\]|\{\})\.?$/i;
  const PLACEHOLDER_PREFIX = /^(not (specified|explicitly (stated|specified|mentioned)|available|extracted|stated|found|mentioned|reported|provided|given|known)\b|n\/a\b|no (specific )?(information|data|details|evidence|mention)( was)? (is )?(available|found|provided|reported)\b|no information available\b|information (is )?not available\b|unknown\b|specific information regarding\b.*\bnot found\b|no specific information\b)/i;
  function isBlank(v) {
    if (v == null) return true;
    if (typeof v === 'number') return !Number.isFinite(v);
    if (typeof v === 'boolean') return false;
    if (Array.isArray(v)) return v.every(isBlank);
    if (typeof v === 'object') return Object.keys(v).length === 0 || Object.values(v).every(isBlank);
    const t = String(v).replace(/\s+/g, ' ').trim();
    if (!t) return true;
    return PLACEHOLDER_EXACT.test(t) || PLACEHOLDER_PREFIX.test(t) || (t.length < 80 && /\((not specified|not named|unknown)[^)]*\)\s*\.?$/i.test(t) && /^[^,;]*$/.test(t.replace(/\(.*\)/, '')) && /^(sponsoring|the )?\s*(authority|institute|institution|organisation|organization)?\s*\(/i.test(t));
  }
  function humanKey(k) {
    const t = String(k || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  // Plain text of any value; blank parts dropped.
  function asText(v) {
    if (isBlank(v)) return '';
    if (Array.isArray(v)) return v.filter(x => !isBlank(x)).map(asText).filter(Boolean).join('; ');
    if (typeof v === 'object') return Object.keys(v).filter(k => !isBlank(v[k])).map(k => humanKey(k) + ' ' + asText(v[k])).join('; ');
    return String(v).replace(/\s+/g, ' ').trim();
  }
  function clean(v) { return isBlank(v) ? '' : asText(v); }
  // Research prose: drop sentences that are placeholders or that refer to internal
  // field names ("average_yield is null", "RESULT_2").
  const INTERNAL_SENTENCE = /\b[a-z]+_[a-z_]+\b|\bRESULT_\d+\b|\boriginal (variety )?(data|record)\b|\b(is|as|was|recorded as|states?) '?null'?(?!\s+(allele|lox|kti|kunitz|lipoxygenase))\b|^null\b(?!\s+(allele|lox|kti|kunitz|lipoxygenase))/i;
  const NOT_FOUND_SENTENCE = /\b(was|were|is|are|could not be|has not been|have not been)\s+(not\s+)?(found|identified|located|available|provided|specified|reported|mentioned|retrieved)\b[^.]*\b(search|results|sources|snippets|documents|provided|retrieved)\b|\bnot found in\b|^no (specific |further |detailed |direct |explicit )?(information|data|details|mention|evidence)\b|^no\b[^.]{0,60}\b(data|information|details|evidence|results)\b[^.]*\b(returned|found|available|reported|retrieved)\b/i;
  function rclean(v) {
    const t = clean(v);
    if (!t) return '';
    const sentences = t.split(/(?<=[.!?])\s+(?=[A-Z0-9("'])/);
    const kept = sentences.map(x => x.trim()).filter(x => x && !isBlank(x.replace(/^[A-Za-z ()]+:\s*/, '')) && !isBlank(x) && !INTERNAL_SENTENCE.test(x) && !NOT_FOUND_SENTENCE.test(x));
    return kept.join(' ').trim();
  }
  function firstResearch() {
    for (let i = 0; i < arguments.length; i++) { const t = rclean(arguments[i]); if (t) return t; }
    return '';
  }
  function firstText() {
    for (let i = 0; i < arguments.length; i++) { const t = clean(arguments[i]); if (t) return t; }
    return '';
  }
  // Values typed entirely in capitals (Seednet, postal addresses) become title case.
  function deshout(s) {
    const t = String(s || '');
    const words = t.match(/[A-Za-z]{4,}/g) || [];
    if (words.length < 1 || t !== t.toUpperCase()) return t;
    return t.toLowerCase().replace(/\b([a-z])/g, (m, c) => c.toUpperCase());
  }
  // Seednet sometimes runs state names together ("Andhra Pradeshchhattisgarhodisha").
  function splitStates(v) {
    const t = String(v || '');
    if (/[,;\n]/.test(t)) return t;
    const names = Object.values(STATE_CODE_TO_NAME).concat(['Orissa', 'Jammu & Kashmir', 'Pondicherry', 'Uttaranchal']).sort((a, b) => b.length - a.length);
    let rest = t.toLowerCase().replace(/\s+/g, ''); const found = [];
    while (rest.length) {
      const hit = names.find(nm => rest.indexOf(nm.toLowerCase().replace(/\s+/g, '')) === 0);
      if (!hit) return t;
      found.push(hit); rest = rest.slice(hit.replace(/\s+/g, '').length);
    }
    return found.length > 1 ? found.join(', ') : t;
  }
  function capFirst(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function listJoin(arr) {
    if (arr.length <= 1) return arr.join('');
    return arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];
  }
  function httpUrl(u) {
    const t = String(u || '').trim();
    if (!t) return '';
    if (/^https?:\/\//i.test(t)) return t;
    if (/^www\.|^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(t) && !/\s/.test(t)) return 'https://' + t;
    return '';
  }
  function linkHtml(u, label) {
    return u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(label || u) + '</a>' : '';
  }
  function formatBuilt(b) {
    const m = String(b || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? (Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1]) : '';
  }
  function debounce(fn, ms) { let t; return function () { clearTimeout(t); const a = arguments; t = setTimeout(() => fn.apply(null, a), ms); }; }

  /* ------------------------------------------------------------------ *
   * Bootstrap                                                          *
   * ------------------------------------------------------------------ */

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bindStaticHandlers();
    await loadData();
  }

  function bindStaticHandlers() {
    $('btn-retry').addEventListener('click', loadData);
    $('btn-error-dismiss').addEventListener('click', () => { $('error-banner').hidden = true; });
    $('btn-about').addEventListener('click', () => { location.hash = 'about'; });
    $('btn-coverage').addEventListener('click', () => { location.hash = 'coverage'; });
    $('btn-reset').addEventListener('click', resetFilters);
    $('select-page-size').addEventListener('change', (e) => {
      STATE.page.size = parseInt(e.target.value, 10) || 25; STATE.page.index = 1; renderTable(); renderPagination();
    });
    $('btn-prev').addEventListener('click', () => goToPage(STATE.page.index - 1));
    $('btn-next').addEventListener('click', () => goToPage(STATE.page.index + 1));
    $('btn-export-csv').addEventListener('click', exportFilteredCSV);

    const colsBtn = $('btn-columns'), colsMenu = $('columns-menu');
    const closeCols = () => { colsMenu.hidden = true; colsBtn.setAttribute('aria-expanded', 'false'); };
    colsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const opening = colsMenu.hidden;
      colsMenu.hidden = !opening; colsBtn.setAttribute('aria-expanded', String(opening));
      if (opening) { const first = colsMenu.querySelector('input:not(:disabled)'); if (first) first.focus(); }
    });
    document.addEventListener('click', (e) => { if (!$('columns-wrap').contains(e.target)) closeCols(); });
    colsMenu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeCols(); colsBtn.focus(); } });

    $('filter-search').addEventListener('input', debounce(applyFilters, 150));
    SELECT_FILTERS.forEach(id => $(id).addEventListener('change', applyFilters));
    $('filter-institution').addEventListener('input', debounce(applyFilters, 200));
    $('filter-year-min').addEventListener('input', debounce(applyFilters, 250));
    $('filter-year-max').addEventListener('input', debounce(applyFilters, 250));

    $('detail-modal').addEventListener('click', (e) => { if (e.target.closest('[data-modal-close]')) closeModal(); });
    document.addEventListener('keydown', onModalKeydown);
    window.addEventListener('hashchange', route);

    const fd = $('filter-details');
    if (fd && window.matchMedia('(min-width: 901px)').matches) fd.open = true;
  }

  /* ------------------------------------------------------------------ *
   * Data load + normalisation                                          *
   * ------------------------------------------------------------------ */

  async function loadData() {
    showLoading(); hideError();
    try {
      const idxRes = await fetch('./data/index.json?t=' + Date.now(), { cache: 'no-store' });
      if (!idxRes.ok) throw new Error('HTTP ' + idxRes.status + ' on data/index.json');
      const meta = await idxRes.json();
      STATE.meta.built = meta.built || '';
      const v = encodeURIComponent(meta.built || '');
      const chunks = await Promise.all((meta.parts || []).map(async p => {
        const r = await fetch('./' + p + '?v=' + v);
        if (!r.ok) throw new Error('HTTP ' + r.status + ' on ' + p);
        return r.json();
      }));
      const data = [].concat(...chunks);
      if (!data.length) throw new Error('The data files contain no records.');

      STATE.all = data.map(normalizeRecord);
      try {
        const cr = await fetch('./data/coverage.json?v=' + v);
        STATE.coverage = cr.ok ? await cr.json() : null;
      } catch (e) { STATE.coverage = null; }
      mapMinutes();
      $('btn-coverage').hidden = !STATE.coverage;
      assignSlugs();
      buildVocabularies();
      populateFilters();
      renderColumnsMenu();
      renderTableHead();
      renderIntro();
      const built = formatBuilt(STATE.meta.built);
      setText('data-compiled', built ? 'Data compiled ' + built + '.' : '');
      const fromUrl = readUrlFilters();
      const h = hashValue();
      if (!fromUrl && !(h === 'all' || STATE.bySlug.has(h.split('/')[0]))) applyDefaultView();
      applyFilters();
      route();
    } catch (err) {
      console.error('[Seed varieties] data load failed:', err);
      showError(err && err.message ? err.message : String(err));
      STATE.all = []; STATE.filtered = [];
      renderTable(); renderPagination(); updateResultCount();
    } finally {
      hideLoading();
    }
  }

  function normalizeRecord(r) {
    const rec = { raw: r };
    rec.id = String(r.variety_id || '');
    rec.name = clean(r.variety_name) || 'Unnamed variety';
    rec.crop = clean(r.crop_clean) || clean(r.crop);
    const yInt = parseInt(String(r.year_of_release == null ? '' : r.year_of_release), 10);
    rec.year = Number.isFinite(yInt) && yInt > 1900 ? yInt : null;

    // States: full names from the cleaned list, else from codes.
    const full = (Array.isArray(r.states_full_clean) ? r.states_full_clean : (Array.isArray(r.states_full) ? r.states_full : []))
      .map(s => String(s || '').replace(/\s*&\s*/g, ' and ').trim()).filter(s => !isBlank(s));
    const codes = String(r.states_acronyms_clean || r.states_acronyms || '').split(',').map(s => s.trim().toUpperCase())
      .map(c => ({ TS: 'TG', UTT: 'UK', JAM: 'JK', NCT: 'DL' }[c] || c)).filter(c => STATE_CODE_TO_NAME[c]);
    rec.stateCodes = uniq(codes);
    rec.states = full.length ? uniq(full) : rec.stateCodes.map(c => STATE_CODE_TO_NAME[c]);

    rec.wave = String(r.enrichment_wave || '');
    rec.researched = !!rec.wave && rec.wave !== 'not_researched';
    rec.waveLabel = !rec.researched ? '' : /20250808|v2\./.test(rec.wave) ? 'August 2025' : 'October to November 2026';

    // Stress evidence.
    const norm = (a) => uniq((Array.isArray(a) ? a : []).map(s => STRESS_NAME[String(s || '').trim().toLowerCase()] || capFirst(String(s || '').trim())));
    rec.level = String(r.stress_confirmation_level || '');
    rec.graded = !!EVIDENCE_LABEL[rec.level];
    rec.evidence = rec.graded ? EVIDENCE_LABEL[rec.level] : 'Not graded';
    rec.typesConfirmed = norm(r.stress_types_confirmed);
    rec.typesMulti = norm(r.stress_types_multi_source);
    rec.typesClaimed = norm(r.stress_types_strict);
    rec.stressTypes = rec.graded ? rec.typesConfirmed : [];
    rec.stressText = stressCellText(rec);
    rec.stressRank = { 'Two or more sources': 0, 'One source': 1, 'Claimed, not confirmed': 2, 'None found': 3 }[rec.evidence];
    if (rec.stressRank == null) rec.stressRank = 4;

    // Seednet.
    rec.seednetStatus = String(r.seednet_match_status || '');
    rec.seednetFields = (r.seednet_fields && typeof r.seednet_fields === 'object') ? r.seednet_fields : {};
    rec.seednetUrl = String((r.official_sources || {}).seednet_url || r.seednet_url || '').trim();
    rec.hasSeednet = !!r.seednet_available && (!rec.seednetStatus || SEEDNET_CONFIRMED.has(rec.seednetStatus))
      && (Object.keys(rec.seednetFields).length > 0 || !!rec.seednetUrl);

    // Where the record comes from. Older builds lack record_source; derive it from the Seednet link.
    rec.source = SOURCES.indexOf(r.record_source) !== -1 ? r.record_source
      : (rec.hasSeednet ? 'CSC minutes and Seednet' : 'CSC minutes only');
    rec.seednetOnly = rec.source === 'Seednet only';
    if (rec.seednetOnly && (Object.keys(rec.seednetFields).length > 0 || rec.seednetUrl)) rec.hasSeednet = true;
    rec.outcome = OUTCOMES.indexOf(r.csc_outcome) !== -1 ? r.csc_outcome : (rec.seednetOnly ? 'Not in the CSC minutes held' : 'Not stated');
    if (rec.seednetOnly && rec.outcome === 'Not stated') rec.outcome = 'Not in the CSC minutes held';

    // Contacts.
    const cs = (r.contacts_structured && typeof r.contacts_structured === 'object') ? r.contacts_structured : {};
    rec.institution = firstText(cs.institution, r.developer_institution_csc, (r.csc_fields || {}).institution, rec.seednetOnly ? deshout(clean(rec.seednetFields['Institution Responsible for developing Breeder Seed'])) : '');
    rec.hasContact = contactData(r, rec).has ? 'Yes' : 'No';

    const pc = (Number(r.publications_scholar_count) || 0) + (Number(r.publications_openalex_count) || 0);
    rec.pubs = pc > 0 ? pc : null;

    rec.search = [rec.name, rec.crop, rec.states.join(' '), rec.institution, rec.stressText, rec.outcome,
      clean((r.csc_fields || {}).variety_code), clean(rec.seednetFields['Variety Name']), clean(r.key_attributes), clean(r.variety_name_as_printed),
      Array.isArray(r.search_names) ? r.search_names.map(clean).join(' ') : clean(r.search_names)]
      .join(' ').toLowerCase();
    rec.skel = ' ' + skeleton(rec.search);
    rec.words = ' ' + rec.search.replace(/[^a-z0-9]+/g, ' ') + ' ';
    return rec;
  }

  // Consonant skeleton for spelling-tolerant search ("swarna" finds "Swarana").
  function skeleton(t) { return String(t).toLowerCase().replace(/[aeiouy]/g, '').replace(/[^a-z0-9]+/g, ' '); }

  function stressCellText(rec) {
    if (rec.evidence === 'Two or more sources' || rec.evidence === 'One source') {
      const multi = rec.typesConfirmed.filter(t => rec.typesMulti.indexOf(t) !== -1);
      const single = rec.typesConfirmed.filter(t => rec.typesMulti.indexOf(t) === -1);
      const fmt = (arr) => capFirst(listJoin(arr.map((t, i) => i === 0 ? t : t.toLowerCase())));
      const parts = [];
      if (multi.length) parts.push(fmt(multi) + ' (two or more sources)');
      if (single.length) parts.push((parts.length ? listJoin(single.map(t => t.toLowerCase())) : fmt(single)) + ' (one source)');
      if (!parts.length) return rec.evidence === 'Two or more sources' ? 'Two or more sources' : 'One source';
      return parts.join('; ');
    }
    if (rec.evidence === 'Claimed, not confirmed') return 'Claimed, not confirmed';
    if (rec.evidence === 'None found') return 'None found';
    return '';
  }

  function assignSlugs() {
    STATE.bySlug = new Map();
    // Prefer the build's own record_id (clean and unique); fall back to a slug of crop and name.
    STATE.all.forEach(rec => {
      const rid = String(rec.raw.record_id || '').trim();
      if (rid && /^[A-Za-z0-9._~-]+$/.test(rid) && !STATE.bySlug.has(rid) && ['about', 'coverage', 'all'].indexOf(rid) === -1) { rec.slug = rid; STATE.bySlug.set(rid, rec); }
    });
    STATE.all.forEach(rec => {
      if (rec.slug) return;
      let base = (rec.crop + '-' + rec.name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'variety';
      let slug = base, i = 2;
      while (STATE.bySlug.has(slug) || slug === 'about' || slug === 'coverage' || slug === 'all') slug = base + '-' + (i++);
      rec.slug = slug;
      STATE.bySlug.set(slug, rec);
    });
  }

  function buildVocabularies() {
    const all = STATE.all;
    STATE.meta.vocab = {
      crops: uniqSorted(all.map(r => r.crop)),
      states: uniqSorted(all.flatMap(r => r.states)),
      stressTypes: uniqSorted(all.flatMap(r => r.stressTypes)),
      institutions: uniqSorted(all.map(r => r.institution))
    };
  }

  /* ------------------------------------------------------------------ *
   * Filters                                                            *
   * ------------------------------------------------------------------ */

  function fillSelect(id, values, labels) {
    const el = $(id);
    el.innerHTML = '<option value="">Any</option>' + values.map((v, i) =>
      '<option value="' + esc(v) + '">' + esc(labels ? labels[i] : v) + '</option>').join('');
  }

  function populateFilters() {
    const v = STATE.meta.vocab;
    const count = (pred) => STATE.all.filter(pred).length;
    fillSelect('filter-crop', v.crops);
    fillSelect('filter-state', v.states);
    fillSelect('filter-stress-type', v.stressTypes);
    const evPresent = EVIDENCE_ORDER.filter(l => STATE.all.some(r => r.evidence === l));
    fillSelect('filter-stress-evidence', evPresent, evPresent.map(l => l + ' (' + n(count(r => r.evidence === l)) + ')'));
    const oc = OUTCOMES.filter(o => STATE.all.some(r => r.outcome === o));
    fillSelect('filter-outcome', oc, oc.map(o => o + ' (' + n(count(r => r.outcome === o)) + ')'));
    const srcs = SOURCES.filter(x => STATE.all.some(r => r.source === x));
    fillSelect('filter-source', srcs, srcs.map(x => x + ' (' + n(count(r => r.source === x)) + ')'));
    fillSelect('filter-contact', ['Yes', 'No']);
    fillSelect('filter-research', ['Yes', 'No'], ['Yes', 'Official record only']);
    fillSelect('filter-seednet', ['Linked', 'Not linked']);
    $('institution-list').innerHTML = v.institutions.map(i => '<option value="' + esc(i) + '"></option>').join('');
    const years = STATE.all.map(r => r.year).filter(Boolean);
    if (years.length) {
      $('filter-year-min').placeholder = 'From ' + Math.min.apply(null, years);
      $('filter-year-max').placeholder = 'To ' + Math.max.apply(null, years);
    }
  }

  function applyFilters() {
    const q = ($('filter-search').value || '').trim().toLowerCase();
    const tokens = q ? q.split(/\s+/) : [];
    const shortTok = tokens.map(t => (t.length <= 3 || /^\d+$/.test(t)) ? t.replace(/[^a-z0-9]+/g, '') : '');
    const skelTokens = tokens.map(t => /^[a-z]{4,}$/.test(t) ? skeleton(t).trim() : '');
    const minutesKey = $('filter-minutes').value;
    const val = (id) => $(id).value;
    const crop = val('filter-crop'), st = val('filter-state'), stype = val('filter-stress-type'),
      ev = val('filter-stress-evidence'), oc = val('filter-outcome'), contact = val('filter-contact'),
      res = val('filter-research'), sn = val('filter-seednet'), source = val('filter-source');
    const inst = ($('filter-institution').value || '').trim().toLowerCase();
    const yMin = parseInt($('filter-year-min').value, 10), yMax = parseInt($('filter-year-max').value, 10);

    // Exact matching first; the spelling-tolerant match is used only when nothing matches exactly.
    const runFilter = (fuzzy) => STATE.all.filter(r => {
      for (let i = 0; i < tokens.length; i++) {
        // Short or numeric tokens ("co", "51") must be whole words; longer ones may match anywhere.
        if (shortTok[i] ? r.words.indexOf(' ' + shortTok[i] + ' ') !== -1 : r.search.indexOf(tokens[i]) !== -1) continue;
        if (fuzzy && skelTokens[i] && r.skel.indexOf(' ' + skelTokens[i]) !== -1) continue;
        return false;
      }
      if (crop && r.crop !== crop) return false;
      if (st && r.states.indexOf(st) === -1) return false;
      if (stype && r.stressTypes.indexOf(stype) === -1) return false;
      if (ev && r.evidence !== ev) return false;
      if (oc && r.outcome !== oc) return false;
      if (source && r.source !== source) return false;
      if (minutesKey && r.minutesKey !== minutesKey) return false;
      if (contact && r.hasContact !== contact) return false;
      if (res && (r.researched ? 'Yes' : 'No') !== res) return false;
      if (sn && (r.hasSeednet ? 'Linked' : 'Not linked') !== sn) return false;
      if (inst && r.institution.toLowerCase().indexOf(inst) === -1) return false;
      if (Number.isFinite(yMin) || Number.isFinite(yMax)) {
        if (!r.year) return false;
        if (Number.isFinite(yMin) && r.year < yMin) return false;
        if (Number.isFinite(yMax) && r.year > yMax) return false;
      }
      return true;
    });
    STATE.filtered = runFilter(false);
    if (!STATE.filtered.length && skelTokens.some(Boolean)) STATE.filtered = runFilter(true);
    STATE.page.index = 1;
    STATE.sorted = null;
    renderTable(); renderPagination(); updateResultCount(); updateFilterSummary();
    syncUrl();
  }

  function hashValue() {
    try { return decodeURIComponent((location.hash || '').replace(/^#/, '')); } catch (e) { return ''; }
  }
  function readUrlFilters() {
    const sp = new URLSearchParams(location.search);
    let any = false;
    URL_KEYS.forEach(([k, id]) => {
      if (!sp.has(k)) return;
      const el = $(id), v = sp.get(k);
      el.value = v;
      if (el.tagName === 'SELECT' && el.value !== v) el.value = '';
      if (id === 'filter-minutes' && !STATE.minutesByKey.has(v)) el.value = '';
      if (el.value) any = true;
    });
    return any;
  }
  function syncUrl() {
    const sp = new URLSearchParams();
    URL_KEYS.forEach(([k, id]) => { const v = ($(id).value || '').trim(); if (v) sp.set(k, v); });
    const qs = sp.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  }
  function applyDefaultView() {
    if (STATE.meta.vocab.crops.indexOf(DEFAULT_VIEW.crop) === -1) return;
    $('filter-crop').value = DEFAULT_VIEW.crop;
    $('filter-research').value = DEFAULT_VIEW.researched;
  }
  function isDefaultView() {
    return $('filter-crop').value === DEFAULT_VIEW.crop && $('filter-research').value === DEFAULT_VIEW.researched && activeFilterCount() === 2;
  }

  function activeFilterCount() {
    let c = SELECT_FILTERS.filter(id => $(id).value).length;
    ['filter-search', 'filter-institution', 'filter-year-min', 'filter-year-max', 'filter-minutes'].forEach(id => { if (($(id).value || '').trim()) c++; });
    return c;
  }
  function updateFilterSummary() {
    const c = activeFilterCount();
    setText('filter-summary', c ? 'Filter the list (' + c + ' active)' : 'Filter the list');
  }

  function resetFilters() {
    SELECT_FILTERS.forEach(id => { $(id).value = ''; });
    ['filter-search', 'filter-institution', 'filter-year-min', 'filter-year-max', 'filter-minutes'].forEach(id => { $(id).value = ''; });
    STATE.sort = { key: 'crop', dir: 'asc' };
    STATE.sorted = null;
    renderTableHead();
    applyFilters();
  }

  /* ------------------------------------------------------------------ *
   * Intro and counts                                                   *
   * ------------------------------------------------------------------ */

  function datasetStats() {
    const all = STATE.all;
    const years = all.map(r => r.year).filter(Boolean);
    const researched = all.filter(r => r.researched);
    const oc = {}; OUTCOMES.forEach(o => { oc[o] = all.filter(r => r.outcome === o).length; });
    // Stress counts over all records, as in the Stress evidence filter; the official-only part is reported separately.
    const ev = {}, evOfficial = {};
    EVIDENCE_ORDER.forEach(l => { ev[l] = all.filter(r => r.evidence === l).length; evOfficial[l] = all.filter(r => !r.researched && r.evidence === l).length; });
    const src = {}; SOURCES.forEach(x => { src[x] = all.filter(r => r.source === x).length; });
    return {
      total: all.length,
      yMin: years.length ? Math.min.apply(null, years) : '', yMax: years.length ? Math.max.apply(null, years) : '',
      crops: STATE.meta.vocab.crops.length, states: STATE.meta.vocab.states.length,
      outcome: oc,
      seednet: all.filter(r => r.hasSeednet).length,
      seednetSpelling: all.filter(r => r.hasSeednet && r.seednetStatus === 'confirmed_spelling').length,
      differentVariety: all.filter(r => r.seednetStatus === 'different_variety').length,
      researched: researched.length,
      waveAug: researched.filter(r => r.waveLabel === 'August 2025').length,
      waveOct: researched.filter(r => r.waveLabel === 'October to November 2026').length,
      notResearched: all.length - researched.length,
      ev: ev, evOfficial: evOfficial, src: src,
      inCsc: src['CSC minutes and Seednet'] + src['CSC minutes only'],
      officialGraded: all.filter(r => !r.researched && r.graded).length,
      officialGradedYes: all.filter(r => !r.researched && (r.evidence === 'Two or more sources' || r.evidence === 'One source')).length,
      withContact: all.filter(r => r.hasContact === 'Yes').length,
      withPubs: all.filter(r => r.pubs).length,
      supported: all.filter(r => r.evidence === 'Two or more sources' || r.evidence === 'One source').length,
      noteDisputes: all.filter(r => !isBlank(r.raw.stress_confirmation_note) && (r.evidence === 'Two or more sources' || r.evidence === 'One source')).length
    };
  }

  function outcomeSentence(s) {
    const o = s.outcome;
    if (!s.inCsc) return '';
    if (o['Not stated'] === s.inCsc) return 'This build does not yet record the outcome of each consideration by the CSC.';
    const parts = [];
    if (o.Approved) parts.push(n(o.Approved) + ' were approved');
    if (o.Deferred) parts.push(n(o.Deferred) + ' deferred');
    if (o.Rejected) parts.push(n(o.Rejected) + ' rejected');
    let t = 'Of the ' + n(s.inCsc) + ' varieties in the CSC minutes, ' + listJoin(parts);
    if (o['Not stated']) t += ', and for ' + n(o['Not stated']) + ' the minutes do not state the outcome';
    return t + '.';
  }

  function sourceSentence(s) {
    const src = s.src, parts = [];
    if (src['CSC minutes and Seednet']) parts.push(n(src['CSC minutes and Seednet']) + ' appear in the minutes of the Central Sub-Committee on Crop Standards, Notification and Release of Varieties (CSC) that this dataset holds and are also notified on Seednet, the Government of India seed portal');
    if (src['CSC minutes only']) parts.push(n(src['CSC minutes only']) + ' appear only in the CSC minutes held');
    if (src['Seednet only']) parts.push(n(src['Seednet only']) + ' are notified on Seednet but do not appear in the CSC minutes held');
    const joined = parts.length === 3 ? parts[0] + '; ' + parts[1] + '; and ' + parts[2] : parts.length === 2 ? parts[0] + ', and ' + parts[1] : parts.join('');
    return 'This page lists ' + n(s.total) + ' crop varieties. Of these, ' + joined + '.';
  }
  function stressSentence(s) {
    const two = s.ev['Two or more sources'], one = s.ev['One source'];
    const twoO = s.evOfficial['Two or more sources'], oneO = s.evOfficial['One source'];
    let t = 'Of all ' + n(s.total) + ', ' + n(two) + ' have a tolerance of drought, heat, salinity, flood or submergence supported by two or more independent sources naming the variety, and ' + n(one) + ' by one such source.';
    if (twoO || oneO) t += ' Of these, ' + n(twoO) + ' and ' + n(oneO) + ' respectively were graded from the official Seednet text alone, because the variety has not been researched on the web.';
    return t;
  }

  function renderIntro() {
    const s = datasetStats();
    $('intro-text').textContent =
      sourceSentence(s) + ' '
      + (s.yMin && s.yMax ? 'Their years, the year of the CSC meeting or, for varieties found only on Seednet, the year of release, run from ' + s.yMin + ' to ' + s.yMax + '. ' : '')
      + (outcomeSentence(s) ? outcomeSentence(s) + ' ' : '')
      + 'Coverage is uneven. ' + n(s.researched) + ' of ' + n(s.total) + ' varieties have been researched on the web; the other ' + n(s.notResearched) + ' have the official record only. '
      + stressSentence(s) + ' '
      + 'Contact details of the developing institution are available for ' + n(s.withContact) + ' of ' + n(s.total) + ' varieties. '
      + 'A blank cell means the source does not state the value; it never means zero or none.';
    $('intro-note').innerHTML = esc('Open a row to see the full record, the contacts of the developing institution and the sources. '
      + 'The research summaries were written by language models from web searches in August 2025 and in October and November 2026, and each cites its sources. They are leads to check against those sources, not official data.')
      + (STATE.coverage ? ' See <a href="#coverage">Coverage</a> for the list of minutes held.' : '');
  }

  function updateResultCount() {
    const total = STATE.all.length, shown = STATE.filtered.length;
    const el = $('result-count');
    if (total && isDefaultView()) {
      el.innerHTML = 'Showing the ' + n(shown) + ' ' + esc(DEFAULT_VIEW.crop.toLowerCase()) + ' varieties that have web research, of '
        + n(total) + ' varieties in all. <a href="#all" id="default-clear">Clear the filters</a> to see every crop.';
      return;
    }
    const mk = $('filter-minutes').value;
    if (total && mk && STATE.minutesByKey.has(mk)) {
      el.innerHTML = 'Showing ' + n(shown) + ' of ' + n(total) + ' varieties, limited to those from ' + esc(minutesName(STATE.minutesByKey.get(mk))) + '. <a href="#" id="minutes-clear">Show all minutes again</a>.';
      $('minutes-clear').addEventListener('click', (e) => { e.preventDefault(); $('filter-minutes').value = ''; applyFilters(); });
      return;
    }
    el.textContent = !total ? 'No varieties loaded.' : 'Showing ' + n(shown) + ' of ' + n(total) + ' varieties';
  }

  /* ------------------------------------------------------------------ *
   * Table                                                              *
   * ------------------------------------------------------------------ */

  function renderColumnsMenu() {
    const menu = $('columns-menu');
    menu.innerHTML = '<p class="dropdown__note">Columns shown in the list</p>' + COLUMNS.map(c =>
      '<label class="dropdown__item"><input type="checkbox" data-col="' + esc(c.key) + '"'
      + (STATE.columns[c.key] ? ' checked' : '') + (c.alwaysVisible ? ' disabled' : '') + '> '
      + esc(c.label) + (c.alwaysVisible ? ' (always shown)' : '') + '</label>').join('');
    menu.querySelectorAll('input[data-col]').forEach(cb => cb.addEventListener('change', () => {
      STATE.columns[cb.dataset.col] = cb.checked; renderTableHead(); renderTable();
    }));
  }

  function renderTableHead() {
    const thead = $('tbl-varieties').querySelector('thead');
    thead.innerHTML = '<tr>' + COLUMNS.filter(c => STATE.columns[c.key]).map(c => {
      const sorted = STATE.sort.key === c.key;
      const aria = sorted ? (STATE.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
      return '<th scope="col" aria-sort="' + aria + '" class="th-' + c.key + '"><button type="button" class="th-sort" data-key="' + esc(c.key) + '">'
        + esc(c.label) + '<span class="th-sort__ind" aria-hidden="true">' + (sorted ? (STATE.sort.dir === 'asc' ? ' ↑' : ' ↓') : '') + '</span></button></th>';
    }).join('') + '</tr>';
    thead.querySelectorAll('.th-sort').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.key;
      STATE.sort = STATE.sort.key === k ? { key: k, dir: STATE.sort.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' };
      STATE.sorted = null; STATE.page.index = 1;
      renderTableHead(); renderTable(); renderPagination();
      const again = thead.querySelector('.th-sort[data-key="' + k + '"]'); if (again) again.focus();
    }));
  }

  function statesText(rec) {
    const s = rec.states;
    if (s.length <= 3) return listJoin(s);
    return s.slice(0, 3).join(', ') + ' and ' + (s.length - 3) + ' more';
  }

  function cellText(key, r) {
    switch (key) {
      case 'crop': return r.crop;
      case 'variety': return r.name.replace(/-/g, '\u2011');
      case 'year': return r.year ? String(r.year) : '';
      case 'outcome': return r.outcome === 'Not stated' ? '' : r.outcome;
      case 'stress': return r.stressText;
      case 'states': return statesText(r);
      case 'seednet': return r.hasSeednet ? 'Linked' : '';
      case 'institution': return r.institution;
      case 'pubs': return r.pubs ? n(r.pubs) : '';
      default: return '';
    }
  }

  function sortValue(key, r) {
    switch (key) {
      case 'year': return r.year;
      case 'pubs': return r.pubs;
      case 'stress': return r.stressRank === 4 ? null : r.stressRank;
      case 'outcome': return r.outcome === 'Not stated' ? null : OUTCOMES.indexOf(r.outcome);
      case 'source': return SOURCES.indexOf(r.source);
      case 'states': return r.states.length ? r.states.join(', ') : null;
      case 'seednet': return r.hasSeednet ? 0 : null;
      default: { const t = cellText(key, r); return t ? t : null; }
    }
  }

  function sortData(data) {
    const { key, dir } = STATE.sort;
    if (!key) return data;
    const mul = dir === 'desc' ? -1 : 1;
    const coll = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
    return data.slice().sort((a, b) => {
      const av = sortValue(key, a), bv = sortValue(key, b);
      if (av == null && bv == null) return coll.compare(a.name, b.name);
      if (av == null) return 1;
      if (bv == null) return -1;
      const c = (typeof av === 'number' && typeof bv === 'number') ? av - bv : coll.compare(String(av), String(bv));
      return c ? c * mul : coll.compare(a.name, b.name);
    });
  }

  function renderTable() {
    const tbody = $('tbl-varieties').querySelector('tbody');
    const cols = COLUMNS.filter(c => STATE.columns[c.key]);
    if (!STATE.all.length) { tbody.innerHTML = '<tr><td class="empty" colspan="' + cols.length + '">No data loaded.</td></tr>'; return; }
    if (!STATE.sorted) STATE.sorted = sortData(STATE.filtered);
    const data = STATE.sorted;
    if (!data.length) {
      tbody.innerHTML = '<tr><td class="empty" colspan="' + cols.length + '"><p>No varieties match the current filters.</p>'
        + '<button id="btn-empty-reset" type="button" class="btn-link">Clear all filters</button></td></tr>';
      $('btn-empty-reset').addEventListener('click', resetFilters);
      return;
    }
    const start = (STATE.page.index - 1) * STATE.page.size;
    tbody.innerHTML = data.slice(start, start + STATE.page.size).map(r =>
      '<tr class="data-row" data-slug="' + esc(r.slug) + '">'
      + cols.map(c => {
        const t = cellText(c.key, r);
        const inner = c.key === 'variety'
          ? '<a class="row-link" href="#' + esc(r.slug) + '">' + esc(t) + '</a>'
          : esc(t);
        return '<td class="td-' + c.key + '" data-label="' + esc(c.label) + '"' + (t ? '' : ' data-empty') + '>' + inner + '</td>';
      }).join('') + '</tr>').join('');
    tbody.querySelectorAll('.data-row').forEach(tr => tr.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      STATE.modal.lastFocus = tr.querySelector('.row-link');
      location.hash = tr.dataset.slug;
    }));
    tbody.querySelectorAll('.row-link').forEach(a => a.addEventListener('click', () => { STATE.modal.lastFocus = a; }));
  }

  function renderPagination() {
    const total = STATE.filtered.length, pages = Math.max(1, Math.ceil(total / STATE.page.size));
    if (STATE.page.index > pages) STATE.page.index = pages;
    setText('page-info', 'Page ' + n(STATE.page.index) + ' of ' + n(pages));
    $('btn-prev').disabled = STATE.page.index <= 1;
    $('btn-next').disabled = STATE.page.index >= pages;
  }
  function goToPage(p) {
    const pages = Math.max(1, Math.ceil(STATE.filtered.length / STATE.page.size));
    STATE.page.index = Math.min(Math.max(1, p), pages);
    renderTable(); renderPagination();
    $('result-count').scrollIntoView({ block: 'nearest' });
  }

  /* ------------------------------------------------------------------ *
   * Routing (permalinks)                                               *
   * ------------------------------------------------------------------ */

  function route() {
    if (!STATE.all.length) return;
    const h = hashValue();
    if (!h) { if (STATE.modal.open) closeModal(true); return; }
    if (h === 'all') { if (STATE.modal.open) closeModal(true); if (activeFilterCount()) resetFilters(); return; }
    if (h === 'about') { openAbout(); return; }
    if (h === 'coverage' && STATE.coverage) { openCoverage(); return; }
    const parts = h.split('/');
    const rec = STATE.bySlug.get(parts[0]);
    if (!rec) return;
    const tab = TABS.some(t => t.id === parts[1]) ? parts[1] : 'record';
    openRecord(rec, tab);
  }

  function setHash(h) {
    const url = location.pathname + location.search + (h ? '#' + h : '');
    history.replaceState(null, '', url);
  }

  /* ------------------------------------------------------------------ *
   * Record view                                                        *
   * ------------------------------------------------------------------ */

  function openRecord(rec, tab) {
    const wasOpen = STATE.modal.open && STATE.modal.record === rec;
    STATE.modal.mode = 'variety';
    STATE.modal.record = rec;
    STATE.modal.tab = tab;
    if (!STATE.modal.open && !STATE.modal.lastFocus) STATE.modal.lastFocus = document.activeElement;
    STATE.modal.open = true;
    rec.view = rec.view || buildView(rec);
    setText('modal-title', rec.name);
    $('modal-sub').textContent = rec.view.subtitle;
    $('modal-sub').hidden = !rec.view.subtitle;
    renderTabs();
    renderPanel();
    showModal(!wasOpen);
  }

  function renderTabs() {
    const bar = $('modal-tabs');
    bar.hidden = false;
    bar.innerHTML = TABS.map(t => {
      const sel = STATE.modal.tab === t.id;
      return '<button type="button" role="tab" class="tab" id="tab-' + t.id + '" aria-controls="modal-body" aria-selected="' + sel + '" tabindex="' + (sel ? '0' : '-1') + '" data-tab="' + t.id + '">' + esc(t.label) + '</button>';
    }).join('');
    bar.querySelectorAll('.tab').forEach(b => {
      b.addEventListener('click', () => selectTab(b.dataset.tab, false));
      b.addEventListener('keydown', (e) => {
        const ids = TABS.map(t => t.id); let i = ids.indexOf(b.dataset.tab);
        if (e.key === 'ArrowRight') i = (i + 1) % ids.length;
        else if (e.key === 'ArrowLeft') i = (i - 1 + ids.length) % ids.length;
        else if (e.key === 'Home') i = 0;
        else if (e.key === 'End') i = ids.length - 1;
        else return;
        e.preventDefault(); selectTab(ids[i], true);
      });
    });
  }

  function selectTab(id, focus) {
    STATE.modal.tab = id;
    setHash(STATE.modal.record.slug + (id === 'record' ? '' : '/' + id));
    renderTabs(); renderPanel();
    $('modal-panel').scrollTop = 0;
    if (focus) $('tab-' + id).focus();
  }

  function renderPanel() {
    const rec = STATE.modal.record;
    const body = $('modal-body');
    body.setAttribute('role', 'tabpanel');
    body.setAttribute('aria-labelledby', 'tab-' + STATE.modal.tab);
    body.innerHTML = rec.view[STATE.modal.tab];
  }

  // Definition-list helpers. Rows with blank values are omitted.
  function row(label, value) {
    const t = clean(value);
    return t ? '<div class="field"><dt>' + esc(label) + '</dt><dd>' + esc(t) + '</dd></div>' : '';
  }
  function rowHtml(label, html) {
    return html && String(html).trim() ? '<div class="field"><dt>' + esc(label) + '</dt><dd>' + html + '</dd></div>' : '';
  }
  function dl(rows) { return rows ? '<dl class="fields">' + rows + '</dl>' : ''; }
  function section(title, inner, lead) {
    if (!inner) return '';
    return '<section class="rsec"><h3>' + esc(title) + '</h3>' + (lead ? '<p class="lead">' + lead + '</p>' : '') + inner + '</section>';
  }
  function p(text, cls) { return text ? '<p' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(text) + '</p>' : ''; }

  // One numbered, deduplicated source list per record.
  function urlKey(u) {
    try { const x = new URL(u); return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '') + x.search).toLowerCase(); }
    catch (e) { return String(u).toLowerCase(); }
  }
  function sourceTitle(u) {
    try {
      const x = new URL(u);
      if (/seednet\.gov\.in$/i.test(x.hostname) && /variety/i.test(x.pathname)) return { host: 'seednet.gov.in', title: 'Seednet record of this variety' };
      const host = x.hostname.replace(/^www\./, '');
      let last = decodeURIComponent(x.pathname.replace(/\/+$/, '').split('/').filter(Boolean).pop() || '');
      last = last.replace(/\.(pdf|html?|aspx?|php|jsp)$/i, '').replace(/[-_+]+/g, ' ').replace(/\s+/g, ' ').trim();
      const ext = (x.pathname.match(/\.(pdf)$/i) || [])[1];
      const good = last && /[a-z]{3,}/i.test(last) && last.length >= 6 && !/^(index|default|home|en|view|details?|article|abs|full|fulltext)$/i.test(last);
      const title = good ? capFirst(last.length > 90 ? last.slice(0, 87).replace(/\s\S*$/, '') + '...' : last) : (ext ? 'PDF document' : 'Web page');
      return { host: host, title: title + (good && ext ? ' (PDF)' : '') };
    } catch (e) { return { host: '', title: 'Web page' }; }
  }

  function buildSources(rec) {
    const r = rec.raw;
    const far = ((r.research_data || {}).full_analysis_result) || {};
    const st = far.stress_tolerance || {};
    const list = []; const index = new Map();
    const add = (u) => {
      if (typeof u !== 'string' || !/^https?:\/\//i.test(u.trim())) return 0;
      const k = urlKey(u.trim());
      if (index.has(k)) return index.get(k);
      list.push(u.trim().replace(/^http:\/\//i, (m) => m)); index.set(k, list.length); return list.length;
    };
    if (rec.hasSeednet && rec.seednetUrl) add(rec.seednetUrl);
    Object.keys(st).forEach(k => ((st[k] || {}).evidence_sources || []).forEach(add));
    ['genetics_and_qtl', 'agronomic_performance', 'breeder_and_contacts'].forEach(k => ((far[k] || {}).evidence_sources || []).forEach(add));
    (far.reference_links || []).forEach(add);
    (r.direct_source_links || []).forEach(add);
    const cs = r.contacts_structured || {}, ic = r.institution_contact || {};
    (cs.contact_source_urls || []).forEach(add);
    (ic.source_urls || []).forEach(add);
    return { list: list, add: add, nums: (urls) => uniq((urls || []).map(add).filter(Boolean)).sort((a, b) => a - b) };
  }
  function sourceRef(nums) {
    if (!nums.length) return '';
    return (nums.length === 1 ? 'Source ' : 'Sources ') + listJoin(nums.map(String)) + ' in the list under Publications and sources.';
  }

  function buildView(rec) {
    const r = rec.raw;
    const rd = r.research_data || {};
    const far = (rd.full_analysis_result && typeof rd.full_analysis_result === 'object') ? rd.full_analysis_result : {};
    const csc = r.csc_fields || {};
    const os_ = r.official_sources || {};
    const sf = rec.hasSeednet ? rec.seednetFields : {};
    const src = buildSources(rec);

    /* ---------- Record tab ---------- */
    const inst = firstText(csc.institution, r.developer_institution_csc, (r.contacts_structured || {}).institution);
    const loc = firstText(csc.institution_location, r.developer_location_csc);
    const meeting = clean(csc.meeting_number);
    const mdate = clean(csc.approval_date).replace(/T00:00:00(\.0+)?Z?/g, '');
    const sentences = [];
    const notifNo = clean(sf['Notification Number'] || os_.seednet_notification_number);
    const notifDate = clean(sf['Notification Date'] || os_.seednet_notification_date);
    const notifText = (notifDate ? ' on ' + notifDate : '') + (notifNo ? ' (' + notifNo.replace(/\.$/, '') + ')' : '');
    if (rec.seednetOnly) {
      const bsi = deshout(clean(sf['Institution Responsible for developing Breeder Seed']));
      sentences.push((rec.crop ? rec.crop + ' variety' : 'Variety') + ' notified on Seednet' + notifText + '. It does not appear in the CSC minutes held for this dataset.');
      if (bsi) sentences.push('Seednet names ' + bsi.replace(/[.\s]+$/, '') + ' as responsible for its breeder seed.');
    } else {
      sentences.push(((rec.crop ? rec.crop + ' variety' : 'Variety') + (inst ? ' developed by ' + inst + (loc && inst.indexOf(loc) === -1 ? ', ' + loc : '') : '')).replace(/[.\s]+$/, '') + '.');
      let consider = 'It was considered by the CSC' + (meeting ? ' at its ' + meeting + ' meeting' : '') + (mdate ? ' on ' + mdate : (rec.year ? ' in ' + rec.year : ''));
      consider += rec.outcome === 'Approved' ? ' and approved.' : rec.outcome === 'Deferred' ? ' and deferred.' : rec.outcome === 'Rejected' ? ' and rejected.' : '; the outcome is not recorded in this build.';
      sentences.push(consider);
      if (rec.hasSeednet && (notifNo || notifDate)) sentences.push('Seednet records its notification' + notifText + '.');
    }
    sentences.push({ 'CSC minutes and Seednet': 'The record draws on the CSC minutes and on Seednet.', 'CSC minutes only': 'The record draws on the CSC minutes only; no matching Seednet record was linked.', 'Seednet only': '' }[rec.source]);
    const snYear = parseInt(clean(sf['Year of Release']), 10);
    if (!rec.seednetOnly && rec.year && Number.isFinite(snYear) && snYear > 1900 && snYear !== rec.year) {
      sentences.push('The year in the list (' + rec.year + ') is the year the CSC considered the variety; Seednet gives ' + snYear + ' as the year of release.');
    }
    rec.view = {};
    const subtitle = rec.seednetOnly
      ? [rec.crop, rec.year ? 'released ' + rec.year : '', 'Seednet only'].filter(Boolean).join(', ')
      : [rec.crop, rec.year ? 'considered ' + rec.year : '', rec.outcome !== 'Not stated' ? rec.outcome.toLowerCase() : ''].filter(Boolean).join(', ');

    // Prominent contact lines on the record tab.
    const contact = buildContacts(rec, src);
    const quickContact = contact.quick
      ? section('Contact', dl(contact.quick), 'The full contact details of the developing institution are under Contacts.')
      : '';

    const minutesPage = httpUrl(os_.csc_minutes_list_page);
    const minutesUrl = httpUrl(os_.csc_minutes_url), archivedUrl = httpUrl(os_.csc_minutes_archived_url);
    const docName = firstText(csc.source_document_filename, os_.csc_source_document);
    const minutesTitle = 'Minutes of the ' + (meeting ? meeting + ' ' : '') + 'CSC meeting';
    const archived = archivedUrl ? ', ' + linkHtml(archivedUrl, 'archived copy') : '';
    const minutesRow = minutesUrl
      ? rowHtml('Minutes', linkHtml(minutesUrl, minutesTitle + ' (PDF)') + archived) + row('Source document', docName)
      : rowHtml('Minutes', esc(docName || minutesTitle) + (minutesPage ? ', listed on the ' + linkHtml(minutesPage, 'CSC minutes page') : '') + archived);
    const cscRows = minutesRow + row('Year considered', rec.year)
      + row('Outcome', rec.outcome === 'Not stated' ? '' : rec.outcome)
      + CSC_FIELDS.filter(([k]) => k !== 'source_document_filename').map(([k, l]) => row(l, k === 'approval_date' ? clean(csc[k]).replace(/T00:00:00(\.0+)?Z?/g, '') : k === 'approval_status' ? capFirst(clean(csc[k])) : k === 'page_reference' ? clean(csc[k]).replace(/^page\s*/i, '') : csc[k])).join('')
      + (clean(csc.state_zone) ? '' : row('States recommended', rec.states.join(', ')));

    let seednetBlock = '';
    if (rec.hasSeednet) {
      const rows = SEEDNET_FIELDS.map(([k, l]) => {
        let v = clean(sf[k]);
        if (/^0+(\.0+)?$/.test(v)) v = '';
        if (k === 'State Central Variety' && !/^(state|central)/i.test(v)) v = '';
        if (k === 'Recommended States') v = splitStates(v);
        return row(l, deshout(v));
      }).join('');
      const how = rec.seednetOnly ? 'Fields as published on Seednet.' : rec.seednetStatus === 'confirmed_spelling'
        ? 'Linked because the crop and the name match, allowing a small spelling difference.'
        : 'Linked because the crop and the name match.';
      seednetBlock = section('Seednet record', dl(rowHtml('Seednet page', linkHtml(rec.seednetUrl, 'Open this variety on seednet.gov.in')) + rows), esc(how + (r.seednet_rematched ? ' The link was corrected in November 2026.' : '')));
    } else {
      const cand = (r.seednet_candidate && typeof r.seednet_candidate === 'object') ? r.seednet_candidate : null;
      const candName = cand ? clean(cand.variety_name) : '';
      const candDesc = candName ? candName + (clean(cand.crop) ? ' (' + deshout(clean(cand.crop)).toLowerCase() + ')' : '') : '';
      const reason = cand ? firstText(cand.reason, cand.note, cand.match_reason, cand.review_reason) : '';
      let t;
      if (rec.seednetStatus === 'needs_review') {
        t = 'A possible Seednet record' + (candDesc ? ', ' + candDesc + ',' : '') + ' was found but needs review before it can be linked, so it is not used.';
      } else if (rec.seednetStatus === 'same_name_crop_conflict') {
        t = 'Seednet has a record with the same name and crop' + (candDesc ? ', ' + candDesc + ',' : '') + ' but it conflicts with this variety in other respects, so it is not linked.';
      } else {
        t = 'No Seednet record with this name and crop was found.';
        if (rec.seednetStatus === 'different_variety' && candDesc) t += ' The nearest Seednet entry, ' + candDesc + ', is a different variety and is not used.';
      }
      if (reason) t += ' ' + capFirst(reason.replace(/\.?$/, '.'));
      seednetBlock = section('Seednet record', p(t));
    }

    const gq = (far.genetics_and_qtl && typeof far.genetics_and_qtl === 'object') ? far.genetics_and_qtl : {};
    const legacyGen = rd.genetics_and_breeding || {};
    const genOfficial = row('Parentage (Seednet)', deshout(clean(sf['Parentage'])))
      + row('Parent material (CSC minutes)', csc.parent_material)
      + row('Breeding method (CSC minutes)', /^variety$/i.test(clean(csc.breeding_method)) ? '' : csc.breeding_method);
    const GEN = [['genetic_markers', 'Genetic markers'], ['qtl_information', 'QTL information'], ['molecular_mechanisms', 'Molecular mechanisms'],
      ['genes_introgressed', 'Genes introgressed'], ['parentage_and_pedigree', 'Parentage and pedigree'], ['breeding_method', 'Breeding method'],
      ['breeding_line_designations', 'Breeding line designations'], ['genome_resources', 'Genome resources']];
    const genKnown = new Set(GEN.map(x => x[0]).concat(['evidence_sources']));
    const genResearch = rec.researched
      ? GEN.map(([k, l]) => row(l, firstResearch(gq[k], legacyGen[k]))).join('')
        + Object.keys(gq).filter(k => !genKnown.has(k)).map(k => row(humanKey(k), rclean(gq[k]))).join('')
      : '';
    const genNums = src.nums(gq.evidence_sources);
    const genetics = (genOfficial ? '<h4>From the official record</h4>' + dl(genOfficial) : '')
      + (genResearch ? '<h4>From the research summary</h4>' + dl(genResearch) + p(sourceRef(genNums), 'note') : '');

    const printed = clean(r.variety_name_as_printed);
    if (printed && printed !== rec.name) sentences.push('Printed in the source as ' + printed + '.');
    const related = (Array.isArray(r.related_record_ids) ? r.related_record_ids : []).map(id => STATE.bySlug.get(String(id))).filter(x => x && x !== rec);
    const relatedBlock = related.length ? section('Related records', '<ul class="related">' + related.map(x =>
      '<li><a href="#' + esc(x.slug) + '">' + esc(x.name) + '</a>' + esc([x.crop ? ', ' + x.crop.toLowerCase() : '', x.year ? ', ' + (x.seednetOnly ? 'released ' : 'considered ') + x.year : '', x.seednetOnly ? ', Seednet only' : (x.outcome !== 'Not stated' ? ', ' + x.outcome.toLowerCase() : '')].join('')) + '</li>').join('') + '</ul>',
      'Other records in the dataset for what appears to be the same variety, for example the same variety considered at another meeting.') : '';
    const nq = String(r.name_quality || 'ok').toLowerCase();
    if (nq && nq !== 'ok') sentences.push('The name in the minutes is incomplete or generic; it could not be linked to other sources.');
    rec.view.subtitle = subtitle;
    rec.view.record = '<div class="summary">' + sentences.filter(Boolean).map(s => '<p>' + esc(s) + '</p>').join('') + '</div>'
      + '<p class="permalink">Permanent link to this record: <a href="#' + esc(rec.slug) + '">#' + esc(rec.slug) + '</a></p>'
      + relatedBlock
      + quickContact
      + (rec.seednetOnly ? '' : section('Official record (CSC minutes)', dl(cscRows)))
      + seednetBlock
      + section('Genetics and breeding', genetics, rec.researched ? 'Fields the sources do not state are left out. Text from the research summary was written by a language model and should be checked against the cited sources.' : 'Fields the sources do not state are left out.');

    /* ---------- Stress evidence tab ---------- */
    rec.view.evidence = buildEvidence(rec, far, rd, sf, src);

    /* ---------- Contacts tab ---------- */
    rec.view.contacts = contact.full;

    /* ---------- Publications and sources tab ---------- */
    rec.view.sources = buildPublications(rec) + buildSourceList(rec, src) + buildAboutRecord(rec, far, r);
    return rec.view;
  }

  function buildEvidence(rec, far, rd, sf, src) {
    const r = rec.raw;
    const stFar = (far.stress_tolerance && typeof far.stress_tolerance === 'object') ? far.stress_tolerance : {};
    const stOld = rd.stress_tolerance_detailed || {};
    const sc = r.stress_confirmation || {};
    const levels = r.stress_levels_gemini || {};
    let lead;
    if (rec.evidence === 'Two or more sources' || rec.evidence === 'One source') {
      lead = 'The independent-source check supports ' + rec.stressText.replace(/^./, c => c.toLowerCase()) + '.';
    } else if (rec.evidence === 'Claimed, not confirmed') {
      lead = 'The research summary claims tolerance of ' + listJoin(rec.typesClaimed.map(t => t.toLowerCase())) + ', but no independent source naming this variety supports the claim.';
    } else if (rec.evidence === 'None found') {
      lead = rec.researched
        ? 'Neither the research summary nor the official record reports tolerance of drought, heat, salinity, flood or submergence for this variety. This means none was found, not that the variety is susceptible.'
        : 'The official record reports no tolerance of drought, heat, salinity, flood or submergence for this variety. This means none was found, not that the variety is susceptible.';
    } else {
      lead = 'This variety has not been researched on the web, and its official record has not been graded for stress tolerance.';
    }
    const basisRaw = clean(r.stress_basis).toLowerCase();
    const basisText = { 'research and official text': 'The grade draws on the research summary and on the official Seednet text.', 'official text only': 'The grade rests on the official Seednet text alone, because web research has not been run for this variety.' }[basisRaw]
      || (!basisRaw && !rec.researched && rec.graded ? 'The grade rests on the official Seednet text alone, because web research has not been run for this variety.' : '');
    let out = '<div class="summary"><p>' + esc(lead) + '</p>'
      + (basisText ? '<p>' + esc(basisText) + '</p>' : '') + '</div>';
    const adjusted = STRESS_KEYS.map(k => {
      const c = sc[k];
      const why = c && typeof c === 'object' ? clean(c.verdict_adjusted_reason) : '';
      return why ? 'For ' + STRESS_NAME[k].toLowerCase() + ', ' + why.charAt(0).toLowerCase() + why.slice(1).replace(/\.?$/, '.') : '';
    }).filter(Boolean);
    const note = [clean(r.stress_confirmation_note)].concat(adjusted).filter(Boolean).join(' ');
    if (note) out += '<p class="caveat"><strong>Reviewer\'s caveat.</strong> ' + esc(note) + '</p>';
    if (rec.researched && (r.research_refers_to === 'other_variety' || r.research_refers_to === 'mixed')) {
      out += '<p class="caveat">Part of the research text may describe a similarly named variety.</p>';
    }

    const VERDICT = {
      confirmed_multi_source: 'Supported by two or more independent sources naming the variety',
      single_source: 'Supported by one independent source naming the variety',
      weak_or_generic: 'Not confirmed; the sources are generic or do not name the variety clearly',
      not_supported: 'Not confirmed; no source supports the claim',
      other_variety: 'Not confirmed; the sources describe a different variety'
    };
    const blocks = []; const none = [];
    STRESS_KEYS.forEach(k => {
      const d = stFar[k] || stOld[k] || {};
      const conf = (sc[k] && typeof sc[k] === 'object') ? sc[k] : null;
      const lvl = clean(d.level) || clean(levels[k]);
      const details = rclean(d.details);
      const verdict = conf && VERDICT[conf.verdict] ? VERDICT[conf.verdict] : '';
      const nSrc = conf && Number.isFinite(Number(conf.independent_sources)) && Number(conf.independent_sources) > 0 ? Number(conf.independent_sources) : 0;
      const nums = src.nums(d.evidence_sources);
      const ot = (r.stress_official_text && typeof r.stress_official_text === 'object') ? r.stress_official_text[k] : null;
      const otQuote = ot && typeof ot === 'object' ? clean(ot.quote) : '';
      const otField = ot && typeof ot === 'object' ? clean(ot.field).replace(/^Seednet:\s*/i, '') : '';
      if (!lvl && !details && !verdict && !otQuote) { none.push(STRESS_NAME[k].toLowerCase()); return; }
      const rows = rowHtml('Official text', otQuote ? '\u201c' + esc(deshout(otQuote)) + '\u201d' + (otField ? ' <span class="note">(Seednet, ' + esc(otField.toLowerCase()) + ')</span>' : '') : '')
        + row('Level in the research summary', lvl ? capFirst(lvl) : '')
        + row('Independent-source check', verdict ? verdict + (nSrc > 1 ? ' (' + nSrc + ' counted)' : '') + '.' : '')
        + row('How it was checked', conf ? rclean(conf.basis) : '')
        + row('What the research says', details)
        + row('Cited sources', nums.length ? listJoin(nums.map(String)) + ' (see Publications and sources)' : '');
      if (rows) blocks.push('<h4>' + esc(STRESS_NAME[k]) + '</h4>' + dl(rows)); else none.push(STRESS_NAME[k].toLowerCase());
    });
    if (blocks.length) {
      out += section('Tolerance by stress', blocks.join('') + (none.length && rec.researched ? p('The research found nothing on ' + listJoin(none) + '.', 'note') : ''),
        rec.researched ? 'The level comes from the research summary, written by a language model. The check counts the independent sources that name this exact variety.' : '');
    } else if (rec.researched) {
      out += p('The research found nothing on drought, heat, salinity, flood or submergence for this variety.', 'note');
    }
    const official = row('Reaction to stress (Seednet)', deshout(clean(sf['Reaction to Stress'])))
      + row('Reaction to major diseases (Seednet)', deshout(clean(sf['Reaction to Major Diseases'])))
      + row('Reaction to major pests (Seednet)', deshout(clean(sf['Reaction to Major Pests'])))
      + row('Special traits (CSC minutes)', (r.csc_fields || {}).special_traits);
    out += section('Official statements', dl(official));
    const dis = rclean((stFar.disease_resistance || {}).summary) || rclean((stOld.disease_resistance || {}).summary);
    const pest = rclean((stFar.pest_resistance || {}).summary) || rclean((stOld.pest_resistance || {}).summary);
    out += section('Disease and pest resistance (research summary)', dl(row('Disease resistance', dis) + row('Pest resistance', pest)));

    if (rec.researched) {
      const ap = (far.agronomic_performance && typeof far.agronomic_performance === 'object') ? far.agronomic_performance : {};
      const ad = rd.agronomic_details || {};
      const agr = row('Yield', firstResearch(ap.yield, ad.yield, ap.yield_potential))
        + row('Yield stability', firstResearch(ap.stability, ad.stability, ap.yield_stability))
        + row('Adaptation', firstResearch(ap.adaptation, ad.adaptation))
        + row('Maturity (days)', firstResearch(ap.maturity_days, ad.maturity_days))
        + row('Plant characteristics', firstResearch(ap.plant_characteristics, ad.plant_characteristics))
        + row('Field trials', firstResearch(ap.field_trials, ad.field_trials, ap.field_trial_results))
        + row('Farmer adoption', rclean(ap.farmer_adoption));
      const nums = src.nums(ap.evidence_sources);
      out += section('Agronomy (research summary)', dl(agr) + p(sourceRef(nums), 'note'),
        'These figures come from the research summary, written by a language model, and have not been checked against the sources. Official figures, where Seednet gives them, are in the Record tab.');
    }
    return out;
  }

  // Every contact field the record carries, deduplicated. Used for the Contacts tab,
  // the "Contact details available" filter and the counts, so all three agree.
  function contactData(r, rec) {
    const cs = (r.contacts_structured && typeof r.contacts_structured === 'object') ? r.contacts_structured : {};
    const ic = (r.institution_contact && typeof r.institution_contact === 'object') ? r.institution_contact : {};
    const far = ((r.research_data || {}).full_analysis_result) || {};
    const bc = far.breeder_and_contacts || {};
    const csc = r.csc_fields || {};
    const items = (arr) => {
      const seen = new Set(); const out = [];
      (arr || []).forEach(x => { const t = clean(x); const k = t.toLowerCase().replace(/\s+/g, ' '); if (t && !seen.has(k)) { seen.add(k); out.push(t); } });
      return out;
    };
    const emailsRaw = items([].concat(cs.emails || [], ic.emails || []));
    const emails = []; const seenE = new Set();
    emailsRaw.forEach(e => (e.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).forEach(m => {
      const k = m.toLowerCase(); if (!seenE.has(k)) { seenE.add(k); emails.push(m); }
    }));
    const phonesAll = items([].concat(cs.phones || [], ic.phones || []));
    const fax = items(phonesAll.filter(x => /^\s*fax\b/i.test(x)).map(x => x.replace(/^\s*fax\s*(no\.?)?\s*[:.-]?\s*/i, '')).concat(cs.fax || [], ic.fax || []));
    const phoneNotes = items([].concat(cs.phone_notes || [], ic.phone_notes || []));
    const phones = phonesAll.filter(x => !/^\s*fax\b/i.test(x)).map(x => x.replace(/^\s*(phone|tel|telephone|ph|mobile)\.?\s*(no\.?)?\s*[:.-]\s*/i, ''));
    const addresses = items([].concat(cs.addresses || [], ic.postal_address ? [ic.postal_address] : [])).map(deshout);
    const breeders = items(cs.breeder_names || []);
    const website = httpUrl(firstText(cs.website, ic.website));
    const contactPage = httpUrl(firstText(cs.contact_page, ic.contact_page));
    const head = firstText(cs.head_or_director, ic.head_or_director);
    const seed = firstText(cs.variety_or_seed_contact, ic.variety_or_seed_contact);
    const institution = firstText(cs.institution, ic.institution_official_name, csc.institution, r.developer_institution_csc);
    const has = !!(emails.length || phones.length || fax.length || phoneNotes.length || breeders.length || addresses.length || head || seed || website || contactPage);
    return { emails, phones, fax, phoneNotes, addresses, breeders, website, contactPage, head, seed, institution, has };
  }

  function buildContacts(rec, src) {
    const r = rec.raw;
    const cs = (r.contacts_structured && typeof r.contacts_structured === 'object') ? r.contacts_structured : {};
    const ic = (r.institution_contact && typeof r.institution_contact === 'object') ? r.institution_contact : {};
    const far = ((r.research_data || {}).full_analysis_result) || {};
    const bc = far.breeder_and_contacts || {};
    const csc = r.csc_fields || {};
    const sf = rec.hasSeednet ? rec.seednetFields : {};
    const cd = contactData(r, rec);
    const { emails, phones, fax, phoneNotes, addresses, breeders, website, contactPage, head, seed, institution } = cd;
    const lines = (arr, fn) => arr.map(x => '<span class="line">' + (fn ? fn(x) : esc(x)) + '</span>').join('');
    const mail = (e) => '<a href="mailto:' + esc(e) + '">' + esc(e) + '</a>';
    const tel = (t) => { const d = (t.match(/^[+\d][\d\s()-]{5,}\d/) || [''])[0].replace(/[^\d+]/g, ''); return d.length >= 6 ? '<a href="tel:' + esc(d) + '">' + esc(t) + '</a>' : esc(t); };

    const rows = row('Institution', institution)
      + row('Institution type', firstText(cs.institution_type, ic.type))
      + row('Location (CSC minutes)', firstText(cs.institution_location_csc, r.developer_location_csc, csc.institution_location))
      + row('Head or director', head)
      + row('Seed or variety enquiries', seed)
      + rowHtml('Breeder or scientist', lines(breeders))
      + row('Principal investigator (CSC minutes)', csc.principal_investigator)
      + rowHtml('Email', lines(emails, mail))
      + rowHtml('Phone', lines(phones, tel))
      + rowHtml('Phone notes', lines(phoneNotes))
      + rowHtml('Fax', lines(fax))
      + rowHtml('Postal address', lines(addresses))
      + rowHtml('Website', website ? linkHtml(website, website.replace(/^https?:\/\//, '').replace(/\/$/, '')) : '')
      + rowHtml('Contact page', contactPage ? linkHtml(contactPage, 'Contact page of the institution') : '')
      + row('Breeder seed institution (Seednet)', deshout(firstText(cs.breeder_seed_institution_seednet, sf['Institution Responsible for developing Breeder Seed'])))
      + row('Notes', cs.notes)
      + (rec.researched ? row('Contact notes (research summary)', rclean(bc.contacts)) : '');
    const nums = src.nums([].concat(cs.contact_source_urls || [], ic.source_urls || [], bc.evidence_sources || []));
    const has = cd.has;
    const full = has
      ? section('Developing institution', dl(rows) + p(sourceRef(nums), 'note'),
        'Contact details are for the developing institution, taken from its own website and directories, and may be out of date. Fields the sources do not state are left out.')
      : section('Developing institution', dl(rows) + p('The sources searched give no contact details for this institution.', 'note'));
    const quick = row('Institution', institution)
      + rowHtml('Email', lines(emails.slice(0, 3), mail) + (emails.length > 3 ? '<span class="line note">and ' + (emails.length - 3) + ' more under Contacts</span>' : ''))
      + rowHtml('Phone', lines(phones.slice(0, 3), tel) + (phones.length > 3 ? '<span class="line note">and ' + (phones.length - 3) + ' more under Contacts</span>' : ''))
      + rowHtml('Breeder or scientist', lines(breeders.slice(0, 3)));
    return { full: full, quick: has ? quick : '' };
  }

  function authorsText(a) {
    const l = (Array.isArray(a) ? a : []).map(x => clean(x)).filter(Boolean);
    if (!l.length) return '';
    return l.length > 4 ? l.slice(0, 3).join(', ') + ' and others' : listJoin(l);
  }
  // Text written in a legacy Hindi font encoding is unreadable; detect and drop it.
  function looksGarbled(s) { return /[;~\\]\s?[a-z]|\bkn~|ifj"/i.test(s) && !/\b(the|of|and|in)\b/i.test(s); }

  function buildPublications(rec) {
    const r = rec.raw;
    const works = [];
    const seen = new Set();
    const key = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);
    (Array.isArray(r.publications_openalex) ? r.publications_openalex : []).forEach(w => {
      if (!w || typeof w !== 'object' || isBlank(w.title)) return;
      const k = key(w.title); if (seen.has(k)) return; seen.add(k);
      works.push({ authors: authorsText(w.authors), year: Number(w.year) || null, title: clean(w.title), venue: clean(w.venue), url: httpUrl(w.doi || w.landing_page) });
    });
    (Array.isArray(r.publications_scholar) ? r.publications_scholar : []).forEach(w => {
      if (!w || typeof w !== 'object' || isBlank(w.title)) return;
      const k = key(w.title); if (seen.has(k)) return; seen.add(k);
      const info = clean(w.publication_info);
      const parts = info.split(/\s+-\s+/);
      const ym = info.match(/\b(19|20)\d{2}\b/);
      let venue = parts.length >= 3 ? parts[1].replace(/,?\s*(19|20)\d{2}\s*$/, '').trim() : '';
      if (/^(19|20)\d{2}$/.test(venue) || looksGarbled(venue)) venue = '';
      const host = parts.length >= 2 ? parts[parts.length - 1].trim() : '';
      let authors = authorsText(w.authors);
      if (!authors && parts.length >= 2) authors = parts[0].replace(/…$/, '').trim();
      authors = authors.replace(/\s*…\s*$/, '');
      works.push({ authors: authors, year: ym ? Number(ym[0]) : null, title: clean(w.title).replace(/\s+…$/, '…'), venue: venue || (host && !looksGarbled(host) ? host : ''), url: httpUrl(w.link) });
    });
    works.sort((a, b) => (b.year || 0) - (a.year || 0));
    const fmt = (w) => '<li>' + (w.authors ? esc(w.authors) + ' ' : '') + (w.year ? '(' + w.year + '). ' : (w.authors ? '(no date). ' : ''))
      + (w.url ? linkHtml(w.url, w.title) : esc(w.title)) + (/[.?!…]$/.test(w.title) ? '' : '.') + (w.venue ? ' ' + esc(w.venue.replace(/\.$/, '')) + (/…$/.test(w.venue) ? '' : '.') : '') + '</li>';
    const total = (Number(r.publications_scholar_count) || 0) + (Number(r.publications_openalex_count) || 0);
    const lead = 'Works whose title, abstract or search snippet contains the variety name, from Google Scholar (searched in 2025) and OpenAlex. A mention is not necessarily a study of this variety.';
    if (!works.length) return section('Publications', p('The searches found no work that mentions this variety name.', 'note'), esc(lead));
    const head = works.slice(0, 10).map(fmt).join('');
    const rest = works.slice(10).map(fmt).join('');
    let html = '<ol class="refs">' + head + '</ol>';
    if (rest) html += '<details class="more"><summary>Show ' + (works.length - 10) + ' more works</summary><ol class="refs" start="11">' + rest + '</ol></details>';
    if (total > works.length) html += p('The searches counted ' + n(total) + ' mentions in all; ' + n(works.length) + ' distinct works are listed here.', 'note');
    return section('Publications (' + works.length + ')', html, esc(lead));
  }

  function buildSourceList(rec, src) {
    if (!src.list.length) return section('Sources', p(rec.researched ? 'The research summary for this variety cites no web sources.' : 'Web research has not been run for this variety, so no web sources are listed. The official record comes from the CSC minutes named in the Record tab.', 'note'));
    const items = src.list.map(u => { const s = sourceTitle(u); return '<li>' + linkHtml(u, s.title) + (s.host ? ', ' + esc(s.host) : '') + '.</li>'; });
    const head = items.slice(0, 15).join(''); const rest = items.slice(15).join('');
    let html = '<ol class="refs">' + head + '</ol>';
    if (rest) html += '<details class="more"><summary>Show ' + (items.length - 15) + ' more sources</summary><ol class="refs" start="16">' + rest + '</ol></details>';
    return section('Sources (' + src.list.length + ')', html, 'Every web source cited anywhere in this record, numbered once. The numbers in the other tabs refer to this list.');
  }

  function buildAboutRecord(rec, far, r) {
    const parts = [];
    if (rec.researched) {
      const pm = far.processing_metadata || {};
      const model = clean(pm.model);
      const date = clean(pm.analysis_date) ? String(pm.analysis_date).slice(0, 10) : '';
      const nq = Number((r.search_metadata || {}).total_queries) || 0;
      parts.push('The research summary for this variety was written by ' + (model || 'a language model') + (date ? ' on ' + date : '')
        + (nq ? ' from ' + nq + ' web searches' : '') + ', as part of the ' + rec.waveLabel + ' research' + (model ? '.' : '; the name of the model was not recorded.'));
      const refers = { this_variety: 'A later check found that the research text refers to this exact variety.', unclear: 'A later check could not settle whether the research text refers to this exact variety.', mixed: 'A later check found that the research text mixes this variety with similarly named ones.', other_variety: 'A later check found that the research text appears to describe a different variety.' }[r.research_refers_to];
      if (refers) parts.push(refers);
    } else {
      parts.push('Web research has not been run for this variety; everything shown comes from the official record' + (rec.hasSeednet ? ' and Seednet' : '') + '.');
    }
    const st = { confirmed_exact: 'matches on crop and name', confirmed_spelling: 'matches on crop and name with a small spelling difference', different_variety: 'found only a different variety, which is not used', no_seednet: 'found no Seednet record' }[rec.seednetStatus];
    if (st) parts.push('The Seednet link ' + st + '.');
    return section('About this record', p(parts.join(' ')));
  }

  /* ------------------------------------------------------------------ *
   * Coverage view                                                      *
   * ------------------------------------------------------------------ */

  function ordinal(k) {
    const v = Number(k); if (!Number.isFinite(v)) return String(k);
    const s10 = v % 10, s100 = v % 100;
    return v + (s100 >= 11 && s100 <= 13 ? 'th' : s10 === 1 ? 'st' : s10 === 2 ? 'nd' : s10 === 3 ? 'rd' : 'th');
  }
  function minutesName(m) {
    return 'the minutes of the ' + ordinal(m.meeting_number) + ' ' + String(m.category || '').toLowerCase() + ' meeting' + (m.year ? ' (' + m.year + ')' : '');
  }
  // Match each CSC record to a row of coverage.json: exact file name (ignoring case),
  // else series, meeting number and year read from the file name.
  function mapMinutes() {
    STATE.minutesByKey = new Map();
    const list = (STATE.coverage && Array.isArray(STATE.coverage.minutes)) ? STATE.coverage.minutes : [];
    const byFile = new Map();
    list.forEach((m, i) => {
      m.key = String(m.category || 'x').toLowerCase().slice(0, 4) + '-' + m.meeting_number + '-' + (m.year || 'na') + (list.findIndex(o => o.category === m.category && o.meeting_number === m.meeting_number && o.year === m.year) !== i ? '-' + i : '');
      STATE.minutesByKey.set(m.key, m);
      if (m.local_file) byFile.set(String(m.local_file).toLowerCase(), m);
      m.count = 0;
    });
    STATE.all.forEach(rec => {
      rec.minutesKey = '';
      if (rec.seednetOnly) return;
      const doc = clean((rec.raw.official_sources || {}).csc_source_document) || clean((rec.raw.csc_fields || {}).source_document_filename);
      if (!doc) return;
      let m = byFile.get(doc.toLowerCase());
      if (!m) {
        const cat = /^horti/i.test(doc) ? 'Horticultural' : /^agri/i.test(doc) ? 'Agricultural' : '';
        const year = (doc.match(/_((19|20)\d{2})_/) || [])[1] || '';
        const nums = (doc.match(/(\d{1,3})(st|nd|rd|th)/gi) || []).map(x => parseInt(x, 10));
        const cands = list.filter(o => (!cat || o.category === cat) && nums.indexOf(Number(o.meeting_number)) !== -1);
        m = cands.find(o => !year || String(o.year) === year) || (cands.length === 1 ? cands[0] : null);
      }
      if (m) { rec.minutesKey = m.key; m.count++; }
    });
  }

  function openCoverage() {
    STATE.modal.mode = 'coverage';
    STATE.modal.record = null;
    if (!STATE.modal.open) STATE.modal.lastFocus = document.activeElement;
    STATE.modal.open = true;
    const c = STATE.coverage || {};
    const list = (Array.isArray(c.minutes) ? c.minutes : []).slice()
      .sort((a, b) => String(a.category).localeCompare(String(b.category)) || Number(a.meeting_number) - Number(b.meeting_number) || String(a.year).localeCompare(String(b.year)));
    const s = datasetStats();
    const byStatus = (re) => list.filter(m => re.test(String(m.status || '')));
    const read = byStatus(/^read/i);
    const late = byStatus(/november 2026/i);
    const notHeld = byStatus(/not held/i);
    const notRead = byStatus(/not read/i);
    const empty = byStatus(/empty/i);
    const years = read.map(m => parseInt(m.year, 10)).filter(Number.isFinite);
    const series = (cat) => read.filter(m => m.category === cat).length;
    const names = (arr) => listJoin(arr.map(m => 'the ' + ordinal(m.meeting_number) + ' ' + String(m.category).toLowerCase() + ' meeting' + (m.year ? ' (' + m.year + ')' : '')));
    // Gaps in each numbered series between the first and last meeting listed.
    const gaps = [];
    ['Agricultural', 'Horticultural'].forEach(cat => {
      const nums = list.filter(m => m.category === cat).map(m => Number(m.meeting_number)).filter(Number.isFinite);
      if (!nums.length) return;
      const have = new Set(nums), lo = Math.min.apply(null, nums), hi = Math.max.apply(null, nums);
      const miss = []; for (let k = lo; k <= hi; k++) if (!have.has(k)) miss.push(ordinal(k));
      gaps.push(miss.length ? 'the ' + listJoin(miss) + ' ' + cat.toLowerCase() + ' meeting' + (miss.length > 1 ? 's are' : ' is') + ' missing from the CSC list between the ' + ordinal(lo) + ' and the ' + ordinal(hi)
        : 'the ' + cat.toLowerCase() + ' series runs without a gap from the ' + ordinal(lo) + ' to the ' + ordinal(hi) + ' meeting');
    });
    const so = s.src['Seednet only'];
    const soResearched = STATE.all.filter(r => r.seednetOnly && r.researched).length;
    const soContact = STATE.all.filter(r => r.seednetOnly && r.hasContact === 'Yes').length;
    let p1 = 'The dataset holds ' + n(s.total) + ' varieties. Of these, ' + n(s.inCsc) + ' come from ' + n(read.length) + ' sets of CSC minutes'
      + (years.length ? ' dated ' + Math.min.apply(null, years) + ' to ' + Math.max.apply(null, years) : '')
      + ', ' + n(series('Agricultural')) + ' for agricultural crops and ' + n(series('Horticultural')) + ' for horticultural crops.';
    if (c.csc_documents_listed) p1 += ' The CSC minutes page lists ' + n(c.csc_documents_listed) + ' sets in all.';
    if (notHeld.length) p1 += ' For ' + names(notHeld) + ' the page lists the minutes, but the PDF is not held here.';
    const word = (k) => ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'][k] || n(k);
    if (late.length) p1 += ' ' + word(late.length) + (late.length === 1 ? ' set, ' : ' sets, ') + names(late) + ', ' + (late.length === 1 ? 'was' : 'were') + ' missed in 2025 and read in November 2026.';
    if (notRead.length) p1 += ' ' + capFirst(names(notRead)) + (notRead.length > 1 ? ' are' : ' is') + ' held but has not been read.';
    if (empty.length) p1 += ' The file for ' + names(empty) + ' is empty.';
    if (gaps.length) p1 += ' In the numbering, ' + gaps.join(', and ') + '.';
    const soGraded = STATE.all.filter(r => r.seednetOnly && r.graded).length;
    const p2 = so ? 'The other ' + n(so) + ' varieties are notified on Seednet but do not appear in the CSC minutes held. For these the dataset has the Seednet record only, with no CSC decision; '
      + (soResearched ? n(soResearched) + ' of them have web research' : 'none of them has web research') + ', ' + n(soGraded) + ' carry a stress grade read from the official Seednet text, and ' + n(soContact) + ' have contact details of an institution.' : '';
    const rows = list.map(m => {
      const gov = httpUrl(m.government_url), arc = httpUrl(m.archived_copy);
      const cnt = m.count || 0;
      const cntHtml = cnt ? '<a href="?minutes=' + encodeURIComponent(m.key) + '#all" class="minutes-filter" data-key="' + esc(m.key) + '">' + n(cnt) + '</a>' : '';
      return '<tr>'
        + '<td data-label="Series">' + esc(m.category || '') + '</td>'
        + '<td data-label="Meeting">' + esc(ordinal(m.meeting_number)) + '</td>'
        + '<td data-label="Year"' + (m.year ? '' : ' data-empty') + '>' + esc(m.year || '') + '</td>'
        + '<td data-label="Status">' + esc(capFirst(String(m.status || ''))) + '</td>'
        + '<td data-label="Varieties in the dataset"' + (cnt ? '' : ' data-empty') + ' class="num">' + cntHtml + '</td>'
        + '<td data-label="Government PDF"' + (gov ? '' : ' data-empty') + '>' + (gov ? linkHtml(gov, 'PDF') : '') + '</td>'
        + '<td data-label="Archived copy"' + (arc ? '' : ' data-empty') + '>' + (arc ? linkHtml(arc, 'Archived copy') : '') + '</td>'
        + '</tr>';
    }).join('');
    setText('modal-title', 'Coverage');
    $('modal-sub').hidden = true;
    $('modal-tabs').hidden = true; $('modal-tabs').innerHTML = '';
    const body = $('modal-body');
    body.removeAttribute('role'); body.removeAttribute('aria-labelledby');
    body.innerHTML = '<div class="about">' + p(p1) + p(p2) + '</div>'
      + '<h3 class="cov-h">CSC minutes</h3>'
      + '<p class="note">Select a count to show only the varieties from that set of minutes. A blank count means no variety in the dataset comes from it.</p>'
      + '<div class="table-scroll"><table class="data-table cov-table"><caption class="visually-hidden">Sets of CSC minutes and the varieties taken from each</caption>'
      + '<thead><tr><th scope="col">Series</th><th scope="col">Meeting</th><th scope="col">Year</th><th scope="col">Status</th><th scope="col" class="num">Varieties in the dataset</th><th scope="col">Government PDF</th><th scope="col">Archived copy</th></tr></thead>'
      + '<tbody>' + rows + '</tbody></table></div>';
    body.querySelectorAll('.minutes-filter').forEach(a => a.addEventListener('click', (e) => {
      e.preventDefault();
      resetFilters();
      $('filter-minutes').value = a.dataset.key;
      STATE.modal.lastFocus = $('result-count');
      closeModal(true);
      history.replaceState(null, '', location.pathname + location.search);
      applyFilters();
      $('result-count').scrollIntoView({ block: 'start' });
    }));
    showModal(true);
  }

  /* ------------------------------------------------------------------ *
   * About dialog                                                       *
   * ------------------------------------------------------------------ */

  function openAbout() {
    STATE.modal.mode = 'about';
    STATE.modal.record = null;
    if (!STATE.modal.open) STATE.modal.lastFocus = document.activeElement;
    STATE.modal.open = true;
    const s = datasetStats();
    const o = s.outcome;
    const outcomeText = outcomeSentence(s);
    setText('modal-title', 'About the data');
    $('modal-sub').hidden = true;
    $('modal-tabs').hidden = true; $('modal-tabs').innerHTML = '';
    const body = $('modal-body');
    body.removeAttribute('role'); body.removeAttribute('aria-labelledby');
    body.innerHTML = '<div class="about">'
      + '<h3>What this is</h3>'
      + '<p>This seed variety dashboard covers ' + n(s.total) + ' crop varieties across ' + n(s.crops) + ' crops and ' + n(s.states) + ' states and union territories. ' + esc(sourceSentence(s).replace(/^This page lists [\d,]+ crop varieties\. /, '')) + ' ' + esc(outcomeText) + ' Each row is one variety, with its entry in the CSC minutes, its Seednet record where one exists, web research where it has been run, publications that mention it, and contact details of the developing institution. It is maintained by Precision Development (PxD).</p>'
      + '<p>Stress tolerance is one attribute among several and is shown only where there is evidence for it.</p>'
      + '<h3>Where the data come from</h3>'
      + '<ul>'
      + '<li>The CSC meeting minutes (PDF files) give the variety, crop, meeting, decision and developing institution, and, where the minutes state them, parentage, breeding method and special traits. Every record drawn from the minutes names its source document and, where one was found, links to the PDF and an archived copy.</li>'
      + '<li>Seednet (seednet.gov.in), the Government of India seed portal, gives the notification number and date, parentage, recommended ecology, yield and other official fields for the ' + n(s.seednet) + ' of ' + n(s.total) + ' varieties linked to a Seednet record.</li>'
      + '<li>Google Scholar results, archived in 2025, and OpenAlex list works that mention the variety name; ' + n(s.withPubs) + ' of ' + n(s.total) + ' varieties have at least one. These are mentions, not necessarily studies of the variety.</li>'
      + '<li>Institution websites and directories give the contact details of the developing institution, available for ' + n(s.withContact) + ' of ' + n(s.total) + ' varieties.</li>'
      + '<li>Web research by language models, with cited sources, covers ' + n(s.researched) + ' of ' + n(s.total) + ' varieties; ' + n(s.waveAug) + ' were researched in August 2025 and ' + n(s.waveOct) + ' in October and November 2026. It covers stress tolerance, agronomy, genetics and breeding.</li>'
      + '</ul>'
      + '<h3>How the Seednet link is decided</h3>'
      + '<p>A variety is linked to a Seednet record only when the crop is the same and the name is the same, including the variety number. Small spelling differences are accepted, and ' + n(s.seednetSpelling) + ' of the ' + n(s.seednet) + ' links rest on such a match. A fuzzy name match used in 2025 had linked some varieties to the Seednet record of a different variety; it was replaced in November 2026. For ' + n(s.differentVariety) + ' varieties the nearest Seednet entry is a different variety, and the record says so without using it.</p>'
      + '<h3>How stress tolerance is graded</h3>'
      + '<p>The research summary first gives a level for drought, heat, salinity, flood and submergence from its cited sources. A separate check then counts the independent sources that name the exact variety and support each claim. Two or more such sources give the grade "two or more sources", one gives "one source", and a claim with no such source is "claimed, not confirmed".</p>'
      + '<p>Of all ' + n(s.total) + ' varieties, ' + n(s.ev['Two or more sources']) + ' are graded two or more sources, ' + n(s.ev['One source']) + ' one source, ' + n(s.ev['Claimed, not confirmed']) + ' claimed but not confirmed, and ' + n(s.ev['None found']) + ' none found; the other ' + n(s.ev['Not graded']) + ' are not graded. "Not graded" means the variety has had no web research and its official record has no stress text that could be graded. These are the counts the Stress evidence filter shows.'
      + (s.officialGraded ? ' Of the graded varieties, ' + n(s.officialGraded) + ' have no web research and were graded from the official Seednet text alone; ' + n(s.officialGradedYes) + ' of them have a supported tolerance.' : '') + '</p>'
      + '<p>"None found" means that the searches found no statement of tolerance; it is not evidence that the variety lacks tolerance, and not that the variety is susceptible. For ' + n(s.noteDisputes) + ' of the ' + n(s.supported) + ' varieties with a supported tolerance, the reviewer of the check left a caveat; it is shown at the top of the Stress evidence tab and should be read before the grade is used.</p>'
      + '<h3>Limitations</h3>'
      + '<ul>'
      + '<li>The research summaries were written by language models. They are leads to check against the linked sources, not official data, and some figures in them (yields in particular) are implausible.</li>'
      + '<li>' + n(s.notResearched) + ' of ' + n(s.total) + ' varieties have the official record only; web research has not been run for them.</li>'
      + '<li>The OpenAlex lookup is incomplete, so a variety with no listed publication may still have been studied.</li>'
      + '<li>Contact details are for the developing institution, not always the individual breeder, and may be out of date.</li>'
      + '<li>A blank field means the source does not state the value. It never means zero or none.</li>'
      + '</ul>'
      + '<h3>Data and code</h3>'
      + '<p>The dataset, the pipeline and the documentation are in the repository linked as "Data and code" in the header.' + (formatBuilt(STATE.meta.built) ? ' This build of the data was compiled on ' + formatBuilt(STATE.meta.built) + '.' : '') + ' Each record has a permanent link, shown in its Record tab. A filtered view of the list can be shared by copying the address, and the address ending #all shows every variety.</p>'
      + '</div>';
    showModal(true);
  }

  /* ------------------------------------------------------------------ *
   * Modal shell                                                        *
   * ------------------------------------------------------------------ */

  function showModal(focus) {
    const m = $('detail-modal');
    const wasHidden = m.hidden;
    m.hidden = false;
    document.body.classList.add('modal-open');
    if (wasHidden) $('modal-panel').scrollTop = 0;
    if (focus || wasHidden) requestAnimationFrame(() => { const c = $('modal-close'); if (c) c.focus(); });
  }

  function closeModal(fromRoute) {
    $('detail-modal').hidden = true;
    document.body.classList.remove('modal-open');
    STATE.modal.open = false; STATE.modal.record = null; STATE.modal.mode = 'variety';
    if (!fromRoute) setHash('');
    const f = STATE.modal.lastFocus;
    STATE.modal.lastFocus = null;
    if (f && document.body.contains(f) && typeof f.focus === 'function') { try { f.focus(); } catch (_) { /* detached */ } }
  }

  function onModalKeydown(e) {
    if (!STATE.modal.open) return;
    if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
    if (e.key !== 'Tab') return;
    const panel = $('modal-panel');
    const f = Array.prototype.filter.call(panel.querySelectorAll('a[href], button:not([disabled]), input, select, summary, [tabindex="0"]'),
      el => el.offsetParent !== null && el.getAttribute('tabindex') !== '-1');
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* ------------------------------------------------------------------ *
   * CSV export                                                         *
   * ------------------------------------------------------------------ */

  function exportFilteredCSV() {
    if (!STATE.filtered.length) { setText('result-count', 'No varieties to export; clear some filters first.'); return; }
    const cols = [
      ['record', r => r.slug], ['crop', r => r.crop], ['variety', r => r.name], ['year_considered', r => r.year || ''],
      ['outcome', r => r.outcome === 'Not stated' ? '' : r.outcome], ['states', r => r.states.join('; ')],
      ['stress_evidence', r => r.evidence === 'Not graded' ? '' : r.evidence], ['stress_types_confirmed', r => r.typesConfirmed.join('; ')],
      ['seednet_linked', r => r.hasSeednet ? 'yes' : ''], ['seednet_url', r => r.hasSeednet ? r.seednetUrl : ''],
      ['developing_institution', r => r.institution], ['contact_details_available', r => r.hasContact === 'Yes' ? 'yes' : 'no'],
      ['researched', r => r.researched ? 'yes' : 'no'], ['research_period', r => r.waveLabel],
      ['record_source', r => r.source], ['publications', r => r.pubs || ''], ['csc_source_document', r => clean((r.raw.official_sources || {}).csc_source_document) || clean((r.raw.csc_fields || {}).source_document_filename)],
      ['csc_minutes_url', r => httpUrl((r.raw.official_sources || {}).csc_minutes_url)], ['csc_minutes_archived_url', r => httpUrl((r.raw.official_sources || {}).csc_minutes_archived_url)],
      ['permalink', r => location.origin + location.pathname + '#' + r.slug]
    ];
    const csvField = (v) => { let s = String(v == null ? '' : v); if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'; return s; };
    const lines = [cols.map(c => c[0]).join(',')].concat(sortData(STATE.filtered).map(r => cols.map(c => csvField(c[1](r))).join(',')));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'seed_varieties_india_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ------------------------------------------------------------------ *
   * Loading + errors                                                   *
   * ------------------------------------------------------------------ */

  function showLoading() { $('loading-overlay').hidden = false; }
  function hideLoading() { $('loading-overlay').hidden = true; }
  function showError(detail) {
    const hint = location.protocol === 'file:' ? ' The page was opened as a local file; browsers block loading the data that way. Serve the folder with a local web server and open it over http.' : '';
    setText('error-banner-detail', (detail || 'Unknown error.') + hint);
    $('error-banner').hidden = false;
    setText('result-count', 'The data could not be loaded.');
  }
  function hideError() { $('error-banner').hidden = true; }

  // Exposed for automated checks only.
  window.__seedVarieties = { STATE: STATE, buildView: buildView, openRecord: openRecord };
})();
