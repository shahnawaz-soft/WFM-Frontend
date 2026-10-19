/** Only same-app paths may be a post-login destination (prevents open redirects). */
export function safeDestination(from: unknown): string {
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') && !from.startsWith('/\\')
    ? from
    : '/'
}
