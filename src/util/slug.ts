/**
 * concept text → filesystem-safe slug (used in run ids / run folders).
 */

export function slugify(text: string, maxLength = 50): string {
  const slug = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug || 'concept';
}
