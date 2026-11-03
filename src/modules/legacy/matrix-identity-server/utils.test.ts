import { type Request, type Response } from 'express'
import { Authenticate, getServerNameFromMatrixId } from './utils'
import SQLite from './db/sql/sqlite'
import { describe, expect, it, test } from 'bun:test'

describe('the getServerNameFromMatrixId helper', () => {
  it('should extract the server name correctly', () => {
    const firstServer = getServerNameFromMatrixId('@test:example.com')
    const secondServer = getServerNameFromMatrixId('@support:linagora.com')

    expect(firstServer).toEqual('example.com')
    expect(secondServer).toEqual('linagora.com')
  })
})

describe('Authenticate', () => {
  it('should answer 401 for an empty token', async () => {
    const noop = (): void => {}
    const logger = { error: noop, warn: noop, info: noop, debug: noop, silly: noop } as any
    const db = new SQLite(
      { database_engine: 'sqlite', database_host: ':memory:' } as any,
      logger,
      { accessTokens: 'id varchar(64) PRIMARY KEY, data text' } as any,
      {},
      { accessTokens: [{ id: 'tok', data: '{"sub":"@alice:example.com"}' }] } as any
    )
    await db.ready
    const status = await new Promise<number>((resolve) => {
      const res = { writeHead: (s: number) => resolve(s), write: noop, end: noop } as unknown as Response
      Authenticate(db as any, logger)(
        { headers: {}, query: { access_token: '' }, socket: {} } as unknown as Request,
        res,
        () => resolve(200),
        false
      )
    })
    expect(status).toBe(401)
  })
})
