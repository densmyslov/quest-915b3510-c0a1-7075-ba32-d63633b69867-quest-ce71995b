# Local Testing & Quality Control

This guide describes the testing and quality control workflows for the `quest-app-template` codebase.

## Quick Start

Before committing your code, run:

```bash
npm test
```

This command runs all critical checks:
1.  **Type Checking** (`tsc`)
2.  **Logic Tests** (`validateQuestData`)
3.  **State Tests** (`quest-state.test.ts`)
4.  **Math Tests** (`coordinates.test.ts`)

---

## Available Commands

### 1. Type Checking (TypeScript)

To check for TypeScript errors (type mismatches, missing properties, etc.) without running the full test suite:

```bash
npm run type-check
```

*Note: This runs `tsc --noEmit`. It is fast and should be your first step when debugging errors.*

### 2. Full Test Suite

The primary test command runs `type-check` followed by the runtime unit tests:

```bash
npm test
```

### 3. End-to-End Tests (Playwright)

To run the full end-to-end browser automation tests:

```bash
npm run test:e2e
```

---

## Pre-Commit Hooks

This project uses `pre-commit` to ensure code quality **automatically** when you run `git commit`.

The following hooks run on every commit:

1.  **Format Checks**:
    - `check-yaml`: Validates YAML syntax
    - `check-json`: Validates JSON syntax
    - `trim-trailing-whitespace`: Removes trailing spaces
    - `end-of-file-fixer`: Ensures files end with a newline

2.  **Linting**:
    - `eslint`: Checks for code style and best practices

3.  **Tests**:
    - `unit-tests`: Runs `npm test` (which includes `type-check`)

### What if a hook fails?

- **Formatting Hooks**: Often, hooks like `end-of-file-fixer` will **auto-fix** the file for you.
  - **Action**: Simply run `git add <file>` to stage the fix, then `git commit` again.

- **Test/Lint Hooks**: If `eslint` or `unit-tests` fail, the commit is blocked.
  - **Action**: Fix the errors shown in the output, verify with `npm test`, then `git add` and `git commit` again.

---

## Continuous Integration (CI)

Our CI pipeline (Vercel / GitHub Actions) runs the same checks. Explicitly running `npm test` locally ensures that your PRs will not fail due to trivial errors.
