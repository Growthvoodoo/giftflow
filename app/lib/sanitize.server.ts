import sanitizeHtml from "sanitize-html";

/**
 * The message editor is Quill, so what arrives is HTML written by a customer.
 * It is rendered into a PDF by a headless browser, which makes an unfiltered
 * <script> or a remote <img> a real problem rather than a theoretical one.
 *
 * Allowlist, not denylist: anything not named here is dropped.
 */
const ALLOWED_TAGS = [
  "p", "br", "strong", "b", "em", "i", "u", "s",
  "ul", "ol", "li", "blockquote", "span", "h1", "h2", "h3",
];

export function sanitizeMessage(html: string): string {
  return sanitizeHtml(html ?? "", {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      // Quill writes alignment and its own size/colour classes as inline style
      // or ql-* classes. Anything else is discarded.
      "*": ["class"],
      span: ["style"],
      p: ["style"],
    },
    allowedStyles: {
      "*": {
        "text-align": [/^left$|^right$|^center$|^justify$/],
        color: [/^#[0-9a-fA-F]{3,6}$/, /^rgb\(/],
        "font-size": [/^\d{1,2}(px|pt)$/],
      },
    },
    // No remote content reaches the renderer: an <img> in a customer message
    // would otherwise make the PDF job fetch an arbitrary URL.
    allowedSchemes: [],
    disallowedTagsMode: "discard",
  });
}

/** Plain text for search, list views and the character limit. */
export function toPlainText(html: string): string {
  // Block ends become spaces so "<p>Hi</p><p>there</p>" reads "Hi there".
  const spaced = (html ?? "").replace(/<\/(p|li|h[1-3]|blockquote)>|<br\s*\/?>/gi, "$& ");
  return decodeEntities(sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {} }))
    .replace(/\s+/g, " ")
    .trim();
}

/** sanitize-html returns entity-escaped text; the plain-text copy should not be. */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/** A plain-text message (one paragraph per line) as the HTML the card renders. */
export function textToHtml(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => `<p>${escapeHtml(line) || "<br>"}</p>`)
    .join("");
}
