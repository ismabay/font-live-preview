const FONT_EXTS = ["ttf", "otf", "woff", "woff2"];
const ACTIVATABLE_EXTS = ["ttf", "otf"]; // only real desktop-installable formats
const LIKE_RATING = 5;

// ---- Platform-aware font activation (installs/removes the font from the OS) ----
const os = require("os");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const PLATFORM = os.platform();
const IS_MAC = PLATFORM === "darwin";
const IS_WIN = PLATFORM === "win32";

const SYSTEM_RATINGS_FILE = path.join(os.homedir(), ".font-live-preview-system-ratings.json");

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
  modeFolderBtn: document.getElementById("modeFolderBtn"),
  modeSystemBtn: document.getElementById("modeSystemBtn"),
  mainView: document.getElementById("mainView"),
  detailView: document.getElementById("detailView"),
  backBtn: document.getElementById("backBtn"),
  detailFontName: document.getElementById("detailFontName"),
  detailStars: document.getElementById("detailStars"),
  detailActivateBadge: document.getElementById("detailActivateBadge"),
  tabButtons: document.querySelectorAll(".tab-btn"),
  tabStyles: document.getElementById("tab-styles"),
  tabPreview: document.getElementById("tab-preview"),
  tabWaterfall: document.getElementById("tab-waterfall"),
  tabGlyphs: document.getElementById("tab-glyphs"),
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
let contentMode = "folder"; // "folder" | "system"

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
  els.bgLightBtn.classList.toggle("active", mode === "light");
  els.bgDarkBtn.classList.toggle("active", mode === "dark");
}

function setActivationFilter(mode) {
  activationFilter = activationFilter === mode ? "all" : mode;
  els.filterActiveBtn.classList.toggle("selected", activationFilter === "active");
  els.filterInactiveBtn.classList.toggle("selected", activationFilter === "inactive");
  renderGrid();
}

function setContentMode(mode) {
  contentMode = mode;
  els.modeFolderBtn.classList.toggle("active", mode === "folder");
  els.modeSystemBtn.classList.toggle("active", mode === "system");
  els.grid.classList.toggle("hidden", mode !== "folder");
  els.systemGrid.classList.toggle("hidden", mode !== "system");
  if (mode === "system" && systemFontEntries.length === 0) {
    scanSystemFonts();
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
function createFontCard({ displayName, family, ok, buildActivateDot, ratingGet, ratingSet, onOpenDetail }) {
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

  const preview = document.createElement("div");
  preview.className = "font-preview-text";
  preview.style.fontFamily = ok ? `"${family}"` : "inherit";
  preview.style.fontSize = els.size.value + "px";
  preview.textContent = ok ? els.input.value : "Failed to load";

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
  loadedFonts.forEach(({ item, family, ok }) => {
    if (activationFilter === "active" && !isActivated(item)) return;
    if (activationFilter === "inactive" && isActivated(item)) return;
    renderedCount++;

    const displayName = item.name + (item.ext ? "." + item.ext : "");
    const card = createFontCard({
      displayName,
      family,
      ok,
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
  systemFontEntries.forEach(({ file, dir, locked, filePath, family, ok }) => {
    const ext = path.extname(file).slice(1).toLowerCase();
    const displayName = file;
    const dotBuilder = makeSystemActivateDotBuilder({ locked, filePath, file, ext });

    const card = createFontCard({
      displayName,
      family,
      ok,
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
        }),
    });
    els.systemGrid.appendChild(card);
  });
  if (contentMode === "system") els.count.textContent = systemFontEntries.length + " fonts";
}

// ================= Detail view (shared by folder + system fonts) =================
let activeTab = "styles";
let savedScrollY = 0;

function openDetail({ displayName, family, filePath, buildActivateDot, ratingGet, ratingSet }) {
  savedScrollY = window.scrollY;
  els.topbar.classList.add("hidden");
  els.mainView.classList.add("hidden");
  els.detailView.classList.remove("hidden");
  window.scrollTo(0, 0);

  els.detailFontName.textContent = displayName;
  buildActivateDot(els.detailActivateBadge);
  buildStars(ratingGet, ratingSet, els.detailStars);

  renderStylesTab(family);
  renderPreviewTab(family);
  renderWaterfallTab(family);
  renderGlyphsTab(family, filePath);

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
}

function renderPreviewTab(family) {
  els.tabPreview.innerHTML = "";
  const ff = `"${family}"`;

  const h1 = document.createElement("div");
  h1.className = "preview-h1";
  h1.style.fontFamily = ff;
  h1.textContent = PREVIEW_CONTENT.h1;

  const h2 = document.createElement("div");
  h2.className = "preview-h2";
  h2.style.fontFamily = ff;
  h2.textContent = PREVIEW_CONTENT.h2;

  const body = document.createElement("div");
  body.className = "preview-body";
  body.style.fontFamily = ff;
  body.textContent = PREVIEW_CONTENT.body;

  const columns = document.createElement("div");
  columns.className = "preview-columns";
  columns.style.fontFamily = ff;
  const p1 = document.createElement("p");
  p1.textContent = PREVIEW_CONTENT.col1;
  const p2 = document.createElement("p");
  p2.textContent = PREVIEW_CONTENT.col2;
  columns.appendChild(p1);
  columns.appendChild(p2);

  els.tabPreview.appendChild(h1);
  els.tabPreview.appendChild(h2);
  els.tabPreview.appendChild(body);
  els.tabPreview.appendChild(columns);
}

function renderStylesTab(family) {
  const text = els.input.value.trim() || DEFAULT_PANGRAM;
  els.tabStyles.innerHTML = "";
  const p = document.createElement("div");
  p.className = "styles-preview";
  p.style.fontFamily = `"${family}"`;
  p.textContent = text;
  els.tabStyles.appendChild(p);
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
    txt.style.fontSize = size + "px";
    txt.textContent = text;
    row.appendChild(label);
    row.appendChild(txt);
    els.tabWaterfall.appendChild(row);
  });
}

function toArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

async function renderGlyphsTab(family, filePath) {
  els.tabGlyphs.innerHTML = "";
  els.tabGlyphs.textContent = "Loading glyphs...";

  let chars = null;
  try {
    const buffer = fs.readFileSync(filePath);
    const font = opentype.parse(toArrayBuffer(buffer));
    chars = GLYPH_CANDIDATES.filter((ch) => {
      try {
        const glyph = font.charToGlyph(ch);
        return !!glyph && glyph.index !== 0;
      } catch (err) {
        return false;
      }
    });
  } catch (err) {
    console.error("Could not read glyph table, falling back to basic set:", err);
    chars = null;
  }

  if (!chars || chars.length === 0) chars = GLYPH_CHARS;

  els.tabGlyphs.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "glyph-grid";
  chars.forEach((ch) => {
    const cell = document.createElement("div");
    cell.className = "glyph-cell";
    cell.style.fontFamily = `"${family}"`;
    cell.textContent = ch;
    grid.appendChild(cell);
  });
  els.tabGlyphs.appendChild(grid);
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
  else scanSystemFonts();
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
els.controlsToggleBtn.addEventListener("click", () => {
  const expanded = els.topbar.classList.toggle("expanded");
  els.controlsToggleBtn.textContent = expanded ? "◂" : "▸";
  els.mainView.classList.toggle("controls-expanded", expanded);
});

setViewMode(viewMode);
setBgMode(bgMode);
setContentMode(contentMode);

eagle.onPluginCreate((plugin) => {
  scanAndLoad();
});

if (eagle.onLibraryChanged) {
  eagle.onLibraryChanged(() => scanAndLoad());
}
