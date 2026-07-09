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
      await page.waitForSelector(':has-text("Player Details")', { timeout: 30000 });
    }
    await sleep(3000);

    const allRecruits = [];

    // Log the default view state for debugging
    const defaultRowCount = await page.evaluate(() => document.querySelectorAll('table tbody tr, [role="grid"] tbody tr, .MuiDataGrid-row').length);
    console.log(`Default view row count: ${defaultRowCount}`);
    await page.screenshot({ path: 'debug-default.png', fullPage: true });

    // Try extracting the default view to verify the extraction logic works
    const defaultRecruits = await extractTableData(page, 'Both', 'Default');
    console.log(`Default view extracted: ${defaultRecruits.length} rows`);

    for (const gender of CONFIG.genders) {
      console.log(`\n--- Gender: ${gender} ---`);

      const genderSetSuccess = await setExclusiveFilter(page, CONFIG.genders, gender);
      if (!genderSetSuccess) {
        console.warn(`Could not set gender filter for ${gender}`);
        await page.screenshot({ path: `debug-fail-gender-${gender}.png`, fullPage: true });
        continue;
      }
      await page.screenshot({ path: `debug-gender-${gender}.png`, fullPage: true });

      for (const cls of CONFIG.classes) {
        console.log(`Class: ${cls}`);

        const classSetSuccess = await setExclusiveFilter(page, CONFIG.classes, cls);
        if (!classSetSuccess) {
          console.warn(`Could not set class filter for ${cls}`);
          await page.screenshot({ path: `debug-fail-class-${gender}-${cls}.png`, fullPage: true });
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

        if (recruits.length === 0) {
          const safeName = `${gender}-${cls}`.replace(/[^a-z0-9\-]/gi, '');
          await page.screenshot({ path: `debug-zero-${safeName}.png`, fullPage: true });
          console.log(`  Saved debug-zero-${safeName}.png because 0 rows were found.`);
        }

        allRecruits.push(...recruits);
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

async function getCheckboxState(page, value) {
  const cb = page.getByRole('checkbox', { name: value, exact: false }).first();
  if (await cb.count() > 0) {
    return await cb.isChecked().catch(() => false);
  }
  return false;
}

async function clickFilterLabel(page, value) {
  // Try the visible label text using Playwright's text locator (most reliable)
  const textLocator = page.getByText(value, { exact: true }).first();
  if (await textLocator.count() > 0) {
    try {
      await textLocator.scrollIntoViewIfNeeded();
      await textLocator.click();
      return true;
    } catch (err) {
      console.warn(`getByText click failed for ${value}:`, err.message);
    }
  }

  // Fallback to MUI-specific label classes
  const label = page.locator(`.MuiFormControlLabel-label:has-text("${value}"), label:has-text("${value}")`).first();
  if (await label.count() > 0) {
    await label.scrollIntoViewIfNeeded();
    await label.click();
    return true;
  }

  // Fallback to the checkbox role locator
  const cb = page.getByRole('checkbox', { name: value, exact: false }).first();
  if (await cb.count() > 0) {
    await cb.scrollIntoViewIfNeeded();
    await cb.click();
    return true;
  }

  console.warn(`Could not find clickable label or checkbox for ${value}`);
  return false;
}

async function setExclusiveFilter(page, allValues, value) {
  try {
    console.log(`  Setting exclusive filter: ${value}`);

    // Uncheck every other value in the group
    for (const other of allValues) {
      if (other === value) continue;
      const wasChecked = await getCheckboxState(page, other);
      console.log(`    ${other} wasChecked=${wasChecked}`);
      if (wasChecked) {
        const clicked = await clickFilterLabel(page, other);
        if (clicked) await sleep(750);
      }
    }

    // Check the desired value
    const isChecked = await getCheckboxState(page, value);
    console.log(`    ${value} isChecked=${isChecked}`);
    if (!isChecked) {
      const clicked = await clickFilterLabel(page, value);
      if (!clicked) return false;
      await sleep(1500);
    }

    const finalState = await getCheckboxState(page, value);
    console.log(`    ${value} finalState=${finalState}`);
    return finalState;
  } catch (err) {
    console.error(`Error setting exclusive filter ${value}:`, err.message);
    return false;
  }
}

async function extract
