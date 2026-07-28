// One button, one job: click it and the scheme flips. Until the first click the
// page follows the OS, and keeps following it, so a machine that dims itself at
// sunset dims this page with it. The first click ends that and pins an explicit
// choice, which then persists across reloads.
//
// The theme resolves to a concrete `data-theme` on <html>, which is what
// style.css keys the dark tokens off. Resolving in JS rather than leaving those
// tokens under a `prefers-color-scheme` media query is what lets an explicit
// choice override the OS at all; the cost is that the attribute has to be set
// before the first paint, which the inline script in index.html does.

const KEY = "quillpad-theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");

// Private browsing and blocked third-party storage make localStorage throw on
// access rather than return null, and a theme is not worth breaking boot over.
function read() {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    return null;
  }
}

function write(theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* the choice still applies to this tab, it just will not outlive it */
  }
}

let chosen = read(); // null while still following the OS

function resolvedTheme() {
  return chosen || (media.matches ? "dark" : "light");
}

// The icon shows where the click leads, not where the page is: a moon on a light
// page means "go dark", which is also what the tooltip says.
const ICONS = {
  light: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/></svg>`,
  dark: `<svg viewBox="0 0 24 24"><path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z"/></svg>`,
};

let button = null;

function apply() {
  const theme = resolvedTheme();
  document.documentElement.dataset.theme = theme;

  // The address bar on mobile is painted from this, so a forced theme has to
  // move it too — which rules out the media-switched pair of static tags.
  const meta = document.getElementById("theme-color");
  if (meta) meta.content = theme === "dark" ? "#202124" : "#ffffff";

  if (button) {
    const next = theme === "dark" ? "light" : "dark";
    button.innerHTML = ICONS[next];
    button.title = `Switch to the ${next} theme`;
    button.setAttribute("aria-label", `Switch to the ${next} theme`);
  }
}

// Only fires meaningfully before the first click; afterwards `chosen` wins and
// the OS flipping is none of this page's business.
media.addEventListener("change", () => {
  if (!chosen) apply();
});

/** Wires the top-bar button and paints the initial theme. */
export function initTheme(el) {
  button = el;
  button.addEventListener("click", () => {
    chosen = resolvedTheme() === "dark" ? "light" : "dark";
    write(chosen);
    apply();
  });
  apply();
}
