const NAMED_ENTITIES = Object.freeze({
  amp: "&",
  apos: "'",
  bull: "•",
  cent: "¢",
  copy: "©",
  deg: "°",
  emsp: " ",
  ensp: " ",
  euro: "€",
  hellip: "…",
  laquo: "«",
  ldquo: "“",
  lt: "<",
  gt: ">",
  lsquo: "‘",
  mdash: "—",
  nbsp: " ",
  ndash: "–",
  pound: "£",
  quot: '"',
  raquo: "»",
  rdquo: "”",
  reg: "®",
  rsquo: "’",
  thinsp: " ",
  trade: "™",
  yen: "¥",
});

function decodeEntities(text) {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi,
    (match, entity) => {
      if (entity[0] === "#") {
        const hex = entity[1] && entity[1].toLowerCase() === "x";
        const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff)
          return "\uFFFD";
        try {
          return String.fromCodePoint(code);
        } catch (_) {
          return "\uFFFD";
        }
      }
      return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
    },
  );
}

/**
 * Convert Sketchfab's possibly-marked-up description into safe, readable text.
 * The DOM parser handles the complete HTML entity table in Electron; the
 * fallback keeps the helper testable in Node and covers common/numeric forms.
 */
export function cleanDescription(value, maxLength = 600) {
  const source = String(value == null ? "" : value);
  let text = source;
  let parsedHtml = false;

  if (typeof DOMParser === "function") {
    try {
      const doc = new DOMParser().parseFromString(source, "text/html");
      doc
        .querySelectorAll("script, style, noscript")
        .forEach((node) => node.remove());
      doc
        .querySelectorAll(
          "br, p, div, li, h1, h2, h3, h4, h5, h6, blockquote, tr",
        )
        .forEach((node) => {
          if (node.tagName.toLowerCase() === "br") {
            node.replaceWith(doc.createTextNode(" "));
          } else {
            node.prepend(doc.createTextNode(" "));
            node.append(doc.createTextNode(" "));
          }
        });
      text = doc.body ? doc.body.textContent || "" : "";
      parsedHtml = true;
    } catch (_) {}
  }

  if (!parsedHtml) {
    text = text
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<[^>]*>/g, " ");
  }

  // A second pass handles the occasional double-escaped description safely;
  // tags decoded from entities are stripped below before reaching the UI.
  for (let pass = 0; pass < 2; pass++) {
    const decoded = decodeEntities(text);
    if (decoded === text) break;
    text = decoded;
  }

  text = text
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<\/?[a-z][^>]*>/gi, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const limit = Number.isFinite(Number(maxLength))
    ? Math.max(0, Math.floor(Number(maxLength)))
    : 600;
  return text.slice(0, limit).trim();
}
