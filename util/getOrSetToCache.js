import { logger } from './logger.js'
import { RedisClient } from './redis.js'

export async function getOrSetToCache(key, callback, origin) {
  if (key.hasOwnProperty('select')) {
    const selectPart = `select=${key.select}`
    const fromPart = `from=${key.from}`

    const sortedClauses = key.clauses.split(',').sort().join(',')

    const clausesPart = `clauses=${sortedClauses}`

    key = `${selectPart}&${fromPart}&${clausesPart}`
  }

  const data = await RedisClient.get(key)
  if (data) {
    logger.info(
      {
        type: 'user request',
        status: 'hit',
        query: key,
        origin: origin === 'frontend' ? 'frontend' : 'api',
      },
      'Redis cache hit'
    )
    return JSON.parse(data)
  }
  const queryResult = await callback()
  if (queryResult) {
    // const now = new Date();
    // const nextRun = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 7, 0, 0, 0);
    // if (now >= nextRun) {
    //   nextRun.setDate(nextRun.getDate() + 1);
    // }
    // const expirationTime = Math.floor((nextRun - now) / 1000)

    RedisClient.set(key, JSON.stringify(queryResult))
    RedisClient.expire(key, 86400)
    logger.info(
      {
        type: 'user request',
        status: 'missed',
        query: key,
        origin: origin === 'frontend' ? 'frontend' : 'api',
      },
      'Redis cache missed'
    )
    return queryResult
  }
}

export async function invalidateCache() {
  try {
    await RedisClient.flushdb()

    logger.info({ type: 'system' }, 'All cache entries have been invalidated')
  } catch (error) {
    logger.error({ type: 'system', error: error.message }, 'Failed to invalidate cache')
  }
}
