/** Only same-app paths: `next` comes from the URL, so anything else (`//evil.com`,
 * `https://…`, `/\\evil.com`) would be an open redirect. */
export function safeNextPath(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return '/'
  }
  return next
}
