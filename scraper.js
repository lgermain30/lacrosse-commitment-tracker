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

async function scrape() {
  console.log('Fetching commitment data from API...');
  const json = await fetchJSON(API_URL);

  if (!json.status || !Array.isArray(json.commitments)) {
    throw new Error('Unexpected API response: ' + JSON.stringify(json).slice(0, 200));
  }

  console.log(`Total records from API: ${json.commitments.length}`);

  const CLASS_CUTOFF = 2026;

  const recruits = json.commitments
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
      clubTeam: c.short_name || '',
      highSchool: c.high_school || '',
      state: c.hs_state || '',
      commitmentDate: c.commitment_date || '',
    }))
    .filter(r => r.playerName && r.commitmentDate);

  console.log(`Valid records after filtering: ${recruits.length}`);

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

