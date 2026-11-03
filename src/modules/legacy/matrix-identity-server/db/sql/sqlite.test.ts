import { describe, expect, it } from 'bun:test'
import SQLite from './sqlite'

const noop = (): void => {}
const logger = { error: noop, warn: noop, info: noop, debug: noop, silly: noop } as any

const makeDb = async (): Promise<SQLite<any>> => {
  const db = new SQLite(
    { database_engine: 'sqlite', database_host: ':memory:' } as any,
    logger,
    { accessTokens: 'id varchar(64) PRIMARY KEY, data text' } as any,
    {},
    { accessTokens: [{ id: 'tok', data: '{"sub":"@alice:example.com"}' }] } as any
  )
  await db.ready
  return db
}

describe('SQLite get with an empty filter value', () => {
  it.each([[''], [[]], [['']], [null], [undefined]])('selects nothing for id = %p', async (id) => {
    const db = await makeDb()
    expect(await db.get('accessTokens', ['data'], { id } as any)).toEqual([])
  })

  it('still matches a non-empty value', async () => {
    const db = await makeDb()
    expect(await db.get('accessTokens', ['data'], { id: ['x', 'tok'] })).toHaveLength(1)
  })

  it('still selects every row without a filter', async () => {
    const db = await makeDb()
    expect(await db.get('accessTokens', ['data'], {})).toHaveLength(1)
  })
})
