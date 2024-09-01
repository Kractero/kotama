import { logger } from './logger.js'
import { RedisClient } from './redis.js'

export async function getOrSetToCache(key, callback, origin) {
  const selectPart = `select=${key.select}`
  const fromPart = `from=${key.from}`

  const sortedClauses = key.clauses.split(',').sort().join(',')

  const clausesPart = `clauses=${sortedClauses}`

  const cacheKey = `${selectPart}&${fromPart}&${clausesPart}`

  const data = await RedisClient.get(cacheKey)
  if (data) {
    logger.info(
      {
        type: 'user request',
        status: 'hit',
        query: cacheKey,
        origin: origin === 'frontend' ? 'frontend' : 'api',
      },
      'Redis cache hit'
    )
    return JSON.parse(data)
  }
  const queryResult = await callback()
  if (queryResult) {
    RedisClient.set(cacheKey, JSON.stringify(queryResult))
    RedisClient.expire(cacheKey, 600)
    logger.info(
      {
        type: 'user request',
        status: 'missed',
        query: cacheKey,
        origin: origin === 'frontend' ? 'frontend' : 'api',
      },
      'Redis cache missed'
    )
    return queryResult
  }
}
