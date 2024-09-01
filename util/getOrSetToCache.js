import { logger } from './logger.js'
import { RedisClient } from './redis.js'

export async function getOrSetToCache(key, callback) {
  const data = await RedisClient.get(key)
  if (data) {
    logger.info(
      {
        type: 'user request',
        status: 'hit',
        query: key,
      },
      'Redis cache hit'
    )
    return JSON.parse(data)
  }
  const queryResult = await callback()
  if (queryResult) {
    RedisClient.set(key, JSON.stringify(queryResult))
    RedisClient.expire(key, 600)
    logger.info(
      {
        type: 'user request',
        status: 'missed',
        query: key,
      },
      'Redis cache missed'
    )
    return queryResult
  }
}
