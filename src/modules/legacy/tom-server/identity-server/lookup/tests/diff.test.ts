import { describe, expect, it, mock } from 'bun:test'
import SQLite from '../../../../matrix-identity-server/db/sql/sqlite'
import UserDBSQLite from '../../../../matrix-identity-server/userdb/sql/sqlite'
import diff from '../diff'

const noop = (): void => {}
const logger = { error: noop, warn: noop, info: noop, debug: noop, silly: noop } as any

const run = async (fields: unknown): Promise<{ status: number; get: any }> => {
  const get = mock(async () => [{ uid: 'alice', mail: 'alice@example.com' }])
  const idServer: any = {
    authenticate: (_q: any, _s: any, cb: any) => cb({ sub: '@user:example.com', epoch: 0 }, 'token'),
    db: { getHigherThan: async () => [{ address: '@alice:example.com', active: 1 }] },
    userDB: { get }
  }
  const status = await new Promise<number>((resolve) => {
    const res: any = { writeHead: resolve, write: noop, end: noop }
    diff(idServer, logger)(
      { headers: { 'content-type': 'application/json' }, body: { since: 0, fields }, on: noop } as any,
      res
    )
  })
  return { status, get }
}

describe('lookup/diff fields', () => {
  it.each([[['']], [['uid,']], [['userPassword']], ['mail']])('refuses %p', async (fields) => {
    const { status, get } = await run(fields)
    expect(status).toBe(400)
    expect(get).not.toHaveBeenCalled()
  })

  it('returns the requested directory fields', async () => {
    const { status, get } = await run(['mail'])
    expect(status).toBe(200)
    expect(get).toHaveBeenCalledWith('users', ['mail', 'uid'], { uid: ['alice'] })
  })
})

describe('lookup/diff fields on a SQLite user database', () => {
  const answer = async (fields: string[]): Promise<number | string> => {
    const db = new SQLite(
      { database_engine: 'sqlite', database_host: ':memory:' } as any,
      logger,
      { userHistory: 'address text PRIMARY KEY, active integer, timestamp integer' } as any,
      {},
      { userHistory: [{ address: '@alice:example.com', active: 1, timestamp: 10 }] } as any
    )
    const userDB = new UserDBSQLite({ userdb_engine: 'sqlite', userdb_host: ':memory:' } as any, logger)
    await Promise.all([db.ready, userDB.ready])
    await userDB.insert('users', { uid: 'alice', mail: 'alice@example.com', mobile: '' })
    const idServer: any = {
      authenticate: (_q: any, _s: any, cb: any) => cb({ sub: '@user:example.com', epoch: 0 }, 'token'),
      db,
      userDB
    }
    return await new Promise((resolve) => {
      setTimeout(() => resolve('no answer'), 1000)
      diff(idServer, logger)(
        { headers: { 'content-type': 'application/json' }, body: { since: 0, fields }, on: noop } as any,
        { writeHead: resolve, write: noop, end: noop } as any
      )
    })
  }

  it('refuses a field the table does not have', async () => {
    expect(await answer(['cn'])).toBe(400)
  })

  it('answers for the fields the table has', async () => {
    expect(await answer(['uid', 'mail', 'mobile'])).toBe(200)
  })
})
