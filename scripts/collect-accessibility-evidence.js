#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { createRequire } = require("module");
const readline = require("readline");

const DEFAULT_CHECKLIST = path.resolve(__dirname, "../references/deque-web-checklist-map.json");
const LEVEL_RANK = { A: 1, AA: 2 };
const WCAG_RANK = { "2.0": 20, "2.1": 21, "2.2": 22 };

function parseArgs(argv) {
  const args = {
    wcag: "2.2",
    level: "AA",
    out: path.resolve(process.cwd(), "a11y-evidence"),
    maxTabs: 160,
    focusScreenshots: true,
    headed: false,
    includeBestPractice: false,
    checklist: DEFAULT_CHECKLIST,
    viewport: "1280x720",
    timeout: 45000,
    captureScreenshots: true,
    captureHtml: true,
    manualCapture: false,
    captureIframes: true,
    captureShadowDom: true,
    captureReverseFocus: true,
    captureVisualModes: true,
    captureWidgetProbes: true,
    maxWidgetProbes: 40
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${token}`);
      i += 1;
      return argv[i];
    };

    if (token === "--url") args.url = next();
    else if (token === "--scenario") args.scenario = path.resolve(next());
    else if (token === "--storage-state") args.storageState = path.resolve(next());
    else if (token === "--wcag") args.wcag = next();
    else if (token === "--level") args.level = next().toUpperCase();
    else if (token === "--out") args.out = path.resolve(next());
    else if (token === "--max-tabs") args.maxTabs = Number(next());
    else if (token === "--no-focus-screenshots") args.focusScreenshots = false;
    else if (token === "--headed") args.headed = true;
    else if (token === "--include-best-practice") args.includeBestPractice = true;
    else if (token === "--checklist") args.checklist = path.resolve(next());
    else if (token === "--viewport") args.viewport = next();
    else if (token === "--timeout") args.timeout = Number(next());
    else if (token === "--module-dir") args.moduleDir = path.resolve(next());
    else if (token === "--no-screenshots") {
      args.captureScreenshots = false;
      args.focusScreenshots = false;
    }
    else if (token === "--no-html") args.captureHtml = false;
    else if (token === "--manual-capture" || token === "--interactive") {
      args.manualCapture = true;
      args.headed = true;
    }
    else if (token === "--no-iframes") args.captureIframes = false;
    else if (token === "--no-shadow-dom") args.captureShadowDom = false;
    else if (token === "--no-reverse-focus") args.captureReverseFocus = false;
    else if (token === "--no-visual-modes") args.captureVisualModes = false;
    else if (token === "--no-widget-probes") args.captureWidgetProbes = false;
    else if (token === "--max-widget-probes") args.maxWidgetProbes = Number(next());
    else if (token === "--help" || token === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }

  if (!WCAG_RANK[args.wcag]) throw new Error(`Unsupported --wcag ${args.wcag}`);
  if (!LEVEL_RANK[args.level]) throw new Error(`Unsupported --level ${args.level}`);
  if (args.help) return args;
  if (!args.url && !args.scenario && !args.manualCapture) throw new Error("Provide --url, --scenario, or --manual-capture.");
  if (!Number.isFinite(args.maxTabs) || args.maxTabs < 1) throw new Error("--max-tabs must be a positive number.");
  if (!Number.isFinite(args.maxWidgetProbes) || args.maxWidgetProbes < 0) throw new Error("--max-widget-probes must be zero or a positive number.");
  return args;
}

function printHelp() {
  console.log(`
Usage:
  node scripts/collect-accessibility-evidence.js --url <url> --wcag 2.2 --level AA --out ./a11y-report
  node scripts/collect-accessibility-evidence.js --scenario ./scenario.js --wcag 2.2 --level AA --out ./a11y-report

Options:
  --url <url>                 Page URL to open.
  --scenario <file>           JS file exporting default/run/scenario async function.
  --storage-state <file>      Playwright storage state JSON.
  --wcag <2.0|2.1|2.2>        Runtime WCAG version. Default: 2.2.
  --level <A|AA>              Runtime level. Default: AA.
  --include-best-practice     Include best-practice checklist rows.
  --out <dir>                 Output directory.
  --max-tabs <n>              Max Tab presses for focus capture. Default: 160.
  --no-focus-screenshots      Skip screenshot for each focused element.
  --headed                    Run Chromium headed.
  --viewport <width>x<height> Desktop viewport. Default: 1280x720.
  --checklist <file>          Checklist JSON override.
  --module-dir <node_modules> Optional module directory for playwright/axe-core.
  --no-screenshots           Skip all screenshot capture.
  --no-html                  Skip captured page.html.
  --manual-capture           Open headed browser, let user navigate, then press Enter to capture.
  --no-iframes               Skip nested frame evidence.
  --no-shadow-dom            Skip open shadow-root evidence.
  --no-reverse-focus         Skip Shift+Tab focus-order capture.
  --no-visual-modes          Skip zoom/text-spacing/forced-colors/reduced-motion screenshots.
  --no-widget-probes         Skip lightweight widget keyboard probes.
  --max-widget-probes <n>    Limit widget probes. Default: 40.
`);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function parseViewport(input) {
  const match = /^(\d+)x(\d+)$/i.exec(input);
  if (!match) throw new Error(`Invalid viewport "${input}". Use WIDTHxHEIGHT.`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

function compareWcag(a, b) {
  return WCAG_RANK[a] - WCAG_RANK[b];
}

function levelIncluded(itemLevel, targetLevel, includeBestPractice) {
  if (itemLevel === "BestPractice") return includeBestPractice;
  if (itemLevel === "Multiple" || itemLevel === "Depends") return true;
  return (LEVEL_RANK[itemLevel] || 0) <= LEVEL_RANK[targetLevel];
}

function filterChecklist(checklist, target) {
  return {
    ...checklist,
    items: checklist.items.filter((item) => {
      const versionOk = compareWcag(item.introduced || "2.0", target.wcag) <= 0;
      return versionOk && levelIncluded(item.level, target.level, target.includeBestPractice);
    })
  };
}

function axeTagsForTarget(wcag, level) {
  const tags = [];
  const levels = level === "A" ? ["a"] : ["a", "aa"];
  for (const suffix of levels) tags.push(`wcag2${suffix}`);
  if (compareWcag(wcag, "2.1") >= 0) {
    for (const suffix of levels) tags.push(`wcag21${suffix}`);
  }
  if (compareWcag(wcag, "2.2") >= 0) {
    for (const suffix of levels) tags.push(`wcag22${suffix}`);
  }
  return tags;
}

function requireFromModuleDir(moduleDir, moduleName) {
  if (!moduleDir) return null;
  const packageRoot = path.join(moduleDir, moduleName);
  if (!fs.existsSync(packageRoot)) return null;
  const packageRequire = createRequire(path.join(packageRoot, "package.json"));
  return packageRequire(packageRoot);
}

async function loadPlaywright(args) {
  const explicit = requireFromModuleDir(args.moduleDir, "playwright");
  if (explicit) return explicit;

  try {
    return require("playwright");
  } catch (error) {
    throw new Error(
      "Missing dependency 'playwright'. Install with: npm i -D playwright && npx playwright install chromium. " +
      `Original error: ${error.message}`
    );
  }
}

async function maybeRunAxe(page, target, args) {
  let axePath = null;
  if (args.moduleDir) {
    const explicitAxePath = path.join(args.moduleDir, "axe-core", "axe.min.js");
    if (fs.existsSync(explicitAxePath)) axePath = explicitAxePath;
  }
  try {
    if (!axePath) axePath = require.resolve("axe-core/axe.min.js");
  } catch (error) {
    return {
      available: false,
      error: "Missing dependency 'axe-core'. Install with: npm i -D axe-core",
      violations: [],
      incomplete: [],
      passes: [],
      inapplicable: []
    };
  }

  await page.addScriptTag({ path: axePath });
  const tags = axeTagsForTarget(target.wcag, target.level);
  return page.evaluate(async (runOnlyTags) => {
    return window.axe.run(document, {
      runOnly: { type: "tag", values: runOnlyTags },
      resultTypes: ["violations", "incomplete", "passes", "inapplicable"]
    });
  }, tags);
}

async function runScenario(page, context, browser, scenarioFile, url) {
  if (url) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
  }
  if (!scenarioFile) return;

  let loaded;
  let scenario;
  try {
    loaded = require(scenarioFile);
    scenario = loaded.default || loaded.run || loaded.scenario || loaded;
  } catch (error) {
    if (error.code !== "ERR_REQUIRE_ESM") throw error;
  }

  if (typeof scenario === "function") {
    await scenario({ page, context, browser });
    return;
  }

  {
    const moduleUrl = pathToFileURL(scenarioFile).href;
    const esm = await import(`${moduleUrl}?cacheBust=${Date.now()}`);
    const esmScenario = esm.default || esm.run || esm.scenario;
    if (typeof esmScenario !== "function") throw new Error(`Scenario ${scenarioFile} does not export a function.`);
    await esmScenario({ page, context, browser });
    return;
  }
}

function waitForEnter(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

async function waitForManualCapture(page) {
  await page.bringToFront().catch(() => {});
  console.log("\n[manual-capture] A headed Playwright browser is open.");
  console.log("[manual-capture] Navigate to the exact page/state you want to test.");
  console.log("[manual-capture] Open menus, dialogs, validation errors, or expanded sections before capture if needed.");
  await waitForEnter("[manual-capture] Press Enter in this terminal when the page is ready to capture...");
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
}

async function collectInventory(page, options = {}) {
  return page.evaluate((collectorOptions) => {
    const CONTROL_ROLES = new Set([
      "button", "checkbox", "combobox", "link", "listbox", "menuitem", "menuitemcheckbox",
      "menuitemradio", "option", "radio", "scrollbar", "searchbox", "slider", "spinbutton",
      "switch", "tab", "textbox", "treeitem"
    ]);
    const WIDGET_ROLES = new Set([
      "accordion", "alert", "alertdialog", "button", "checkbox", "combobox", "dialog",
      "feed", "grid", "link", "listbox", "menu", "menubar", "menuitem", "option",
      "progressbar", "radio", "radiogroup", "scrollbar", "searchbox", "slider",
      "spinbutton", "switch", "tab", "tablist", "tabpanel", "textbox", "toolbar",
      "tooltip", "tree", "treegrid", "treeitem"
    ]);

    function isVisible(el) {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== "hidden" &&
        style.display !== "none" &&
        Number(style.opacity) !== 0 &&
        rect.width > 0 &&
        rect.height > 0;
    }

    function text(el) {
      return (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 240);
    }

    function attr(el, name) {
      return el.getAttribute(name);
    }

    function cssPath(el) {
      if (!el || el.nodeType !== Node.ELEMENT_NODE) return "";
      const parts = [];
      let current = el;
      while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
        let part = current.localName;
        if (current.id) {
          part += `#${CSS.escape(current.id)}`;
          parts.unshift(part);
          break;
        }
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((candidate) => candidate.localName === current.localName);
          if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
        parts.unshift(part);
        current = parent;
      }
      return parts.join(" > ");
    }

    function labelsFor(el) {
      if (el.labels) return Array.from(el.labels).map(text).filter(Boolean);
      return [];
    }

    function byIds(value) {
      if (!value) return "";
      return value.split(/\s+/).map((id) => {
        const found = document.getElementById(id);
        return found ? text(found) : "";
      }).filter(Boolean).join(" ");
    }

    function accessibleName(el) {
      const ariaLabel = attr(el, "aria-label");
      if (ariaLabel) return ariaLabel.trim();
      const labelledBy = byIds(attr(el, "aria-labelledby"));
      if (labelledBy) return labelledBy;
      const labelText = labelsFor(el).join(" ");
      if (labelText) return labelText;
      if (el instanceof HTMLImageElement && attr(el, "alt") !== null) return attr(el, "alt") || "";
      if (el instanceof HTMLInputElement && ["button", "submit", "reset"].includes(el.type)) return el.value || "";
      const ownText = text(el);
      if (ownText) return ownText;
      return attr(el, "title") || attr(el, "placeholder") || "";
    }

    function describedBy(el) {
      const value = byIds(attr(el, "aria-describedby"));
      return value || "";
    }

    function bounds(el) {
      const rect = el.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    }

    function common(el) {
      return {
        selector: cssPath(el),
        tag: el.localName,
        role: attr(el, "role") || "",
        name: accessibleName(el),
        text: text(el),
        visible: isVisible(el),
        bounds: bounds(el),
        id: el.id || "",
        classes: String(el.className || "").slice(0, 160)
      };
    }

    const all = Array.from(document.querySelectorAll("*"));
    const metadata = {
      url: location.href,
      title: document.title || "",
      documentLang: document.documentElement.getAttribute("lang") || "",
      viewportMeta: document.querySelector("meta[name='viewport']")?.getAttribute("content") || "",
      charset: document.characterSet,
      userAgent: navigator.userAgent
    };

    const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role='heading']")).map((el) => ({
      ...common(el),
      level: attr(el, "aria-level") || (el.localName.match(/^h[1-6]$/) ? Number(el.localName.slice(1)) : null)
    }));

    const landmarkSelector = [
      "header", "nav", "main", "footer", "aside", "section[aria-label]", "section[aria-labelledby]",
      "form[aria-label]", "form[aria-labelledby]",
      "[role='banner']", "[role='navigation']", "[role='main']", "[role='contentinfo']",
      "[role='complementary']", "[role='search']", "[role='region']", "[role='form']"
    ].join(",");
    const landmarks = Array.from(document.querySelectorAll(landmarkSelector)).map(common);

    const links = Array.from(document.querySelectorAll("a[href],[role='link']")).map((el) => ({
      ...common(el),
      href: attr(el, "href") || "",
      target: attr(el, "target") || "",
      rel: attr(el, "rel") || "",
      download: attr(el, "download") !== null
    }));

    const buttons = Array.from(document.querySelectorAll("button,input[type='button'],input[type='submit'],input[type='reset'],[role='button']")).map((el) => ({
      ...common(el),
      type: attr(el, "type") || "",
      ariaExpanded: attr(el, "aria-expanded") || "",
      ariaPressed: attr(el, "aria-pressed") || "",
      ariaControls: attr(el, "aria-controls") || ""
    }));

    const fieldSelector = [
      "input:not([type='hidden'])", "select", "textarea",
      "[role='textbox']", "[role='searchbox']", "[role='combobox']", "[role='checkbox']",
      "[role='radio']", "[role='switch']", "[role='slider']", "[role='spinbutton']"
    ].join(",");
    const forms = Array.from(document.querySelectorAll(fieldSelector)).map((el) => ({
      ...common(el),
      type: attr(el, "type") || el.localName,
      labels: labelsFor(el),
      placeholder: attr(el, "placeholder") || "",
      autocomplete: attr(el, "autocomplete") || "",
      required: el.hasAttribute("required") || attr(el, "aria-required") === "true",
      disabled: el.hasAttribute("disabled") || attr(el, "aria-disabled") === "true",
      invalid: attr(el, "aria-invalid") || "",
      describedBy: describedBy(el),
      errorMessageRef: attr(el, "aria-errormessage") || "",
      valuePresent: Boolean(el.value)
    }));

    const formGroups = Array.from(document.querySelectorAll("fieldset,[role='group'],[role='radiogroup']")).map((el) => ({
      ...common(el),
      legend: el.querySelector("legend") ? text(el.querySelector("legend")) : ""
    }));

    const images = Array.from(document.querySelectorAll("img,svg,canvas,[role='img']")).map((el) => ({
      ...common(el),
      alt: attr(el, "alt"),
      src: attr(el, "src") || "",
      ariaHidden: attr(el, "aria-hidden") || "",
      isActive: Boolean(el.closest("a[href],button,[role='button'],[role='link']"))
    }));

    const backgroundImages = all.filter((el) => {
      const style = window.getComputedStyle(el);
      return style.backgroundImage && style.backgroundImage !== "none";
    }).slice(0, 200).map(common);

    const media = Array.from(document.querySelectorAll("audio,video")).map((el) => ({
      ...common(el),
      controls: el.hasAttribute("controls"),
      autoplay: el.hasAttribute("autoplay"),
      muted: el.hasAttribute("muted"),
      tracks: Array.from(el.querySelectorAll("track")).map((track) => ({
        kind: attr(track, "kind") || "",
        srclang: attr(track, "srclang") || "",
        label: attr(track, "label") || "",
        src: attr(track, "src") || ""
      }))
    }));

    const tables = Array.from(document.querySelectorAll("table,[role='table'],[role='grid']")).map((el) => ({
      ...common(el),
      caption: el.querySelector("caption") ? text(el.querySelector("caption")) : "",
      headerCount: el.querySelectorAll("th,[role='columnheader'],[role='rowheader']").length,
      dataCellCount: el.querySelectorAll("td,[role='cell'],[role='gridcell']").length,
      hasScopeHeaders: Boolean(el.querySelector("th[scope]")),
      hasIdHeaders: Boolean(el.querySelector("td[headers],th[headers]"))
    }));

    const iframes = Array.from(document.querySelectorAll("iframe,frame")).map((el) => ({
      ...common(el),
      title: attr(el, "title") || "",
      src: attr(el, "src") || "",
      ariaHidden: attr(el, "aria-hidden") || ""
    }));

    const lists = Array.from(document.querySelectorAll("ul,ol,dl,[role='list']")).map((el) => ({
      ...common(el),
      itemCount: el.querySelectorAll(":scope > li,:scope > dt,:scope > dd,[role='listitem']").length
    }));

    const dialogs = Array.from(document.querySelectorAll("dialog,[role='dialog'],[role='alertdialog']")).map((el) => ({
      ...common(el),
      modal: attr(el, "aria-modal") || (el instanceof HTMLDialogElement && el.open ? "open-dialog" : "")
    }));

    const liveRegions = Array.from(document.querySelectorAll("[aria-live],[role='alert'],[role='status'],[role='log'],[role='marquee'],[role='timer']")).map((el) => ({
      ...common(el),
      ariaLive: attr(el, "aria-live") || "",
      ariaAtomic: attr(el, "aria-atomic") || ""
    }));

    const ariaWidgets = all.filter((el) => WIDGET_ROLES.has(attr(el, "role") || "")).map((el) => ({
      ...common(el),
      ariaExpanded: attr(el, "aria-expanded") || "",
      ariaSelected: attr(el, "aria-selected") || "",
      ariaChecked: attr(el, "aria-checked") || "",
      ariaPressed: attr(el, "aria-pressed") || "",
      ariaValueNow: attr(el, "aria-valuenow") || "",
      ariaControls: attr(el, "aria-controls") || ""
    }));

    const focusableSelector = [
      "a[href]", "button", "input:not([type='hidden'])", "select", "textarea", "summary", "iframe",
      "[tabindex]", "[contenteditable='true']",
      "[role='button']", "[role='link']", "[role='checkbox']", "[role='radio']", "[role='switch']",
      "[role='slider']", "[role='spinbutton']", "[role='combobox']", "[role='textbox']", "[role='tab']",
      "[role='menuitem']", "[role='option']"
    ].join(",");

    const controls = Array.from(document.querySelectorAll(focusableSelector)).map((el) => ({
      ...common(el),
      tabindex: attr(el, "tabindex"),
      disabled: el.hasAttribute("disabled") || attr(el, "aria-disabled") === "true"
    }));

    const positiveTabindex = controls.filter((item) => Number(item.tabindex) > 0);

    const targetSize = controls.filter((item) => item.visible).map((item) => ({
      ...item,
      below24: item.bounds.width < 24 || item.bounds.height < 24,
      below44: item.bounds.width < 44 || item.bounds.height < 44
    }));

    const languageParts = all.filter((el) => attr(el, "lang")).map((el) => ({
      ...common(el),
      lang: attr(el, "lang")
    }));

    const semanticText = Array.from(document.querySelectorAll("em,strong,mark,blockquote,q,del,ins,s")).map(common);
    const skipLinks = links.filter((link) => /^#/.test(link.href) || /skip|main content/i.test(`${link.name} ${link.text}`));
    const draggable = all.filter((el) => el.draggable || attr(el, "draggable") === "true").map(common);
    const motionCandidates = all.filter((el) => {
      const style = window.getComputedStyle(el);
      const animation = style.animationName && style.animationName !== "none";
      const transition = style.transitionDuration && style.transitionDuration !== "0s";
      return animation || transition;
    }).slice(0, 200).map(common);
    const captchaCandidates = all.filter((el) => /captcha|challenge|verify human|i am not a robot/i.test(`${text(el)} ${attr(el, "id") || ""} ${attr(el, "class") || ""}`)).map(common);
    const shadowDom = collectorOptions.captureShadowDom ? (() => {
      const hostElements = all.filter((el) => el.shadowRoot);
      const customElementCandidates = all
        .filter((el) => el.localName.includes("-") && !el.shadowRoot)
        .slice(0, 200)
        .map(common);
      const shadowControls = [];
      const shadowHeadings = [];
      const shadowLinks = [];
      const shadowForms = [];
      const shadowImages = [];
      const shadowWidgets = [];

      function shadowCommon(el, host) {
        const base = common(el);
        return {
          ...base,
          selector: `${cssPath(host)} ::shadow ${base.selector || el.localName}`,
          shadowHost: cssPath(host),
          shadowHostName: accessibleName(host)
        };
      }

      for (const host of hostElements.slice(0, 100)) {
        const root = host.shadowRoot;
        shadowControls.push(
          ...Array.from(root.querySelectorAll(focusableSelector)).slice(0, 200).map((el) => ({
            ...shadowCommon(el, host),
            tabindex: attr(el, "tabindex"),
            disabled: el.hasAttribute("disabled") || attr(el, "aria-disabled") === "true"
          }))
        );
        shadowHeadings.push(
          ...Array.from(root.querySelectorAll("h1,h2,h3,h4,h5,h6,[role='heading']")).slice(0, 100).map((el) => ({
            ...shadowCommon(el, host),
            level: attr(el, "aria-level") || (el.localName.match(/^h[1-6]$/) ? Number(el.localName.slice(1)) : null)
          }))
        );
        shadowLinks.push(...Array.from(root.querySelectorAll("a[href],[role='link']")).slice(0, 150).map((el) => ({
          ...shadowCommon(el, host),
          href: attr(el, "href") || ""
        })));
        shadowForms.push(...Array.from(root.querySelectorAll(fieldSelector)).slice(0, 150).map((el) => ({
          ...shadowCommon(el, host),
          type: attr(el, "type") || el.localName,
          labels: labelsFor(el),
          placeholder: attr(el, "placeholder") || "",
          autocomplete: attr(el, "autocomplete") || "",
          required: el.hasAttribute("required") || attr(el, "aria-required") === "true",
          describedBy: describedBy(el)
        })));
        shadowImages.push(...Array.from(root.querySelectorAll("img,svg,canvas,[role='img']")).slice(0, 150).map((el) => ({
          ...shadowCommon(el, host),
          alt: attr(el, "alt"),
          ariaHidden: attr(el, "aria-hidden") || ""
        })));
        shadowWidgets.push(...Array.from(root.querySelectorAll("[role]")).filter((el) => WIDGET_ROLES.has(attr(el, "role") || "")).slice(0, 150).map((el) => shadowCommon(el, host)));
      }

      return {
        openHostCount: hostElements.length,
        hosts: hostElements.slice(0, 100).map((host) => ({
          ...common(host),
          shadowElementCount: host.shadowRoot.querySelectorAll("*").length
        })),
        customElementCandidates,
        controls: shadowControls,
        headings: shadowHeadings,
        links: shadowLinks,
        forms: shadowForms,
        images: shadowImages,
        ariaWidgets: shadowWidgets
      };
    })() : {
      skipped: true,
      openHostCount: 0,
      hosts: [],
      customElementCandidates: [],
      controls: [],
      headings: [],
      links: [],
      forms: [],
      images: [],
      ariaWidgets: []
    };

    return {
      metadata,
      headings,
      landmarks,
      links,
      buttons,
      forms,
      formGroups,
      images,
      backgroundImages,
      media,
      tables,
      iframes,
      lists,
      dialogs,
      liveRegions,
      ariaWidgets,
      controls,
      positiveTabindex,
      targetSize,
      languageParts,
      semanticText,
      skipLinks,
      draggable,
      motionCandidates,
      captchaCandidates,
      shadowDom
    };
  }, { captureShadowDom: options.captureShadowDom !== false });
}

async function collectFocusOrder(page, outDir, options, direction = "forward") {
  const focusDir = path.join(outDir, "screenshots", direction === "reverse" ? "focus-reverse" : "focus");
  if (options.focusScreenshots) ensureDir(focusDir);

  await page.keyboard.press("Escape").catch(() => {});
  if (direction === "reverse") {
    await page.evaluate(() => {
      const selector = [
        "a[href]", "button", "input:not([type='hidden'])", "select", "textarea", "summary", "iframe",
        "[tabindex]", "[contenteditable='true']",
        "[role='button']", "[role='link']", "[role='checkbox']", "[role='radio']", "[role='switch']",
        "[role='slider']", "[role='spinbutton']", "[role='combobox']", "[role='textbox']", "[role='tab']",
        "[role='menuitem']", "[role='option']"
      ].join(",");
      const focusables = Array.from(document.querySelectorAll(selector)).filter((el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const disabled = el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true";
        const tabindex = el.getAttribute("tabindex");
        return !disabled && tabindex !== "-1" && style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      });
      const last = focusables[focusables.length - 1];
      if (last && last instanceof HTMLElement) last.focus();
    }).catch(() => {});
  } else {
    await page.evaluate(() => {
    if (document.activeElement && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    }).catch(() => {});
  }

  const seen = new Map();
  const steps = [];
  const keyToPress = direction === "reverse" ? "Shift+Tab" : "Tab";

  for (let i = 0; i < options.maxTabs; i += 1) {
    await page.keyboard.press(keyToPress);
    await page.waitForTimeout(80);
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) {
        return { inPage: false, tag: el ? el.localName : "", name: "", selector: "", role: "", text: "" };
      }

      function text(node) {
        return (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 180);
      }
      function attr(node, name) {
        return node.getAttribute(name);
      }
      function byIds(value) {
        if (!value) return "";
        return value.split(/\s+/).map((id) => {
          const found = document.getElementById(id);
          return found ? text(found) : "";
        }).filter(Boolean).join(" ");
      }
      function labelsFor(node) {
        if (node.labels) return Array.from(node.labels).map(text).filter(Boolean);
        return [];
      }
      function accessibleName(node) {
        const ariaLabel = attr(node, "aria-label");
        if (ariaLabel) return ariaLabel.trim();
        const labelledBy = byIds(attr(node, "aria-labelledby"));
        if (labelledBy) return labelledBy;
        const labelText = labelsFor(node).join(" ");
        if (labelText) return labelText;
        if (node instanceof HTMLImageElement && attr(node, "alt") !== null) return attr(node, "alt") || "";
        if (node instanceof HTMLInputElement && ["button", "submit", "reset"].includes(node.type)) return node.value || "";
        return text(node) || attr(node, "title") || attr(node, "placeholder") || "";
      }
      function cssPath(node) {
        const parts = [];
        let current = node;
        while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
          let part = current.localName;
          if (current.id) {
            part += `#${CSS.escape(current.id)}`;
            parts.unshift(part);
            break;
          }
          const parent = current.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter((candidate) => candidate.localName === current.localName);
            if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
          }
          parts.unshift(part);
          current = parent;
        }
        return parts.join(" > ");
      }
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const centerX = rect.x + rect.width / 2;
      const centerY = rect.y + rect.height / 2;
      const topElement = document.elementFromPoint(centerX, centerY);
      const focusStyle = {
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        outlineColor: style.outlineColor,
        boxShadow: style.boxShadow,
        borderColor: style.borderColor
      };
      const hasObviousFocusStyle =
        (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) ||
        (style.boxShadow && style.boxShadow !== "none");
      return {
        inPage: true,
        tag: el.localName,
        role: attr(el, "role") || "",
        name: accessibleName(el),
        text: text(el),
        selector: cssPath(el),
        href: attr(el, "href") || "",
        tabindex: attr(el, "tabindex"),
        bounds: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        },
        focusStyle,
        hasObviousFocusStyle,
        possiblyObscured: Boolean(topElement && topElement !== el && !el.contains(topElement))
      };
    });

    info.step = i + 1;
    info.direction = direction;
    if (options.focusScreenshots && info.inPage) {
      const file = path.join(focusDir, `focus-${String(i + 1).padStart(3, "0")}.png`);
      await page.screenshot({ path: file, fullPage: false });
      info.screenshot = path.relative(outDir, file).replace(/\\/g, "/");
    }
    steps.push(info);

    const key = `${info.selector}|${info.name}|${info.tag}`;
    const count = seen.get(key) || 0;
    seen.set(key, count + 1);
    if (info.inPage && steps.length > 3 && count > 0) break;
    if (!info.inPage && steps.length > 10) break;
  }

  return steps;
}

async function collectVisualState(page) {
  return page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("*"));
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight
    };
    const overflowCandidates = all.filter((el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") return false;
      return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
    }).slice(0, 100).map((el) => {
      const rect = el.getBoundingClientRect();
      const path = [];
      let current = el;
      while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
        let part = current.localName;
        if (current.id) {
          part += `#${CSS.escape(current.id)}`;
          path.unshift(part);
          break;
        }
        path.unshift(part);
        current = current.parentElement;
      }
      return {
        selector: path.join(" > "),
        text: (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120),
        bounds: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        },
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight
      };
    });
    return {
      viewport,
      pageOverflowsHorizontally: document.documentElement.scrollWidth > window.innerWidth + 1,
      overflowCandidateCount: overflowCandidates.length,
      overflowCandidates
    };
  });
}

async function captureVisualModes(page, outDir, viewport, options) {
  const captures = [];
  if (!options.captureScreenshots || !options.captureVisualModes) return captures;
  const modeDir = path.join(outDir, "screenshots", "visual-modes");
  ensureDir(modeDir);

  async function snap(name, setup, restore) {
    try {
      await setup();
      await page.waitForTimeout(150);
      const file = path.join(modeDir, `${name}.png`);
      await page.screenshot({ path: file, fullPage: true });
      captures.push({
        name,
        file: path.relative(outDir, file).replace(/\\/g, "/"),
        state: await collectVisualState(page)
      });
    } catch (error) {
      captures.push({ name, error: error.message });
    } finally {
      if (restore) await restore().catch(() => {});
      await page.waitForTimeout(50).catch(() => {});
    }
  }

  await snap(
    "zoom-200-css",
    async () => page.evaluate(() => { document.documentElement.style.zoom = "200%"; }),
    async () => page.evaluate(() => { document.documentElement.style.zoom = ""; })
  );
  await snap(
    "text-spacing",
    async () => page.addStyleTag({
      content: `
        * {
          line-height: 1.5 !important;
          letter-spacing: 0.12em !important;
          word-spacing: 0.16em !important;
        }
        p, li, blockquote {
          margin-bottom: 2em !important;
        }
      `
    }).then((handle) => { page.__a11yTextSpacingHandle = handle; }),
    async () => {
      if (page.__a11yTextSpacingHandle) {
        await page.__a11yTextSpacingHandle.evaluate((node) => node.remove());
        page.__a11yTextSpacingHandle = null;
      }
    }
  );
  await snap(
    "forced-colors",
    async () => page.emulateMedia({ forcedColors: "active" }),
    async () => page.emulateMedia({ forcedColors: "none" })
  );
  await snap(
    "reduced-motion",
    async () => page.emulateMedia({ reducedMotion: "reduce" }),
    async () => page.emulateMedia({ reducedMotion: "no-preference" })
  );
  await page.setViewportSize(viewport).catch(() => {});
  return captures;
}

async function collectFrameEvidence(page, args) {
  if (!args.captureIframes) return [];
  const mainFrame = page.mainFrame();
  const frames = page.frames().filter((frame) => frame !== mainFrame);
  const frameEvidence = [];
  for (const frame of frames.slice(0, 50)) {
    const entry = {
      name: frame.name(),
      url: frame.url(),
      parentUrl: frame.parentFrame() ? frame.parentFrame().url() : "",
      inventory: null,
      axeSummary: null,
      error: ""
    };
    try {
      entry.inventory = await collectInventory(frame, args);
    } catch (error) {
      entry.error = `inventory failed: ${error.message}`;
    }
    try {
      const frameAxe = await maybeRunAxe(frame, { wcag: args.wcag, level: args.level }, args);
      entry.axeSummary = {
        available: frameAxe.available !== false,
        error: frameAxe.error || "",
        violationCount: (frameAxe.violations || []).length,
        violations: (frameAxe.violations || []).map((item) => ({
          id: item.id,
          impact: item.impact,
          tags: item.tags,
          help: item.help,
          nodes: item.nodes.map((node) => ({ target: node.target, failureSummary: node.failureSummary }))
        }))
      };
    } catch (error) {
      entry.axeSummary = { available: false, error: `axe failed: ${error.message}`, violationCount: 0, violations: [] };
    }
    frameEvidence.push(entry);
  }
  return frameEvidence;
}

async function collectWidgetProbes(page, inventory, options) {
  if (!options.captureWidgetProbes || options.maxWidgetProbes === 0) return [];
  const widgets = [
    ...(inventory.ariaWidgets || []),
    ...(inventory.dialogs || []),
    ...(inventory.buttons || []).filter((button) => /true|false/i.test(String(button.ariaExpanded || button.text || "")))
  ];
  const seen = new Set();
  const candidates = widgets
    .filter((item) => item.selector && !item.selector.includes("::shadow"))
    .filter((item) => {
      const key = item.selector;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, options.maxWidgetProbes);

  const probes = [];
  for (const candidate of candidates) {
    const probe = {
      selector: candidate.selector,
      role: candidate.role,
      name: candidate.name,
      keysTried: ["ArrowDown", "Escape"],
      before: null,
      afterArrowDown: null,
      afterEscape: null,
      error: ""
    };
    try {
      const locator = page.locator(candidate.selector).first();
      await locator.focus({ timeout: 2000 });
      probe.before = await locator.evaluate((el) => {
        const active = document.activeElement;
        return {
          role: el.getAttribute("role") || "",
          name: el.getAttribute("aria-label") || el.textContent?.replace(/\s+/g, " ").trim().slice(0, 160) || "",
          ariaExpanded: el.getAttribute("aria-expanded"),
          ariaSelected: el.getAttribute("aria-selected"),
          ariaChecked: el.getAttribute("aria-checked"),
          ariaPressed: el.getAttribute("aria-pressed"),
          activeSelector: active ? active.localName + (active.id ? `#${active.id}` : "") : ""
        };
      });
      await page.keyboard.press("ArrowDown").catch(() => {});
      await page.waitForTimeout(80);
      probe.afterArrowDown = await locator.evaluate((el) => {
        const active = document.activeElement;
        return {
          ariaExpanded: el.getAttribute("aria-expanded"),
          ariaSelected: el.getAttribute("aria-selected"),
          ariaChecked: el.getAttribute("aria-checked"),
          ariaPressed: el.getAttribute("aria-pressed"),
          activeSelector: active ? active.localName + (active.id ? `#${active.id}` : "") : ""
        };
      });
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(80);
      probe.afterEscape = await locator.evaluate((el) => {
        const active = document.activeElement;
        return {
          ariaExpanded: el.getAttribute("aria-expanded"),
          ariaSelected: el.getAttribute("aria-selected"),
          ariaChecked: el.getAttribute("aria-checked"),
          ariaPressed: el.getAttribute("aria-pressed"),
          activeSelector: active ? active.localName + (active.id ? `#${active.id}` : "") : ""
        };
      });
    } catch (error) {
      probe.error = error.message;
    }
    probes.push(probe);
  }
  return probes;
}

function summarizeApplicability(inventory) {
  const has = {
    forms: inventory.forms.length > 0 || inventory.formGroups.length > 0,
    links: inventory.links.length > 0,
    media: inventory.media.length > 0,
    images: inventory.images.length > 0 || inventory.backgroundImages.length > 0,
    tables: inventory.tables.length > 0,
    iframes: inventory.iframes.length > 0,
    customWidgets: inventory.ariaWidgets.length > 0,
    dynamicContent: inventory.liveRegions.length > 0 || inventory.dialogs.length > 0,
    captcha: inventory.captchaCandidates.length > 0,
    motion: inventory.motionCandidates.length > 0 || inventory.media.some((item) => item.autoplay),
    lists: inventory.lists.length > 0
  };

  return {
    has,
    candidateNaReasons: {
      "structure.tables": has.tables ? "" : "No data or layout tables were detected in this page state.",
      "structure.iframes": has.iframes ? "" : "No iframe or frame elements were detected in this page state.",
      "structure.lists": has.lists ? "" : "No semantic list elements were detected; tester should confirm no visual list-like content exists.",
      "links.semantic-purpose": has.links ? "" : "No links were detected in this page state.",
      "links.keyboard-focus": has.links ? "" : "No links were detected in this page state.",
      "images.alternative-text": has.images ? "" : "No images, SVGs, canvas, or CSS background images were detected in this page state.",
      "images.images-of-text": has.images ? "" : "No image-like content was detected; tester should confirm no image contains informative text.",
      "media.audio-video": has.media ? "" : "No audio or video elements were detected in this page state.",
      "motion.animation-timed-content": has.motion ? "" : "No obvious animation, motion, autoplaying media, or timed content was detected; tester should confirm live UI behavior.",
      "forms.input-labels": has.forms ? "" : "No form fields or form-like custom controls were detected in this page state.",
      "forms.input-purpose-instructions": has.forms ? "" : "No form fields were detected in this page state.",
      "forms.timing-redundant-authentication": has.forms ? "" : "No form process was detected; tester should confirm there is no timed, redundant-entry, or authentication flow in this page state.",
      "forms.validation-feedback": has.forms ? "" : "No forms or user-submitted input were detected in this page state.",
      "dynamic.content-changes": has.dynamicContent ? "" : "No dialogs, live regions, or obvious dynamic-content containers were detected; tester should confirm no dynamic interactions exist.",
      "widgets.name-role-value": has.customWidgets ? "" : "No custom ARIA widgets were detected; tester should confirm all controls are native or no custom widgets exist.",
      "widgets.keyboard-patterns": has.customWidgets ? "" : "No custom ARIA widget patterns were detected.",
      "captcha": has.captcha ? "" : "No CAPTCHA or human verification challenge was detected in this page state."
    }
  };
}

function createManualTemplate({ checklist, evidence, applicability }) {
  const lines = [];
  lines.push(`# Manual Accessibility Verification Template`);
  lines.push("");
  lines.push(`Page: ${evidence.metadata.finalUrl}`);
  lines.push(`WCAG target: ${evidence.target.wcag} ${evidence.target.level}`);
  lines.push(`Generated: ${evidence.metadata.generatedAt}`);
  lines.push("");
  lines.push("Every AI-supported item still requires human final verification.");
  lines.push("");

  for (const item of checklist.items) {
    const naReason = applicability.candidateNaReasons[item.id] || "";
    lines.push(`## ${item.id}`);
    lines.push("");
    lines.push(`Topic: ${item.topic}`);
    lines.push(`Requirement: ${item.requirement}`);
    lines.push(`WCAG: ${item.wcag.join(", ")} (${item.level}, introduced ${item.introduced})`);
    lines.push(`Test mode: ${item.testMode}`);
    lines.push(`AI assessment: Pending`);
    lines.push(`Human final result: Pending`);
    lines.push("");
    if (naReason) {
      lines.push(`N/A candidate reason: ${naReason}`);
      lines.push("");
    }
    lines.push("Manual verification steps:");
    item.manualSteps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
    lines.push("");
    lines.push(`Pass criteria: ${item.passCriteria}`);
    lines.push(`N/A criteria: ${item.naCriteria}`);
    lines.push("");
    lines.push("Tester notes:");
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function createChecklistDetailsForPrompt(checklist) {
  const lines = [];
  lines.push("Complete Deque/WCAG checkpoint details to analyze:");
  lines.push("");
  for (const item of checklist.items || []) {
    lines.push(`## ${item.id}`);
    lines.push(`Topic: ${item.topic}`);
    lines.push(`Requirement: ${item.requirement}`);
    lines.push(`WCAG: ${item.wcag.join(", ")} | Level: ${item.level} | Introduced: ${item.introduced}`);
    lines.push(`Test mode: ${item.testMode}`);
    if (item.evidenceSignals?.length) lines.push(`Evidence signals to inspect: ${item.evidenceSignals.join(", ")}`);
    lines.push("Manual verification steps:");
    for (const [index, step] of (item.manualSteps || []).entries()) lines.push(`${index + 1}. ${step}`);
    lines.push(`Pass criteria: ${item.passCriteria}`);
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

function createAiPrompt({ checklistPath, evidence }) {
  return `You are reviewing a web page for AI-assisted accessibility verification.

Use the evidence files in this directory and the checklist map at:
${checklistPath}

Primary checklist sources:
${sourceDetailsForTarget(evidence.target)}

Target:
- WCAG version: ${evidence.target.wcag}
- Level: ${evidence.target.level}

Rules:
- Do not mark final Pass. Only produce AI assessment states.
- The human tester must re-verify every item, including likely implemented items.
- For every N/A candidate, provide a specific reason and ask the tester to confirm.
- Use selectors, visible text, screenshots, axe results, and accessibility-tree details as evidence.
- For each checklist item, produce manual steps, pass criteria, fail indicators, and recommended fix if a gap is found.

Required report sections:
1. Executive summary
2. Automated findings summary
3. AI checklist assessment table
4. Implementation gaps for developers
5. Manual verification pack for testers
6. N/A candidates with reasons
7. Residual risks and items needing screen reader/manual-only judgment

${createChecklistDetailsForPrompt(evidence.checklist)}
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  ensureDir(args.out);
  ensureDir(path.join(args.out, "screenshots"));

  const checklistRaw = readJson(args.checklist);
  const checklist = filterChecklist(checklistRaw, {
    wcag: args.wcag,
    level: args.level,
    includeBestPractice: args.includeBestPractice
  });

  const { chromium } = await loadPlaywright(args);
  const viewport = parseViewport(args.viewport);
  const browser = await chromium.launch({ headless: !(args.headed || args.manualCapture) });
  const contextOptions = { viewport };
  if (args.storageState) contextOptions.storageState = args.storageState;
  const context = await browser.newContext(contextOptions);
  context.setDefaultTimeout(args.timeout);
  const page = await context.newPage();

  try {
    await runScenario(page, context, browser, args.scenario, args.url);
    if (args.manualCapture) await waitForManualCapture(page);
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});

    const finalUrl = page.url();
    const title = await page.title();
    if (args.captureScreenshots) {
      await page.screenshot({ path: path.join(args.out, "screenshots", "full-page.png"), fullPage: true });
    }

    const responsiveScreenshots = [];
    if (args.captureScreenshots) {
      for (const vp of [
        { name: "desktop", width: viewport.width, height: viewport.height },
        { name: "narrow-320", width: 320, height: 720 },
        { name: "tablet", width: 768, height: 1024 }
      ]) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.waitForTimeout(150);
        const file = path.join(args.out, "screenshots", `${vp.name}.png`);
        await page.screenshot({ path: file, fullPage: true });
        responsiveScreenshots.push({ ...vp, file: path.relative(args.out, file).replace(/\\/g, "/") });
      }
    }
    await page.setViewportSize(viewport);
    const visualModeCaptures = await captureVisualModes(page, args.out, viewport, args);

    const inventory = await collectInventory(page, args);
    const focusOrder = await collectFocusOrder(page, args.out, args, "forward");
    const reverseFocusOrder = args.captureReverseFocus
      ? await collectFocusOrder(page, args.out, args, "reverse")
      : [];
    const axe = await maybeRunAxe(page, { wcag: args.wcag, level: args.level }, args);
    const accessibilityTree = page.accessibility && typeof page.accessibility.snapshot === "function"
      ? await page.accessibility.snapshot({ interestingOnly: false }).catch((error) => ({
        available: false,
        error: error.message
      }))
      : {
        available: false,
        error: "Playwright accessibility snapshot API is not available in this installed Playwright version."
      };
    const frameEvidence = await collectFrameEvidence(page, args);
    const widgetProbes = await collectWidgetProbes(page, inventory, args);
    if (args.captureHtml) {
      const html = await page.content();
      fs.writeFileSync(path.join(args.out, "page.html"), html, "utf8");
    }

    const applicability = summarizeApplicability(inventory);
    const evidence = {
      target: {
        wcag: args.wcag,
        level: args.level,
        includeBestPractice: args.includeBestPractice,
        axeTags: axeTagsForTarget(args.wcag, args.level)
      },
      metadata: {
        generatedAt: new Date().toISOString(),
        finalUrl,
        title,
        scenario: args.scenario || "",
        sourceUrl: args.url || "",
        manualCapture: args.manualCapture,
        viewport,
        captureScreenshots: args.captureScreenshots,
        captureHtml: args.captureHtml,
        captureIframes: args.captureIframes,
        captureShadowDom: args.captureShadowDom,
        captureReverseFocus: args.captureReverseFocus,
        captureVisualModes: args.captureVisualModes,
        captureWidgetProbes: args.captureWidgetProbes
      },
      summary: {
        checklistItemsIncluded: checklist.items.length,
        axeAvailable: Boolean(axe.available !== false),
        axeViolationCount: axe.violations ? axe.violations.length : 0,
        axeIncompleteCount: axe.incomplete ? axe.incomplete.length : 0,
        focusSteps: focusOrder.length,
        reverseFocusSteps: reverseFocusOrder.length,
        frameCount: frameEvidence.length,
        frameAxeViolationCount: frameEvidence.reduce((count, frame) => count + (frame.axeSummary?.violationCount || 0), 0),
        visualModeCaptureCount: visualModeCaptures.length,
        visualModeOverflowCount: visualModeCaptures.filter((capture) => capture.state?.pageOverflowsHorizontally || capture.state?.overflowCandidateCount).length,
        widgetProbeCount: widgetProbes.length,
        counts: {
          headings: inventory.headings.length,
          landmarks: inventory.landmarks.length,
          links: inventory.links.length,
          controls: inventory.controls.length,
          forms: inventory.forms.length,
          images: inventory.images.length,
          media: inventory.media.length,
          tables: inventory.tables.length,
          iframes: inventory.iframes.length,
          ariaWidgets: inventory.ariaWidgets.length,
          dialogs: inventory.dialogs.length,
          liveRegions: inventory.liveRegions.length,
          positiveTabindex: inventory.positiveTabindex.length,
          targetSizeBelow24: inventory.targetSize.filter((item) => item.below24).length,
          shadowOpenHosts: inventory.shadowDom?.openHostCount || 0,
          shadowControls: inventory.shadowDom?.controls?.length || 0,
          shadowCustomElementCandidates: inventory.shadowDom?.customElementCandidates?.length || 0
        }
      },
      inventory,
      focusOrder,
      reverseFocusOrder,
      axeSummary: {
        available: axe.available !== false,
        error: axe.error || "",
        violations: (axe.violations || []).map((item) => ({
          id: item.id,
          impact: item.impact,
          tags: item.tags,
          description: item.description,
          help: item.help,
          helpUrl: item.helpUrl,
          nodes: item.nodes.map((node) => ({
            target: node.target,
            html: node.html,
            failureSummary: node.failureSummary
          }))
        })),
        incomplete: (axe.incomplete || []).map((item) => ({
          id: item.id,
          impact: item.impact,
          tags: item.tags,
          description: item.description,
          help: item.help,
          helpUrl: item.helpUrl,
          nodes: item.nodes.map((node) => ({ target: node.target, html: node.html }))
        }))
      },
      responsiveScreenshots,
      visualModeCaptures,
      frameEvidence,
      widgetProbes,
      applicability,
      checklist
    };

    writeJson(path.join(args.out, "accessibility-tree.json"), accessibilityTree);
    writeJson(path.join(args.out, "axe-results.json"), axe);
    writeJson(path.join(args.out, "focus-order.json"), focusOrder);
    writeJson(path.join(args.out, "reverse-focus-order.json"), reverseFocusOrder);
    writeJson(path.join(args.out, "frame-evidence.json"), frameEvidence);
    writeJson(path.join(args.out, "visual-modes.json"), visualModeCaptures);
    writeJson(path.join(args.out, "widget-probes.json"), widgetProbes);
    writeJson(path.join(args.out, "evidence.json"), evidence);
    fs.writeFileSync(
      path.join(args.out, "manual-verification-template.md"),
      createManualTemplate({ checklist, evidence, applicability }),
      "utf8"
    );
    fs.writeFileSync(
      path.join(args.out, "ai-review-prompt.md"),
      createAiPrompt({ checklistPath: path.relative(args.out, args.checklist).replace(/\\/g, "/"), evidence }),
      "utf8"
    );

    console.log(`Accessibility evidence written to: ${args.out}`);
    console.log(`Checklist items included: ${checklist.items.length}`);
    console.log(`axe violations: ${evidence.summary.axeViolationCount}`);
    console.log(`Focus steps captured: ${focusOrder.length}`);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
  }
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
