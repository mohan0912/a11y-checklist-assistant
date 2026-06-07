# A11y Checklist Assistant

A11y Checklist Assistant is a local, engineer-run accessibility evidence and checklist assistant for web pages. It uses Playwright and axe-core to capture repeatable evidence, maps that evidence to a Deque/WCAG-style checklist, generates Copilot-ready analysis prompts, and produces human tester verification packs.

The tool does not certify accessibility automatically. It helps testers and developers move faster by collecting evidence, pre-filling likely findings, documenting N/A candidates, and generating step-by-step manual verification instructions. A human tester still makes the final `Pass`, `Fail`, or `N/A` decision for every checkpoint.

Primary references:

- Deque Web Accessibility Checklist: https://dequeuniversity.com/checklists/web/
- Deque WCAG 2.2 AA PDF: https://media.dequeuniversity.com/en/docs/web-accessibility-checklist-wcag-2.2.pdf

The bundled checklist map is a structured, paraphrased Deque/WCAG-oriented checklist map. It is not a verbatim copy of the Deque checklist.

## What This Tool Does

The tool captures evidence from a page or page state:

- Page URL, title, language, viewport metadata
- DOM inventory
- axe-core automated results
- headings, landmarks, links, buttons, controls
- forms, labels, required state, disabled state, error associations
- images, SVG, canvas, background images
- tables and table header signals
- iframes and same-origin frame evidence where available
- media elements
- dialogs, live regions, ARIA widgets
- open shadow DOM evidence
- custom-element candidates
- forward `Tab` focus order
- reverse `Shift+Tab` focus order
- responsive screenshots
- optional full page screenshots
- optional captured HTML
- visual stress mode evidence:
  - CSS zoom 200%
  - WCAG text-spacing stress
  - forced colors
  - reduced motion
- lightweight widget probes:
  - focus widget
  - try `ArrowDown`
  - try `Escape`
  - record state/focus changes

It then generates:

- AI/Copilot review prompt
- deterministic checklist pre-assessment
- developer remediation gap report
- manual tester verification pack
- N/A candidate reasons
- HTML report
- CSV tracker for human final results
- aggregate summary across scenarios

## What This Tool Does Not Do

The tool does not replace manual accessibility testing.

It cannot fully determine:

- actual NVDA, JAWS, or VoiceOver spoken output
- whether alt text is truly meaningful in product context
- whether reading order feels intuitive
- whether content is cognitively accessible
- media caption or audio-description quality
- correctness of product-specific language
- all custom widget behavior
- all authenticated or multi-step flows unless scenarios or manual capture reach those states

Treat the tool as an evidence collector and checklist assistant, not as an accessibility certification engine.

## Folder Structure

```text
a11y-checklist-assistant/
  README.md
  package.json
  a11y-checklist.config.example.json
  SKILL.md
  agents/
    openai.yaml
  references/
    deque-web-checklist-map.json
  scenarios/
    example-login-empty-submit.js
  scripts/
    a11y-checklist-assistant.js
    collect-accessibility-evidence.js
```

Important files:

- `scripts/a11y-checklist-assistant.js`: production wrapper CLI
- `scripts/collect-accessibility-evidence.js`: lower-level evidence collector
- `references/deque-web-checklist-map.json`: structured checklist map
- `a11y-checklist.config.example.json`: example config for multi-scenario runs
- `SKILL.md`: Codex skill instructions

## Install

From the tool folder:

```bash
npm install
npx playwright install chromium
```

On Windows PowerShell:

```powershell
npm install
npx playwright install chromium
```

Verify:

```bash
npm run check
```

Expected result:

```text
node --check scripts/a11y-checklist-assistant.js
node --check scripts/collect-accessibility-evidence.js
```

No syntax errors should be reported.

## Basic Direct URL Run

Use this when the page can be opened directly by URL.

```bash
node scripts/a11y-checklist-assistant.js \
  --url "http://localhost:3000/login" \
  --id "login-page" \
  --wcag 2.2 \
  --level AA \
  --out ./a11y-reports
```

Windows PowerShell:

```powershell
node scripts/a11y-checklist-assistant.js `
  --url "http://localhost:3000/login" `
  --id "login-page" `
  --wcag 2.2 `
  --level AA `
  --out ./a11y-reports
```

Output folder:

```text
a11y-reports/login-page/
```

## Manual Browser Capture

Use this when the tester needs to navigate manually in the Playwright browser before capture.

This is useful for:

- pages behind login
- pages reached through complex navigation
- modal/dialog states
- expanded menus
- validation error states
- selected records
- tabs/accordions/carousels in a specific state
- flows that are hard or risky to script

Run:

```bash
node scripts/a11y-checklist-assistant.js \
  --manual-capture \
  --url "http://localhost:3000" \
  --id "manual-checkout-state" \
  --wcag 2.2 \
  --level AA \
  --out ./a11y-reports
```

What happens:

1. Playwright opens a headed browser.
2. The tester manually navigates to the target page/state.
3. The tester opens menus, dialogs, errors, expanded panels, or selected records as needed.
4. The tester returns to the terminal.
5. The tester presses `Enter`.
6. The tool captures the current browser page.
7. Reports are generated.

The manual capture command still writes the same report files as a direct URL run.

## Scripted Scenario Capture

Use a scenario file when the state can be reliably scripted.

Example:

```js
// scenarios/login-empty-submit.js
module.exports = async ({ page }) => {
  await page.goto("http://localhost:3000/login");
  await page.getByRole("button", { name: /sign in|log in|submit/i }).click();
  await page.waitForLoadState("networkidle").catch(() => {});
};
```

Run:

```bash
node scripts/a11y-checklist-assistant.js \
  --scenario ./scenarios/login-empty-submit.js \
  --id "login-empty-submit" \
  --wcag 2.2 \
  --level AA \
  --out ./a11y-reports
```

Scenario files may export:

- `module.exports = async ({ page }) => {}`
- `exports.run = async ({ page }) => {}`
- `exports.scenario = async ({ page }) => {}`
- ESM `default` export

The scenario receives:

```js
{
  page,
  context,
  browser
}
```

Do not hard-code credentials in scenario files. Use Playwright storage state for authenticated flows.

## Logged-In Flows

Create a Playwright storage state separately, then pass it to the tool:

```bash
node scripts/a11y-checklist-assistant.js \
  --url "http://localhost:3000/account" \
  --id "account-page" \
  --storage-state ./auth/customer-storage-state.json \
  --wcag 2.2 \
  --level AA \
  --out ./a11y-reports
```

In config:

```json
{
  "id": "account-page",
  "name": "Account page",
  "url": "http://localhost:3000/account",
  "storageState": "./auth/customer-storage-state.json"
}
```

## Config-Driven Runs

Copy:

```text
a11y-checklist.config.example.json
```

to:

```text
a11y-checklist.config.json
```

Example:

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
      "id": "manual-current-page",
      "name": "Manual browser navigation capture",
      "manualCapture": true,
      "url": "http://localhost:3000",
      "notes": "Tool opens the browser at the start URL; tester navigates manually and presses Enter in the terminal to capture."
    },
    {
      "id": "login-empty-submit",
      "name": "Login form empty submit validation",
      "url": "http://localhost:3000/login",
      "scenario": "./scenarios/example-login-empty-submit.js",
      "notes": "Navigate to login, submit empty form, and capture validation state."
    }
  ]
}
```

Run:

```bash
node scripts/a11y-checklist-assistant.js --config ./a11y-checklist.config.json
```

The config target applies to all scenarios unless overridden by CLI flags.

## Runtime WCAG Target Selection

The user decides the WCAG target at runtime.

Supported versions:

```text
2.0
2.1
2.2
```

Supported levels:

```text
A
AA
```

Examples:

```bash
# WCAG 2.2 AA
node scripts/a11y-checklist-assistant.js --url "http://localhost:3000/login" --id login --wcag 2.2 --level AA

# WCAG 2.1 AA
node scripts/a11y-checklist-assistant.js --url "http://localhost:3000/login" --id login --wcag 2.1 --level AA

# WCAG 2.0 A
node scripts/a11y-checklist-assistant.js --url "http://localhost:3000/login" --id login --wcag 2.0 --level A
```

CLI flags override config:

```bash
node scripts/a11y-checklist-assistant.js \
  --config ./a11y-checklist.config.json \
  --wcag 2.1 \
  --level AA
```

The checklist is filtered at runtime:

- WCAG 2.0 includes items introduced in 2.0.
- WCAG 2.1 includes items introduced in 2.0 and 2.1.
- WCAG 2.2 includes items introduced in 2.0, 2.1, and 2.2.
- Level A includes A items.
- Level AA includes A and AA items.

AAA is not currently supported because the bundled checklist map contains A and AA rows only.

## Output Files

For each scenario:

```text
evidence.json
checklist-results.json
summary.md
developer-gaps.md
manual-verification-pack.md
manual-results.csv
report.html
ai-review-prompt.md
accessibility-tree.json
axe-results.json
focus-order.json
reverse-focus-order.json
frame-evidence.json
visual-modes.json
widget-probes.json
manual-verification-template.md
page.html                  optional, only when HTML capture is enabled
screenshots/               optional, only when screenshots are enabled
```

At the root output folder:

```text
aggregate-summary.md
aggregate-summary.json
```

## Most Important Reports

Read these first:

```text
aggregate-summary.md
<scenario>/summary.md
<scenario>/report.html
<scenario>/developer-gaps.md
<scenario>/manual-verification-pack.md
<scenario>/ai-review-prompt.md
```

Use JSON when Copilot or another tool needs structured evidence:

```text
<scenario>/evidence.json
<scenario>/checklist-results.json
<scenario>/axe-results.json
<scenario>/focus-order.json
<scenario>/reverse-focus-order.json
<scenario>/visual-modes.json
```

## AI Assessment States

The tool uses AI/pre-review states only:

```text
Evidence supports implementation
Evidence suggests gap
Needs manual verification
N/A candidate
Blocked or insufficient evidence
```

These are not final audit results.

## Human Final States

Only the tester should mark:

```text
Pass
Fail
N/A
Not tested
```

Every item must remain:

```text
Human final result: Pending
```

until a human tester verifies it.

The tester must re-verify all categories:

- items that look implemented
- items that likely fail
- manual-only items
- N/A candidates

## How To Work With Copilot

Give Copilot the full scenario report folder when possible.

Example folder:

```text
a11y-reports/login-empty-submit/
```

Best files to provide:

```text
ai-review-prompt.md
summary.md
checklist-results.json
evidence.json
axe-results.json
focus-order.json
reverse-focus-order.json
frame-evidence.json
visual-modes.json
widget-probes.json
manual-verification-pack.md
screenshots/
```

If Copilot cannot consume the whole folder, provide files in this priority order:

```text
1. ai-review-prompt.md
2. summary.md
3. checklist-results.json
4. evidence.json
5. axe-results.json
6. focus-order.json
7. reverse-focus-order.json
8. visual-modes.json
9. screenshots/
10. manual-verification-pack.md
```

For a lightweight review:

```text
ai-review-prompt.md
summary.md
checklist-results.json
screenshots/
```

For a deep review, provide the full scenario folder.

## What Copilot Should Do

Ask Copilot to:

1. Read `ai-review-prompt.md`.
2. Inspect the evidence files listed in the prompt.
3. Review every checkpoint section included in the prompt.
4. Produce an executive summary.
5. List evidence-supported implemented items.
6. List gaps requiring developer fixes.
7. List manual-only items requiring tester judgment.
8. List N/A candidates with reasons.
9. Generate developer-ready remediation notes.
10. Generate tester-ready Pass/Fail/N/A verification instructions.

Copilot must not mark final `Pass`.

## Example Copilot Prompt

```text
Use ai-review-prompt.md as your instruction file.

Analyze this accessibility evidence folder for the selected WCAG target:
<attach or reference the full scenario folder>

Generate:
1. Executive summary
2. Items likely implemented
3. Items needing developer fixes
4. Items needing manual verification
5. N/A candidates with specific reasons
6. Step-by-step tester instructions for Pass/Fail/N/A
7. Developer-ready remediation notes with selectors and evidence

Important:
- Do not mark final Pass.
- Human tester must re-verify every item.
- Treat AI assessments as pre-filled review states only.
- Treat N/A as a candidate until the tester confirms it.
```

## What Is Inside ai-review-prompt.md

`ai-review-prompt.md` is intentionally self-contained.

It includes:

- scenario name
- selected WCAG version and level
- Deque checklist source link
- evidence files to inspect
- AI review rules
- required output structure
- every included checkpoint after runtime filtering
- each checkpoint's:
  - id
  - topic
  - requirement
  - WCAG criteria
  - level
  - version introduced
  - test mode
  - current AI pre-assessment
  - confidence
  - N/A candidate reason, when present
  - evidence signals
  - related axe violations
  - known pre-assessment gaps
  - recommended developer fix
  - manual verification steps
  - pass criteria
  - fail criteria
  - N/A criteria
  - human final result placeholder

This lets Copilot analyze the scenario even if it does not separately open the checklist map.

## How Tester Uses The Output

Tester workflow:

1. Open `summary.md`.
2. Review the overall counts and top gaps.
3. Open `manual-verification-pack.md`.
4. For each checkpoint:
   - read the AI assessment
   - inspect evidence and screenshots
   - perform the manual steps
   - compare observations to pass criteria
   - mark `Pass`, `Fail`, or `N/A`
   - add notes
5. Use `manual-results.csv` if spreadsheet tracking is preferred.
6. Use `developer-gaps.md` to confirm issues before creating tickets.

Tester should not skip items marked `Evidence supports implementation`. Those still require manual re-verification.

## How Developer Uses The Output

Developer workflow:

1. Open `developer-gaps.md`.
2. Review each finding, selector, and recommended fix.
3. Use `evidence.json` and `axe-results.json` for technical details.
4. Fix the implementation.
5. Ask tester or engineer to rerun the same scenario.
6. Tester re-verifies the item and updates final result.

Developer should not treat all heuristic findings as confirmed defects. Some require tester confirmation.

## N/A Handling

The tool only proposes N/A candidates. A human tester confirms final N/A.

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

N/A must be specific to the captured page state.

## Privacy And Data Handling

The tool runs locally.

Defaults and controls:

- Input values are not captured; the tool records whether a value is present.
- `captureHtml` defaults to `false` in the wrapper.
- Screenshots can be disabled with `--no-screenshots`.
- Focus screenshots are disabled unless requested.
- Reports are written to local disk.
- The tool does not call an AI API.
- Copilot analysis happens only when the user gives Copilot the report files.

For sensitive pages:

```bash
node scripts/a11y-checklist-assistant.js \
  --url "http://localhost:3000/account" \
  --id "account-page" \
  --no-screenshots \
  --no-visual-modes
```

Avoid enabling `--html-capture` on pages containing sensitive DOM content unless approved.

## Capture Controls

Useful flags:

```text
--url <url>                    Page URL.
--scenario <file>              Scenario file.
--manual-capture               Let tester navigate manually before capture.
--storage-state <file>         Playwright storage state.
--wcag <2.0|2.1|2.2>           Runtime WCAG version.
--level <A|AA>                 Runtime conformance level.
--out <dir>                    Output directory.
--formats <json,md,html,csv>   Report formats.
--headed                       Run browser headed.
--max-tabs <number>            Max Tab presses.
--viewport <width>x<height>    Desktop viewport.
--no-screenshots               Disable screenshots.
--html-capture                 Enable page.html capture.
--focus-screenshots            Capture screenshot per focus step.
--no-iframes                   Skip frame evidence.
--no-shadow-dom                Skip open shadow-root evidence.
--no-reverse-focus             Skip Shift+Tab capture.
--no-visual-modes              Skip zoom/text-spacing/forced-colors/reduced-motion captures.
--no-widget-probes             Skip lightweight widget probes.
--max-widget-probes <number>   Limit widget probes.
```

## Evidence File Details

### evidence.json

Main combined evidence file. Contains:

- target
- metadata
- summary counts
- DOM inventory
- focus order
- reverse focus order
- axe summary
- responsive screenshots
- visual mode captures
- frame evidence
- widget probes
- applicability and N/A candidate reasons
- filtered checklist

### checklist-results.json

Deterministic pre-assessment output. Contains one entry per checkpoint:

- AI assessment
- confidence
- evidence notes
- known gaps
- recommended fix
- manual steps
- pass/fail/N/A criteria
- human final result placeholder

### axe-results.json

Raw axe-core output.

Use it for:

- rule id
- impact
- help text
- help URL
- affected selectors
- failure summaries

### focus-order.json

Forward `Tab` capture.

Contains:

- step number
- selector
- role
- accessible name heuristic
- bounds
- focus style
- possible obscuring

### reverse-focus-order.json

Reverse `Shift+Tab` capture.

Use it to compare backwards navigation with forward tab order.

### visual-modes.json

Visual stress evidence:

- zoom 200%
- text spacing
- forced colors
- reduced motion
- overflow candidates

This is evidence for manual review, not an automatic failure.

### frame-evidence.json

Nested frame evidence where Playwright can access the frame.

Frame access can be limited by browser origin/security rules. Access errors should become manual-review items, not automatic failures.

### widget-probes.json

Lightweight widget keyboard probes.

The tool intentionally avoids arbitrary `Enter` or `Space` activation because that can submit forms, navigate, or trigger destructive actions.

## Reading The Reports

Recommended order:

1. `aggregate-summary.md`
2. `<scenario>/summary.md`
3. `<scenario>/report.html`
4. `<scenario>/developer-gaps.md`
5. `<scenario>/manual-verification-pack.md`
6. `<scenario>/ai-review-prompt.md`
7. raw JSON files for disputes or deeper analysis

## Known Limitations

Known limitations:

- No final accessibility certification.
- Screen reader output is not actually captured.
- Closed shadow DOM cannot be inspected.
- Cross-origin iframes may not be inspectable.
- Visual-mode overflow requires human interpretation.
- Widget probes are lightweight and non-destructive.
- Alt text quality requires product/context judgment.
- Link purpose quality may require surrounding context.
- Media captions/transcripts/audio descriptions require human review.
- Dynamic states must be reached by scenario or manual capture first.

## Troubleshooting

### Playwright browser is missing

Run:

```bash
npx playwright install chromium
```

### Network access denied

If running in a restricted environment, allow the browser to access the target site or use a local app URL.

### Page requires login

Use one of:

- `--manual-capture`
- `--storage-state`
- a scripted scenario that logs in using approved test credentials

### Too many screenshots or sensitive data

Use:

```bash
--no-screenshots --no-visual-modes
```

Avoid:

```bash
--html-capture
```

on sensitive pages.

### Manual capture is waiting

In manual capture mode, the tool pauses until the tester presses `Enter` in the terminal.

### Checklist count changes between runs

This is expected when changing:

- `--wcag`
- `--level`
- `--include-best-practice`

The prompt and reports are generated for the selected runtime target.

## Example End-To-End Local Flow

1. Open **Terminal 1** and start the application under test.

Run this command in the project folder for the application you want to test, not in the
`a11y-checklist-assistant` tool folder.

```powershell
cd C:\path\to\your\application
npm run dev
```

Use the real start command for that application. Common examples are `npm run dev`,
`npm start`, `pnpm dev`, or `yarn dev`. Keep Terminal 1 running so the site stays
available at a local URL such as `http://localhost:3000`.

2. Open **Terminal 2** and run the accessibility capture tool.

Use a new terminal window or tab. Do not stop the app running in Terminal 1.

Run the command from the `a11y-checklist-assistant` tool folder. In this workspace:

```powershell
cd C:\Users\hp\Documents\Codex\2026-06-07\we-have-access-to-dequeue-tool\outputs\a11y-checklist-assistant
```

Then run:

```powershell
node scripts/a11y-checklist-assistant.js --manual-capture --url "http://localhost:3000" --id "checkout-payment-errors" --wcag 2.2 --level AA --out ./a11y-reports
```

3. In the Playwright browser:

```text
Navigate to checkout.
Open the payment step.
Submit invalid payment details.
Leave validation errors visible.
```

Then go back to **Terminal 2**, the same terminal running the accessibility tool, and
press `Enter` there to capture the page. Do not press `Enter` in Terminal 1 unless the
application itself asks for input.

4. Give Copilot:

```text
a11y-reports/checkout-payment-errors/
```

5. In the Copilot chat window, type this exact message:

```text
Use the file `a11y-reports/checkout-payment-errors/ai-review-prompt.md` as your instruction file.

Analyze the full folder `a11y-reports/checkout-payment-errors/` for WCAG accessibility review.

Please produce:
1. Executive summary
2. Evidence-supported implemented checkpoints
3. Checkpoints needing developer fixes
4. Checkpoints needing manual tester verification
5. N/A candidates with specific reasons
6. Step-by-step Pass/Fail/N/A verification instructions for the tester
7. Developer remediation notes with selectors and evidence

Important:
- Do not mark final Pass.
- Keep Human final result as Pending.
- Human tester must re-verify every checkpoint, including implemented and N/A candidate items.
- Treat AI assessment as pre-review only.
```

6. Developer fixes confirmed gaps.

7. Tester reruns the same scenario.

8. Tester manually marks final:

```text
Pass
Fail
N/A
```

for every checkpoint.

## Final Principle

Use this tool to make accessibility checklist work faster, more consistent, and easier to review. Do not use it to remove the human tester from the process.
