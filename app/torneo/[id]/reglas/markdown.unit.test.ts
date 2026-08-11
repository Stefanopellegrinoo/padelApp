import { describe, expect, it } from 'vitest'
import { renderAdminMarkdown } from './markdown'

describe('renderAdminMarkdown', () => {
  it('escapes a script tag so it never becomes an executable element', () => {
    const html = renderAdminMarkdown('<script>alert(1)</script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapes an img onerror payload so no img element is ever created', () => {
    const html = renderAdminMarkdown('<img src=x onerror=alert(1)>')
    expect(html).not.toMatch(/<img/i)
    expect(html).toContain('&lt;img')
  })

  it('never emits an anchor for a javascript: link, because links are not a supported format', () => {
    const html = renderAdminMarkdown('[link](javascript:alert(1))')
    expect(html).not.toContain('<a ')
    expect(html).not.toContain('href=')
  })

  it('turns **bold** into a real strong tag', () => {
    const html = renderAdminMarkdown('**negrita**')
    expect(html).toContain('<strong>negrita</strong>')
  })

  it('escapes a bare ampersand without breaking the rest of the text', () => {
    const html = renderAdminMarkdown('Café & Bar')
    expect(html).toContain('Café &amp; Bar')
  })

  it('escapes a raw tag and still formats bold in the same text, whichever comes first', () => {
    const html = renderAdminMarkdown('<b>x</b> y **negrita**')
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(html).toContain('<strong>negrita</strong>')
    expect(html).not.toContain('<b>x</b>')
  })
})
