import { describe, expect, it } from 'bun:test'
import { mailBody } from './index'

// Minimal multipart template mirroring assets/templates/3pidInvitation.tpl:
// a header block, a text/plain part and a text/html part.
const TPL = [
  'Date: __date__',
  'From: __from__',
  'To: __to__',
  'Message-ID: __messageid__',
  'Subject: Invitation',
  '',
  '--B',
  'Content-Type: text/plain; charset=UTF-8',
  '',
  'You have been invited by __inviter_name__.',
  '',
  '--B',
  'Content-Type: text/html; charset=UTF-8',
  '',
  '<p>You have been invited by __inviter_name__.</p>',
  '<li>Room Name: __room_name__</li>',
  '<li>Room Type: __room_type__</li>',
  '<img src="__room_avatar__" alt="Room Avatar" />'
].join('\n')

const render = (over: {
  inviter?: string
  dst?: string
  roomName?: string
  roomAvatar?: string
  roomType?: string
}): string =>
  mailBody(
    TPL,
    over.inviter ?? 'Alice',
    '@alice:example.com',
    over.dst ?? 'bob@example.com',
    over.roomName ?? 'Room',
    over.roomAvatar ?? 'https://example.com/a.png',
    over.roomType ?? 'public',
    'matrix.to'
  )

describe('mailBody', () => {
  it('inserts each value once, literally, and keeps values out of the headers', () => {
    const raw = render({
      inviter: "$&-$`-$'",
      dst: '__room_name__@example.com',
      roomName: 'x\r\nReply-To: attacker@example.org'
    })
    const headers = raw.slice(0, raw.search(/\r?\n\r?\n/))
    // The address inserted into To is not rescanned by the room_name pass.
    expect(headers).toContain('To: __room_name__@example.com')
    expect(headers).not.toContain('Reply-To')
    // $ sequences in a value are not read as replacement patterns.
    expect(raw).toContain("$&-$`-$'")
  })

  it('strips CR/LF from a value so it cannot add a header or MIME line', () => {
    const raw = render({
      roomName: 'Room\r\n--boundary\r\nContent-Type: text/evil'
    })
    // The value stays on a single line: no new header/boundary line appears.
    expect(raw).not.toMatch(/\n--boundary/)
    expect(raw).not.toMatch(/\nContent-Type: text\/evil/)
  })

  it('HTML-escapes inviter-chosen values in the text/html part', () => {
    const raw = render({
      inviter: '<p>x</p>',
      roomName: '<b>T</b>',
      roomAvatar: 'a" onerror="b'
    })
    const html = raw.slice(raw.indexOf('Content-Type: text/html'))
    expect(html).not.toContain('<b>T</b>')
    expect(html).toContain('&lt;b&gt;T&lt;/b&gt;')
    expect(html).not.toContain('onerror="b"')
  })
})
