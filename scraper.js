const https = require('https');
const fs = require('fs');

const API_URL = 'https://public.clublacrosse.org/api/commitments';
const SOURCE_URL = 'https://public.clublacrosse.org/commitments/Dashboard/gender-with-player';

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Failed to parse JSON: ' + e.message)); }
      });
    }).on('error', reject);
  });
}

const MANUAL_FILE = 'manual_recruits.json';
const SUPPRESS_FILE = 'suppress_recruits.json';

// Dedupe key: a recruit is uniquely identified by player + committed college.
function recruitKey(r) {
  return ((r.playerName || '') + '|' + (r.college || ''))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Curated list of duplicate rows to drop: the same recruit entered under two
// spellings by the upstream feed (e.g. "Rodriguez"/"Rodgriguez"). We keep the
// correct spelling and suppress the other by exact player+college key. Kept as
// an explicit list (not fuzzy matching) so real distinct players — including
// siblings with similar names — are never removed by accident.
function loadSuppress() {
  if (!fs.existsSync(SUPPRESS_FILE)) return new Set();
  try {
    const data = JSON.parse(fs.readFileSync(SUPPRESS_FILE, 'utf8'));
    const list = Array.isArray(data) ? data : (data.suppress || []);
    return new Set(list.filter(r => r && r.playerName && r.college).map(recruitKey));
  } catch (e) {
    console.warn(`Could not read ${SUPPRESS_FILE}: ${e.message}`);
    return new Set();
  }
}

// Load manually curated commitments (e.g. from Inside Lacrosse). These are
// hand-maintained and must survive the daily scrape, so they are merged in
// here rather than written by the scraper.
function loadManual() {
  if (!fs.existsSync(MANUAL_FILE)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(MANUAL_FILE, 'utf8'));
    const list = Array.isArray(data) ? data : (data.recruits || []);
    return list.filter(r => r && r.playerName && r.college);
  } catch (e) {
    console.warn(`Could not read ${MANUAL_FILE}: ${e.message}`);
    return [];
  }
}

// AP-style state/province abbreviations (as the upstream feed sometimes appends
// them to the high-school name, e.g. "Shawnee - N.J.") mapped to the two-letter
// codes the State column already uses. Only these known abbreviations are
// treated as a state; anything else after " - " is left in the school name so a
// real school name containing a hyphen (e.g. "X - North Campus") is not mangled.
const STATE_ABBR = {
  'Ala.': 'AL', 'Ariz.': 'AZ', 'Ark.': 'AR', 'Calif.': 'CA', 'Colo.': 'CO',
  'Conn.': 'CT', 'Del.': 'DE', 'Fla.': 'FL', 'Ga.': 'GA', 'Idaho': 'ID',
  'Ill.': 'IL', 'Ind.': 'IN', 'Kan.': 'KS', 'Ky.': 'KY', 'La.': 'LA',
  'Maine': 'ME', 'Mass.': 'MA', 'Md.': 'MD', 'Mich.': 'MI', 'Minn.': 'MN',
  'Mo.': 'MO', 'Mont.': 'MT', 'Neb.': 'NE', 'Nev.': 'NV', 'N.C.': 'NC',
  'N.D.': 'ND', 'N.H.': 'NH', 'N.J.': 'NJ', 'N.M.': 'NM', 'N.Y.': 'NY',
  'Ohio': 'OH', 'Okla.': 'OK', 'Ore.': 'OR', 'Pa.': 'PA', 'R.I.': 'RI',
  'S.C.': 'SC', 'S.D.': 'SD', 'Tenn.': 'TN', 'Texas': 'TX', 'Utah': 'UT',
  'Va.': 'VA', 'Vt.': 'VT', 'Wash.': 'WA', 'W.Va.': 'WV', 'Wis.': 'WI',
  'Wyo.': 'WY', 'D.C.': 'DC',
  // Canadian provinces / already two-letter tails the feed uses as-is.
  'AB': 'AB', 'BC': 'BC', 'MB': 'MB', 'ON': 'ON', 'QC': 'QC', 'DC': 'DC',
};

// Move a state that the feed tacked onto the end of the high-school name into
// the dedicated `state` field, so it renders in the State column instead of
// under High School. Only runs when `state` is empty and the trailing token is
// a recognized abbreviation.
function normalizeState(r) {
  if (r.state && r.state.trim()) return r;
  const hs = r.highSchool || '';
  const idx = hs.lastIndexOf(' - ');
  if (idx === -1) return r;
  const tail = hs.slice(idx + 3).trim();
  const code = STATE_ABBR[tail];
  if (code) {
    r.state = code;
    r.highSchool = hs.slice(0, idx).trim();
  }
  return r;
}

async function scrape() {
  console.log('Fetching commitment data from API...');
  const json = await fetchJSON(API_URL);

  if (!json.status || !Array.isArray(json.commitments)) {
    throw new Error('Unexpected API response: ' + JSON.stringify(json).slice(0, 200));
  }

  console.log(`Total records from API: ${json.commitments.length}`);

  const CLASS_CUTOFF = 2026;

  let recruits = json.commitments
    .filter(c => {
      const year = parseInt(c.class_id, 10);
      return !isNaN(year) && year >= CLASS_CUTOFF;
    })
    .map(c => ({
      gender: c.gender_id === '1' ? 'Boys' : 'Girls',
      class: c.class_id || '',
      division: c.division_id || '',
      playerName: c.player_name || '',
      college: c.school_name || '',
      position: c.position_name || '',
      clubTeam: c.short_name === 'Error 500' ? '' : (c.short_name || ''),
      highSchool: c.high_school || '',
      state: c.hs_state || '',
      commitmentDate: c.commitment_date || '',
    }))
    .filter(r => r.playerName && r.commitmentDate);

  console.log(`Valid records after filtering: ${recruits.length}`);

  // Merge manual commitments, skipping any that already exist in the scraped
  // set (dedupe by player + college) so nothing is duplicated.
  const seen = new Set(recruits.map(recruitKey));
  const manual = loadManual();
  let added = 0;
  for (const m of manual) {
    const key = recruitKey(m);
    if (seen.has(key)) continue;
    seen.add(key);
    recruits.push(m);
    added++;
  }
  console.log(`Manual commitments: ${manual.length} loaded, ${added} added (rest were duplicates)`);

  // Drop curated spelling-duplicate rows.
  const suppress = loadSuppress();
  if (suppress.size) {
    const before = recruits.length;
    recruits = recruits.filter(r => !suppress.has(recruitKey(r)));
    console.log(`Suppressed ${before - recruits.length} duplicate spelling row(s)`);
  }

  // Collapse any remaining exact player+college duplicates. The upstream feed
  // occasionally lists the same commitment twice (e.g. under two dates or club
  // spellings); keep the newest by commitment date so a single row remains.
  {
    const byKey = new Map();
    for (const r of recruits) {
      const k = recruitKey(r);
      const ex = byKey.get(k);
      if (!ex || (r.commitmentDate || '') > (ex.commitmentDate || '')) byKey.set(k, r);
    }
    const before = recruits.length;
    recruits = Array.from(byKey.values());
    if (before !== recruits.length) {
      console.log(`Collapsed ${before - recruits.length} exact duplicate row(s)`);
    }
  }

  // Pull any state the feed appended to the high-school name into the State
  // column (applies to both scraped and manual rows).
  recruits.forEach(normalizeState);

  // Newest commitments first so recently-added entries surface at the top.
  recruits.sort((a, b) => (b.commitmentDate || '').localeCompare(a.commitmentDate || ''));

  const output = {
    generatedAt: new Date().toISOString(),
    source: SOURCE_URL,
    count: recruits.length,
    recruits,
  };

  fs.writeFileSync('recruits.json', JSON.stringify(output, null, 2));
  console.log(`\nTotal recruits saved: ${recruits.length}`);
}

scrape().catch(err => {
  console.error('Scraper failed:', err);
  process.exit(1);
});
