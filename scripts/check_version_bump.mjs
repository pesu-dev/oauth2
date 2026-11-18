#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parseSemver(v) {
  const match = SEMVER_RE.exec(String(v).trim());
  if (!match) {
    throw new Error(`Invalid SemVer string: "${v}". Expected format: MAJOR.MINOR.PATCH (e.g. 1.2.3)`);
  }
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] ?? null,
  };
}

export function isGreaterThan(a, b) {
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  if (a.patch !== b.patch) return a.patch > b.patch;
  if (b.prerelease && !a.prerelease) return true;
  if (!b.prerelease && a.prerelease) return false;
  if (a.prerelease && b.prerelease) {
    return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true }) > 0;
  }
  return false;
}

export function runCheck(options = {}) {
  const eventName = options.eventName || process.env.EVENT_NAME || process.env.GITHUB_EVENT_NAME || 'local';
  const baseRef = options.baseRef || process.env.BASE_REF || process.env.GITHUB_BASE_REF || 'main';
  const beforeSha = options.beforeSha || process.env.BEFORE_SHA;

  let basePkgRaw = null;
  let baseSource = '';

  // 1. In 'push' events, compare against the commit before the push
  if (eventName === 'push') {
    const ZERO_SHA = '0000000000000000000000000000000000000000';
    if (beforeSha && beforeSha !== ZERO_SHA) {
      try {
        basePkgRaw = execSync(`git show ${beforeSha}:package.json`, {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        baseSource = `commit before push (${beforeSha.slice(0, 7)})`;
      } catch {
        try {
          execSync(`git fetch origin ${beforeSha} --depth=1`, { stdio: 'pipe' });
          basePkgRaw = execSync(`git show ${beforeSha}:package.json`, {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          baseSource = `commit before push (${beforeSha.slice(0, 7)})`;
        } catch {
          // Fall back to HEAD~1
        }
      }
    }

    if (!basePkgRaw) {
      try {
        basePkgRaw = execSync('git show HEAD~1:package.json', {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        baseSource = 'previous commit (HEAD~1)';
      } catch {
        // Fall back to origin/main or baseRef
      }
    }
  }

  // 2. In 'pull_request', 'merge_group', or fallback: compare against the target base branch
  if (!basePkgRaw) {
    if (options.fetchBaseRef !== false) {
      try {
        execSync(`git fetch origin ${baseRef} --depth=1`, { stdio: 'pipe' });
      } catch {
        // Ignore fetch error if offline or already fetched
      }
    }

    const candidates = [`origin/${baseRef}`, baseRef, 'origin/main', 'main'];
    for (const ref of candidates) {
      try {
        basePkgRaw = execSync(`git show ${ref}:package.json`, {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        baseSource = `${ref}`;
        break;
      } catch {
        // Try next candidate
      }
    }
  }

  if (!basePkgRaw) {
    throw new Error(`Could not read package.json from base reference (event=${eventName}, baseRef=${baseRef}).`);
  }

  const basePkg = JSON.parse(basePkgRaw);
  const headPkg = options.headPkg || JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

  const baseVer = parseSemver(basePkg.version);
  const headVer = parseSemver(headPkg.version);

  if (!isGreaterThan(headVer, baseVer)) {
    return {
      success: false,
      baseVersion: basePkg.version,
      headVersion: headPkg.version,
      baseSource,
      eventName,
    };
  }

  return {
    success: true,
    baseVersion: basePkg.version,
    headVersion: headPkg.version,
    baseSource,
    eventName,
  };
}

// Only execute when run directly from CLI
if (process.argv[1] && process.argv[1].endsWith('check_version_bump.mjs')) {
  try {
    const result = runCheck();
    if (!result.success) {
      console.error('\n❌ Version bump check failed!');
      console.error(`   Event:        ${result.eventName}`);
      console.error(`   Base (${result.baseSource}): v${result.baseVersion}`);
      console.error(`   Current:      v${result.headVersion}\n`);
      console.error('Every pull request, merge queue run, and push to main must have a bumped version in package.json.');
      console.error('Run one of the following before pushing:');
      console.error('  pnpm version patch   # for bug fixes and small changes');
      console.error('  pnpm version minor   # for new features');
      console.error('  pnpm version major   # for breaking changes\n');
      process.exit(1);
    }

    console.log(`✅ Version bump check passed: v${result.baseVersion} -> v${result.headVersion} [${result.eventName}]`);
    process.exit(0);
  } catch (err) {
    console.error(`❌ Version bump check error: ${err.message}`);
    process.exit(1);
  }
}
