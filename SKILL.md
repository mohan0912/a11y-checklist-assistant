---
name: a11y-checklist-assistant
description: Enterprise-ready local web accessibility checklist workflow for Deque-style WCAG audits. Use when Codex or Copilot needs to run Playwright plus axe-core evidence capture, assess pages against WCAG versions and levels such as WCAG 2.2 AA, generate AI-ready summaries, developer remediation gaps, tester manual verification packs, and explicit N/A reasons while keeping final Pass/Fail/N/A decisions with a human tester.
---

# A11y Checklist Assistant

## Overview

Use this skill for local, engineer-run accessibility checklist verification. It does not implement CI/CD and does not certify accessibility automatically.

The production workflow is:

1. Engineer starts the application locally or opens the target environment.
2. Engineer defines one or more page states in `a11y-checklist.config.json`.
3. `scripts/a11y-checklist-assistant.js` runs Playwright evidence capture and axe-core automation.
4. The tool generates deterministic AI pre-assessments, developer gap reports, an AI prompt, and a tester re-verification pack.
5. The tester manually verifies every item and marks final `Pass`, `Fail`, or `N/A`, including items the tool says are likely implemented.

## Install Locally

From the tool folder or after copying it into a target repo:

```bash
npm install
npx playwright install chromium
```

Run a direct one-page assessment:

```bash
node scripts/a11y-checklist-assistant.js \
  --url "http://localhost:3000/login" \
  --id "login" \
  --wcag 2.2 \
  --level AA \
  --out ./a11y-reports
```

Choose the WCAG target at runtime:

```bash
# WCAG 2.2 AA
node scripts/a11y-checklist-assistant.js --url "http://localhost:3000/login" --id login --wcag 2.2 --level AA

# WCAG 2.1 AA
node scripts/a11y-checklist-assistant.js --url "http://localhost:3000/login" --id login --wcag 2.1 --level AA

# WCAG 2.0 A
node scripts/a11y-checklist-assistant.js --url "http://localhost:3000/login" --id login --wcag 2.0 --level A
```

Supported runtime targets are WCAG `2.0`, `2.1`, and `2.2` with level `A` or `AA`. The checklist is filtered at runtime so the generated reports and `ai-review-prompt.md` reflect the selected target.

Run a manual browser navigation capture:

```bash
node scripts/a11y-checklist-assistant.js \
  --manual-capture \
  --url "http://localhost:3000" \
  --id "manual-checkout-state" \
  --wcag 2.2 \
  --level AA \
  --out ./a11y-reports
```

In this mode the headed Playwright browser opens, the tester navigates manually to the exact page/state, then presses Enter in the terminal. The tool captures the current browser page after Enter is pressed.

Run an enterprise-style config:

```bash
node scripts/a11y-checklist-assistant.js --config ./a11y-checklist.config.json
```

Use the raw collector only for debugging:

```bash
node scripts/collect-accessibility-evidence.js --url "http://localhost:3000/login" --out ./debug-evidence
```

## Config File

Copy `a11y-checklist.config.example.json` to `a11y-checklist.config.json` and edit scenarios.

Core shape:

```json
{
  "target": {
    "wcag": "2.2",
    "level": "AA",
    "includeBestPractice": false
  },
  "run": {
    "headed": false,
    "timeout": 45000,
    "maxTabs": 160,
    "viewport": "1280x720",
    "manualCapture": false,
    "captureScreenshots": true,
    "captureHtml": false,
    "focusScreenshots": false,
    "captureIframes": true,
    "captureShadowDom": true,
    "captureReverseFocus": true,
    "captureVisualModes": true,
    "captureWidgetProbes": true,
    "maxWidgetProbes": 40
  },
  "reports": {
    "outputDir": "./a11y-reports",
    "formats": ["json", "md", "html", "csv"]
  },
  "scenarios": [
    {
      "id": "login-empty-submit",
      "name": "Login form empty submit validation",
      "url": "http://localhost:3000/login",
      "scenario": "./scenarios/login-empty-submit.js"
    },
    {
      "id": "manual-checkout-state",
      "name": "Manual checkout capture",
      "url": "http://localhost:3000",
      "manualCapture": true
    }
  ]
}
```

The `target` block is the default for all scenarios in that config run. CLI flags override it at runtime:

```bash
node scripts/a11y-checklist-assistant.js --config ./a11y-checklist.config.json --wcag 2.1 --level AA
```

Scenario files may export `default`, `run`, or `scenario`:

```js
module.exports = async ({ page }) => {
  await page.goto("http://localhost:3000/login");
  await page.getByRole("button", { name: /sign in|log in|submit/i }).click();
  await page.waitForLoadState("networkidle").catch(() => {});
};
```

Use `storageState` for logged-in flows. Do not hard-code credentials in scenario files.

Use `manualCapture: true` when the page state is easier to reach by hand than by scripting. A scenario can still provide a start URL; the tester can then navigate, authenticate, open menus/dialogs, trigger errors, or select records manually before pressing Enter in the terminal.

## Output Files

For each scenario, the tool writes:

```text
evidence.json                    Full structured evidence for AI and traceability.
checklist-results.json           Deterministic checklist pre-assessment.
summary.md                       Executive summary and N/A candidates.
developer-gaps.md                Developer remediation-focused findings.
manual-verification-pack.md      Step-by-step tester Pass/Fail/N/A workflow.
manual-results.csv               Spreadsheet-friendly human verification tracker.
report.html                      Local HTML review report.
ai-review-prompt.md              Prompt for Copilot or another AI reviewer.
accessibility-tree.json          Playwright accessibility snapshot.
axe-results.json                 axe-core raw results.
focus-order.json                 Tab sequence evidence.
reverse-focus-order.json         Shift+Tab sequence evidence.
frame-evidence.json              Nested iframe/frame inventories and frame axe summaries.
visual-modes.json                Zoom, text-spacing, forced-colors, and reduced-motion screenshots/overflow metrics.
widget-probes.json               Lightweight arrow/Escape widget keyboard probe outcomes.
screenshots/                     Optional visual evidence.
page.html                        Optional captured HTML when enabled.
```

At the report root:

```text
aggregate-summary.md
aggregate-summary.json
```

## Assessment Model

The tool uses AI/pre-review states only:

```text
Evidence supports implementation
Evidence suggests gap
Needs manual verification
N/A candidate
Blocked or insufficient evidence
```

Human final states are separate:

```text
Pass
Fail
N/A
Not tested
```

Never convert an AI assessment into final Pass. The tester must verify implemented, likely implemented, failed, and N/A candidate items.

## AI Prompt Contents

`ai-review-prompt.md` must include:

- Deque Web Accessibility Checklist source link
- WCAG target version and level
- required evidence files
- AI review rules
- requested output structure
- every included checkpoint from the checklist map
- each checkpoint's topic, requirement, WCAG criteria, level, test mode, evidence signals, current AI pre-assessment, known gaps, recommended fix, manual steps, pass criteria, fail criteria, N/A criteria, and pending human result

This makes the prompt self-contained for Copilot while still asking it to inspect the underlying evidence files.

## Enhanced Evidence

The collector captures the following high-value evidence when enabled:

```text
captureIframes       Scans nested frames where Playwright can access them; records frame inventory and frame axe findings.
captureShadowDom     Traverses open shadow roots; closed shadow roots remain manual/component-review candidates.
captureReverseFocus  Captures Shift+Tab order in addition to forward Tab order.
captureVisualModes   Captures CSS zoom 200%, WCAG text-spacing stress, forced-colors, and reduced-motion evidence.
captureWidgetProbes  Performs lightweight ArrowDown/Escape probes on ARIA widgets and records state/focus changes.
```

Interpretation rules:

- Treat iframe evidence as part of the same page state when the iframe is user-facing.
- Treat frame access errors as `Needs manual verification`, not an automatic failure.
- Treat open shadow-root findings like normal DOM findings.
- Treat custom elements without open shadow roots as component-review candidates.
- Treat visual-mode overflow as a manual-review risk unless the evidence clearly maps to lost content/functionality.
- Treat widget probes as clues only. They do not replace full keyboard pattern testing with Tab, Shift+Tab, Enter, Space, Escape, and arrow keys.
- Do not use automated Enter/Space activation on arbitrary controls because it can submit forms or trigger destructive actions.

## Checklist Mapping

Use `references/deque-web-checklist-map.json` as the checklist reference. It is a structured, paraphrased Deque/WCAG map containing:

- checklist topic and requirement
- WCAG success criterion, version introduced, and level
- automated, hybrid, AI-assisted, or manual test mode
- evidence signals from `evidence.json`
- manual verification steps
- pass criteria
- N/A criteria

Filtering rules:

1. Include criteria introduced in or before the requested WCAG version.
2. For AA, include A and AA criteria.
3. Include `Multiple` or `Depends` rows when related page evidence exists or the user says the feature exists.
4. Include best practices only when requested.

## Manual Verification Rules

For every checklist item, produce or preserve:

```text
AI assessment:
Human final result: Pending
Manual steps:
Pass criteria:
Fail criteria:
N/A criteria:
Tester notes:
```

Tester guidance:

1. Start from the exact scenario state captured by Playwright.
2. Use the selectors, visible names, screenshots, focus order, accessibility tree, and axe evidence.
3. Execute the manual steps.
4. Mark exactly one final result: `Pass`, `Fail`, or `N/A`.
5. For `N/A`, write a specific page-state reason.

Good N/A reasons:

```text
No audio, video, animation, motion, or timed content exists in this page state.
No form fields or user input controls exist in this page state.
No iframe/frame elements exist in this page state.
No CAPTCHA or human verification challenge is present.
No custom ARIA widget pattern is present; all controls are native HTML controls.
```

Bad N/A reasons:

```text
Not found.
Tool did not report anything.
Looks fine.
```

## Enterprise Controls

Privacy defaults:

- Input values are not captured; evidence records whether values are present.
- `captureHtml` defaults to false in the production wrapper.
- Screenshots can be disabled with `captureScreenshots: false` or `--no-screenshots`.
- Focus screenshots are disabled unless explicitly requested.
- Deep captures can be disabled with `captureIframes`, `captureShadowDom`, `captureReverseFocus`, `captureVisualModes`, and `captureWidgetProbes`.
- All reports are written locally; the tool does not call an AI API.

Operational guidance:

- Use scenarios for logged-in, modal, validation, expanded-menu, and dynamic-content states.
- Create separate scenarios for each meaningful page state, not just each URL.
- Keep screenshots/HTML disabled for sensitive states unless the team has approval.
- Use `manual-results.csv` as the human sign-off tracker.
- Use `developer-gaps.md` to create tickets after tester confirmation.

## Report Review Order

Use this order when helping a user interpret results:

1. `aggregate-summary.md`
2. Per-scenario `summary.md`
3. Per-scenario `developer-gaps.md`
4. Per-scenario `manual-verification-pack.md`
5. `checklist-results.json` and raw evidence for detailed disputes

When writing a final accessibility summary, state clearly that the tool produced pre-assessments and that final conformance depends on human verification.
