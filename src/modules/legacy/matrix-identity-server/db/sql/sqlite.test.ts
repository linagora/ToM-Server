import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { getLogger, type TwakeLogger } from '../../../logger'
import SQLite from './sqlite'

const logger: TwakeLogger = getLogger()

afterAll(() => {
  logger.close()
})

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

// A request-body key that holds a sub-select. The write sinks interpolate keys
// into the statement, so without a guard it would run as SQL and leak another
// table through RETURNING *.
const injectionKey =
  'visible_fields=(SELECT access_token FROM matrixtokens LIMIT 1),visibility'

describe('SQLite write sinks reject injected identifiers', () => {
  let db: any

  beforeAll(async () => {
    db = new SQLite(
      { database_engine: 'sqlite', database_host: ':memory:' } as any,
      logger,
      {
        profilesettings:
          'matrix_id text PRIMARY KEY, visibility text, visible_fields text',
        matrixtokens: 'id text PRIMARY KEY, access_token text'
      } as any,
      {} as any,
      {} as any
    )
    await db.ready
    await db.insert('matrixtokens', { id: '1', access_token: 'SECRET' })
    await db.insert('profilesettings', {
      matrix_id: '@victim:srv',
      visibility: 'private',
      visible_fields: '[]'
    })
  })

  afterAll(() => {
    db?.close?.()
  })

  it('rejects an update whose column key carries SQL', async () => {
    await expect(
      db.update('profilesettings', { [injectionKey]: 'public' }, 'matrix_id', '@victim:srv')
    ).rejects.toThrow('Invalid identifier')
    const [row] = await db.get('profilesettings', ['visible_fields'], {
      matrix_id: '@victim:srv'
    })
    expect(row.visible_fields).toBe('[]')
  })

  it('rejects an insert whose column key carries SQL', async () => {
    await expect(
      db.insert('profilesettings', { 'matrix_id,visibility) SELECT 1,2 --': 'x' })
    ).rejects.toThrow('Invalid identifier')
  })

  it('rejects an updateAnd whose column key carries SQL', async () => {
    await expect(
      db.updateAnd(
        'profilesettings',
        { [injectionKey]: 'public' },
        { field: 'matrix_id', value: '@victim:srv' },
        { field: 'visibility', value: 'private' }
      )
    ).rejects.toThrow('Invalid identifier')
  })

  it('still performs a legitimate update', async () => {
    await db.update('profilesettings', { visibility: 'public' }, 'matrix_id', '@victim:srv')
    const [row] = await db.get('profilesettings', ['visibility'], {
      matrix_id: '@victim:srv'
    })
    expect(row.visibility).toBe('public')
  })
})
