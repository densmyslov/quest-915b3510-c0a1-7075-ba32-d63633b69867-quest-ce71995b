/* eslint-disable @typescript-eslint/no-require-imports */
const { execSync } = require('child_process');

// --- Configuration ---

// Mapping of source files/directories to Playwright spec files.
// Rules are processed in order. First match wins (or we can accumulate, but simple mapping is usually safer).
// If a file matches multiple, we can run all related tests.
const dependencyMap = [
    { pattern: /^src\/app\/page\.tsx/, tests: ['e2e/landing.spec.ts'] },
    { pattern: /^src\/components\/landing\//, tests: ['e2e/landing.spec.ts'] },
    { pattern: /^src\/app\/map\//, tests: ['e2e/map.spec.ts'] },
    { pattern: /^src\/components\/QuestMap\.tsx/, tests: ['e2e/map.spec.ts'] },
    { pattern: /^src\/components\/map\//, tests: ['e2e/map.spec.ts'] },

    // Puzzle specific mappings
    // If we can map specific puzzles to specific specs, great.
    // For now, let's map generic puzzle components to all puzzle specs to be safe/broad.
    { pattern: /^src\/app\/puzzle\//, tests: ['e2e/steps-mode-puzzle.spec.ts', 'e2e/witch-knot-simple.spec.ts', 'e2e/mozaic-play.spec.ts'] },
    { pattern: /^src\/components\/puzzle\//, tests: ['e2e/steps-mode-puzzle.spec.ts', 'e2e/witch-knot-simple.spec.ts', 'e2e/mozaic-play.spec.ts'] },

    // Data changes - strictly affect everything? 
    // Usually quest.json affects the whole app flow.
    { pattern: /^src\/data\/quest\.json/, tests: ['ALL'] },

    // Core libs - safe to run all
    { pattern: /^src\/lib\//, tests: ['ALL'] },
    { pattern: /^src\/context\//, tests: ['ALL'] }, // Context changes likely affect many things

    // Config files
    { pattern: /^playwright\.config\.ts/, tests: ['ALL'] },
    { pattern: /^package\.json/, tests: ['ALL'] },
    { pattern: /^next\.config\.ts/, tests: ['ALL'] },
    { pattern: /^src\/globals\.css/, tests: ['e2e/landing.spec.ts', 'e2e/map.spec.ts'] }, // Global styles change visual regression risk

    // CI & Scripts
    { pattern: /^\.github\//, tests: ['ALL'] },
    { pattern: /^scripts\//, tests: ['ALL'] }
];

// Fallback for anything not matched?
// If a file is in `src/` but not matched above, we might want to run ALL or warn.
// For safety, let's default to ALL if it looks like source code.
const catchAllPattern = /^src\//;

// --- Helper Functions ---

function getChangedFiles() {
    try {
        // In GitHub Actions, we need to compare against the target branch (usually main or dev).
        // GITHUB_BASE_REF is set for PRs.
        // For partial checkouts or push events, it might be trickier.
        // We generally assume `origin/main` is the base if not in a PR.

        const baseRef = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main';
        const headRef = process.env.GITHUB_SHA || 'HEAD';

        console.log(`Analyzing changes between ${baseRef} and ${headRef}...`);

        // Ensure we have the base ref fetched (in CI this is handled by checkout action usually)
        // execSync(`git fetch origin ${process.env.GITHUB_BASE_REF || 'main'}`); 

        const diffCommand = `git diff --name-only ${baseRef} ${headRef}`;
        const output = execSync(diffCommand, { encoding: 'utf-8' });
        return output.split('\n').filter(line => line.trim() !== '');
    } catch (error) {
        console.error('Error getting changed files:', error.message);
        // Fallback to running all tests if git fails
        return null;
    }
}

function determineTestsToRun(changedFiles) {
    if (!changedFiles) return 'ALL';

    const testsToRun = new Set();

    console.log('Changed files:', changedFiles);

    for (const file of changedFiles) {
        let matched = false;

        // 1. Check explicit maps
        for (const rule of dependencyMap) {
            if (rule.pattern.test(file)) {
                matched = true;
                if (rule.tests.includes('ALL')) return 'ALL';
                rule.tests.forEach(t => testsToRun.add(t));
            }
        }

        // 2. Check catch-all for source code
        if (!matched && catchAllPattern.test(file)) {
            console.log(`File ${file} matched catch-all pattern -> Running ALL tests.`);
            return 'ALL';
        }
    }

    return Array.from(testsToRun);
}

// --- Main Execution ---

function main() {
    // 1. Get Changes
    const changedFiles = getChangedFiles();

    // 2. Determine Tests
    const tests = determineTestsToRun(changedFiles);

    // 3. Execute
    if (tests === 'ALL') {
        console.log('Running ALL tests.');
        if (process.env.DRY_RUN) return;
        execSync('npx playwright test', { stdio: 'inherit' });
    } else if (tests.length === 0) {
        console.log('No relevant source changes detected. Skipping E2E tests.');
    } else {
        console.log(`Running specific tests: ${tests.join(', ')}`);
        if (process.env.DRY_RUN) return;
        const testCommand = `npx playwright test ${tests.join(' ')}`;
        execSync(testCommand, { stdio: 'inherit' });
    }
}

main();
