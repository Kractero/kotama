import { logger } from './logger.js'
import { RedisClient } from './redis.js'

export async function getOrSetToCache(key, callback) {
  const data = await RedisClient.get(key)
  if (data) {
    logger.info(`Data gathered from redis with key ${key}`)
    return JSON.parse(data)
  }
  const queryResult = await callback()
  if (queryResult) {
    RedisClient.set(key, JSON.stringify(queryResult))
    RedisClient.expire(key, 600)
    logger.info(`Data gathered from database and stored in redis with key ${key}`)
    return queryResult
  }
}
