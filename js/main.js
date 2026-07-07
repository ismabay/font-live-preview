const FONT_EXTS = ["ttf", "otf", "woff", "woff2"];
const ACTIVATABLE_EXTS = ["ttf", "otf"]; // only real desktop-installable formats
const LIKE_RATING = 5;

// ---- Platform-aware font activation (installs/removes the font from the OS) ----
const os = require("os");
const fs = require("fs");
const path = require("path");
const https = require("https");
const { execFile } = require("child_process");

const PLATFORM = os.platform();
const IS_MAC = PLATFORM === "darwin";
const IS_WIN = PLATFORM === "win32";

const SYSTEM_RATINGS_FILE = path.join(os.homedir(), ".font-live-preview-system-ratings.json");
const GOOGLE_CACHE_DIR = path.join(os.homedir(), ".font-live-preview-google-cache");

const els = {
  input: document.getElementById("previewText"),
  size: document.getElementById("sizeSlider"),
  topbar: document.getElementById("topbar"),
  controlsToggleBtn: document.getElementById("controlsToggleBtn"),
  grid: document.getElementById("grid"),
  systemGrid: document.getElementById("systemGrid"),
  status: document.getElementById("status"),
  count: document.getElementById("itemCount"),
  rescan: document.getElementById("rescanBtn"),
  includeSubfolders: document.getElementById("includeSubfolders"),
  viewGridBtn: document.getElementById("viewGridBtn"),
  viewListBtn: document.getElementById("viewListBtn"),
  bgLightBtn: document.getElementById("bgLightBtn"),
  bgDarkBtn: document.getElementById("bgDarkBtn"),
  filterActiveBtn: document.getElementById("filterActiveBtn"),
  filterInactiveBtn: document.getElementById("filterInactiveBtn"),
  ratingFilter: document.getElementById("ratingFilter"),
  modeFolderBtn: document.getElementById("modeFolderBtn"),
  modeSystemBtn: document.getElementById("modeSystemBtn"),
  modeGoogleBtn: document.getElementById("modeGoogleBtn"),
  googleSearchRow: document.getElementById("googleSearchRow"),
  googleSearchInput: document.getElementById("googleSearchInput"),
  googleGrid: document.getElementById("googleGrid"),
  nameSearchRow: document.getElementById("nameSearchRow"),
  nameSearchInput: document.getElementById("nameSearchInput"),
  mainView: document.getElementById("mainView"),
  detailView: document.getElementById("detailView"),
  backBtn: document.getElementById("backBtn"),
  detailFontName: document.getElementById("detailFontName"),
  detailStars: document.getElementById("detailStars"),
  detailActivateBadge: document.getElementById("detailActivateBadge"),
  detailSizeSlider: document.getElementById("detailSizeSlider"),
  tabButtons: document.querySelectorAll(".tab-btn"),
  tabStyles: document.getElementById("tab-styles"),
  tabPreview: document.getElementById("tab-preview"),
  tabWaterfall: document.getElementById("tab-waterfall"),
  tabGlyphs: document.getElementById("tab-glyphs"),
  tabDetails: document.getElementById("tab-details"),
};

const GLYPH_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,:;!?'\"-()&@#%".split("");

// Broad candidate pool checked against each font's real glyph table (via opentype.js).
// Only the characters the font actually contains are shown; the rest are simply skipped.
const GLYPH_CANDIDATES = (
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ" +
  "abcdefghijklmnopqrstuvwxyz" +
  "0123456789" +
  ".,:;!?'\"-()[]{}/\\@#$%^&*_+=<>|~`" +
  "ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÑÒÓÔÕÖØÙÚÛÜÝ" +
  "àáâãäåæçèéêëìíîïñòóôõöøùúûüýÿ" +
  "€£¥¢§¶©®™°±×÷" +
  "←→↑↓•…–—"
).split("");
const WATERFALL_SIZES = [64, 48, 36, 28, 22, 18, 15, 12];
const DEFAULT_PANGRAM = "The quick brown fox jumps over the lazy dog";

const PREVIEW_CONTENT = {
  h1: "Choosing the right typeface",
  h2: "A good typeface earns its place through legibility, not decoration.",
  body:
    "Every typeface carries a personality shaped by its proportions, contrast, and rhythm. Before committing to one for a project, it helps to see it set at several sizes and in real sentences — headlines behave differently than long paragraphs, and a face that feels elegant at large sizes can turn awkward once shrunk down for body text.",
  col1:
    "Pair a display face with a calmer, more neutral partner for body copy. Most readers won't consciously notice the typeface at all when it's doing its job well, they'll simply read comfortably, and that quiet reliability is exactly the point. A display face is allowed to have personality: exaggerated contrast, unusual proportions, a bit of flair in the terminals. It's meant to be looked at, not just read. But once that same energy carries into paragraph after paragraph of body copy, the eye tires quickly and the reading experience starts to feel like work rather than communication. This is why so many strong brand systems pair one expressive typeface for headlines with a second, quieter one for everything else. The contrast between the two actually reinforces the hierarchy of the page: the reader's eye is drawn to the bold statement first, then settles into the neutral voice underneath for the details. Testing this pairing early, before a single line of real copy exists, saves a lot of second-guessing later once a client or team has already fallen in love with a headline font that turns out to be unreadable at ten point size.",
  col2:
    "Look closely at spacing, x-height, and how the punctuation sits on the line. These small details are what separate a typeface that merely looks good from one that reads well over a full page. A generous x-height, for instance, tends to improve legibility at small sizes because the lowercase letters (where most of the reading actually happens) have more room to breathe. Tight letter spacing can look elegant in a logotype but turns into a headache in a paragraph, where letters start to visually collide and the reader has to work harder to separate one word from the next. Punctuation is an easy thing to overlook, but a comma or quotation mark that sits awkwardly high or low on the baseline will quietly undermine an otherwise beautiful typeface every time it appears. The same goes for numerals: old-style figures that rise and dip like lowercase letters feel completely different in a table full of tabular figures lined up neatly in a column. None of this shows up in a single specimen word like 'Typography', it only becomes visible once you set real sentences, in context, at the actual size the font will be used.",
};

let loadedFonts = []; // { item, family, ok }
let systemFontEntries = []; // { file, dir, locked, filePath, family, ok }
let viewMode = "list"; // "list" | "grid"
let bgMode = "light"; // "light" | "dark"
let activationFilter = "all"; // "all" | "active" | "inactive"
let ratingFilter = 0; // 0 = no filter, else minimum star rating required
let nameSearchQuery = "";
let contentMode = "folder"; // "folder" | "system" | "google"
let googleFontsMetadata = null; // null = not fetched yet
let googleResultEntries = []; // currently rendered Google Fonts pool
let googleSearchTimer = null;
let googleRequestId = 0;

// ================= View / background / filter toggles =================
function setViewMode(mode) {
  viewMode = mode;
  document.querySelectorAll(".font-list-container").forEach((el) => {
    el.classList.toggle("view-list", mode === "list");
    el.classList.toggle("view-grid", mode === "grid");
  });
  els.viewListBtn.classList.toggle("active", mode === "list");
  els.viewGridBtn.classList.toggle("active", mode === "grid");
}

function setBgMode(mode) {
  bgMode = mode;
  document.querySelectorAll(".font-list-container").forEach((el) => {
    el.classList.toggle("bg-light", mode === "light");
  });
  els.googleSearchRow.classList.toggle("bg-light", mode === "light");
  els.nameSearchRow.classList.toggle("bg-light", mode === "light");
  els.bgLightBtn.classList.toggle("active", mode === "light");
  els.bgDarkBtn.classList.toggle("active", mode === "dark");
}

function setActivationFilter(mode) {
  activationFilter = activationFilter === mode ? "all" : mode;
  els.filterActiveBtn.classList.toggle("selected", activationFilter === "active");
  els.filterInactiveBtn.classList.toggle("selected", activationFilter === "inactive");
  renderGrid();
}

function buildRatingFilterWidget() {
  els.ratingFilter.innerHTML = "";
  for (let i = 0; i < 5; i++) {
    const star = document.createElement("span");
    star.className = "star" + (i < ratingFilter ? " filled" : "");
    star.textContent = "★";
    star.title = `Show only fonts rated ${i + 1}+ stars`;
    star.addEventListener("click", () => {
      ratingFilter = ratingFilter === i + 1 ? 0 : i + 1;
      buildRatingFilterWidget();
      renderGrid();
      renderSystemGrid();
    });
    els.ratingFilter.appendChild(star);
  }
}

function setContentMode(mode) {
  contentMode = mode;
  els.modeFolderBtn.classList.toggle("active", mode === "folder");
  els.modeSystemBtn.classList.toggle("active", mode === "system");
  els.modeGoogleBtn.classList.toggle("active", mode === "google");
  els.grid.classList.toggle("hidden", mode !== "folder");
  els.systemGrid.classList.toggle("hidden", mode !== "system");
  els.googleGrid.classList.toggle("hidden", mode !== "google");
  els.googleSearchRow.classList.toggle("hidden", mode !== "google");
  els.nameSearchRow.classList.toggle("hidden", mode === "google");

  if (mode === "system") {
    if (systemFontEntries.length === 0) {
      els.count.textContent = "Loading...";
      scanSystemFonts();
    } else {
      els.count.textContent = systemFontEntries.length + " fonts";
    }
  } else if (mode === "google") {
    if (googleFontsMetadata === null) {
      els.count.textContent = "Loading...";
      loadGoogleFontsList();
    } else {
      els.count.textContent = googleResultEntries.filter((r) => r.ok).length + " fonts";
    }
  } else {
    els.count.textContent = loadedFonts.length ? loadedFonts.length + " fonts" : "0 fonts";
  }
}

function setStatus(msg) {
  els.status.textContent = msg;
}

function applyText() {
  const text = els.input.value || " ";
  document.querySelectorAll(".font-preview-text").forEach((el) => {
    el.textContent = text;
  });
}

function applySize() {
  const px = els.size.value + "px";
  document.querySelectorAll(".font-preview-text").forEach((el) => {
    el.style.fontSize = px;
  });
}

// ================= Generic star rating (works for Eagle items AND system fonts) =================
function updateStarsUI(container, rating) {
  container.querySelectorAll(".star").forEach((starEl, i) => {
    starEl.classList.toggle("filled", i < rating);
  });
}

function buildStars(getValue, setValue, container) {
  container.innerHTML = "";
  const rating = getValue();
  for (let i = 0; i < 5; i++) {
    const star = document.createElement("span");
    star.className = "star" + (i < rating ? " filled" : "");
    star.textContent = "★";
    star.addEventListener("click", async (e) => {
      e.stopPropagation();
      const current = getValue();
      const newValue = current === i + 1 ? 0 : i + 1;
      container.classList.add("pending");
      try {
        await setValue(newValue);
        updateStarsUI(container, newValue);
      } catch (err) {
        console.error("Failed to update rating:", err);
      } finally {
        container.classList.remove("pending");
      }
    });
    container.appendChild(star);
  }
}

// ================= System-font rating store (local JSON, independent of Eagle) =================
function loadSystemRatingsMap() {
  try {
    return JSON.parse(fs.readFileSync(SYSTEM_RATINGS_FILE, "utf8"));
  } catch (err) {
    return {};
  }
}
function saveSystemRatingsMap(map) {
  try {
    fs.writeFileSync(SYSTEM_RATINGS_FILE, JSON.stringify(map));
  } catch (err) {
    console.error("Could not save system font ratings:", err);
  }
}
function getSystemRating(filePath) {
  return loadSystemRatingsMap()[filePath] || 0;
}
function setSystemRating(filePath, value) {
  const map = loadSystemRatingsMap();
  if (value === 0) delete map[filePath];
  else map[filePath] = value;
  saveSystemRatingsMap(map);
}

// ================= Font activation (Mac + Windows) =================
function macFontDest(item) {
  return path.join(os.homedir(), "Library", "Fonts", path.basename(item.filePath));
}

function winFontDest(item) {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(localAppData, "Microsoft", "Windows", "Fonts", path.basename(item.filePath));
}

function isActivatable(item) {
  const ext = (item.ext || "").toLowerCase();
  return (IS_MAC || IS_WIN) && ACTIVATABLE_EXTS.includes(ext);
}

function isActivated(item) {
  if (IS_MAC) return fs.existsSync(macFontDest(item));
  if (IS_WIN) return fs.existsSync(winFontDest(item));
  return false;
}

function fontRegistryName(item) {
  const suffix = (item.ext || "").toLowerCase() === "otf" ? "OpenType" : "TrueType";
  return `${item.name} (${suffix})`;
}

function runWindowsFontScript(fontPath, item, install) {
  return new Promise((resolve, reject) => {
    const regName = fontRegistryName(item).replace(/'/g, "''");
    const safePath = fontPath.replace(/'/g, "''");
    const script = install
      ? `
New-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts' -Name '${regName}' -Value '${safePath}' -PropertyType String -Force | Out-Null
Add-Type -TypeDefinition '
using System;
using System.Runtime.InteropServices;
public class EagleFontHelperInstall {
  [DllImport("gdi32.dll")] public static extern int AddFontResource(string lpFileName);
  [DllImport("user32.dll")] public static extern int SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
}
'
[EagleFontHelperInstall]::AddFontResource('${safePath}') | Out-Null
[EagleFontHelperInstall]::SendMessage([IntPtr]0xffff, 0x001D, [IntPtr]0, [IntPtr]0) | Out-Null
`
      : `
Remove-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts' -Name '${regName}' -ErrorAction SilentlyContinue
Add-Type -TypeDefinition '
using System;
using System.Runtime.InteropServices;
public class EagleFontHelperRemove {
  [DllImport("gdi32.dll")] public static extern int RemoveFontResource(string lpFileName);
  [DllImport("user32.dll")] public static extern int SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
}
'
[EagleFontHelperRemove]::RemoveFontResource('${safePath}') | Out-Null
[EagleFontHelperRemove]::SendMessage([IntPtr]0xffff, 0x001D, [IntPtr]0, [IntPtr]0) | Out-Null
`;

    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      (err, stdout, stderr) => {
        if (err) {
          console.error("PowerShell font script failed:", err, stderr);
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
}

async function activateFont(item) {
  if (IS_MAC) {
    fs.copyFileSync(item.filePath, macFontDest(item));
    return;
  }
  if (IS_WIN) {
    const dest = winFontDest(item);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(item.filePath, dest);
    await runWindowsFontScript(dest, item, true);
    return;
  }
  throw new Error("Font activation is not supported on this platform.");
}

async function deactivateFont(item) {
  if (IS_MAC) {
    const dest = macFontDest(item);
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    return;
  }
  if (IS_WIN) {
    const dest = winFontDest(item);
    await runWindowsFontScript(dest, item, false);
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    return;
  }
  throw new Error("Font activation is not supported on this platform.");
}

// Default activate-dot builder for Eagle-library fonts (folder mode)
function buildActivateBadge(item, container) {
  if (!isActivatable(item)) {
    container.classList.add("hidden");
    return;
  }
  container.classList.remove("hidden");
  container.classList.remove("pending", "locked-dot");
  container.style.cursor = "pointer";
  const active = isActivated(item);
  container.classList.toggle("active", active);
  container.title = active ? "Activated — click to deactivate" : "Click to activate on this computer";
  container.onclick = async (e) => {
    e.stopPropagation();
    container.classList.add("pending");
    try {
      if (isActivated(item)) {
        await deactivateFont(item);
      } else {
        await activateFont(item);
      }
    } catch (err) {
      console.error("Font activation failed:", err);
      alert("Could not update font activation:\n" + err.message);
    } finally {
      buildActivateBadge(item, container);
    }
  };
}

// Activate-dot builder for System Fonts view: these are always "active" by definition
// (they were found in a live font directory). Locked = OS/system dir, cannot be changed.
// Editable = user font dir, clicking removes the file entirely.
function makeSystemActivateDotBuilder({ locked, filePath, file, ext }) {
  return (el) => {
    el.classList.remove("hidden", "pending");
    el.classList.add("active");
    el.classList.toggle("locked-dot", locked);
    if (locked) {
      el.title = "System font — cannot be changed";
      el.style.cursor = "default";
      el.onclick = null;
    } else {
      el.title = "Click to deactivate (removes the font file)";
      el.style.cursor = "pointer";
      el.onclick = async (e) => {
        e.stopPropagation();
        el.classList.add("pending");
        try {
          fs.unlinkSync(filePath);
          if (IS_WIN) {
            const guessName = file.replace(/\.(ttf|otf)$/i, "");
            await runWindowsFontScript(filePath, { name: guessName, ext }, false).catch(() => {});
          }
          if (!els.detailView.classList.contains("hidden")) closeDetail();
          await scanSystemFonts();
        } catch (err) {
          alert("Could not remove font file:\n" + err.message);
          el.classList.remove("pending");
        }
      };
    }
  };
}

// ================= Shared font card builder =================
function createFontCard({ displayName, family, ok, buildActivateDot, ratingGet, ratingSet, onOpenDetail, familyCount }) {
  const card = document.createElement("div");
  card.className = "font-card" + (ok ? "" : " failed");

  const name = document.createElement("div");
  name.className = "font-name";

  const activateBadge = document.createElement("span");
  activateBadge.className = "activate-badge";
  buildActivateDot(activateBadge);

  const stars = document.createElement("span");
  stars.className = "stars";
  buildStars(ratingGet, ratingSet, stars);

  const nameText = document.createElement("span");
  nameText.textContent = displayName;

  name.appendChild(activateBadge);
  name.appendChild(stars);
  name.appendChild(nameText);

  if (familyCount && familyCount > 1) {
    const badge = document.createElement("span");
    badge.className = "family-count-badge";
    badge.textContent = familyCount + " styles";
    badge.title = "Part of a family with " + familyCount + " styles — open it to see them all";
    name.appendChild(badge);
  }

  const preview = document.createElement("div");
  preview.className = "font-preview-text";
  preview.style.fontFamily = ok ? `"${family}"` : "inherit";
  preview.style.fontSize = els.size.value + "px";
  preview.textContent = ok ? els.input.value : "Failed to load";

  if (ok) {
    const stepper = document.createElement("span");
    stepper.className = "size-stepper";
    const minus = document.createElement("button");
    minus.type = "button";
    minus.textContent = "–";
    minus.title = "Shrink this font only";
    const plus = document.createElement("button");
    plus.type = "button";
    plus.textContent = "+";
    plus.title = "Enlarge this font only";
    const adjust = (delta) => {
      const current = parseFloat(preview.style.fontSize) || parseFloat(els.size.value);
      const next = Math.min(220, Math.max(10, current + delta));
      preview.style.fontSize = next + "px";
    };
    minus.addEventListener("click", (e) => {
      e.stopPropagation();
      adjust(-4);
    });
    plus.addEventListener("click", (e) => {
      e.stopPropagation();
      adjust(4);
    });
    stepper.appendChild(minus);
    stepper.appendChild(plus);
    name.appendChild(stepper);
  }

  card.appendChild(name);
  card.appendChild(preview);
  if (ok && onOpenDetail) {
    card.addEventListener("click", onOpenDetail);
  }
  return card;
}

// ================= Folder mode grid =================
function renderGrid() {
  els.grid.innerHTML = "";
  let renderedCount = 0;

  const pool = loadedFonts
    .filter((f) => f.ok)
    .map(({ item, family }) => ({
      displayName: item.name + (item.ext ? "." + item.ext : ""),
      filePath: item.filePath,
      cssFamily: family,
      buildActivateDot: (el) => buildActivateBadge(item, el),
      ratingGet: () => item.star || 0,
      ratingSet: async (v) => {
        item.star = v;
        await item.save();
      },
    }));

  const familyCountOf = buildFamilyCountLookup(pool.map((p) => p.filePath));
  const query = nameSearchQuery.trim().toLowerCase();

  loadedFonts.forEach(({ item, family, ok }) => {
    if (activationFilter === "active" && !isActivated(item)) return;
    if (activationFilter === "inactive" && isActivated(item)) return;
    if (ratingFilter > 0 && (item.star || 0) < ratingFilter) return;
    if (query && !item.name.toLowerCase().includes(query)) return;
    renderedCount++;

    const displayName = item.name + (item.ext ? "." + item.ext : "");
    const card = createFontCard({
      displayName,
      family,
      ok,
      familyCount: ok ? familyCountOf(item.filePath) : 1,
      buildActivateDot: (el) => buildActivateBadge(item, el),
      ratingGet: () => item.star || 0,
      ratingSet: async (v) => {
        item.star = v;
        await item.save();
      },
      onOpenDetail: () =>
        openDetail({
          displayName,
          family,
          filePath: item.filePath,
          buildActivateDot: (el) => buildActivateBadge(item, el),
          ratingGet: () => item.star || 0,
          ratingSet: async (v) => {
            item.star = v;
            await item.save();
          },
          pool,
        }),
    });
    els.grid.appendChild(card);
  });
  if (contentMode === "folder") els.count.textContent = renderedCount + " fonts";
}

// ================= System Fonts mode =================
function getSystemFontDirs() {
  if (IS_MAC) {
    return {
      locked: ["/System/Library/Fonts", "/System/Library/Fonts/Supplemental"],
      editable: ["/Library/Fonts", path.join(os.homedir(), "Library", "Fonts")],
    };
  }
  if (IS_WIN) {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return {
      locked: ["C:\\Windows\\Fonts"],
      editable: [path.join(localAppData, "Microsoft", "Windows", "Fonts")],
    };
  }
  return { locked: [], editable: [] };
}

function scanDirForFonts(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => ACTIVATABLE_EXTS.includes(path.extname(f).slice(1).toLowerCase()))
      .map((f) => ({ file: f, dir }));
  } catch (err) {
    return [];
  }
}

async function loadSystemFontFace(fullPath, index) {
  const family = `sys-font-${index}`;
  try {
    const face = new FontFace(family, `url("file://${fullPath}")`);
    await face.load();
    document.fonts.add(face);
    return family;
  } catch (err) {
    console.error("Failed to load system font:", fullPath, err);
    return null;
  }
}

async function scanSystemFonts() {
  systemFontEntries = [];
  els.systemGrid.innerHTML = "";

  if (!IS_MAC && !IS_WIN) {
    els.systemGrid.textContent = "System font scanning is not supported on this platform.";
    return;
  }

  const dirs = getSystemFontDirs();
  const lockedFiles = dirs.locked.flatMap((d) => scanDirForFonts(d).map((e) => ({ ...e, locked: true })));
  const editableFiles = dirs.editable
    .filter(Boolean)
    .flatMap((d) => scanDirForFonts(d).map((e) => ({ ...e, locked: false })));
  const all = [...lockedFiles, ...editableFiles].sort((a, b) => a.file.localeCompare(b.file));

  if (all.length === 0) {
    els.systemGrid.textContent = "No active fonts found.";
    if (contentMode === "system") els.count.textContent = "0 fonts";
    return;
  }

  els.systemGrid.textContent = `Loading ${all.length} fonts...`;
  if (contentMode === "system") setStatus(`Loading ${all.length} system fonts...`);

  systemFontEntries = await Promise.all(
    all.map(async ({ file, dir, locked }, i) => {
      const filePath = path.join(dir, file);
      const family = await loadSystemFontFace(filePath, i);
      return { file, dir, locked, filePath, family, ok: !!family };
    })
  );

  renderSystemGrid();
  if (contentMode === "system") setStatus(`${systemFontEntries.length} system fonts loaded.`);
}

function renderSystemGrid() {
  els.systemGrid.innerHTML = "";
  let renderedCount = 0;

  const pool = systemFontEntries
    .filter((e) => e.ok)
    .map(({ file, filePath, family, locked }) => {
      const ext = path.extname(file).slice(1).toLowerCase();
      return {
        displayName: file,
        filePath,
        cssFamily: family,
        buildActivateDot: makeSystemActivateDotBuilder({ locked, filePath, file, ext }),
        ratingGet: () => getSystemRating(filePath),
        ratingSet: async (v) => setSystemRating(filePath, v),
      };
    });

  const familyCountOf = buildFamilyCountLookup(pool.map((p) => p.filePath));
  const query = nameSearchQuery.trim().toLowerCase();

  systemFontEntries.forEach(({ file, dir, locked, filePath, family, ok }) => {
    if (ratingFilter > 0 && getSystemRating(filePath) < ratingFilter) return;
    if (query && !file.toLowerCase().includes(query)) return;
    renderedCount++;
    const ext = path.extname(file).slice(1).toLowerCase();
    const displayName = file;
    const dotBuilder = makeSystemActivateDotBuilder({ locked, filePath, file, ext });

    const card = createFontCard({
      displayName,
      family,
      ok,
      familyCount: ok ? familyCountOf(filePath) : 1,
      buildActivateDot: dotBuilder,
      ratingGet: () => getSystemRating(filePath),
      ratingSet: async (v) => setSystemRating(filePath, v),
      onOpenDetail: () =>
        openDetail({
          displayName,
          family,
          filePath,
          buildActivateDot: dotBuilder,
          ratingGet: () => getSystemRating(filePath),
          ratingSet: async (v) => setSystemRating(filePath, v),
          pool,
        }),
    });
    els.systemGrid.appendChild(card);
  });
  if (contentMode === "system") els.count.textContent = renderedCount + " fonts";
}

// ================= Google Fonts mode =================
async function mapWithConcurrencyLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await mapper(items[i], i);
    }
  }
  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: headers || {} }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          resolve(httpsGet(res.headers.location, headers));
          return;
        }
        if (res.statusCode >= 400) {
          reject(new Error(`Request failed: ${res.statusCode} for ${url}`));
          return;
        }
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

async function loadGoogleFontsList() {
  els.googleGrid.textContent = "Loading Google Fonts list...";
  try {
    const buffer = await httpsGet("https://fonts.google.com/metadata/fonts");
    let text = buffer.toString("utf8");
    if (text.startsWith(")]}'")) text = text.slice(text.indexOf("\n") + 1);
    const json = JSON.parse(text);
    googleFontsMetadata = json.familyMetadataList || [];
    renderGoogleGrid();
  } catch (err) {
    console.error("Could not load Google Fonts list:", err);
    googleFontsMetadata = [];
    els.googleGrid.textContent = "Could not reach Google Fonts. Check your internet connection and try again.";
  }
}

// Uses the legacy (non-css2) endpoint with an old-browser User-Agent, which makes
// Google serve a plain .ttf link instead of .woff2 — needed for OS font activation.
async function fetchGoogleFontFileUrl(familyName) {
  const url = `https://fonts.googleapis.com/css?family=${encodeURIComponent(familyName)}`;
  const buffer = await httpsGet(url, {
    "User-Agent": "Mozilla/5.0 (Windows NT 6.1) AppleWebKit/534.34 (KHTML, like Gecko) PhantomJS/1.9.7 Safari/534.34",
  });
  const css = buffer.toString("utf8");
  const match = css.match(/url\((https:[^)]+\.ttf)\)/i) || css.match(/url\((https:[^)]+)\)/i);
  return match ? match[1] : null;
}

async function downloadGoogleFont(familyName) {
  fs.mkdirSync(GOOGLE_CACHE_DIR, { recursive: true });
  const safeName = familyName.replace(/[^a-z0-9]/gi, "_");
  const destPath = path.join(GOOGLE_CACHE_DIR, `${safeName}.ttf`);
  if (fs.existsSync(destPath)) return destPath;

  const fileUrl = await fetchGoogleFontFileUrl(familyName);
  if (!fileUrl) throw new Error("Could not find a downloadable file for " + familyName);
  const fileBuffer = await httpsGet(fileUrl);
  fs.writeFileSync(destPath, fileBuffer);
  return destPath;
}

async function loadGoogleFontFace(filePath, index) {
  const family = `google-font-${index}`;
  try {
    const face = new FontFace(family, `url("file://${filePath}")`);
    await face.load();
    document.fonts.add(face);
    return family;
  } catch (err) {
    console.error("Failed to load downloaded Google font:", filePath, err);
    return null;
  }
}

const GOOGLE_PAGE_SIZE = 100;
let googleMatches = []; // full match list for the current query (unsliced)
let googleLoadedCount = 0; // how many of googleMatches have been downloaded so far
let googleLoadingMore = false;

async function renderGoogleGrid() {
  const myRequestId = ++googleRequestId;
  const query = els.googleSearchInput.value.trim().toLowerCase();

  if (!googleFontsMetadata) return;

  googleMatches = query
    ? googleFontsMetadata.filter((f) => f.family.toLowerCase().includes(query))
    : googleFontsMetadata.slice();
  googleLoadedCount = 0;
  googleResultEntries = [];

  if (googleMatches.length === 0) {
    if (myRequestId !== googleRequestId) return;
    els.googleGrid.innerHTML = "";
    els.googleGrid.textContent = "No fonts found for \"" + query + "\".";
    return;
  }

  els.googleGrid.innerHTML = "";
  els.googleGrid.textContent = `Downloading fonts from Google...`;

  await loadMoreGoogleFonts(myRequestId);
}

async function loadMoreGoogleFonts(requestId) {
  const myRequestId = requestId !== undefined ? requestId : googleRequestId;
  const nextBatch = googleMatches.slice(googleLoadedCount, googleLoadedCount + GOOGLE_PAGE_SIZE);
  if (nextBatch.length === 0) return;

  googleLoadingMore = true;
  renderGoogleGridCards(); // shows a disabled "Loading more..." button while this batch downloads

  const startIndex = googleLoadedCount;
  const results = await mapWithConcurrencyLimit(nextBatch, 5, async (meta, i) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const filePath = await downloadGoogleFont(meta.family);
        const family = await loadGoogleFontFace(filePath, startIndex + i);
        if (family) return { name: meta.family, filePath, family, ok: true };
      } catch (err) {
        if (attempt === 1) console.error("Could not load Google font:", meta.family, err);
        else await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
    return { name: meta.family, filePath: null, family: null, ok: false };
  });

  // A newer search started while this batch was still downloading — discard it
  // so an older, slower request can't overwrite the latest search.
  if (myRequestId !== googleRequestId) return;

  googleResultEntries = googleResultEntries.concat(results);
  googleLoadedCount += nextBatch.length;
  googleLoadingMore = false;
  renderGoogleGridCards();
}

function renderGoogleGridCards() {
  els.googleGrid.innerHTML = "";

  const pool = googleResultEntries
    .filter((r) => r.ok)
    .map(({ name, filePath, family }) => ({
      displayName: name + ".ttf",
      filePath,
      cssFamily: family,
      buildActivateDot: (el) => buildActivateBadge({ filePath, name, ext: "ttf" }, el),
      ratingGet: () => getSystemRating(filePath),
      ratingSet: async (v) => setSystemRating(filePath, v),
    }));

  googleResultEntries.forEach(({ name, filePath, family, ok }) => {
    const displayName = name + (ok ? ".ttf" : "");
    const card = createFontCard({
      displayName: ok ? displayName : `${name} (failed to load)`,
      family,
      ok,
      buildActivateDot: (el) => {
        if (!ok) {
          el.classList.add("hidden");
          return;
        }
        buildActivateBadge({ filePath, name, ext: "ttf" }, el);
      },
      ratingGet: () => (ok ? getSystemRating(filePath) : 0),
      ratingSet: async (v) => {
        if (ok) setSystemRating(filePath, v);
      },
      onOpenDetail: ok
        ? () =>
            openDetail({
              displayName,
              family,
              filePath,
              buildActivateDot: (el) => buildActivateBadge({ filePath, name, ext: "ttf" }, el),
              ratingGet: () => getSystemRating(filePath),
              ratingSet: async (v) => setSystemRating(filePath, v),
              pool,
            })
        : null,
    });
    els.googleGrid.appendChild(card);
  });

  const remaining = googleMatches.length - googleLoadedCount;
  if (remaining > 0) {
    const loadMoreBtn = document.createElement("button");
    loadMoreBtn.className = "load-more-btn";
    if (googleLoadingMore) {
      loadMoreBtn.textContent = "Loading more...";
      loadMoreBtn.disabled = true;
    } else {
      loadMoreBtn.textContent = `Load ${Math.min(GOOGLE_PAGE_SIZE, remaining)} more (${remaining} remaining)`;
      loadMoreBtn.addEventListener("click", () => loadMoreGoogleFonts());
    }
    els.googleGrid.appendChild(loadMoreBtn);
  }

  if (contentMode === "google") {
    els.count.textContent = googleResultEntries.filter((r) => r.ok).length + " of " + googleMatches.length + " fonts";
  }
}

// ================= Detail view (shared by folder + system fonts) =================
let activeTab = "styles";
let savedScrollY = 0;
let detailScale = 1;

function taggedSize(el, baseSize) {
  el.dataset.baseSize = baseSize;
  el.style.fontSize = baseSize * detailScale + "px";
}

function applyDetailScale(scale) {
  detailScale = scale;
  document.querySelectorAll("#detailView [data-base-size]").forEach((el) => {
    const base = parseFloat(el.dataset.baseSize);
    el.style.fontSize = base * scale + "px";
  });
}

function openExternal(url) {
  try {
    require("electron").shell.openExternal(url);
  } catch (err) {
    window.open(url, "_blank");
  }
}

function openDetail({ displayName, family, filePath, buildActivateDot, ratingGet, ratingSet, pool }) {
  savedScrollY = window.scrollY;
  els.topbar.classList.add("hidden");
  els.mainView.classList.add("hidden");
  els.detailView.classList.remove("hidden");
  window.scrollTo(0, 0);

  els.detailFontName.textContent = displayName;
  buildActivateDot(els.detailActivateBadge);
  buildStars(ratingGet, ratingSet, els.detailStars);

  detailScale = 1;
  els.detailSizeSlider.value = 100;
  stylesTabText = null;

  let parsedFont = null;
  try {
    const buffer = fs.readFileSync(filePath);
    parsedFont = opentype.parse(toArrayBuffer(buffer));
  } catch (err) {
    console.error("Could not parse font for glyphs/details:", err);
  }

  const currentEntry = { displayName, filePath, cssFamily: family, buildActivateDot, ratingGet, ratingSet };

  renderStylesTab(pool || [currentEntry], currentEntry, parsedFont);
  renderPreviewTab(family);
  renderWaterfallTab(family);
  renderGlyphsTab(family, parsedFont);
  renderDetailsTab(parsedFont);

  setActiveTab(activeTab);
}

function closeDetail() {
  els.detailView.classList.add("hidden");
  els.topbar.classList.remove("hidden");
  els.mainView.classList.remove("hidden");
  requestAnimationFrame(() => window.scrollTo(0, savedScrollY));
}

function setActiveTab(tab) {
  activeTab = tab;
  els.tabButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tab));
  els.tabStyles.classList.toggle("hidden", tab !== "styles");
  els.tabPreview.classList.toggle("hidden", tab !== "preview");
  els.tabWaterfall.classList.toggle("hidden", tab !== "waterfall");
  els.tabGlyphs.classList.toggle("hidden", tab !== "glyphs");
  els.tabDetails.classList.toggle("hidden", tab !== "details");
}

function renderPreviewTab(family) {
  els.tabPreview.innerHTML = "";
  const ff = `"${family}"`;

  const h1 = document.createElement("div");
  h1.className = "preview-h1";
  h1.style.fontFamily = ff;
  taggedSize(h1, 46);
  h1.textContent = PREVIEW_CONTENT.h1;

  const h2 = document.createElement("div");
  h2.className = "preview-h2";
  h2.style.fontFamily = ff;
  taggedSize(h2, 26);
  h2.textContent = PREVIEW_CONTENT.h2;

  const body = document.createElement("div");
  body.className = "preview-body";
  body.style.fontFamily = ff;
  taggedSize(body, 17);
  body.textContent = PREVIEW_CONTENT.body;

  const columns = document.createElement("div");
  columns.className = "preview-columns";
  columns.style.fontFamily = ff;
  const p1 = document.createElement("p");
  taggedSize(p1, 14);
  p1.textContent = PREVIEW_CONTENT.col1;
  const p2 = document.createElement("p");
  taggedSize(p2, 14);
  p2.textContent = PREVIEW_CONTENT.col2;
  columns.appendChild(p1);
  columns.appendChild(p2);

  els.tabPreview.appendChild(h1);
  els.tabPreview.appendChild(h2);
  els.tabPreview.appendChild(body);
  els.tabPreview.appendChild(columns);
}

let stylesTabText = null;

function renderStylesTab(pool, current, parsedFont) {
  els.tabStyles.innerHTML = "";

  const inputRow = document.createElement("div");
  inputRow.className = "styles-tab-input-row";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Type your text here...";
  input.value = stylesTabText !== null ? stylesTabText : els.input.value.trim() || DEFAULT_PANGRAM;
  input.addEventListener("input", () => {
    stylesTabText = input.value;
    const text = input.value || " ";
    els.tabStyles.querySelectorAll(".styles-row-preview").forEach((el) => {
      el.textContent = text;
    });
  });
  inputRow.appendChild(input);
  els.tabStyles.appendChild(inputRow);

  const currentFamily = getFontNameField(parsedFont, "fontFamily") || getRealFamilyName(current.filePath);

  let siblings = [current];
  if (currentFamily && Array.isArray(pool) && pool.length) {
    const matched = pool.filter((p) => getRealFamilyName(p.filePath) === currentFamily);
    if (matched.length > 0) siblings = matched;
  }

  const list = document.createElement("div");
  list.className = "styles-family-list";

  siblings.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "styles-family-row";

    const header = document.createElement("div");
    header.className = "font-name";

    const dot = document.createElement("span");
    dot.className = "activate-badge";
    entry.buildActivateDot(dot);

    const stars = document.createElement("span");
    stars.className = "stars";
    buildStars(entry.ratingGet, entry.ratingSet, stars);

    const label = document.createElement("span");
    label.textContent = entry.displayName;

    header.appendChild(dot);
    header.appendChild(stars);
    header.appendChild(label);

    const preview = document.createElement("div");
    preview.className = "styles-row-preview";
    preview.style.fontFamily = `"${entry.cssFamily}"`;
    taggedSize(preview, 40);
    preview.textContent = input.value || DEFAULT_PANGRAM;

    row.appendChild(header);
    row.appendChild(preview);

    if (entry.filePath !== current.filePath) {
      row.classList.add("clickable-sibling");
      row.addEventListener("click", (e) => {
        if (e.target.closest(".activate-badge") || e.target.closest(".star")) return;
        openDetail({
          displayName: entry.displayName,
          family: entry.cssFamily,
          filePath: entry.filePath,
          buildActivateDot: entry.buildActivateDot,
          ratingGet: entry.ratingGet,
          ratingSet: entry.ratingSet,
          pool,
        });
      });
    }

    list.appendChild(row);
  });

  els.tabStyles.appendChild(list);
}

function renderWaterfallTab(family) {
  const text = els.input.value.trim() || DEFAULT_PANGRAM;
  els.tabWaterfall.innerHTML = "";
  WATERFALL_SIZES.forEach((size) => {
    const row = document.createElement("div");
    row.className = "waterfall-row";
    const label = document.createElement("span");
    label.className = "wf-size";
    label.textContent = size + "px";
    const txt = document.createElement("span");
    txt.className = "wf-text";
    txt.style.fontFamily = `"${family}"`;
    taggedSize(txt, size);
    txt.textContent = text;
    row.appendChild(label);
    row.appendChild(txt);
    els.tabWaterfall.appendChild(row);
  });
}

function toArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

// Real font-family name (from the font's own name table), cached per file path
// so re-opening the Styles tab doesn't re-parse every sibling file each time.
const familyNameCache = new Map();

function getRealFamilyName(filePath) {
  if (familyNameCache.has(filePath)) return familyNameCache.get(filePath);
  let family = null;
  try {
    const buffer = fs.readFileSync(filePath);
    const font = opentype.parse(toArrayBuffer(buffer));
    family = getFontNameField(font, "fontFamily") || null;
  } catch (err) {
    family = null;
  }
  familyNameCache.set(filePath, family);
  return family;
}

// Builds a lookup function returning how many fonts in the given list share the
// same real font-family name — used to show a "N styles" badge in the list.
function buildFamilyCountLookup(filePaths) {
  const counts = {};
  const familyOf = {};
  filePaths.forEach((fp) => {
    const fam = getRealFamilyName(fp) || fp;
    familyOf[fp] = fam;
    counts[fam] = (counts[fam] || 0) + 1;
  });
  return (fp) => counts[familyOf[fp]] || 1;
}

function renderGlyphsTab(family, parsedFont) {
  els.tabGlyphs.innerHTML = "";

  let chars = null;
  if (parsedFont) {
    chars = GLYPH_CANDIDATES.filter((ch) => {
      try {
        const glyph = parsedFont.charToGlyph(ch);
        return !!glyph && glyph.index !== 0;
      } catch (err) {
        return false;
      }
    });
  }
  if (!chars || chars.length === 0) chars = GLYPH_CHARS;

  const grid = document.createElement("div");
  grid.className = "glyph-grid";
  chars.forEach((ch) => {
    const cell = document.createElement("div");
    cell.className = "glyph-cell";
    cell.style.fontFamily = `"${family}"`;
    taggedSize(cell, 22);
    cell.textContent = ch;
    grid.appendChild(cell);
  });
  els.tabGlyphs.appendChild(grid);
}

function getFontNameField(parsedFont, field) {
  if (!parsedFont || !parsedFont.names) return "";
  // opentype.js nests name-table entries under a platform key (e.g. "windows",
  // "macintosh") rather than exposing them flatly, so check each platform in turn.
  const platforms = Object.keys(parsedFont.names);
  for (const platform of platforms) {
    const nameObj = parsedFont.names[platform] && parsedFont.names[platform][field];
    if (nameObj) {
      return nameObj.en || Object.values(nameObj)[0] || "";
    }
  }
  return "";
}

function renderDetailsTab(parsedFont) {
  els.tabDetails.innerHTML = "";

  const fields = [
    ["Font Family", "fontFamily"],
    ["Font Subfamily", "fontSubfamily"],
    ["Full Name", "fullName"],
    ["Version", "version"],
    ["Designer", "designer"],
    ["Designer URL", "designerURL"],
    ["Manufacturer", "manufacturer"],
    ["Manufacturer URL", "manufacturerURL"],
    ["License", "license"],
    ["License URL", "licenseURL"],
    ["Copyright", "copyright"],
    ["Trademark", "trademark"],
  ];

  const table = document.createElement("table");
  table.className = "details-table";
  let anyRow = false;

  fields.forEach(([label, key]) => {
    const value = getFontNameField(parsedFont, key);
    if (!value) return;
    anyRow = true;

    const tr = document.createElement("tr");
    const tdLabel = document.createElement("td");
    tdLabel.textContent = label;

    const tdValue = document.createElement("td");
    if (/^https?:\/\//i.test(value)) {
      const link = document.createElement("a");
      link.href = "#";
      link.textContent = value;
      link.addEventListener("click", (e) => {
        e.preventDefault();
        openExternal(value);
      });
      tdValue.appendChild(link);
    } else {
      tdValue.textContent = value;
    }

    tr.appendChild(tdLabel);
    tr.appendChild(tdValue);
    table.appendChild(tr);
  });

  if (!anyRow) {
    const empty = document.createElement("div");
    empty.className = "details-empty";
    empty.textContent = "No metadata available for this font.";
    els.tabDetails.appendChild(empty);
    return;
  }

  els.tabDetails.appendChild(table);
}

els.backBtn.addEventListener("click", closeDetail);
els.tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
});

// ================= Folder scanning (Eagle library) =================
async function loadFontFace(item, index) {
  const family = `live-preview-${index}-${item.id}`;
  try {
    const src = item.fileURL || `file://${item.filePath}`;
    const face = new FontFace(family, `url("${src}")`);
    await face.load();
    document.fonts.add(face);
    return { item, family, ok: true };
  } catch (err) {
    console.error("Failed to load font:", item.name, err);
    return { item, family, ok: false };
  }
}

function collectIds(folder) {
  let ids = [folder.id];
  if (Array.isArray(folder.children) && folder.children.length) {
    folder.children.forEach((child) => {
      ids = ids.concat(collectIds(child));
    });
  }
  return ids;
}

async function getFolderIdsWithDescendants(folder, includeSub) {
  if (!includeSub) return [folder.id];
  if (Array.isArray(folder.children)) {
    return collectIds(folder);
  }
  try {
    const allFolders = await eagle.folder.get();
    const childrenMap = {};
    allFolders.forEach((f) => {
      const p = f.parent || null;
      if (!childrenMap[p]) childrenMap[p] = [];
      childrenMap[p].push(f.id);
    });
    const result = [folder.id];
    const queue = [folder.id];
    while (queue.length) {
      const current = queue.shift();
      (childrenMap[current] || []).forEach((id) => {
        result.push(id);
        queue.push(id);
      });
    }
    return result;
  } catch (err) {
    console.error("Could not resolve subfolders:", err);
    return [folder.id];
  }
}

async function scanAndLoad() {
  if (contentMode === "folder") setStatus("Scanning folder...");
  loadedFonts = [];
  renderGrid();

  let items = [];
  let debugLines = [];
  try {
    const selectedFolders = await eagle.folder.getSelected();
    debugLines.push(`Selected folders in sidebar: ${selectedFolders ? selectedFolders.length : 0}`);

    if (selectedFolders && selectedFolders.length > 0) {
      const folder = selectedFolders[0];
      debugLines.push(`Folder: "${folder.name}" (children: ${Array.isArray(folder.children) ? folder.children.length : "n/a"})`);
      const includeSub = els.includeSubfolders.checked;
      const folderIds = await getFolderIdsWithDescendants(folder, includeSub);
      debugLines.push(`Folder IDs searched: ${folderIds.length}`);

      const perFolderResults = await Promise.all(
        folderIds.map((id) => eagle.item.get({ folders: [id] }).catch(() => []))
      );
      const seen = new Map();
      perFolderResults.flat().forEach((it) => {
        if (it && it.id) seen.set(it.id, it);
      });
      items = Array.from(seen.values());
      debugLines.push(`Raw items returned (merged): ${items.length}`);
    } else {
      debugLines.push("No folder selected in the left sidebar — click the folder itself (not just browse into it) so it highlights.");
      items = await eagle.item.get({ isSelected: true });
      debugLines.push(`Selected files fallback: ${items ? items.length : 0}`);
    }
  } catch (err) {
    console.error(err);
    if (contentMode === "folder") setStatus("Could not read Eagle data: " + err.message);
    return;
  }

  const beforeFilter = (items || []).length;
  items = (items || []).filter((item) => {
    const ext = (item.ext || "").toLowerCase().replace(/^\./, "");
    return FONT_EXTS.includes(ext);
  });
  debugLines.push(`After font-extension filter: ${items.length} / ${beforeFilter}`);
  console.log(debugLines.join(" | "));

  if (!items || items.length === 0) {
    if (contentMode === "folder") {
      setStatus(debugLines.join(" — "));
      els.count.textContent = "0 fonts";
    }
    return;
  }

  if (contentMode === "folder") setStatus(`Loading ${items.length} fonts...`);

  const results = await Promise.all(items.map((item, i) => loadFontFace(item, i)));
  loadedFonts = results;
  renderGrid();

  const failed = results.filter((r) => !r.ok).length;
  if (contentMode === "folder") {
    setStatus(failed > 0 ? `${results.length} fonts loaded, ${failed} failed.` : `${results.length} fonts ready.`);
  }
}

// ================= Event wiring =================
els.input.addEventListener("input", applyText);
els.size.addEventListener("input", applySize);
els.rescan.addEventListener("click", () => {
  if (contentMode === "folder") scanAndLoad();
  else if (contentMode === "system") scanSystemFonts();
  else renderGoogleGrid();
});
els.includeSubfolders.addEventListener("change", scanAndLoad);
els.viewGridBtn.addEventListener("click", () => setViewMode("grid"));
els.viewListBtn.addEventListener("click", () => setViewMode("list"));
els.bgLightBtn.addEventListener("click", () => setBgMode("light"));
els.bgDarkBtn.addEventListener("click", () => setBgMode("dark"));
els.filterActiveBtn.addEventListener("click", () => setActivationFilter("active"));
els.filterInactiveBtn.addEventListener("click", () => setActivationFilter("inactive"));
els.modeFolderBtn.addEventListener("click", () => setContentMode("folder"));
els.modeSystemBtn.addEventListener("click", () => setContentMode("system"));
els.modeGoogleBtn.addEventListener("click", () => setContentMode("google"));
els.googleSearchInput.addEventListener("input", () => {
  clearTimeout(googleSearchTimer);
  googleSearchTimer = setTimeout(renderGoogleGrid, 400);
});
els.nameSearchInput.addEventListener("input", () => {
  nameSearchQuery = els.nameSearchInput.value;
  if (contentMode === "folder") renderGrid();
  else if (contentMode === "system") renderSystemGrid();
});
els.detailSizeSlider.addEventListener("input", () => {
  applyDetailScale(els.detailSizeSlider.value / 100);
});
els.controlsToggleBtn.addEventListener("click", () => {
  const expanded = els.topbar.classList.toggle("expanded");
  els.controlsToggleBtn.textContent = expanded ? "◂" : "▸";
  els.mainView.classList.toggle("controls-expanded", expanded);
});

buildRatingFilterWidget();
setViewMode(viewMode);
setBgMode(bgMode);
setContentMode(contentMode);

eagle.onPluginCreate((plugin) => {
  scanAndLoad();
});

if (eagle.onLibraryChanged) {
  eagle.onLibraryChanged(() => scanAndLoad());
}
