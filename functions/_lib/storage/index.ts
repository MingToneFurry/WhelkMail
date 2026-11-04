import type { AccountRow } from '../db'
import type { Env } from '../env'
import { DriveStorage } from './drive'
import { R2Storage } from './r2'
import type { StorageAdapter } from './types'

export async function getStorage(env: Env, row: AccountRow): Promise<StorageAdapter> {
  if (row.storage_driver === 'r2') {
    return new R2Storage(env)
  }
  return new DriveStorage(env, row)
}

export type { StorageAdapter } from './types'
