const { chromium } = require('playwright');
const fs = require('fs');

const BASE_URL = 'https://public.clublacrosse.org/commitments/Dashboard/gender-with-player';

const CONFIG = {
  genders: ['Boys', 'Girls'],
  classes: ['2025', '2026', '2027', '2028', '2029', '2030'],
};

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function dismissPopups(page) {
  try {
    const accept = page.locator('button:has-text("Accept")').first();
    if (await accept.count() > 0) { await accept.click(); await sleep(1500); console.log('Accepted cookie banner.'); }
  } catch (_) {}
  try {
    const close = page.locator('button:has-text("Got it!"), button:has-text("Got It"), button:has-text("Close"), button:has-text("OK")').first();
    if (await close.count() > 0) { await close.click(); await sleep(1500); console.log('Dismissed popup.'); }
  } catch (_) {}
}

async function waitForRows(page, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const count = await page.evaluate(() =>
      document.querySelectorAll('.ag-row, .ag-row-even, .ag-row-odd').length
    );
    if (count > 0) return count;
    await sleep(1000);
  }
  return 0;
}

async function clickFilterLabel(page, value) {
  const labels = await page.locator('label').all();
  for (const label of labels) {
    const text = (await label.innerText().catch(() => '')).trim();
    if (text === value) {
      await label.scrollIntoViewIfNeeded();
      await label.click();
      await sleep(500);
      return true;
    }
  }
  const cb = page.getByRole('checkbox', { name: value });
  if (await cb.count() > 0) {
    await cb.first().scrollIntoViewIfNeeded();
    await cb.first().click();
    await sleep(500);
    return true;
  }
  console.warn(`Could not find label or checkbox for: ${value}`);
  return false;
}

async function setExclusiveFilter(page, allValues, desired) {
  for (const v of allValues) {
    if (v === desired) continue;
    const cb = page.getByRole('checkbox', { name: v });
    if (await cb.count() > 0 && await cb.first().isChecked().catch(() => false)) {
      await clickFilterLabel(page, v);
    }
  }
  const cb = page.getByRole('checkbox', { name: desired });
  if (await cb.count() > 0) {
    if (!await cb.first().isChecked().catch(() => false)) {
      await clickFilterLabel(page, desired);
    }
    await sleep(2000);
    return await cb.first().isChecked().catch(() => false);
  }
  const clicked = await clickFilterLabel(page, desired);
  await sleep(2000);
  return clicked;
}

async function extractRows(page, gender, cls) {
  return await page.evaluate(({ g, c }) => {
    const results = [];

    // AG Grid selectors
    const headerEls = document.querySelectorAll('.ag-header-cell[col-id]');
    const headers = Array.from(headerEls).map(h => (h.getAttribute('col-id') || h.innerText).trim().replace(/\s+/g, ' ').toLowerCase());

    const agRows = document.querySelectorAll('.ag-row');

    agRows.forEach(row => {
      const cells = Array.from(row.querySelectorAll('.ag-cell[col-id]'));
      const cellMap = {};
      cells.forEach(cell => {
        const key = (cell.getAttribute('col-id') || '').toLowerCase();
        cellMap[key] = cell.innerText.trim().replace(/\s+/g, ' ');
      });

      const get = (keys) => {
        for (const k of keys) {
          if (cellMap[k] !== undefined && cellMap[k] !== '') return cellMap[k];
          const mk = Object.keys(cellMap).find(m => m.includes(k) && cellMap[m] !== '');
          if (mk) return cellMap[mk];
        }
        return '';
      };

      const allCells = cells.map(c => c.innerText.trim().replace(/\s+/g, ' '));
      if (allCells.length < 2) return;

      results.push({
        gender: g, class: c,
        playerName: get(['playername', 'player', 'name', 'athlete', 'playerName']) || allCells[2] || '',
        college: get(['schoolname', 'school', 'college', 'university']) || allCells[3] || '',
        position: get(['position', 'pos']) || allCells[4] || '',
        clubTeam: get(['clubname', 'club', 'team']) || allCells[5] || '',
        highSchool: get(['highschool', 'highschoolname', 'hs']) || allCells[6] || '',
        commitmentDate: get(['commitdate', 'date', 'committed', 'commitmentdate']) || allCells[0] || '',
        state: get(['hsstate', 'state', 'st']) || allCells[7] || '',
        rawColIds: Object.keys(cellMap),
      });
    });

    return { results, agRowCount: agRows.length, headers, colIds: Array.from(headerEls).map(h => h.getAttribute('col-id')) };
  }, { g: gender, c: cls });
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
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 90000 });
    await sleep(3000);
    await dismissPopups(page);
    await sleep(2000);

    await page.screenshot({ path: 'debug-default.png', fullPage: true });
    fs.writeFileSync('debug-page.html', await page.content());
    console.log('Saved debug-default.png and debug-page.html');

    const audit = await page.evaluate(() => ({
      agRow: document.querySelectorAll('.ag-row').length,
      agCell: document.querySelectorAll('.ag-cell').length,
      agHeader: document.querySelectorAll('.ag-header-cell[col-id]').length,
      agColIds: Array.from(document.querySelectorAll('.ag-header-cell[col-id]')).map(h => h.getAttribute('col-id')),
      table: document.querySelectorAll('table').length,
      labels: Array.from(document.querySelectorAll('label')).map(l => l.innerText.trim()).filter(t => t.length > 0 && t.length < 40),
      checkboxCount: document.querySelectorAll('input[type="checkbox"]').length,
    }));
    console.log('DOM audit:', JSON.stringify(audit, null, 2));

    const allRecruits = [];

    for (const gender of CONFIG.genders) {
      console.log(`\n--- Gender: ${gender} ---`);
      const gOk = await setExclusiveFilter(page, CONFIG.genders, gender);
      console.log(`  Gender filter set: ${gOk}`);
      if (!gOk) { await page.screenshot({ path: `debug-fail-gender-${gender}.png`, fullPage: true }); continue; }
      await page.screenshot({ path: `debug-gender-${gender}.png`, fullPage: true });

      for (const cls of CONFIG.classes) {
        console.log(`  Class: ${cls}`);
        const cOk = await setExclusiveFilter(page, CONFIG.classes, cls);
        console.log(`    Class filter set: ${cOk}`);
        if (!cOk) { await page.screenshot({ path: `debug-fail-class-${gender}-${cls}.png`, fullPage: true }); continue; }

        const rowCount = await waitForRows(page, 15000);
        console.log(`    Rows visible: ${rowCount}`);

        const { results, agRowCount, headers, colIds } = await extractRows(page, gender, cls);
        console.log(`    AG rows: ${agRowCount}, extracted: ${results.length}, colIds: ${JSON.stringify(colIds)}`);

        if (results.length === 0) {
          await page.screenshot({ path: `debug-zero-${gender}-${cls}.png`, fullPage: true });
        }

        allRecruits.push(...results);
      }
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
      fs.writeFileSync('scraper-error.html', await page.content());
    } catch (_) {}
    await browser.close();
    process.exit(1);
  }
}

scrape();

