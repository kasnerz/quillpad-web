// marked and DOMPurify are loaded as plain scripts in index.html (both ship as
// UMD globals), so they arrive on window rather than as module exports.

export function renderMarkdown(text) {
  const html = window.marked.parse(text || "", { gfm: true, breaks: true });
  // The only author here is the user themselves, but markdown passes raw HTML
  // through by default and a note can arrive from the phone — sanitising costs
  // nothing and keeps a stray <script> from ever executing.
  return window.DOMPurify.sanitize(html);
}
