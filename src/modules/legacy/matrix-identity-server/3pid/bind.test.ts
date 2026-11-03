import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import bind from './bind'

const noop = (): void => {}

describe('3pid/bind', () => {
  afterEach(() => {
    mock.restore()
  })

  it('refuses an mxid that is not the caller', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    const insert = mock(async () => {})
    const rows: Record<string, unknown[]> = {
      mappings: [{ address: '33612345678', medium: 'msisdn', submit_time: 1, valid: 1 }],
      keys: [{ data: 'pepper' }],
      longTermKeypairs: [{ keyID: 'ed25519:0', private: 'x' }],
      invitationTokens: []
    }
    const idServer: any = {
      authenticate: (_q: any, _s: any, cb: any) => cb({ sub: '@u1:example.com' }, 'token'),
      logger: { debug: noop, info: noop, warn: noop, error: noop },
      conf: { server_name: 'example.com' },
      db: { get: async (table: string) => rows[table] ?? [], insert, listInvitationTokens: async () => [] }
    }
    const status = await new Promise<number>((resolve) => {
      const res: any = { writeHead: resolve, write: noop, end: noop }
      bind(idServer)(
        {
          headers: { 'content-type': 'application/json' },
          body: { client_secret: 'secret_1_0', sid: 'sid1x0', mxid: '@u2:example.com' },
          on: noop
        } as any,
        res
      )
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(insert).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(status).toBe(403)
  })
})
