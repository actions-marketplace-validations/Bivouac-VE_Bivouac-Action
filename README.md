# Bivouac — dependency-update checks for GitHub pull requests

> Know what a dependency bump will break before you merge it.

`bivouac-action` is a free, open-source GitHub Action. When a Dependabot,
Renovate, Snyk or manual PR bumps a dependency, it checks each bumped package
for known CVEs and for breaking changes in the upstream release notes, then
posts one PR comment summarising what it found. No account and no API key —
just your `GITHUB_TOKEN`.

The Action is the **Investigate** step of Bivouac's wider remediation workflow.
Opening fixes, running your tests and merging are part of the hosted Bivouac
product at [getbivouac.com](https://getbivouac.com) and are **not** performed
by this Action.

## What you get on a pull request

![Example bivouac-action comment on a dependency-bump pull request](https://raw.githubusercontent.com/Bivouac-VE/Bivouac-Action/main/docs/pr-comment.png)

_Excerpt of a real comment on a PR bumping axios, lodash, minimist and express._

## How it works

Bivouac's workflow has four steps. This Action performs **Investigate**. Fix,
Test and Merge describe the hosted Bivouac product and are listed here for
context — installing this Action does not enable them.

### Investigate

When a dependency-bump PR opens — from Dependabot, Renovate, Snyk, or anything
else that opens a PR — `bivouac-action` reads the `package.json` diff, matches
every bumped dependency against the
[GitHub Advisory Database](https://github.com/advisories), and walks each package's
release notes between the old and new versions. Bumps whose release notes
contain a `BREAKING`, `major:`, `removed`, or `deprecated API(s)` marker are
surfaced as quoted snippets with a link back to the upstream release. No LLM,
no third-party key beyond your `GITHUB_TOKEN`.

The action posts (or rewrites in place) a single PR comment summarising the
findings, and — when any breaking-change signal fires — splices a warning block
into the PR description so it's visible to reviewers before the merge button is
ever clicked.

### Fix _(hosted Bivouac product)_

Once the investigation is grounded in real findings, Bivouac opens the
remediation PR with a version-aware code change. The fix is scoped to the
specific breaking-change signals Investigate surfaced — a renamed method, a
removed API, a deprecated alias — rather than a blanket version bump.

### Test _(hosted Bivouac product)_

Bivouac runs the repository's test suite against the fix under the same policy
pack that gated the remediation PR. A failing test is a signal, not a roadblock:
Bivouac reports it with the failing assertion quoted so the next loop iteration
has a concrete target.

### Merge _(hosted Bivouac product)_

When the suite is green and your merge policy passes, the hosted product can
merge the PR, or hand it to a reviewer — your policy decides.

## Quickstart

Drop this into `.github/workflows/bivouac.yml`:

```yaml
name: Bivouac Action

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  pull-requests: write # required to post the comment
  contents: read

jobs:
  bivouac:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: Bivouac-VE/bivouac-action@v1
        with:
          github-token: ${{ github.token }}
```

Once the step is in place, every dependency-bump PR gets a Bivouac comment
listing known CVEs and breaking-change warnings for each bumped package.

## Works alongside your existing tools

Bivouac is **not** a replacement for anything already in your stack. The Action
adds a review step on top of the tools you already use:

- **Dependabot** and **Renovate** open the update PRs. Bivouac comments on
  each one with the CVEs and breaking changes for the bumped packages.
- **Snyk** flags vulnerabilities. Bivouac shows the release-note changes
  between the old and new versions so reviewers can judge the upgrade.
- **GitHub Actions** runs your CI. Bivouac runs as one more step alongside it.

Bivouac is purely additive — the open-source action is a one-step drop-in
to a workflow you already have.

## Inputs

| Name | Required | Default | Description |
| --- | --- | --- | --- |
| `github-token` | no | `${{ github.token }}` | Token used to read files and post the PR comment. |
| `comment-marker` | no | `<!-- bivouac-action -->` | Marker string used to tag and locate the posted comment. Change it to namespace the comment under a different label. |

## Outputs

| Name | Description |
| --- | --- |
| `cve-summary` | JSON array of `{ name, from, to, cves, breakingChanges }` — one entry per npm bump detected. |
| `breaking-summary` | JSON array of `{ name, from, to, breakingChanges }` — entries for bumps whose release notes contain a `BREAKING`/`major:`/`removed`/deprecated marker. |
| `breaking-change-summary` | JSON array of `{ name, from, to, findings }` — one finding per upstream breaking-change signal. Each finding carries `category`, `summary`, `migrationNote`, `version`, `url`, `markers`. Sources: `github-releases`, `changelog-md`, `major-version-diff`. |
| `comment-id` | The numeric ID of the posted (or updated) PR comment. |
| `pr-warning-count` | Number of packages with at least one breaking-change finding, surfaced on the PR description. |
| `pr-description-updated` | `"true"` if the PR body was rewritten with the warnings block, `"false"` otherwise (no findings, or update failed). |

## What Bivouac posts on your PR

The posted comment starts with the marker line, a single `## Dependency bump
CVE summary` heading, a one-line summary of how many bumps matched an
advisory or flag a breaking-change marker, and one section per bump. Each
section shows the `(from, to)` pair, the advisories the bump fixes, the
advisories that still affect the new version (with the version that clears
them), and — when applicable — a
"Breaking changes (release notes)" block. Each breaking-change entry quotes
the matched marker line and links to the upstream release:

```
**Breaking changes** (release notes):

> _"BREAKING: rename .remove to .delete; deprecated API removedForEach"_ — [release `5.0.0`](https://github.com/lodash/lodash/releases/tag/5.0.0)
> _Detected markers: BREAKING, removed, deprecated._
```

Bumps with no matching advisory render a single `_No CVEs match the new
version._` line in the table, and a bump whose release notes carry no
breaking-change marker simply has no "Breaking changes" block.

In addition to the PR comment, when any of the breaking-change signals
fires (a `BREAKING`/`major:`/`removed`/`deprecated API(s)` marker in release
notes, a corresponding block in `CHANGELOG.md`, or a major-version boundary
crossing) the Action also rewrites the PR description to append a single
warning block that names the offending package, quotes the upstream change
verbatim, and links to the source:

```
<!-- bivouac-action:pr-warnings:start -->
## ⚠️ Breaking change warnings (bivouac-action)

The following bumped packages have documented breaking changes between the old and new versions on this PR. Review before merging.

### `lodash` `4.16.0` → `5.0.0`

> [breaking] "BREAKING: rename .remove to .delete across the core tree." — [release notes (5.0.0)](https://github.com/lodash/lodash/releases/tag/5.0.0)
> _Migration:_ **use lodash.delete instead of lodash.remove**
> _Source:_ `github-releases` · _Detected markers:_ BREAKING, deprecated

> [breaking] "Major-version boundary" — [major-version-diff (5.0.0)](https://github.com/lodash/lodash/releases/tag/v5.0.0)
> _Migration:_ **Read upstream major-version diff for migration notes.**
> _Source:_ `major-version-diff` · _Detected markers:_ major

<!-- bivouac-action:pr-warnings:end -->
```

The warning block is **idempotent on PR synchronize** — re-runs replace the
previous block (spliced between the `<!-- bivouac-action:pr-warnings:start -->`
and `<!-- bivouac-action:pr-warnings:end -->` markers) rather than appending
a duplicate. Content outside those markers — including any human-written
description text — is preserved.

**Permissions.** Writing the PR description requires only the same
`pull-requests: write` scope the comment-posting step already needs;
`contents: write` is **not** required. The README's `permissions:` block in
the workflow example is sufficient out of the box.

**Best-effort.** The PR-description rewrite is best-effort: if
`pulls.update` fails (for example, the token has been revoked mid-job, the
PR is locked, or GitHub returns a transient error) the Action logs a
`core.warning`, leaves the PR description untouched, and continues the
job — `comment-id` still records the posted comment and any downstream
test-run still executes.

## CVE + breaking-change coverage

Every npm bump is checked against the reviewed advisories in the
[GitHub Advisory Database](https://github.com/advisories), for both the old and
the new version:

- **Fixed by this bump**: advisories that affected the old version but not the
  new one.
- **Still vulnerable after this bump**: advisories that still affect the new
  version, with each advisory's fixed-in version and the lowest version that
  clears all of them.

Withdrawn advisories are ignored. If the advisory database can't be reached,
the comment says so instead of reporting a false "no advisories".

Breaking-change detection walks the npm registry + GitHub Releases between
the old and new versions. Releases whose notes mention `BREAKING`/`major:`/
`removed`/`deprecated API(s)` are flagged; the entry quotes the marker line
verbatim and links to the upstream release.

## Privacy

- This Action calls the **GitHub REST API** (reading diffs + posting the
  comment) and the **public npm registry** (reading `package.json` for the
  bumped package). No Bivouac endpoint, no third-party vendor.
- Add your `GITHUB_TOKEN` and you're set — no Bivouac API key.

## Local development

```bash
npm ci
npm test          # node --test, runs test/*.test.ts
npm run typecheck # tsc --noEmit
npm run build     # @vercel/ncc → dist/index.js
```

`dist/index.js` is the file referenced by `action.yml` (`runs.main`). Rebuild
it before publishing a release.

## License

[MIT](./LICENSE).
