import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest'

import { tokenStore } from '../auth/tokenStore'
import { toastStore } from '../components/feedback/toastStore'
import { mockBackend } from './mockBackend'
import { mockDrawings } from './mockDrawings'
import { mockProjects } from './mockProjects'
import { server } from './server'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
beforeEach(() => {
  mockBackend.reset()
  mockProjects.reset()
  mockDrawings.reset()
})
afterEach(() => {
  cleanup()
  server.resetHandlers()
  toastStore.clear()
  tokenStore.set(null)
})
afterAll(() => server.close())

// Expected error logs (error boundary, route errors) would otherwise clutter test output.
vi.spyOn(console, 'error').mockImplementation(() => {})

// jsdom lacks the Pointer Capture API that Radix primitives call on pointer events.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
}

// jsdom does not implement element scrolling; record calls instead of throwing.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo() {}
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {}
}

// jsdom's Blob has no stream(). MSW's XHR interceptor wraps every XHR response in a Fetch
// Response, which reads blob bodies (responseType 'blob', e.g. thumbnails) through stream().
if (!Blob.prototype.stream) {
  Blob.prototype.stream = function stream(this: Blob) {
    const read = () => this.text()
    return new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(new Uint8Array(await new Response(await read()).arrayBuffer()))
        controller.close()
      },
    })
  } as Blob['stream']
}
