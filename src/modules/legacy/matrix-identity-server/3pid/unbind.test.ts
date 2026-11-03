import { describe, expect, it, mock } from 'bun:test'
import { Hash } from '../../crypto/index'
import unbind from './unbind'

const noop = (): void => {}
const logger = { debug: noop, info: noop, warn: noop, error: noop }

const hashOf = async (address: string, pepper: string): Promise<string> => {
  const hash = new Hash()
  await hash.ready
  return hash.sha256(`${address} mail ${pepper}`)
}

const run = async (
  sub: string,
  body: Record<string, unknown>,
  valid = 1
): Promise<{ status: number; deleteEqual: any; deleteWhere: any }> => {
  const deleteEqual = mock(async () => {})
  const deleteWhere = mock(async () => {})
  const hashes = [
    { hash: await hashOf('alice@example.com', 'p1'), pepper: 'p1' },
    { hash: await hashOf('alice@example.com', 'p0'), pepper: 'p0' },
    { hash: await hashOf('other@example.com', 'p1'), pepper: 'p1' }
  ]
  const idServer: any = {
    authenticate: (_q: any, _s: any, cb: any) => cb({ sub }, 'token'),
    logger,
    db: {
      get: async (table: string) =>
        table === 'mappings'
          ? [{ address: 'alice@example.com', medium: 'email', valid }]
          : hashes,
      deleteEqual,
      deleteWhere
    }
  }
  const status = await new Promise<number>((resolve) => {
    const res: any = { writeHead: resolve, write: noop, end: noop }
    unbind(idServer)({ headers: { 'content-type': 'application/json' }, body, on: noop } as any, res)
  })
  return { status, deleteEqual, deleteWhere }
}

const body = (mxid: string): Record<string, unknown> => ({
  client_secret: 'secret_0_0',
  sid: 'sid0x0',
  mxid,
  threepid: { address: 'alice@example.com', medium: 'email' }
})

describe('3pid/unbind', () => {
  it('removes only the hashes of the given 3PID for the caller', async () => {
    const { status, deleteEqual, deleteWhere } = await run('@u1:example.com', body('@u1:example.com'))
    expect(status).toBe(200)
    expect(deleteEqual).not.toHaveBeenCalled()
    expect(deleteWhere.mock.calls.map((c: any) => c[1][0].value).sort()).toEqual(
      [await hashOf('alice@example.com', 'p0'), await hashOf('alice@example.com', 'p1')].sort()
    )
    for (const c of deleteWhere.mock.calls) {
      expect(c[1][1]).toEqual({ field: 'value', operator: '=', value: '@u1:example.com' })
    }
  })

  it('refuses an mxid that is not the caller', async () => {
    const { status, deleteEqual, deleteWhere } = await run('@u1:example.com', body('@u2:example.com'))
    expect(status).toBe(403)
    expect(deleteEqual).not.toHaveBeenCalled()
    expect(deleteWhere).not.toHaveBeenCalled()
  })

  it('refuses a session that was never validated', async () => {
    const { status, deleteEqual, deleteWhere } = await run('@u1:example.com', body('@u1:example.com'), 0)
    expect(status).toBe(400)
    expect(deleteEqual).not.toHaveBeenCalled()
    expect(deleteWhere).not.toHaveBeenCalled()
  })
})
