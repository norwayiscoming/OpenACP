export function sanitizeHtml(html: string): string {
  let result = html;

  // Strip <script> tags and content (case-insensitive, handles nesting)
  for (let i = 0; i < 3; i++) {
    result = result.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  }
  result = result.replace(/<\/?script\b[^>]*>/gi, "");

  // Remove all on* event handler attributes
  result = result.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, "");

  // Remove javascript: and data: URIs from href and src attributes
  result = result.replace(
    /(href|src)\s*=\s*(?:"(?:javascript|data):[^"]*"|'(?:javascript|data):[^']*')/gi,
    '$1=""',
  );

  return result;
}
