# Upgrading WhelkMail

WhelkMail is self-hosted: nobody can push an update into your deployment. This
guide is what the in-app notice links to when a newer release exists.

## Before you start

- The installed version is in **Settings → System → Version and updates**,
  together with the latest release it could find.
- A newer release is announced after the app compares your build with the latest
  published release on
  [github.com/WhelkMail/WhelkMail/releases](https://github.com/WhelkMail/WhelkMail/releases).
  The check runs from your Worker and is cached for a day; set
  `UPDATE_CHECK=off` to disable it.
- Read the release notes: they say whether the release adds a database
  migration. A release that needs one must not be deployed before the
  migration (or the app answers with a schema error).

## Upgrading a deployment

1. **Get the code.** Update your copy of the repository to the release tag:
   - GitHub fork: open your fork and use **Sync fork → Update branch**, then
     check that your fork's `main` matches the upstream tag.
   - Command line: `git fetch --tags && git checkout v1.2.3`.
2. **Deploy.** It depends on the target:
   - **Workers (default):** `npm run deploy` publishes the Worker built from this
     checkout; the Deploy to Cloudflare button updates it from a repository push.
   - **Pages:** let the Pages project rebuild from the
     branch, or upload the build yourself with `npm run deploy:pages`.
   - **Docker:** rebuild the image and recreate the container, keeping the data
     volume:
     ```bash
     cd deploy/docker && docker compose up -d --build
     ```
   For all three, install the exact dependencies first:
   ```bash
   npm ci
   ```
3. **Migrate, if the release notes ask for it.**
   ```bash
   npm run db:migrate:remote      # Workers or Pages: D1
   ```
   Docker keeps its own SQLite file and migrates it when the container starts,
   so there is nothing to run there unless the release notes say otherwise.
   Migrations are additive, so a release written against the previous schema
   keeps working while you run them; still, run them before using new features.
4. **Reload the app.** A tab left open on the old bundle shows a "reload"
   notice; after the reload, Settings → System reports the new version.

## If something goes wrong

- **The app returns a schema error.** The code is newer than the database. Run
  `npm run db:migrate:remote`, then retry.
- **Settings → System says the check is unreachable.** Neither the GitHub API
  nor the releases feed could be reached from the Worker. The app keeps
  working; the last known answer stays cached. Run **Check again** to retry
  immediately. An optional `GITHUB_TOKEN` secret raises the API rate limit
  (the feed fallback needs no token).
- **Your fork is ahead of the latest release.** No notice is shown: only
  releases newer than your build are announced.

Releases and their notes are listed at
[github.com/WhelkMail/WhelkMail/releases](https://github.com/WhelkMail/WhelkMail/releases).
