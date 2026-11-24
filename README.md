# Claude Developer Foundations Study Companion

A static personal study roadmap for developers who have used Claude Code or Codex and are starting formal certification study. Independent of Anthropic; not an official certification product or pass predictor.

## Study

Start with **Lesson 1 · Claude Code and your certification starting point** for the tool overview, exam snapshot, recommended background, and registration eligibility. Continue with the technical lessons and their linked resources, then try the supplied exercises. The roadmap covers eight domains with a short introductory lesson, eight technical study activities, and eight original exercises. Each study lesson has an important summary, best practices, tips/common pitfalls, and official read-more links. Community reading is optional and separated from official guidance. Each exercise includes practice material, hints, and a reference solution with reasoning; no API key or subscription is required for the core activity.

Use **Activity status** to record your progress and **Needs review** to collect topics to revisit. Save questions and conclusions in each activity's note editor. Review lists link back to your activities and show their saved notes. The notebook also retains notes from retired activities.

The roadmap targets the published CCDV-F guide effective December 7, 2026. Until then it is labeled upcoming. Resource cards distinguish official and community providers, access requirements, and matching/different/unverified editions. A completion count is a study aid, not an exam readiness score. Check official registration eligibility separately.

Repository: https://github.com/truongchanbuu/claude-developer-cert

Site URL: https://truongchanbuu.github.io/claude-developer-cert/

## Run locally

Requires Node.js 24 for checks and Python 3 for HTTP preview. No packages or build step.

```sh
node --test
node --check site/app.mjs
node --check site/state.mjs
python3 -m http.server 8000 --bind 127.0.0.1 --directory site
```

Open http://127.0.0.1:8000/. Use HTTP rather than opening index.html as a file URL.

For a nested-path preview from this directory:

```sh
python3 -m http.server 8001 --bind 127.0.0.1 --directory ..
```

Open http://127.0.0.1:8001/claude-developer-cert/site/#item/study-messages-api.

## Research-informed learning cycle

Each exercise now provides a different worked example and an explanation prompt. If the topic is unfamiliar, explain the example first; then close it, attempt the exercise from memory, compare your answer with the reference solution, and identify a correction. Earlier exercise notes stay collapsed on repeat visits. After a recall has been recorded, the original case and instructions also start collapsed; answer cues are disclosed only with the explained feedback.

After opening feedback, choose **Needed support**, **Partly recalled**, or **Recalled independently** to plan a return in 1, 3, or 7 UTC calendar days. Due exercises appear in Review; future dates appear under Scheduled returns. These intervals are practical defaults, not a scientifically optimal schedule. The rating is self-reported, never auto-completes an activity, and does not save an unsaved note draft or trigger notifications.

The [learning-methods page](site/learning-methods.html) links the primary retrieval, spacing, and self-explanation studies and explains their limits. This application combines those ideas as a design inference; certification or learning-effectiveness gains have not been measured. Existing v1 notes and progress remain compatible, with optional recall metadata added to progress entries.

## Personal data

Notes and progress stay in this browser profile. Clearing browser data deletes them. They are not encrypted or isolated from other code sharing the origin; never enter secrets or sensitive information. Use one study tab: the latest successful save wins. Export, synchronization, accounts, and live model calls are outside scope.

Choose **Save note** before leaving. Unsaved edits prompt Save/Discard/Keep editing for internal navigation. Browser-close warnings are supported where the browser permits them and are not a draft backup. Notes are limited to 10,000 Unicode code points; oversized text stays available to edit without replacing the saved note. Empty saves and Delete require deletion confirmation.

Blocked or full storage leaves the current session usable and shows that changes are not saved for future visits. Unreadable saved data is preserved, with replacement writes paused until a confirmed companion reset. Reset deletes only this companion's key. Archived notes remain editable; materially changed activities require a new completion confirmation for their current edition.

Storage key: `claude-developer-cert:learner-state:v1`.

## Content maintenance

Edit `site/content.json`. Study items require `summary`, `bestPractices`, and `tips` arrays alongside their original orientation. Keep guidance supported by official sources. Curated community entries need a topic-specific purpose and explicit version/evidence limits; discussion anecdotes are not exam facts. Keep item IDs stable, map objective references to the selected guide, and update review/access/compatibility metadata when checking linked sources. Objective numbers are local references in guide order, not official objective codes. Increase an item's content edition when the learning activity materially changes; never reuse a retired ID for a different topic.

Orientations and exercises are original, with synthetic inline examples. Linked material remains its provider's property; links do not grant republication rights. Recalled or leaked live exam content is excluded. Enrollment, charges, availability, and policies on external websites are governed by those providers.

## Publish on GitHub Pages

The supplied workflow runs checks on pull requests and pushes. Publication runs only from the repository's actual default branch, after checks pass, or from a manual run on that branch. It uploads only `site/`; there is no build step.

1. Choose or create the intended GitHub repository and add the website source, tests, README, ignore file, and `.github/workflows/pages.yml`. Review staged files before committing; keep local tooling and planning directories excluded.
2. In repository **Settings → Pages**, choose **GitHub Actions** as the publishing source. Check that the `github-pages` environment permits the intended default branch.
3. Push the reviewed change to the default branch, or run the workflow manually from it.
4. Inspect the Pages deployment record and its actual URL. Check a successful HTTP response, assets, `#item/study-messages-api`, refresh, an exercise, and local-note persistence there.

A local preview, enabled Pages setting, or green test job does not establish a successful deployment. The deployment target is `truongchanbuu/claude-developer-cert`; deployment status is available in its Actions runs and `github-pages` environment.

## Validation

On November 24, 2026, `node --test` passed 55 tests; both modules passed syntax checks. Chromium 158 checks passed roadmap/resource/exercise navigation, literal note rendering, save/reload, confirmed deletion/reset, Unicode limits, keyboard-only study-to-review flow, dirty-note navigation and browser-history cases, blocked/quota/corrupt storage handling, archived notes, edition changes, and full browser restart persistence. New learning-cycle checks cover collapsed examples/earlier notes, comparison before rating, scheduled/due returns, and preservation of old saved data and draft notes. All four main views fit a 360-pixel viewport without page overflow. Nested-path direct links and refresh work locally.

Local throttled preview: approximately 200 ms load at 10 Mbps with 40 ms simulated latency; a status change took under 1 ms on the validation machine. Static files total approximately 111 KiB, including the optional learning-methods page. These local measurements are not a Pages performance guarantee.

Firefox/Safari checks and an unaided walkthrough with the intended learner remain pending. Check the repository’s Actions run and Pages deployment record for hosted release status.
