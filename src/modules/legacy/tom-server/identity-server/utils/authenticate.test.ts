import { describe, expect, it } from 'bun:test'
import { type Request, type Response } from 'express'
import SQLite from '../../../matrix-identity-server/db/sql/sqlite'
import Authenticate from './authenticate'

const noop = (): void => {}
const logger = { error: noop, warn: noop, info: noop, debug: noop, silly: noop } as any

describe('tom-server Authenticate', () => {
  it('should answer 401 for an empty token', async () => {
    const db = new SQLite(
      { database_engine: 'sqlite', database_host: ':memory:' } as any,
      logger,
      {
        matrixTokens: 'id varchar(64) PRIMARY KEY, data text',
        accessTokens: 'id varchar(64) PRIMARY KEY, data text'
      } as any,
      {},
      { matrixTokens: [{ id: 'tok', data: '{"sub":"@alice:example.com"}' }] } as any
    )
    await db.ready
    const sub = await new Promise<string>((resolve) => {
      const res = { writeHead: (s: number) => resolve(String(s)), write: noop, end: noop } as unknown as Response
      Authenticate(db as any, { matrix_server: '127.0.0.1:1' } as any, logger)(
        { headers: {}, query: { access_token: '' }, socket: {} } as unknown as Request,
        res,
        (data) => resolve(data.sub)
      )
    })
    expect(sub).toBe('401')
  })
})
