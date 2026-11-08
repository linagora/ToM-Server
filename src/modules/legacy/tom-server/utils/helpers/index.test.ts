import { describe, expect, it } from 'bun:test'
import { buildEmailBody } from './index'

const htmlTemplate = 'assets/templates/en/email/invitation/body.min.html'
const textTemplate = 'assets/templates/en/email/invitation/body.txt'

describe('buildEmailBody', () => {
  it('HTML-escapes inviter-chosen values for the HTML template', () => {
    const html = buildEmailBody(
      htmlTemplate,
      '<b>"Bob" & co</b>',
      'to@example.org',
      'https://chat.example/?t=1',
      'from@example.org',
      true
    )
    expect(html).toContain('&lt;b&gt;&quot;Bob&quot; &amp; co&lt;/b&gt;')
    expect(html).not.toContain('<b>"Bob"')
  })

  it('keeps the value literal for the text template', () => {
    const text = buildEmailBody(
      textTemplate,
      '<b>Bob</b>',
      'to@example.org',
      'https://chat.example/?t=1',
      'from@example.org'
    )
    expect(text).toContain('<b>Bob</b>')
  })

  it('does not read a value as a replacement pattern', () => {
    const text = buildEmailBody(
      textTemplate,
      "$&-$`-$'",
      'to@example.org',
      'https://chat.example/?t=1',
      'from@example.org'
    )
    expect(text).toContain("$&-$`-$'")
  })
})
