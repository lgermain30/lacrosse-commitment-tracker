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
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  try {
    console.log('Loading page...');
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');

    // Accept or dismiss the cookie/privacy consent banner if it appears
    try {
      const consentButton = page.locator('button:has-text("Accept")').first();
      if (await consentButton.count() > 0) {
        await consentButton.click();
        console.log('Accepted cookie banner.');
        await sleep(2000);
      }
    } catch (err) {
      console.log('No cookie banner to accept.');
    }

    // Dismiss any additional informational popups (e.g., NCAA settlement notice)
    try {
      const gotItButton = page.locator('button:has-text("Got it!"), button:has-text("Got It"), button:has-text("Close")').first();
      if (await gotItButton.count() > 0) {
        await gotItButton.click();
        console.log('Dismissed informational popup.');
        await sleep(2000);
      }
    } catch (err) {
      console.log('No informational popup to dismiss.');
    }

    // Wait for the player details section to appear.
    // ClubLacrosse uses a Material UI data grid, so look for multiple possible selectors.
    const gridSelector = 'table, [role="grid"], .MuiDataGrid-root, [data-testid="data-grid"]'; //legacy fallback
    try {
      await page.waitForSelector(gridSelector, { timeout: 60000 });
    } catch (err) {
      console.warn('Primary grid selector timed out, waiting for Player Details text...');
      await page.waitForSelector('text="Player Details"', { timeout: 30000 });
    }
    await sleep(3000);

    const allRecruits = [];

    for (const gender of CONFIG.genders) {
      console.log(`\n--- Gender: ${gender} ---`);

      const genderSetSuccess = await setCheckboxFilter(page, 'Gender', gender);
      if (!genderSetSuccess) {
        console.warn(`Could not set gender filter for ${gender}`);
        continue;
      }

      for (const cls of CONFIG.classes) {
        console.log(`Class: ${cls}`);

        const classSetSuccess = await setCheckboxFilter(page, 'Recruiting Class Filter', cls);
        if (!classSetSuccess) {
          console.warn(`Could not set class filter for ${cls}`);
          continue;
        }

        await sleep(4000);

        // Wait for the grid to repopulate after filter change
        try {
          await page.waitForSelector(gridSelector, { timeout: 30000 });
        } catch (err) {
          console.warn(`No grid found for ${gender} / ${cls}, skipping...`);
          continue;
        }

        const recruits = await extractTableData(page, gender, cls);
        console.log(`  Found ${recruits.length} recruits`);
        allRecruits.push(...recruits);
      }

      await resetFilter(page, 'Recruiting Class Filter');
    }

    await browser.close();

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
  } catch (err) {
    console.error('Scraper failed:', err);
    try {
      await page.screenshot({ path: 'scraper-error.png', fullPage: true });
      const html = await page.content();
      fs.writeFileSync('scraper-error.html', html);
      console.log('Saved debug screenshot and HTML.');
    } catch (debugErr) {
      console.error('Could not save debug files:', debugErr.message);
    }
    await browser.close();
    process.exit(1);
  }
}

async function setCheckboxFilter(page, groupLabel, value) {
  try {
    // Try several strategies to find and toggle the checkbox
    const selectors = [
      `label:has-text("${value}") input[type="checkbox"]`,
      `span:has-text("${value}") >> xpath=ancestor::label | ancestor::div >> input[type="checkbox"]`,
      `[aria-label*="${value}"] input[type="checkbox"]`,
      `input[type="checkbox"][value="${value}"]`,
    ];

    for (const selector of selectors) {
      const checkbox = await page.locator(selector).first();
      const count = await checkbox.count().catch(() => 0);
      if (count === 0) continue;

      const isChecked = await checkbox.isChecked().catch(() => false);
      if (!isChecked) {
        await checkbox.click();
        await sleep(1500);
      }
      return true;
    }

    console.warn(`Could not find checkbox for ${value}`);
    return false;
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

    // Try several possible grid/table structures
    const containers = [
      ...document.querySelectorAll('.MuiDataGrid-root'),
      ...document.querySelectorAll('[role="grid"]'),
      ...document.querySelectorAll('table'),
    ];

    for (const container of containers) {
      // Try to get headers
      let headers = [];
      const headerCells = container.querySelectorAll('.MuiDataGrid-columnHeader, [role="columnheader"], thead th, tr th');
      headers = Array.from(headerCells).map(th => th.innerText.trim().replace(/\s+/g, ' '));

      // Try to get body rows
      const rowSelectors = [
        '.MuiDataGrid-row',
        '[role="row"]',
        'tbody tr',
        'tr',
      ];

      let bodyRows = [];
      for (const sel of rowSelectors) {
        bodyRows = Array.from(container.querySelectorAll(sel));
        if (bodyRows.length > 0) break;
      }

      for (const tr of bodyRows) {
        const cellSelectors = [
          '.MuiDataGrid-cell, [role="gridcell"], td',
          'td',
        ];

        let cells = [];
        for (const sel of cellSelectors) {
          cells = Array.from(tr.querySelectorAll(sel)).map(td => td.innerText.trim().replace(/\s+/g, ' '));
          if (cells.length > 0) break;
        }

        if (cells.length < 3) continue;

        const map = {};
        headers.forEach((h, i) => {
          if (h) map[h.toLowerCase()] = cells[i] || '';
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

scrape();

