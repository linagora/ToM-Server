import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, describe, expect, it } from 'bun:test'
import defaultConfig from '../../defaultConfig.json'
import { type Config } from '../types'
import IdentityServerDB, { keyIdOf } from '.'

const noop = (): void => {}
const logger = { error: noop, warn: noop, info: noop, debug: noop, silly: noop } as any
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tom-keys-'))

const open = async (file: string): Promise<IdentityServerDB> => {
  const db = new IdentityServerDB(
    { ...defaultConfig, database_engine: 'sqlite', database_host: file } as Config,
    logger
  )
  await db.ready
  return db
}

const currentKeyId = async (db: IdentityServerDB): Promise<string> =>
  keyIdOf((await db.get('longTermKeypairs', ['keyID'], { name: 'currentKey' }))[0] ?? {})

describe('ensureSigningKey', () => {
  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('keeps the same Ed25519 key across starts', async () => {
    const db = await open(path.join(dir, 'idempotent.db'))
    await db.ensureSigningKey()
    const first = await currentKeyId(db)
    await db.ensureSigningKey()
    expect(first).toStartWith('ed25519:')
    expect(await currentKeyId(db)).toBe(first)
    db.close()
  })

  it('settles for two instances replacing a curve25519 key together', async () => {
    const file = path.join(dir, 'race.db')
    const a = await open(file)
    const b = await open(file)
    await a.createKeypair('longTerm', 'curve25519')
    const results = await Promise.race([
      Promise.allSettled([a.ensureSigningKey(), b.ensureSigningKey()]),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 3000))
    ])
    expect(results).not.toBe('timeout')
    expect((results as PromiseSettledResult<void>[]).map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(await currentKeyId(a)).toStartWith('ed25519:')
    a.close()
    b.close()
  })
})

describe('keyIdOf', () => {
  it('reads the column as PostgreSQL returns it', () => {
    expect(keyIdOf({ keyid: 'ed25519:x' })).toBe('ed25519:x')
  })
})
