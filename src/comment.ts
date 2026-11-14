import semver from 'semver';
import { COMMENT_MARKER } from './state';
import type {
  BreakingChangeCategory,
  BreakingChangeFinding,
  BumpResult,
  VulnerabilityRef,
} from './types';

function advisoryCell(c: VulnerabilityRef): string {
  return c.url ? `[\`${c.id}\`](${c.url})` : `\`${c.id}\``;
}

function cleanSummary(summary: string): string {
  const s = summary.replace(/\|/g, '\\|');
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
}

const TOP_ROWS = 5;

function cveRow(c: VulnerabilityRef): string {
  const aliases = c.aliases.length > 0 ? c.aliases.map((a) => `\`${a}\``).join(', ') : '—';
  const fixed = c.fixedVersions.length > 0 ? c.fixedVersions.map((v) => `\`${v}\``).join(', ') : 'no fix yet';
  return `| ${advisoryCell(c)} | ${c.severity} | ${aliases} | ${fixed} | ${cleanSummary(c.summary)} |`;
}

function cveTable(rows: VulnerabilityRef[]): string[] {
  return [
    '| Advisory | Severity | CVE | Fixed in | Summary |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map(cveRow),
  ];
}

/**
 * Smallest version on the same major line as `to` that is at or above every
 * advisory's patched version — i.e. the upgrade that clears them all. Returns
 * null when an advisory has no fix on that line (or none at all).
 */
export function clearingVersion(to: string, cves: VulnerabilityRef[]): string | null {
  const cur = semver.valid(to);
  if (!cur || cves.length === 0) return null;
  const majorOf = (v: string): number => semver.parse(v)?.major ?? -1;
  const cmp = (a: string, b: string): number => (semver.gt(a, b) ? 1 : semver.lt(a, b) ? -1 : 0);
  const major = majorOf(cur);
  let best: string | null = null;
  for (const c of cves) {
    const candidates = c.fixedVersions
      .map((v) => semver.valid(v))
      .filter((v): v is string => !!v && semver.gt(v, cur));
    const sameLine = candidates.filter((v) => majorOf(v) === major).sort(cmp);
    const pick = sameLine[0] ?? candidates.sort(cmp)[0];
    if (!pick) return null;
    if (!best || semver.gt(pick, best)) best = pick;
  }
  return best;
}

function renderCveTable(result: BumpResult): string {
  const { cves, advisoryLookupFailed } = result;
  if (advisoryLookupFailed) {
    return '_Could not reach the GitHub Advisory Database for this bump; advisories were not checked._';
  }
  if (cves.length === 0) return '_No known advisories affect the new version._';
  const lines: string[] = [];
  lines.push(`**Still vulnerable after this bump** (${cves.length} advisory(ies)):`);
  const clear = clearingVersion(result.bump.to, cves);
  if (clear) {
    lines.push('');
    lines.push(`_Upgrading to \`${clear}\` or later clears all of them._`);
  }
  lines.push('');
  if (cves.length <= TOP_ROWS) {
    lines.push(...cveTable(cves));
    return lines.join('\n');
  }
  lines.push(...cveTable(cves.slice(0, TOP_ROWS)));
  lines.push('');
  lines.push('<details>');
  lines.push(`<summary>Show ${cves.length - TOP_ROWS} more</summary>`);
  lines.push('');
  lines.push(...cveTable(cves.slice(TOP_ROWS)));
  lines.push('');
  lines.push('</details>');
  return lines.join('\n');
}

function renderFixes(fixes: VulnerabilityRef[]): string {
  if (fixes.length === 0) return '';
  const lines: string[] = [];
  lines.push(`**Fixed by this bump** (${fixes.length} advisory(ies)):`);
  lines.push('');
  for (const c of fixes) {
    const cve = c.aliases.length > 0 ? ` (${c.aliases.join(', ')})` : '';
    lines.push(`- ${advisoryCell(c)}${cve} · ${c.severity} · ${cleanSummary(c.summary)}`);
  }
  return lines.join('\n');
}

function categoryTag(category: BreakingChangeCategory): string {
  switch (category) {
    case 'removed':
      return '[removed]';
    case 'renamed':
      return '[renamed]';
    case 'behavior':
      return '[breaking]';
    case 'deprecated':
      return '[deprecated]';
  }
}

function renderBreakingChanges(findings: BreakingChangeFinding[]): string {
  // Bucket findings by source so each upstream signal gets its own stanza with
  // a descriptive header. Order: release-notes, CHANGELOG.md, major-version-diff.
  const order: Array<'github-releases' | 'changelog-md' | 'major-version-diff'> = [
    'github-releases',
    'changelog-md',
    'major-version-diff',
  ];
  const headers: Record<(typeof order)[number], string> = {
    'github-releases': 'Release notes',
    'changelog-md': 'CHANGELOG.md',
    'major-version-diff': 'Major-version diff',
  };

  const lines: string[] = [];
  const totalFindings = findings.length;
  if (totalFindings > 0) {
    lines.push(`**Breaking changes** (${totalFindings} finding(s) flagged):`);
    lines.push('');
  }

  for (const source of order) {
    const group = findings.filter((f) => f.source === source);
    if (group.length === 0) continue;
    lines.push(`**Breaking changes** (${headers[source]}):`);
    lines.push('');
    for (const f of group) {
      const tag = categoryTag(f.category);
      const summary = f.summary.length > 0 ? f.summary : `_marker: ${f.markers.join(', ')}_`;
      lines.push(`> ${tag} \`${f.version}\` — "${summary}" — [link](${f.url})`);
      lines.push(`> _Migration:_ **${f.migrationNote}**`);
      if (f.markers.length > 0) {
        lines.push(`> _Detected markers: ${f.markers.join(', ')}._`);
      }
      // Blank line so each finding is its own quote block and the next
      // heading is not swallowed into the quote.
      lines.push('');
    }
  }
  return lines.join('\n');
}

function summaryLine(results: BumpResult[]): string {
  let withCves = 0;
  let fixedCount = 0;
  let withBreaking = 0;
  let totalFindings = 0;
  for (const r of results) {
    if (r.cves.length > 0) withCves += 1;
    fixedCount += r.fixes?.length ?? 0;
    if (r.breakingChanges.length > 0) withBreaking += 1;
    totalFindings += r.breakingChanges.length;
  }
  const total = results.length;
  const noun = total === 1 ? 'bump' : 'bumps';
  const findingNoun = totalFindings === 1 ? 'finding' : 'findings';
  return `**${total} ${noun} analysed · ${fixedCount} advisory(ies) fixed · ${withCves} still vulnerable · ${withBreaking} flag breaking changes · ${totalFindings} ${findingNoun}.**`;
}

function renderBumpSection(result: BumpResult): string {
  const { bump, breakingChanges } = result;
  const lines: string[] = [];
  lines.push(`### \`${bump.name}\` \`${bump.from}\` → \`${bump.to}\``);
  lines.push('');
  const fixed = renderFixes(result.fixes ?? []);
  if (fixed) {
    lines.push(fixed);
    lines.push('');
  }
  lines.push(renderCveTable(result));
  if (breakingChanges.length > 0) {
    lines.push('');
    lines.push(renderBreakingChanges(breakingChanges));
    lines.push('');
    lines.push('_Full quoted snippets are mirrored to the PR description by bivouac-action._');
  }
  return lines.join('\n');
}

export function renderComment(results: BumpResult[]): string {
  const lines: string[] = [];
  lines.push(COMMENT_MARKER);
  lines.push('## Dependency bump CVE summary');
  lines.push('');
  lines.push('_Advisories from the [GitHub Advisory Database](https://github.com/advisories); breaking changes from upstream release notes._');
  lines.push('');
  if (results.length === 0) {
    lines.push('_No dependency bumps detected in the PR._');
    lines.push('');
    return lines.join('\n');
  }
  lines.push(summaryLine(results));
  lines.push('');
  for (const r of results) {
    lines.push(renderBumpSection(r));
    lines.push('');
  }
  return lines.join('\n');
}
