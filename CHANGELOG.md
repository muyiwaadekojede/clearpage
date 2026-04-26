# Clearpage Change Log (Full Ledger)

Generated: 2026-04-26T00:55:14+01:00
Timezone: Africa/Lagos (+01:00)
Source basis: Git history + copied chat timeline context

## 1) Verified Git Commit Ledger (Complete)

### Commit
Hash: 6e808770aa88cff40b94862ec9ec0484eb4cb7eb
Date: 2026-04-22T19:52:11+01:00
Author: Muyiwa Adekojede
Subject: Initial commit
Files:
A	README.md

### Commit
Hash: e714ab3bb357d575866ee2aaa840d8cae9eea3a5
Date: 2026-04-23T01:09:51+01:00
Author: muyiwaadekojede
Subject: Build Clearpage full-stack app with extraction, exports, feedback, and E2E matrix
Files:
A	.env.local.example
A	.gitignore
A	app/admin/page.tsx
A	app/globals.css
A	app/layout.tsx
A	app/page.tsx
A	components/ExportButton.tsx
A	components/FailureModal.tsx
A	components/ImageToggle.tsx
A	components/ProgressIndicator.tsx
A	components/ReadingPreview.tsx
A	components/SettingsSidebar.tsx
A	components/UrlInput.tsx
A	lib/browser.ts
A	lib/db.ts
A	lib/exportDocx.ts
A	lib/exportMarkdown.ts
A	lib/exportPdf.ts
A	lib/exportTxt.ts
A	lib/extract.ts
A	lib/rateLimit.ts
A	lib/sanitise.ts
A	lib/types.ts
A	next-env.d.ts
A	next.config.ts
A	package-lock.json
A	package.json
A	pages/api/export.ts
A	pages/api/extract.ts
A	pages/api/feedback.ts
A	postcss.config.mjs
A	public/favicon.ico
A	scripts/e2e-brand-matrix.mjs
A	scripts/e2e-export.mjs
A	scripts/e2e-extract.mjs
A	scripts/e2e-feedback.mjs
A	scripts/e2e-ui.mjs
A	tsconfig.json

### Commit
Hash: 9f2113312a81fb04823144cbbaf9585a21e30f02
Date: 2026-04-23T01:11:52+01:00
Author: muyiwaadekojede
Subject: Ignore Vercel project metadata
Files:
M	.gitignore

### Commit
Hash: f6b0b34b76ad33a82a426a36f1490571deac293a
Date: 2026-04-23T01:15:08+01:00
Author: muyiwaadekojede
Subject: Merge Clearpage implementation
Files:
### Commit
Hash: cfa79a899ff4b20d57e8440a4a3cee3797662dff
Date: 2026-04-23T18:40:49+01:00
Author: muyiwaadekojede
Subject: Add admin auth, server-side telemetry dashboard, and robust image source extraction
Files:
M	.gitignore
M	app/admin/page.tsx
M	app/layout.tsx
M	app/page.tsx
M	components/FailureModal.tsx
M	components/ReadingPreview.tsx
A	lib/adminAuth.ts
A	lib/analytics.ts
A	lib/clientAnalytics.ts
M	lib/db.ts
M	lib/extract.ts
M	lib/types.ts
M	package.json
A	pages/api/admin-auth.ts
A	pages/api/analytics.ts
M	pages/api/export.ts
M	pages/api/extract.ts
M	pages/api/feedback.ts
A	scripts/e2e-admin-auth.mjs
A	scripts/e2e-analytics.mjs
M	scripts/e2e-brand-matrix.mjs
M	scripts/e2e-feedback.mjs

### Commit
Hash: c86bfb89c1f410cd096bf553d4f5e5d1a275300c
Date: 2026-04-23T19:01:15+01:00
Author: muyiwaadekojede
Subject: Fix Vercel serverless storage paths for DB and admin auth
Files:
M	lib/adminAuth.ts
M	lib/db.ts

### Commit
Hash: e79aad22d1eb477790e7de60de86ab162e949138
Date: 2026-04-23T19:10:30+01:00
Author: muyiwaadekojede
Subject: Make extraction resilient on Vercel with lazy Playwright + HTML fallback
Files:
M	lib/browser.ts
M	lib/exportPdf.ts
M	lib/extract.ts

### Commit
Hash: a60ba7bbf7f06546e01a82200d5280aaf4663c0e
Date: 2026-04-23T19:19:21+01:00
Author: muyiwaadekojede
Subject: Add runtime diagnostics endpoint for Vercel dependency checks
Files:
A	pages/api/runtime-check.ts

### Commit
Hash: e73f03b26aafb22686c9fb76bac0ec04cd0bdc9f
Date: 2026-04-23T19:21:03+01:00
Author: muyiwaadekojede
Subject: Use static module probes in runtime diagnostics
Files:
M	pages/api/runtime-check.ts

### Commit
Hash: d119cedfe4fe858fac857f5621b22c3bdc61dfc9
Date: 2026-04-23T19:24:42+01:00
Author: muyiwaadekojede
Subject: Harden server module loading for Vercel runtime compatibility
Files:
M	lib/browser.ts
M	lib/sanitise.ts
M	pages/api/runtime-check.ts

### Commit
Hash: e6f6aa941ac22133b1e4fb0fa0499bb5f94d206a
Date: 2026-04-23T19:34:57+01:00
Author: muyiwaadekojede
Subject: Enable require(esm) support in Vercel runtime for jsdom compatibility
Files:
A	vercel.json

### Commit
Hash: 9639919afa790187b4768b227215dedfa33bda56
Date: 2026-04-23T19:38:38+01:00
Author: muyiwaadekojede
Subject: Configure Vercel build to install Playwright Chromium
Files:
M	vercel.json

### Commit
Hash: a734e52d25c371952eb3bb924c7649479359e45d
Date: 2026-04-23T19:39:48+01:00
Author: muyiwaadekojede
Subject: Add Playwright launch/pdf probe to runtime diagnostics
Files:
M	pages/api/runtime-check.ts

### Commit
Hash: 43638940f4767c188702afb0963d61c25a90d227
Date: 2026-04-23T19:42:29+01:00
Author: muyiwaadekojede
Subject: Expose Playwright launch diagnostics for runtime debugging
Files:
M	lib/browser.ts
M	pages/api/runtime-check.ts

### Commit
Hash: 82ea0f2f8b212d0ecd8fa8a1767f997c1bf6c8a1
Date: 2026-04-23T19:44:20+01:00
Author: muyiwaadekojede
Subject: Ensure Chromium is installed during Vercel install step
Files:
M	vercel.json

### Commit
Hash: d3f3f5d0d925007af7569a0d260444bdb362f584
Date: 2026-04-25T06:03:06+01:00
Author: muyiwaadekojede
Subject: Fix Vercel PDF runtime fallback and robust UI submit flow
Files:
M	app/page.tsx
M	components/UrlInput.tsx
M	lib/browser.ts
M	package-lock.json
M	package.json
D	pages/api/runtime-check.ts
M	vercel.json

### Commit
Hash: 2c51b4abffafd5d698d341f674b7f69f862dd4f9
Date: 2026-04-25T06:10:40+01:00
Author: muyiwaadekojede
Subject: Stabilize Vercel Chromium bundling for Playwright routes
Files:
M	lib/browser.ts
M	next.config.ts

### Commit
Hash: 1bd39ee83402685c1ed2ec96b8faeafb48375289
Date: 2026-04-25T06:14:16+01:00
Author: muyiwaadekojede
Subject: Expose export error message for production debugging
Files:
M	pages/api/export.ts

### Commit
Hash: 4a1b90c8cf0c0f29c457c6ead1c3c4e40b956063
Date: 2026-04-25T06:20:41+01:00
Author: muyiwaadekojede
Subject: Add text-native PDF fallback when Playwright is unavailable
Files:
M	lib/exportPdf.ts
M	package-lock.json
M	package.json

### Commit
Hash: 4066092d237e6503b9a01a6ff3578651165be836
Date: 2026-04-25T06:29:38+01:00
Author: muyiwaadekojede
Subject: Revert "Add text-native PDF fallback when Playwright is unavailable"
Files:
M	lib/exportPdf.ts
M	package-lock.json
M	package.json

### Commit
Hash: 0b483fd795daf7527021ef858ea78e6903b44dad
Date: 2026-04-25T06:29:38+01:00
Author: muyiwaadekojede
Subject: Revert "Expose export error message for production debugging"
Files:
M	pages/api/export.ts

### Commit
Hash: d60bd7069a37e66bca82e95dd3aa7427b110f940
Date: 2026-04-25T06:29:38+01:00
Author: muyiwaadekojede
Subject: Revert "Stabilize Vercel Chromium bundling for Playwright routes"
Files:
M	lib/browser.ts
M	next.config.ts

### Commit
Hash: bc1dcd9746b8e0a4ffc2602f55426f4325aca493
Date: 2026-04-25T06:32:40+01:00
Author: muyiwaadekojede
Subject: Add built-in PDF fallback when Playwright is unavailable
Files:
M	lib/exportPdf.ts

### Commit
Hash: 6b2deac4e9a197acc51be61cea34acc313a074f4
Date: 2026-04-25T06:37:57+01:00
Author: muyiwaadekojede
Subject: Harden serverless admin auth fallback and PDF export resilience
Files:
M	lib/adminAuth.ts
M	scripts/e2e-admin-auth.mjs

### Commit
Hash: ab2c116adf331ccb6cb098bbf7e16c030d536600
Date: 2026-04-25T06:43:44+01:00
Author: muyiwaadekojede
Subject: Use deterministic admin credentials in Vercel serverless mode
Files:
M	lib/adminAuth.ts

### Commit
Hash: 93e4d49af3a8e523db93c1ab63810fb45763eb7a
Date: 2026-04-25T07:22:29+01:00
Author: muyiwaadekojede
Subject: Use deterministic admin creds for remote e2e targets
Files:
M	scripts/e2e-admin-auth.mjs

### Commit
Hash: aa98a590f83a8c0fa7e46f529acdacd40d9729b0
Date: 2026-04-25T13:13:42+01:00
Author: muyiwaadekojede
Subject: Improve full title fidelity and sticky sidebar behavior
Files:
M	app/page.tsx
M	components/SettingsSidebar.tsx
M	lib/extract.ts
M	lib/sanitise.ts

### Commit
Hash: 0a38cab2d4081b36f70c5d862a60566ae1de23ba
Date: 2026-04-25T19:35:32+01:00
Author: muyiwaadekojede
Subject: Avoid export payload bloat by server-side refresh for live exports
Files:
M	app/page.tsx
M	pages/api/export.ts
M	scripts/e2e-brand-matrix.mjs

### Commit
Hash: 4f7c805ac400f82d58c15b854a0ba1f74eec0979
Date: 2026-04-25T21:28:55+01:00
Author: muyiwaadekojede
Subject: Harden extraction against bot signals and timeout fallbacks
Files:
M	lib/browser.ts
M	lib/extract.ts
M	next.config.ts
M	scripts/e2e-brand-matrix.mjs

### Commit
Hash: 1905d3881c0deca11a3ba7072d6ca1e47ff093bd
Date: 2026-04-25T22:11:20+01:00
Author: muyiwaadekojede
Subject: Use extraction snapshots for exports and stabilize e2e defaults
Files:
M	app/page.tsx
M	lib/extract.ts
A	lib/extractCache.ts
M	lib/types.ts
M	pages/api/export.ts
M	pages/api/extract.ts
M	scripts/e2e-analytics.mjs
M	scripts/e2e-brand-matrix.mjs
M	scripts/e2e-export.mjs
M	scripts/e2e-extract.mjs
M	scripts/e2e-feedback.mjs
M	scripts/e2e-ui.mjs

### Commit
Hash: 9f34d03d59a393aeebe930b9dc48fd63a061da59
Date: 2026-04-25T22:23:33+01:00
Author: muyiwaadekojede
Subject: Reduce Vercel function bundle size for extract/export APIs
Files:
M	next.config.ts

### Commit
Hash: 00ca2bd46d2962abe5f2a81123b954b85c4fc916
Date: 2026-04-25T22:26:51+01:00
Author: muyiwaadekojede
Subject: Prevent recursive medium fallback loops in extractor
Files:
M	lib/extract.ts

### Commit
Hash: 48818c8e974d7767e28b953a7c5d1e4555a4e1ab
Date: 2026-04-25T23:35:04+01:00
Author: muyiwaadekojede
Subject: Add extractor fallbacks for TLS, feeds, and RSC payload content
Files:
M	lib/extract.ts

## 2) Chat Activity Ledger (Operational Timeline)

Note: This section records interactive work that may not map 1:1 to a commit (test runs, deployments, diagnostics, server starts, reproductions, and iteration loops). Times below are taken from chat UI labels where available.

1. [Time label: 8:25 PM] Full Clearpage build scope was provided (product, architecture, stack, extraction/export requirements, feedback pipeline, admin page requirements).
2. [Time label: 8:25 PM onward] Base app implementation was completed, then iterative e2e runs started (npm run e2e:extract, npm run e2e:export, npm run e2e:feedback, npm run e2e:ui, and later npm run e2e:full).
3. [Time label: 8:56 PM] Local server was launched and localhost URL was shared.
4. [Time label: ~9:11 PM] User reported major quality issues (missing images, filename/title correctness, plus requirement for many unique URL tests).
5. [Time label: ~9:11 PM to ~12:49 AM] Multi-loop extraction/export hardening was done:
- Diagnosed image failures on target URLs.
- Improved image MIME/type handling and source selection.
- Hardened title/filename derivation and sanitization.
- Added large matrix e2e script for provided + additional brand URLs.
- Fixed payload-size/413 and test harness resiliency issues.
6. [Time label: ~12:49 AM] Reported full matrix + core suite green for that cycle.
7. [Time label: ~1:06 AM] Vercel production deployment performed; deployment URLs shared.
8. [Time label: ~1:13 AM] Existing GitHub repo was found/used and project was pushed (github.com/muyiwaadekojede/clearpage).
9. [Time label: ~10:29 AM] Full-journey telemetry tracking was requested and implemented (SQLite analytics, admin analytics dashboard, client/server events).
10. [Time label: ~10:54 AM onward] Strict admin auth and server-side-only behavior hardening was requested.
11. [Time label: ~1:50 PM and after] Admin auth/session/cookie protection, protected admin APIs, and server-side content-variant handling were implemented and tested.
12. [Multiple timestamps] Repeated debugging for interrupted runs / server log visibility:
- Clarified detached vs foreground start behavior.
- Standardized foreground start expectation for visible logs.
13. [Time label: ~6:19 PM] Blurry image issue identified as low-res placeholder selection, not CSS.
14. [Time label: ~6:19 PM onward] Generic high-res image source resolver fix landed and validated.
15. [Time label: ~6:40 PM] Push to Git completed for the image fix cycle.
16. [Time label: ~6:55 PM onward] Localhost-vs-Vercel divergence and 500 errors were reported and addressed through multiple runtime/deploy cycles.
17. [Operations across this period] Vercel runtime stabilization cycle:
- Serverless-writable path handling for DB/admin auth.
- Runtime diagnostics route creation/iteration/removal.
- Module loading compatibility hardening for serverless runtime.
- Playwright/Chromium availability probes and fallback strategy.
18. [Operations across later cycles] Reliability cycle for export/extract and auth in Vercel:
- Built-in PDF fallback when Playwright unavailable.
- Deterministic serverless admin credential behavior and remote e2e auth logic.
19. [Time label: ~7:15 AM / ~7:23 AM] Status reported with local/live e2e passing for that cycle.
20. [Current continuation cycle] Remaining blocked URL handling and Vercel regressions were resolved to 0 blocked in brand matrix.
21. [Current continuation cycle] Final live validation done:
- BASE_URL=https://clearpage.vercel.app npm run e2e:full passed.
- BASE_URL=https://clearpage.vercel.app node scripts/e2e-brand-matrix.mjs returned 36/36 pass, 0 blocked.

## 3) Operational Notes

1. Timezone for verified timestamps: Africa/Lagos (+01:00).
2. Verified code-change timestamps are from Git commit metadata in section 1.
3. Chat-time labels in section 2 are preserved from UI labels and may not include explicit calendar date in the copied transcript.
