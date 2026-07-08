# Lacrosse Commitment Tracker

Automated scraper + WordPress filterable table for boys' and girls' lacrosse college commitments.

## What it does

1. A GitHub Actions workflow runs `scraper.js` once per day using Playwright.
2. The scraper visits ClubLacrosse, cycles through Gender and Class filters, and extracts the player commitment table.
3. Cleaned data is saved to `recruits.json` and committed back to the repo.
4. Your WordPress page loads `recruits.json` from GitHub and displays it with dropdown filters.

## Files

- `scraper.js` — Playwright scraper
- `package.json` — Node dependencies
- `.github/workflows/scrape.yml` — GitHub Actions daily schedule
- `wordpress-page.html` — Code to paste into a WordPress Custom HTML block
- `recruits.json` — Generated data file (created after first run)

## Setup

### 1. Create the GitHub repository

1. Go to https://github.com/new
2. Name the repo something like `lacrosse-commitment-tracker`
3. Choose **Public**
4. Click **Create repository**

### 2. Upload these files

Upload the entire contents of this folder to the repo:

```
commitment-tracker/
├── .github/
│   └── workflows/
│       └── scrape.yml
├── package.json
├── scraper.js
└── wordpress-page.html
```

Make sure the folder structure matches exactly (especially `.github/workflows/`).

### 3. Run the scraper manually first

1. In your repo, go to the **Actions** tab.
2. Click **Daily Commitment Scrape** on the left.
3. Click **Run workflow** → **Run workflow**.
4. Wait a few minutes, then refresh. If it succeeds, `recruits.json` will appear in your repo.

### 4. Update the WordPress page

1. Open `wordpress-page.html`.
2. Replace `YOUR_USERNAME` and `YOUR_REPO` in this line near the top:

   ```javascript
   const DATA_URL = 'https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/recruits.json';
   ```

   Example:

   ```javascript
   const DATA_URL = 'https://raw.githubusercontent.com/johnsmith/lacrosse-commitment-tracker/main/recruits.json';
   ```

3. Copy the entire contents of `wordpress-page.html`.
4. In WordPress, add a **Custom HTML** block to the page.
5. Paste the code.

## Local testing (optional)

If you want to run the scraper on your own computer:

```bash
npm install
npx playwright install --with-deps chromium
npm run scrape
```

## Troubleshooting

- **Workflow fails:** Check the Actions log. ClubLacrosse may have changed their page structure.
- **WordPress page shows no data:** Verify the `DATA_URL` in `wordpress-page.html` is correct and that `recruits.json` exists in the repo.
- **Filters are empty:** The scraper may have returned zero rows. Check `recruits.json` for content.

## Customizing

- To scrape more or fewer recruiting classes, edit the `classes` array in `scraper.js`.
- To change the scrape time, edit the `cron` expression in `.github/workflows/scrape.yml`.
