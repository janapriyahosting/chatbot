// Tiny, safe markdown renderer used by the preview and inbox chat.
// Supports **bold**, *italic* / _italic_, `code`, [text](https://url), line breaks.
export function mdToHtml(raw: string): string {
  let s = String(raw || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^\w*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/_([^_\n]+)_/g, "<em>$1</em>");
  s = s.replace(/`([^`\n]+)`/g, '<code style="background:#f3f4f6;padding:1px 5px;border-radius:3px">$1</code>');
  s = s.replace(/\n/g, "<br>");
  return s;
}
