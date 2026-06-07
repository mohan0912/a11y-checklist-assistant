#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const TOOL_ROOT = path.resolve(__dirname, "..");
const DEFAULT_COLLECTOR = path.join(__dirname, "collect-accessibility-evidence.js");
const DEFAULT_CHECKLIST = path.join(TOOL_ROOT, "references", "deque-web-checklist-map.json");

const ASSESSMENT = {
  SUPPORTS: "Evidence supports implementation",
  GAP: "Evidence suggests gap",
  MANUAL: "Needs manual verification",
  NA: "N/A candidate",
  BLOCKED: "Blocked or insufficient evidence"
};

const IMPACT_RANK = { critical: 4, serious: 3, moderate: 2, minor: 1 };

function parseArgs(argv) {
  const args = {
    headed: false,
    includeBestPractice: false,
    skipCollect: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${token}`);
      i += 1;
      return argv[i];
    };

    if (token === "--config") args.config = path.resolve(next());
    else if (token === "--id") args.id = next();
    else if (token === "--name") args.name = next();
    else if (token === "--url") args.url = next();
    else if (token === "--scenario") args.scenario = path.resolve(next());
    else if (token === "--storage-state") args.storageState = path.resolve(next());
    else if (token === "--wcag") args.wcag = next();
    else if (token === "--level") args.level = next().toUpperCase();
    else if (token === "--out") args.out = next();
    else if (token === "--max-tabs") args.maxTabs = Number(next());
    else if (token === "--viewport") args.viewport = next();
    else if (token === "--timeout") args.timeout = Number(next());
    else if (token === "--module-dir") args.moduleDir = path.resolve(next());
    else if (token === "--checklist") args.checklist = path.resolve(next());
    else if (token === "--formats") args.formats = next().split(",").map((item) => item.trim()).filter(Boolean);
    else if (token === "--include-best-practice") args.includeBestPractice = true;
    else if (token === "--headed") args.headed = true;
    else if (token === "--manual-capture" || token === "--interactive") {
      args.manualCapture = true;
      args.headed = true;
    }
    else if (token === "--skip-collect") args.skipCollect = true;
    else if (token === "--no-screenshots") args.captureScreenshots = false;
    else if (token === "--screenshots") args.captureScreenshots = true;
    else if (token === "--no-html") args.captureHtml = false;
    else if (token === "--html-capture") args.captureHtml = true;
    else if (token === "--focus-screenshots") args.focusScreenshots = true;
    else if (token === "--no-focus-screenshots") args.focusScreenshots = false;
    else if (token === "--no-iframes") args.captureIframes = false;
    else if (token === "--no-shadow-dom") args.captureShadowDom = false;
    else if (token === "--no-reverse-focus") args.captureReverseFocus = false;
    else if (token === "--no-visual-modes") args.captureVisualModes = false;
    else if (token === "--no-widget-probes") args.captureWidgetProbes = false;
    else if (token === "--max-widget-probes") args.maxWidgetProbes = Number(next());
    else if (token === "--help" || token === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

function printHelp() {
  console.log(`
Usage:
  npx a11y-checklist-assistant --config ./a11y-checklist.config.json
  node scripts/a11y-checklist-assistant.js --url http://localhost:3000/login --id login --wcag 2.2 --level AA --out ./a11y-reports

Local-only workflow:
  1. Engineer starts the app locally.
  2. Tool uses Playwright + axe-core to collect evidence.
  3. Tool generates AI-ready and human-review reports.
  4. Tester manually marks Pass, Fail, or N/A for every checklist item.

Options:
  --config <file>             JSON config with target, run, reports, and scenarios.
  --id <id>                   Scenario id for direct URL/scenario runs.
  --name <name>               Human-friendly scenario name.
  --url <url>                 Page URL for direct run.
  --scenario <file>           Playwright scenario file for exact state setup.
  --storage-state <file>      Optional Playwright storage state.
  --wcag <2.0|2.1|2.2>        Runtime WCAG version. Default: 2.2.
  --level <A|AA>              Runtime conformance level. Default: AA.
  --include-best-practice     Include best-practice checklist rows.
  --out <dir>                 Report output directory. Default: ./a11y-reports.
  --formats <list>            json,md,html,csv. Default: json,md,html,csv.
  --skip-collect              Analyze existing evidence.json files only.
  --headed                    Run browser headed.
  --manual-capture            Open browser, let user navigate manually, then press Enter to capture.
  --max-tabs <n>              Max Tab presses for focus capture.
  --viewport <WxH>            Desktop viewport. Default: 1280x720.
  --no-screenshots            Do not capture screenshots.
  --html-capture              Capture page.html. Default is off for privacy.
  --no-iframes                Skip nested frame evidence.
  --no-shadow-dom             Skip open shadow-root evidence.
  --no-reverse-focus          Skip Shift+Tab focus capture.
  --no-visual-modes           Skip zoom/text-spacing/forced-colors/reduced-motion screenshots.
  --no-widget-probes          Skip lightweight widget keyboard probes.
  --max-widget-probes <n>     Limit widget probes. Default: 40.
  --module-dir <node_modules> Explicit module directory for local runtimes.
`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function className(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function slug(value) {
  return String(value || "scenario")
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "scenario";
}

function resolveFrom(baseDir, maybePath) {
  if (!maybePath) return maybePath;
  if (/^[a-z]+:\/\//i.test(maybePath)) return maybePath;
  return path.isAbsolute(maybePath) ? maybePath : path.resolve(baseDir, maybePath);
}

function loadRunPlan(args) {
  if (!args.config) {
    if (!args.url && !args.scenario && !args.manualCapture) {
      throw new Error("Provide --config, or provide --url/--scenario/--manual-capture for a direct run.");
    }
    const outputDir = path.resolve(args.out || "a11y-reports");
    return {
      target: {
        wcag: args.wcag || "2.2",
        level: (args.level || "AA").toUpperCase(),
        includeBestPractice: args.includeBestPractice
      },
      run: {
        headed: args.headed,
        manualCapture: Boolean(args.manualCapture),
        timeout: args.timeout || 45000,
        maxTabs: args.maxTabs || 160,
        viewport: args.viewport || "1280x720",
        captureScreenshots: args.captureScreenshots !== false,
        captureHtml: Boolean(args.captureHtml),
        focusScreenshots: Boolean(args.focusScreenshots),
        captureIframes: args.captureIframes !== false,
        captureShadowDom: args.captureShadowDom !== false,
        captureReverseFocus: args.captureReverseFocus !== false,
        captureVisualModes: args.captureVisualModes !== false,
        captureWidgetProbes: args.captureWidgetProbes !== false,
        maxWidgetProbes: args.maxWidgetProbes ?? 40,
        moduleDir: args.moduleDir,
        checklist: args.checklist || DEFAULT_CHECKLIST
      },
      reports: {
        outputDir,
        formats: args.formats || ["json", "md", "html", "csv"]
      },
      scenarios: [
        {
          id: args.id || slug(args.name || args.url || args.scenario),
          name: args.name || args.id || args.url || path.basename(args.scenario || "scenario"),
          url: args.url,
          scenario: args.scenario,
          storageState: args.storageState,
          manualCapture: Boolean(args.manualCapture)
        }
      ],
      skipCollect: args.skipCollect
    };
  }

  const config = readJson(args.config);
  const baseDir = path.dirname(args.config);
  const target = {
    wcag: args.wcag || config.target?.wcag || "2.2",
    level: (args.level || config.target?.level || "AA").toUpperCase(),
    includeBestPractice: Boolean(args.includeBestPractice || config.target?.includeBestPractice)
  };
  const run = {
    headed: Boolean(args.headed || config.run?.headed),
    manualCapture: Boolean(args.manualCapture || config.run?.manualCapture),
    timeout: Number(args.timeout || config.run?.timeout || 45000),
    maxTabs: Number(args.maxTabs || config.run?.maxTabs || 160),
    viewport: args.viewport || config.run?.viewport || "1280x720",
    captureScreenshots: args.captureScreenshots !== undefined ? args.captureScreenshots : config.run?.captureScreenshots !== false,
    captureHtml: args.captureHtml !== undefined ? args.captureHtml : Boolean(config.run?.captureHtml),
    focusScreenshots: args.focusScreenshots !== undefined ? args.focusScreenshots : Boolean(config.run?.focusScreenshots),
    captureIframes: args.captureIframes !== undefined ? args.captureIframes : config.run?.captureIframes !== false,
    captureShadowDom: args.captureShadowDom !== undefined ? args.captureShadowDom : config.run?.captureShadowDom !== false,
    captureReverseFocus: args.captureReverseFocus !== undefined ? args.captureReverseFocus : config.run?.captureReverseFocus !== false,
    captureVisualModes: args.captureVisualModes !== undefined ? args.captureVisualModes : config.run?.captureVisualModes !== false,
    captureWidgetProbes: args.captureWidgetProbes !== undefined ? args.captureWidgetProbes : config.run?.captureWidgetProbes !== false,
    maxWidgetProbes: Number(args.maxWidgetProbes ?? config.run?.maxWidgetProbes ?? 40),
    moduleDir: args.moduleDir || resolveFrom(baseDir, config.run?.moduleDir),
    checklist: args.checklist || resolveFrom(baseDir, config.run?.checklist) || DEFAULT_CHECKLIST
  };
  const reports = {
    outputDir: path.resolve(baseDir, args.out || config.reports?.outputDir || "a11y-reports"),
    formats: args.formats?.length ? args.formats : (config.reports?.formats || ["json", "md", "html", "csv"])
  };
  const scenarios = (config.scenarios || []).map((scenario, index) => ({
    id: scenario.id || slug(scenario.name || scenario.url || scenario.scenario || `scenario-${index + 1}`),
    name: scenario.name || scenario.id || scenario.url || scenario.scenario || `Scenario ${index + 1}`,
    url: scenario.url,
    scenario: resolveFrom(baseDir, scenario.scenario),
    storageState: resolveFrom(baseDir, scenario.storageState),
    manualCapture: Boolean(args.manualCapture || scenario.manualCapture || config.run?.manualCapture),
    notes: scenario.notes || ""
  }));
  if (!scenarios.length) throw new Error("Config must include at least one scenario.");
  return { target, run, reports, scenarios, skipCollect: args.skipCollect };
}

function scenarioDir(plan, scenario) {
  return path.join(plan.reports.outputDir, scenario.id);
}

function runCollector(plan, scenario) {
  const outDir = scenarioDir(plan, scenario);
  ensureDir(outDir);
  const argv = [
    DEFAULT_COLLECTOR,
    "--out", outDir,
    "--wcag", plan.target.wcag,
    "--level", plan.target.level,
    "--max-tabs", String(plan.run.maxTabs),
    "--viewport", plan.run.viewport,
    "--timeout", String(plan.run.timeout),
    "--checklist", plan.run.checklist
  ];

  if (scenario.url) argv.push("--url", scenario.url);
  if (scenario.scenario) argv.push("--scenario", scenario.scenario);
  if (scenario.storageState) argv.push("--storage-state", scenario.storageState);
  if (plan.target.includeBestPractice) argv.push("--include-best-practice");
  if (plan.run.headed) argv.push("--headed");
  if (plan.run.manualCapture || scenario.manualCapture) argv.push("--manual-capture");
  if (!plan.run.focusScreenshots) argv.push("--no-focus-screenshots");
  if (!plan.run.captureScreenshots) argv.push("--no-screenshots");
  if (!plan.run.captureHtml) argv.push("--no-html");
  if (!plan.run.captureIframes) argv.push("--no-iframes");
  if (!plan.run.captureShadowDom) argv.push("--no-shadow-dom");
  if (!plan.run.captureReverseFocus) argv.push("--no-reverse-focus");
  if (!plan.run.captureVisualModes) argv.push("--no-visual-modes");
  if (!plan.run.captureWidgetProbes) argv.push("--no-widget-probes");
  if (Number.isFinite(plan.run.maxWidgetProbes)) argv.push("--max-widget-probes", String(plan.run.maxWidgetProbes));
  if (plan.run.moduleDir) argv.push("--module-dir", plan.run.moduleDir);

  console.log(`\n[collect] ${scenario.id}`);
  const result = spawnSync(process.execPath, argv, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Collector failed for scenario "${scenario.id}" with exit code ${result.status}.`);
}

function wcagToAxeTags(wcagList) {
  const tags = new Set();
  for (const sc of wcagList || []) {
    const compact = String(sc).replace(/\./g, "");
    tags.add(`wcag${compact}`);
    tags.add(`wcag${compact.slice(0, 3)}`);
  }
  return tags;
}

function matchingAxeViolations(item, evidence) {
  const wanted = wcagToAxeTags(item.wcag);
  const violations = evidence.axeSummary?.violations || [];
  return violations.filter((violation) => (violation.tags || []).some((tag) => wanted.has(tag)));
}

function addGap(gaps, severity, message, evidence) {
  gaps.push({ severity, message, evidence: evidence || "" });
}

function namesMissing(items) {
  return (items || []).filter((item) => item.visible !== false && !String(item.name || "").trim());
}

function assessItem(item, evidence) {
  const inv = evidence.inventory || {};
  const shadow = inv.shadowDom || {};
  const gaps = [];
  const evidenceNotes = [];
  const axeMatches = matchingAxeViolations(item, evidence);
  const naReason = evidence.applicability?.candidateNaReasons?.[item.id] || "";

  for (const violation of axeMatches) {
    addGap(
      gaps,
      violation.impact || "moderate",
      `axe violation ${violation.id}: ${violation.help || violation.description}`,
      (violation.nodes || []).slice(0, 3).map((node) => (node.target || []).join(" ")).join("; ")
    );
  }

  switch (item.id) {
    case "structure.page-title":
      if (!evidence.metadata?.title) addGap(gaps, "serious", "Page title is missing.", "document.title is empty");
      else evidenceNotes.push(`Title: ${evidence.metadata.title}`);
      break;
    case "structure.language":
      if (!inv.metadata?.documentLang) addGap(gaps, "serious", "Document language is missing.", "html[lang] is empty");
      else evidenceNotes.push(`Document language: ${inv.metadata.documentLang}`);
      break;
    case "structure.headings": {
      const headings = [...(inv.headings || []), ...(shadow.headings || [])];
      if (!headings.length) addGap(gaps, "moderate", "No semantic headings were detected.", "inventory.headings is empty");
      if (!headings.some((heading) => Number(heading.level) === 1)) addGap(gaps, "moderate", "No h1 or level-1 heading was detected.", "headings list has no level 1");
      for (const heading of namesMissing(headings)) addGap(gaps, "moderate", "A heading has no accessible text.", heading.selector);
      break;
    }
    case "structure.landmarks": {
      const landmarks = inv.landmarks || [];
      if (!landmarks.some((item) => item.tag === "main" || item.role === "main")) addGap(gaps, "moderate", "No main landmark was detected.", "inventory.landmarks has no main");
      if (landmarks.filter((item) => item.tag === "main" || item.role === "main").length > 1) addGap(gaps, "minor", "Multiple main landmarks were detected.", "review duplicate main regions");
      break;
    }
    case "structure.tables":
      for (const table of inv.tables || []) {
        if (table.dataCellCount > 0 && table.headerCount === 0) addGap(gaps, "serious", "A data table appears to have no headers.", table.selector);
      }
      break;
    case "structure.iframes":
      for (const frame of inv.iframes || []) {
        if (frame.visible && !frame.title) addGap(gaps, "serious", "A visible iframe/frame is missing a title.", frame.selector);
      }
      for (const frame of evidence.frameEvidence || []) {
        if (frame.error) evidenceNotes.push(`Iframe inventory issue for ${frame.url}: ${frame.error}`);
        if (frame.axeSummary?.violationCount) evidenceNotes.push(`Iframe ${frame.url} has ${frame.axeSummary.violationCount} axe violation(s).`);
      }
      break;
    case "links.semantic-purpose": {
      const links = [...(inv.links || []), ...(shadow.links || [])];
      for (const link of namesMissing(links)) addGap(gaps, "serious", "A visible link has no accessible name.", link.selector);
      const vague = links.filter((link) => /\b(click here|learn more|read more|more|here)\b/i.test(link.name || link.text || ""));
      for (const link of vague.slice(0, 10)) addGap(gaps, "minor", "Link text may be vague without surrounding context.", `${link.name || link.text} (${link.selector})`);
      break;
    }
    case "links.keyboard-focus":
    case "navigation.reading-focus-order":
    case "input.keyboard": {
      const positive = inv.positiveTabindex || [];
      if (positive.length) addGap(gaps, "moderate", "Positive tabindex values were detected.", positive.slice(0, 5).map((item) => item.selector).join("; "));
      const noFocusStyle = (evidence.focusOrder || []).filter((step) => step.inPage && !step.hasObviousFocusStyle);
      if (noFocusStyle.length) addGap(gaps, "moderate", "Some focused elements did not show an obvious focus indicator in computed styles.", noFocusStyle.slice(0, 5).map((step) => step.selector).join("; "));
      const obscured = (evidence.focusOrder || []).filter((step) => step.possiblyObscured);
      if (obscured.length) addGap(gaps, "moderate", "Some focused elements may be obscured.", obscured.slice(0, 5).map((step) => step.selector).join("; "));
      if (evidence.metadata?.captureReverseFocus && !(evidence.reverseFocusOrder || []).length) {
        evidenceNotes.push("Reverse Shift+Tab order was requested but no reverse focus steps were captured.");
      }
      if (item.id === "input.keyboard") {
        const allControls = [...(inv.controls || []), ...(shadow.controls || [])];
        for (const control of namesMissing(allControls)) addGap(gaps, "serious", "A visible keyboard-focusable control has no accessible name.", control.selector);
      }
      break;
    }
    case "images.alternative-text":
      for (const image of [...(inv.images || []), ...(shadow.images || [])]) {
        const hidden = image.ariaHidden === "true";
        if (!hidden && image.tag === "img" && image.alt === null) addGap(gaps, "serious", "An image is missing an alt attribute.", image.selector);
        if (!hidden && image.tag !== "img" && !image.name) addGap(gaps, "moderate", "An image-like element has no accessible name.", image.selector);
      }
      break;
    case "visual.text-resize-reflow-zoom": {
      const viewportMeta = inv.metadata?.viewportMeta || "";
      if (/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\.0)?/i.test(viewportMeta)) {
        addGap(gaps, "serious", "Viewport meta may disable or restrict user zoom.", viewportMeta);
      }
      const overflowModes = (evidence.visualModeCaptures || []).filter((capture) => capture.state?.pageOverflowsHorizontally || capture.state?.overflowCandidateCount);
      if (overflowModes.length) {
        addGap(gaps, "minor", "Zoom/text-spacing/visual-mode captures show overflow candidates requiring manual review.", overflowModes.map((mode) => mode.name).join(", "));
      }
      break;
    }
    case "media.audio-video":
      for (const media of inv.media || []) {
        if (media.tag === "video" && !media.tracks?.length) addGap(gaps, "moderate", "Video has no track elements; captions/audio description require manual verification.", media.selector);
        if (media.autoplay && !media.controls) addGap(gaps, "serious", "Autoplaying media may lack user controls.", media.selector);
      }
      break;
    case "motion.animation-timed-content":
      if ((inv.motionCandidates || []).length) evidenceNotes.push(`${inv.motionCandidates.length} motion/animation candidates detected.`);
      break;
    case "input.pointer-touch-voice": {
      const smallTargets = (inv.targetSize || []).filter((target) => target.below24);
      if (smallTargets.length) addGap(gaps, "moderate", "Pointer target size may be below 24 by 24 CSS pixels.", smallTargets.slice(0, 8).map((item) => item.selector).join("; "));
      const labelMismatch = (inv.controls || []).filter((control) => control.text && control.name && !control.name.toLowerCase().includes(control.text.toLowerCase().slice(0, 20)));
      if (labelMismatch.length) addGap(gaps, "minor", "Some visible labels may not be included in accessible names.", labelMismatch.slice(0, 5).map((item) => item.selector).join("; "));
      break;
    }
    case "forms.input-labels": {
      for (const field of [...(inv.forms || []), ...(shadow.forms || [])]) {
        if (!field.name) addGap(gaps, "serious", "A form control has no accessible name.", field.selector);
        if (!field.labels?.length && field.placeholder && field.name === field.placeholder) {
          addGap(gaps, "moderate", "A field appears to use placeholder text as its only label.", field.selector);
        }
      }
      for (const group of inv.formGroups || []) {
        if (!group.name && !group.legend) addGap(gaps, "moderate", "A form group has no visible/programmatic group label.", group.selector);
      }
      break;
    }
    case "forms.input-purpose-instructions": {
      const personalFields = (inv.forms || []).filter((field) => /\b(email|name|given|family|address|postal|zip|tel|phone|username|password|city|country)\b/i.test(`${field.name} ${field.id} ${field.type}`));
      const missingAutocomplete = personalFields.filter((field) => !field.autocomplete && !/password/i.test(`${field.type} ${field.name}`));
      if (missingAutocomplete.length) addGap(gaps, "minor", "Some personal-data fields may be missing autocomplete/input purpose.", missingAutocomplete.slice(0, 5).map((item) => item.selector).join("; "));
      break;
    }
    case "forms.validation-feedback": {
      const invalidFields = (inv.forms || []).filter((field) => field.invalid === "true");
      for (const field of invalidFields) {
        if (!field.describedBy && !field.errorMessageRef) addGap(gaps, "serious", "Invalid field may not be programmatically associated with error text.", field.selector);
      }
      break;
    }
    case "widgets.name-role-value":
      for (const widget of namesMissing([...(inv.ariaWidgets || []), ...(shadow.ariaWidgets || [])])) addGap(gaps, "serious", "A custom/ARIA widget has no accessible name.", widget.selector);
      break;
    case "widgets.keyboard-patterns": {
      const probeErrors = (evidence.widgetProbes || []).filter((probe) => probe.error);
      if (probeErrors.length) evidenceNotes.push(`${probeErrors.length} widget probe(s) could not be completed; manual keyboard review required.`);
      if ((evidence.widgetProbes || []).length) evidenceNotes.push(`${evidence.widgetProbes.length} lightweight widget keyboard probe(s) captured.`);
      break;
    }
    case "captcha":
      if ((inv.captchaCandidates || []).length) addGap(gaps, "moderate", "CAPTCHA-like content detected; alternatives require manual verification.", (inv.captchaCandidates || []).slice(0, 3).map((item) => item.selector).join("; "));
      break;
    default:
      break;
  }

  let aiAssessment = ASSESSMENT.MANUAL;
  let confidence = "medium";
  if (naReason && !gaps.length) {
    aiAssessment = ASSESSMENT.NA;
    confidence = "medium";
  } else if (gaps.length) {
    aiAssessment = ASSESSMENT.GAP;
    confidence = axeMatches.length ? "high" : "medium";
  } else if (item.testMode === "manual") {
    aiAssessment = ASSESSMENT.MANUAL;
    confidence = "low";
  } else {
    aiAssessment = ASSESSMENT.SUPPORTS;
    confidence = item.testMode === "automated" || axeMatches.length ? "high" : "medium";
  }

  return {
    id: item.id,
    topic: item.topic,
    requirement: item.requirement,
    wcag: item.wcag,
    level: item.level,
    introduced: item.introduced,
    testMode: item.testMode,
    aiAssessment,
    confidence,
    humanFinalResult: "Pending",
    naCandidateReason: naReason,
    evidence: {
      notes: evidenceNotes,
      axeViolationIds: axeMatches.map((violation) => violation.id),
      signals: item.evidenceSignals || []
    },
    gaps,
    recommendedFix: recommendedFix(item, gaps),
    manualSteps: item.manualSteps || [],
    passCriteria: item.passCriteria || "",
    failCriteria: "Mark Fail if the tester confirms any gap, cannot complete the manual steps, or observes behavior that does not meet the pass criteria.",
    naCriteria: item.naCriteria || ""
  };
}

function recommendedFix(item, gaps) {
  if (!gaps.length) return "";
  if (item.id.startsWith("forms.")) return "Fix labels, instructions, required/error associations, and form state semantics in the affected form controls.";
  if (item.id.startsWith("links.")) return "Use semantic links with clear accessible names, logical keyboard order, and visible focus/hover states.";
  if (item.id.startsWith("images.")) return "Add purpose-appropriate alternatives for informative images and hide decorative images from assistive technologies.";
  if (item.id.startsWith("input.") || item.id.startsWith("widgets.")) return "Use native controls where possible; otherwise expose correct name, role, value, state, focus behavior, and keyboard support.";
  if (item.id.startsWith("visual.") || item.id.startsWith("responsive.")) return "Update CSS and responsive behavior so information remains perceivable at required contrast, zoom, and viewport conditions.";
  if (item.id.startsWith("structure.")) return "Correct semantic structure in the HTML/ARIA so assistive technologies expose the intended relationships.";
  return "Review the affected selectors and remediate the implementation to meet the checklist requirement.";
}

function analyzeEvidence(evidence) {
  const results = (evidence.checklist?.items || []).map((item) => assessItem(item, evidence));
  const counts = results.reduce((acc, item) => {
    acc[item.aiAssessment] = (acc[item.aiAssessment] || 0) + 1;
    return acc;
  }, {});
  const gapResults = results.filter((item) => item.gaps.length);
  const highestImpact = gapResults.reduce((max, item) => {
    for (const gap of item.gaps) max = Math.max(max, IMPACT_RANK[gap.severity] || 0);
    return max;
  }, 0);

  return {
    generatedAt: new Date().toISOString(),
    scenario: {
      finalUrl: evidence.metadata?.finalUrl,
      title: evidence.metadata?.title,
      sourceUrl: evidence.metadata?.sourceUrl,
      scenarioFile: evidence.metadata?.scenario
    },
    target: evidence.target,
    summary: {
      totalChecklistItems: results.length,
      counts,
      automatedViolations: evidence.summary?.axeViolationCount || 0,
      automatedIncomplete: evidence.summary?.axeIncompleteCount || 0,
      focusSteps: evidence.summary?.focusSteps || 0,
      reverseFocusSteps: evidence.summary?.reverseFocusSteps || 0,
      frameCount: evidence.summary?.frameCount || 0,
      frameAxeViolationCount: evidence.summary?.frameAxeViolationCount || 0,
      visualModeCaptureCount: evidence.summary?.visualModeCaptureCount || 0,
      visualModeOverflowCount: evidence.summary?.visualModeOverflowCount || 0,
      widgetProbeCount: evidence.summary?.widgetProbeCount || 0,
      highestImpact,
      artifactPrivacy: {
        htmlCaptured: Boolean(evidence.metadata?.captureHtml),
        screenshotsCaptured: Boolean(evidence.metadata?.captureScreenshots),
        inputValuesCaptured: false
      }
    },
    checklistResults: results
  };
}

function createSummaryMarkdown(scenario, evidence, analysis) {
  const counts = analysis.summary.counts;
  const gaps = analysis.checklistResults.filter((item) => item.aiAssessment === ASSESSMENT.GAP);
  const na = analysis.checklistResults.filter((item) => item.aiAssessment === ASSESSMENT.NA);
  const manual = analysis.checklistResults.filter((item) => item.aiAssessment === ASSESSMENT.MANUAL);
  const lines = [];

  lines.push(`# Accessibility Checklist Summary`);
  lines.push("");
  lines.push(`Scenario: ${scenario.name || scenario.id}`);
  lines.push(`Scenario ID: ${scenario.id}`);
  lines.push(`Page: ${analysis.scenario.finalUrl || ""}`);
  lines.push(`Title: ${analysis.scenario.title || ""}`);
  lines.push(`Target: WCAG ${analysis.target.wcag} ${analysis.target.level}`);
  lines.push(`Generated: ${analysis.generatedAt}`);
  lines.push("");
  lines.push(`Source checklist: https://dequeuniversity.com/checklists/web/`);
  if (analysis.target.wcag === "2.2" && analysis.target.level === "AA") {
    lines.push(`Deque WCAG 2.2 AA PDF: https://media.dequeuniversity.com/en/docs/web-accessibility-checklist-wcag-2.2.pdf`);
  } else {
    lines.push(`Checklist filtered at runtime for WCAG ${analysis.target.wcag} ${analysis.target.level} using references/deque-web-checklist-map.json.`);
  }
  lines.push("");
  lines.push(`## Executive Summary`);
  lines.push("");
  lines.push(`- Evidence supports implementation: ${counts[ASSESSMENT.SUPPORTS] || 0}`);
  lines.push(`- Evidence suggests gap: ${counts[ASSESSMENT.GAP] || 0}`);
  lines.push(`- Needs manual verification: ${counts[ASSESSMENT.MANUAL] || 0}`);
  lines.push(`- N/A candidates: ${counts[ASSESSMENT.NA] || 0}`);
  lines.push(`- axe violations: ${analysis.summary.automatedViolations}`);
  lines.push(`- Focus steps captured: ${analysis.summary.focusSteps}`);
  lines.push(`- Reverse focus steps captured: ${analysis.summary.reverseFocusSteps}`);
  lines.push(`- Iframes scanned: ${analysis.summary.frameCount}`);
  lines.push(`- Iframe axe violations: ${analysis.summary.frameAxeViolationCount}`);
  lines.push(`- Visual mode captures: ${analysis.summary.visualModeCaptureCount}`);
  lines.push(`- Visual mode overflow candidates: ${analysis.summary.visualModeOverflowCount}`);
  lines.push(`- Widget probes captured: ${analysis.summary.widgetProbeCount}`);
  lines.push("");
  lines.push("AI assessments are pre-filled review states. The tester must mark final Pass, Fail, or N/A for every item.");
  lines.push("");

  lines.push(`## Top Implementation Gaps`);
  lines.push("");
  if (!gaps.length) {
    lines.push("No deterministic implementation gaps were found. Manual verification is still required.");
  } else {
    for (const item of gaps.slice(0, 20)) {
      const firstGap = item.gaps[0];
      lines.push(`- ${item.id}: ${firstGap.message}${firstGap.evidence ? ` (${firstGap.evidence})` : ""}`);
    }
  }
  lines.push("");

  lines.push(`## Manual Review Risks`);
  lines.push("");
  if (!manual.length) lines.push("No manual-only items are currently isolated by the deterministic analyzer.");
  for (const item of manual.slice(0, 20)) lines.push(`- ${item.id}: ${item.requirement}`);
  lines.push("");

  lines.push(`## N/A Candidates`);
  lines.push("");
  if (!na.length) lines.push("No N/A candidates were identified.");
  for (const item of na) lines.push(`- ${item.id}: ${item.naCandidateReason}`);
  lines.push("");

  lines.push(`## Evidence Captured`);
  lines.push("");
  lines.push(`- HTML captured: ${analysis.summary.artifactPrivacy.htmlCaptured ? "yes" : "no"}`);
  lines.push(`- Screenshots captured: ${analysis.summary.artifactPrivacy.screenshotsCaptured ? "yes" : "no"}`);
  lines.push(`- Input values captured: no`);
  lines.push(`- Counts: headings ${evidence.summary?.counts?.headings || 0}, landmarks ${evidence.summary?.counts?.landmarks || 0}, links ${evidence.summary?.counts?.links || 0}, controls ${evidence.summary?.counts?.controls || 0}, forms ${evidence.summary?.counts?.forms || 0}, images ${evidence.summary?.counts?.images || 0}`);
  lines.push(`- Shadow DOM: open hosts ${evidence.summary?.counts?.shadowOpenHosts || 0}, shadow controls ${evidence.summary?.counts?.shadowControls || 0}, custom element candidates ${evidence.summary?.counts?.shadowCustomElementCandidates || 0}`);
  lines.push(`- Extra evidence files: reverse-focus-order.json, frame-evidence.json, visual-modes.json, widget-probes.json`);
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function createDeveloperGapsMarkdown(scenario, analysis) {
  const gaps = analysis.checklistResults.filter((item) => item.gaps.length);
  const lines = [];
  lines.push(`# Developer Implementation Gaps`);
  lines.push("");
  lines.push(`Scenario: ${scenario.name || scenario.id}`);
  lines.push(`Target: WCAG ${analysis.target.wcag} ${analysis.target.level}`);
  lines.push("");

  if (!gaps.length) {
    lines.push("No deterministic implementation gaps were found. Developers should still review manual findings after tester verification.");
    return `${lines.join("\n")}\n`;
  }

  for (const item of gaps) {
    lines.push(`## ${item.id}`);
    lines.push("");
    lines.push(`Topic: ${item.topic}`);
    lines.push(`WCAG: ${item.wcag.join(", ")}`);
    lines.push(`Recommended fix: ${item.recommendedFix}`);
    lines.push("");
    lines.push("Findings:");
    for (const gap of item.gaps) {
      lines.push(`- [${gap.severity}] ${gap.message}${gap.evidence ? ` Evidence: ${gap.evidence}` : ""}`);
    }
    lines.push("");
    lines.push("Verification after fix:");
    item.manualSteps.slice(0, 6).forEach((step, index) => lines.push(`${index + 1}. ${step}`));
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function createManualMarkdown(scenario, analysis) {
  const lines = [];
  lines.push(`# Manual Re-Verification Pack`);
  lines.push("");
  lines.push(`Scenario: ${scenario.name || scenario.id}`);
  lines.push(`Scenario ID: ${scenario.id}`);
  lines.push(`Page: ${analysis.scenario.finalUrl || ""}`);
  lines.push(`Target: WCAG ${analysis.target.wcag} ${analysis.target.level}`);
  lines.push("");
  lines.push("For every item, perform the steps and mark exactly one final result.");
  lines.push("");

  for (const item of analysis.checklistResults) {
    lines.push(`## ${item.id}`);
    lines.push("");
    lines.push(`Topic: ${item.topic}`);
    lines.push(`Requirement: ${item.requirement}`);
    lines.push(`AI assessment: ${item.aiAssessment}`);
    lines.push(`Confidence: ${item.confidence}`);
    lines.push(`Human final result: Pending`);
    lines.push("");
    lines.push("Final result:");
    lines.push("- [ ] Pass");
    lines.push("- [ ] Fail");
    lines.push("- [ ] N/A");
    lines.push("");
    if (item.naCandidateReason) {
      lines.push(`N/A candidate reason: ${item.naCandidateReason}`);
      lines.push("");
    }
    if (item.gaps.length) {
      lines.push("Known gaps to re-check:");
      for (const gap of item.gaps) lines.push(`- ${gap.message}${gap.evidence ? ` (${gap.evidence})` : ""}`);
      lines.push("");
    }
    lines.push("Steps:");
    item.manualSteps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
    lines.push("");
    lines.push(`Pass criteria: ${item.passCriteria}`);
    lines.push(`Fail criteria: ${item.failCriteria}`);
    lines.push(`N/A criteria: ${item.naCriteria}`);
    lines.push("");
    lines.push("Tester notes:");
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function createCheckpointDetailsForPrompt(results) {
  const lines = [];
  lines.push("Complete Deque/WCAG checkpoint details to analyze:");
  lines.push("");
  for (const item of results) {
    lines.push(`## ${item.id}`);
    lines.push(`Topic: ${item.topic}`);
    lines.push(`Requirement: ${item.requirement}`);
    lines.push(`WCAG: ${item.wcag.join(", ")} | Level: ${item.level} | Introduced: ${item.introduced}`);
    lines.push(`Test mode: ${item.testMode}`);
    lines.push(`Current AI pre-assessment: ${item.aiAssessment}`);
    lines.push(`Confidence: ${item.confidence}`);
    if (item.naCandidateReason) lines.push(`N/A candidate reason: ${item.naCandidateReason}`);
    if (item.evidence?.signals?.length) lines.push(`Evidence signals to inspect: ${item.evidence.signals.join(", ")}`);
    if (item.evidence?.axeViolationIds?.length) lines.push(`Related axe violation IDs: ${item.evidence.axeViolationIds.join(", ")}`);
    if (item.evidence?.notes?.length) {
      lines.push("Evidence notes:");
      for (const note of item.evidence.notes) lines.push(`- ${note}`);
    }
    if (item.gaps?.length) {
      lines.push("Known pre-assessment gaps:");
      for (const gap of item.gaps) {
        lines.push(`- [${gap.severity}] ${gap.message}${gap.evidence ? ` Evidence: ${gap.evidence}` : ""}`);
      }
    }
    if (item.recommendedFix) lines.push(`Recommended developer fix: ${item.recommendedFix}`);
    lines.push("Manual verification steps:");
    for (const [index, step] of (item.manualSteps || []).entries()) lines.push(`${index + 1}. ${step}`);
    lines.push(`Pass criteria: ${item.passCriteria}`);
    lines.push(`Fail criteria: ${item.failCriteria}`);
    lines.push(`N/A criteria: ${item.naCriteria}`);
    lines.push("Human final result: Pending");
    lines.push("");
  }
  return lines.join("\n");
}

function sourceDetailsForTarget(target) {
  const lines = [
    "- Deque Web Accessibility Checklist: https://dequeuniversity.com/checklists/web/"
  ];
  if (target.wcag === "2.2" && target.level === "AA") {
    lines.push("- Deque WCAG 2.2 AA PDF: https://media.dequeuniversity.com/en/docs/web-accessibility-checklist-wcag-2.2.pdf");
  } else {
    lines.push(`- Checklist filtered at runtime for WCAG ${target.wcag} ${target.level} using references/deque-web-checklist-map.json.`);
  }
  return lines.join("\n");
}

function createAiPrompt(scenario, analysis) {
  return `You are an accessibility review assistant.

Analyze the local evidence and checklist output for:
- Scenario: ${scenario.name || scenario.id}
- WCAG target: ${analysis.target.wcag} ${analysis.target.level}

Primary checklist sources:
${sourceDetailsForTarget(analysis.target)}

Use these local files:
- evidence.json
- checklist-results.json
- accessibility-tree.json
- axe-results.json
- focus-order.json
- reverse-focus-order.json
- frame-evidence.json
- visual-modes.json
- widget-probes.json
- screenshots/ if available

Rules:
- Do not produce final Pass. Only propose AI assessment states.
- The human tester must re-verify every item, including implemented items.
- For N/A, provide a specific reason and ask the tester to confirm.
- Use selectors, visible labels, role/name/state/value evidence, screenshots, and axe findings.
- Produce developer-ready fixes and tester-ready re-verification steps.

Return:
1. Executive summary.
2. Implemented/evidence-supported items.
3. Gaps requiring development.
4. Manual-only items requiring tester judgment.
5. N/A candidates with reasons.
6. Final manual verification checklist.

${createCheckpointDetailsForPrompt(analysis.checklistResults)}
`;
}

function createHtmlReport(scenario, analysis) {
  const rows = analysis.checklistResults.map((item) => {
    const gaps = item.gaps.map((gap) => `<li><strong>${escapeHtml(gap.severity)}</strong>: ${escapeHtml(gap.message)} ${escapeHtml(gap.evidence)}</li>`).join("");
    const steps = item.manualSteps.map((step, index) => `<li>${index + 1}. ${escapeHtml(step)}</li>`).join("");
    return `<tr>
      <td>${escapeHtml(item.id)}</td>
      <td>${escapeHtml(item.topic)}</td>
      <td><span class="status ${escapeHtml(className(item.aiAssessment))}">${escapeHtml(item.aiAssessment)}</span></td>
      <td>${escapeHtml(item.wcag.join(", "))}</td>
      <td>
        <details>
          <summary>Review details</summary>
          <p><strong>Requirement:</strong> ${escapeHtml(item.requirement)}</p>
          ${item.naCandidateReason ? `<p><strong>N/A candidate:</strong> ${escapeHtml(item.naCandidateReason)}</p>` : ""}
          ${gaps ? `<p><strong>Gaps:</strong></p><ul>${gaps}</ul>` : "<p><strong>Gaps:</strong> none detected</p>"}
          <p><strong>Pass criteria:</strong> ${escapeHtml(item.passCriteria)}</p>
          <p><strong>Fail criteria:</strong> ${escapeHtml(item.failCriteria)}</p>
          <p><strong>N/A criteria:</strong> ${escapeHtml(item.naCriteria)}</p>
          <p><strong>Manual steps:</strong></p><ol>${steps}</ol>
          <p><strong>Human final result:</strong> Pending</p>
        </details>
      </td>
    </tr>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Accessibility Checklist Report - ${escapeHtml(scenario.id)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #1f2937; }
    header { border-bottom: 1px solid #d1d5db; margin-bottom: 20px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #d1d5db; padding: 8px; vertical-align: top; }
    th { background: #f3f4f6; text-align: left; }
    .status { display: inline-block; padding: 3px 6px; border-radius: 4px; font-size: 12px; font-weight: 700; }
    .evidence-supports-implementation { background: #dcfce7; color: #166534; }
    .evidence-suggests-gap { background: #fee2e2; color: #991b1b; }
    .needs-manual-verification { background: #fef3c7; color: #92400e; }
    .n-a-candidate { background: #e0e7ff; color: #3730a3; }
    .cards { display: flex; gap: 12px; flex-wrap: wrap; margin: 16px 0; }
    .card { border: 1px solid #d1d5db; border-radius: 6px; padding: 10px; min-width: 160px; }
  </style>
</head>
<body>
  <header>
    <h1>Accessibility Checklist Report</h1>
    <p><strong>Scenario:</strong> ${escapeHtml(scenario.name || scenario.id)}</p>
    <p><strong>Page:</strong> ${escapeHtml(analysis.scenario.finalUrl || "")}</p>
    <p><strong>Target:</strong> WCAG ${escapeHtml(analysis.target.wcag)} ${escapeHtml(analysis.target.level)}</p>
    <p>AI assessments are pre-filled review states. Human final result remains pending.</p>
  </header>
  <section class="cards">
    <div class="card"><strong>Supports implementation</strong><br>${analysis.summary.counts[ASSESSMENT.SUPPORTS] || 0}</div>
    <div class="card"><strong>Suggests gap</strong><br>${analysis.summary.counts[ASSESSMENT.GAP] || 0}</div>
    <div class="card"><strong>Manual verification</strong><br>${analysis.summary.counts[ASSESSMENT.MANUAL] || 0}</div>
    <div class="card"><strong>N/A candidates</strong><br>${analysis.summary.counts[ASSESSMENT.NA] || 0}</div>
  </section>
  <table>
    <thead><tr><th>ID</th><th>Topic</th><th>AI Assessment</th><th>WCAG</th><th>Details</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>
`;
}

function createManualCsv(analysis) {
  const rows = [
    ["id", "topic", "wcag", "aiAssessment", "humanFinalResult", "naCandidateReason", "primaryGap", "testerNotes"]
  ];
  for (const item of analysis.checklistResults) {
    rows.push([
      item.id,
      item.topic,
      item.wcag.join(" "),
      item.aiAssessment,
      "Pending",
      item.naCandidateReason,
      item.gaps[0]?.message || "",
      ""
    ]);
  }
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function writeScenarioReports(plan, scenario, evidence, analysis) {
  const outDir = scenarioDir(plan, scenario);
  const formats = new Set(plan.reports.formats || ["json", "md", "html", "csv"]);
  if (formats.has("json")) writeJson(path.join(outDir, "checklist-results.json"), analysis);
  if (formats.has("md")) {
    fs.writeFileSync(path.join(outDir, "summary.md"), createSummaryMarkdown(scenario, evidence, analysis), "utf8");
    fs.writeFileSync(path.join(outDir, "developer-gaps.md"), createDeveloperGapsMarkdown(scenario, analysis), "utf8");
    fs.writeFileSync(path.join(outDir, "manual-verification-pack.md"), createManualMarkdown(scenario, analysis), "utf8");
    fs.writeFileSync(path.join(outDir, "ai-review-prompt.md"), createAiPrompt(scenario, analysis), "utf8");
  }
  if (formats.has("html")) fs.writeFileSync(path.join(outDir, "report.html"), createHtmlReport(scenario, analysis), "utf8");
  if (formats.has("csv")) fs.writeFileSync(path.join(outDir, "manual-results.csv"), createManualCsv(analysis), "utf8");
}

function writeAggregate(plan, scenarioAnalyses) {
  const aggregate = {
    generatedAt: new Date().toISOString(),
    target: plan.target,
    scenarioCount: scenarioAnalyses.length,
    scenarios: scenarioAnalyses.map(({ scenario, analysis }) => ({
      id: scenario.id,
      name: scenario.name,
      page: analysis.scenario.finalUrl,
      counts: analysis.summary.counts,
      automatedViolations: analysis.summary.automatedViolations,
      totalChecklistItems: analysis.summary.totalChecklistItems
    }))
  };
  writeJson(path.join(plan.reports.outputDir, "aggregate-summary.json"), aggregate);

  const lines = [];
  lines.push("# Aggregate Accessibility Checklist Summary");
  lines.push("");
  lines.push(`Generated: ${aggregate.generatedAt}`);
  lines.push(`Target: WCAG ${plan.target.wcag} ${plan.target.level}`);
  lines.push(`Scenarios: ${aggregate.scenarioCount}`);
  lines.push("");
  lines.push("| Scenario | Supports | Gaps | Manual | N/A Candidates | axe Violations |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  for (const item of aggregate.scenarios) {
    lines.push(`| ${item.id} | ${item.counts[ASSESSMENT.SUPPORTS] || 0} | ${item.counts[ASSESSMENT.GAP] || 0} | ${item.counts[ASSESSMENT.MANUAL] || 0} | ${item.counts[ASSESSMENT.NA] || 0} | ${item.automatedViolations || 0} |`);
  }
  lines.push("");
  lines.push("Human final Pass/Fail/N/A decisions are not made by this tool.");
  fs.writeFileSync(path.join(plan.reports.outputDir, "aggregate-summary.md"), `${lines.join("\n")}\n`, "utf8");
}

function analyzeScenario(plan, scenario) {
  const outDir = scenarioDir(plan, scenario);
  const evidenceFile = path.join(outDir, "evidence.json");
  if (!fs.existsSync(evidenceFile)) throw new Error(`Missing evidence file for ${scenario.id}: ${evidenceFile}`);
  const evidence = readJson(evidenceFile);
  const analysis = analyzeEvidence(evidence);
  writeScenarioReports(plan, scenario, evidence, analysis);
  return { scenario, analysis };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const plan = loadRunPlan(args);
  ensureDir(plan.reports.outputDir);
  console.log(`[plan] ${plan.scenarios.length} scenario(s), WCAG ${plan.target.wcag} ${plan.target.level}`);
  console.log(`[reports] ${plan.reports.outputDir}`);

  for (const scenario of plan.scenarios) {
    if (!plan.skipCollect) runCollector(plan, scenario);
  }

  const analyses = [];
  for (const scenario of plan.scenarios) {
    console.log(`[analyze] ${scenario.id}`);
    analyses.push(analyzeScenario(plan, scenario));
  }
  writeAggregate(plan, analyses);
  console.log(`\nDone. Open aggregate-summary.md or per-scenario report.html in: ${plan.reports.outputDir}`);
}

main();
