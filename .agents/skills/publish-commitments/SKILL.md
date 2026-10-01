---
name: publish-commitments
description: Add or edit commitments in the lacrosse commitment tracker and publish them live with zero manual merges. Use whenever the user asks to add, flip, correct, or remove a commitment.
---

# Publishing commitment edits (zero-click)

The live Commitments page reads `recruits.json` from the `main` branch (via GitHub's
raw CDN, which caches ~5 min). A daily GitHub Action re-scrapes ClubLacrosse and
overwrites `recruits.json`, so **direct edits to `recruits.json` do not survive** —
curated edits must live in `manual_recruits.json` (adds/edits) or
`suppress_recruits.json` (hide stale upstream rows).

## Steps to add/edit a commitment

1. Edit `manual_recruits.json` (append/modify the entry). Fields:
   `gender` ("Boys"/"Girls"), `class`, `division` ("D1"/"D2"/"D3"/""),
   `playerName`, `college`, `position` (Middie/Attack/Defense/Goalie/LSM/FOGO/...),
   `clubTeam`, `highSchool`, `state`, `commitmentDate` (YYYY-MM-DD).
   To hide a stale upstream row, add it to `suppress_recruits.json` instead.
   Preserve each file's existing 2-space indentation (only touch the entry you add).

2. Commit and push to a side branch:
   ```
   git checkout -b devin/<ts>-<slug>
   git add manual_recruits.json suppress_recruits.json
   git commit -m "..."
   git push -u origin devin/<ts>-<slug>
   ```

3. Publish to `main` with zero clicks from the user:
   ```
   scripts/publish.sh devin/<ts>-<slug>
   ```
   This dispatches the `publish.yml` workflow, which pulls the two edit files from
   your branch, re-runs the scraper so `recruits.json` is regenerated with the edits
   merged, and pushes the result to `main` via the github-actions bot. The script
   waits for the run and reports success/failure.

4. Tell the user it's live and to hard-refresh (raw CDN caches ~5 min).

## Requirements

- Secret `GH_COMMIT_TRACKER_ACTIONS_PAT`: a fine-grained PAT scoped to this repo
  with **Actions: Read and write**. Saved as a repo-scoped Devin secret, so it is
  available automatically in sessions working in this repo. If it is missing or
  expired, `scripts/publish.sh` exits 2 / the dispatch returns 403 — ask the user
  to regenerate it at https://github.com/settings/personal-access-tokens and paste
  it into the secure secret prompt (never into chat).

## Notes

- Do NOT ask the user to merge a PR for routine commitment edits — that's what this
  zero-click path replaces.
- The publish workflow re-runs the ClubLacrosse scraper; a run takes a few minutes.
