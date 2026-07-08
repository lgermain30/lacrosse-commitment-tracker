const { chromium } = require('playwright');
const fs = require('fs');

const BASE_URL = 'https://public.clublacrosse.org/commitments/Dashboard/gender-with-player';

// Combinations to scrape. Add/remove class years as needed.
const CONFIG = {
  genders: ['Boys', 'Girls'],
  classes: ['2025', '2026', '2027', '2028', '2029', '2030'],
  divisions: ['D1', 'D2', 'D3'], // not used as primary filter, but available
};

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function scrape() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Loading page...');
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  // Wait for the player details table to appear
  await page.waitForSelector('table', { timeout: 30000 });
  await sleep(3000);

  const allRecruits = [];

  for (const gender of CONFIG.genders) {
    console.log(`\n--- Gender: ${gender} ---`);

    // Set Gender filter
    const genderSetSuccess = await setCheckboxFilter(page, 'Gender', gender);
    if (!genderSetSuccess) {
      console.warn(`Could not set gender filter for ${gender}`);
      continue;
    }

    for (const cls of CONFIG.classes) {
      console.log(`Class: ${cls}`);

      // Set Recruiting Class filter
      const classSetSuccess = await setCheckboxFilter(page, 'Recruiting Class Filter', cls);
      if (!classSetSuccess) {
        console.warn(`Could not set class filter for ${cls}`);
        continue;
      }

      // Allow table to update
      await sleep(3000);

      const recruits = await extractTableData(page, gender, cls);
      console.log(`  Found ${recruits.length} recruits`);
      allRecruits.push(...recruits);
    }

    // Reset class filter before switching gender
    await resetFilter(page, 'Recruiting Class Filter');
  }

  await browser.close();

  // Deduplicate by a composite key (name + class + school + college + gender)
  const seen = new Set();
  const uniqueRecruits = allRecruits.filter(r => {
    const key = [r.playerName, r.class, r.highSchool, r.college, r.gender].join('|').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const output = {
    generatedAt: new Date().toISOString(),
    source: BASE_URL,
    count: uniqueRecruits.length,
    recruits: uniqueRecruits,
  };

  fs.writeFileSync('recruits.json', JSON.stringify(output, null, 2));
  console.log(`\nTotal unique recruits saved: ${uniqueRecruits.length}`);
}

async function setCheckboxFilter(page, groupLabel, value) {
  try {
    const control = await page.$(`:text-is("${groupLabel}")`);
    if (!control) return false;

    // Find the checkbox associated with this value within the same filter group
    const checkbox = await page.locator(`label:has-text("${value}") input[type="checkbox"]`).first();
    const isChecked = await checkbox.isChecked().catch(() => false);
    if (!isChecked) {
      await checkbox.click();
      await sleep(1500);
    }
    return true;
  } catch (err) {
    console.error(`Error setting ${groupLabel} = ${value}:`, err.message);
    return false;
  }
}

async function resetFilter(page, groupLabel) {
  try {
    const checkboxes = await page.locator(`input[type="checkbox"]`).all();
    for (const cb of checkboxes) {
      const isChecked = await cb.isChecked().catch(() => false);
      if (isChecked) {
        await cb.click();
      }
    }
    await sleep(1000);
  } catch (err) {
    console.error(`Error resetting ${groupLabel}:`, err.message);
  }
}

async function extractTableData(page, gender, cls) {
  return page.evaluate((genderValue, classValue) => {
    const rows = [];
    const tables = document.querySelectorAll('table');

    for (const table of tables) {
      const headers = Array.from(table.querySelectorAll('thead th, tr th'))
        .map(th => th.innerText.trim().replace(/\s+/g, ' '));

      const bodyRows = table.querySelectorAll('tbody tr');
      for (const tr of bodyRows) {
        const cells = Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim().replace(/\s+/g, ' '));
        if (cells.length < 3) continue;

        // Map generic headers to known fields using common names
        const map = {};
        headers.forEach((h, i) => {
          map[h.toLowerCase()] = cells[i] || '';
        });

        const get = (keys) => {
          for (const k of keys) {
            if (map[k] !== undefined && map[k] !== '') return map[k];
          }
          return '';
        };

        const playerName = get(['player', 'name', 'player name', 'athlete']);
        const highSchool = get(['high school', 'school', 'hs', 'highschool']);
        const position = get(['position', 'pos', 'positions']);
        const clubTeam = get(['club', 'club team', 'clubteam', 'team']);
        const college = get(['college', 'school', 'university', 'committed to', 'committed school']);
        const commitmentDate = get(['date', 'commitment date', 'commit date', 'committed']);
        const state = get(['state', 'st', 'location']);

        rows.push({
          gender: genderValue,
          class: classValue,
          playerName: playerName || cells[2] || '',
          highSchool: highSchool || cells[3] || '',
          position: position || cells[4] || '',
          clubTeam: clubTeam || cells[5] || '',
          college: college || cells[6] || '',
          commitmentDate: commitmentDate || cells[0] || '',
          state: state || cells[7] || '',
          raw: cells,
        });
      }
    }

    return rows;
  }, gender, cls);
}

scrape().catch(err => {
  console.error('Scraper failed:', err);
  process.exit(1);
});
