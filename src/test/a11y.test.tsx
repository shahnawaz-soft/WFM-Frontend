/**
 * Automated accessibility checks (axe-core, WCAG 2.1 A/AA rules) on the main screens.
 * jsdom has no layout, so colour contrast is checked manually instead (see docs/qa).
 */
import { screen } from '@testing-library/react'
import axe from 'axe-core'
import { describe, expect, it, vi } from 'vitest'

import { mockBackend } from './mockBackend'
import { acceptUpload, mockDrawings } from './mockDrawings'
import { mockProjects } from './mockProjects'
import { renderApp } from './renderApp'

vi.mock('../features/viewer/pdf', () => ({ loadPdf: async () => ({ numPages: 1 }) }))
vi.mock('../features/viewer/PdfPageCanvas', () => ({ PdfPageCanvas: ({ label }: { label: string }) => <div role="img" aria-label={label} /> }))

async function violations() {
  const results = await axe.run(document.body, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    rules: { 'color-contrast': { enabled: false } },
  })
  return results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

async function call(method: string, path: string, body?: object) {
  const response = await fetch(`http://localhost/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return response.json()
}

async function projectWithAddedPage() {
  const project = mockProjects.create('Warehouse', 'estimator@steelo.test')
  mockBackend.startSession('estimator@steelo.test')
  await acceptUpload(project.id, new File(['%PDF-1.7 pages:1'], 'GA.pdf'))
  const page = mockDrawings.sets[0]!.pages[0]!
  await call('POST', `/drawing-pages/${page.id}/run-plan/`)
  await call('POST', `/drawing-pages/${page.id}/accept-all/`)
  const members = await call('GET', `/drawing-pages/${page.id}/members/`)
  const hss = members.find((m: { profile: string }) => m.profile === 'HSS')
  await call('POST', `/members/${hss.id}/review/`, { version: hss.version, status: 'unsupported' })
  await call('POST', `/drawing-pages/${page.id}/mark-reviewed/`)
  await call('POST', `/drawing-pages/${page.id}/add-to-project/`)
  return { project, page }
}

describe('Accessibility (axe)', () => {
  it('login', async () => {
    renderApp('/login')
    await screen.findByRole('button', { name: /Sign in/ })
    expect(await violations()).toEqual([])
  })

  it('projects list', async () => {
    mockProjects.create('Warehouse', 'estimator@steelo.test')
    mockBackend.startSession('estimator@steelo.test')
    renderApp('/projects')
    await screen.findByRole('link', { name: 'Warehouse' })
    expect(await violations()).toEqual([])
  })

  it('project page', async () => {
    const { project } = await projectWithAddedPage()
    renderApp(`/projects/${project.id}`)
    await screen.findByRole('region', { name: 'Project review' })
    await screen.findByText(/In progress|ABM complete/)
    expect(await violations()).toEqual([])
  })

  it('page workspace', async () => {
    const { project, page } = await projectWithAddedPage()
    renderApp(`/projects/${project.id}/pages/${page.id}`)
    await screen.findByRole('table', { name: /Detected members/ })
    expect(await violations()).toEqual([])
  })

  it('ABM', async () => {
    const { project } = await projectWithAddedPage()
    renderApp(`/projects/${project.id}/abm`)
    await screen.findByRole('table', { name: /ABM/ })
    expect(await violations()).toEqual([])
  })

  it('wireframe', async () => {
    const { project } = await projectWithAddedPage()
    await call('POST', `/projects/${project.id}/wireframes/`)
    renderApp(`/projects/${project.id}/wireframe`)
    await screen.findByRole('table', { name: 'Wireframe elements' })
    expect(await violations()).toEqual([])
  })

  it('operations', async () => {
    mockBackend.startSession('admin@steelo.test')
    renderApp('/ops')
    await screen.findByText('All services up')
    expect(await violations()).toEqual([])
  })
})
