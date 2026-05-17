const Redis = require('ioredis');
const logger = require('../utils/logger');

let redis = null;

const connectRedis = async () => {
  // If no REDIS_URL provided, skip Redis (app works without it)
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    logger.warn('REDIS_URL not set - running without Redis cache');
    return null;
  }

  try {
    redis = new Redis(redisUrl, {
      retryStrategy: (times) => {
        if (times > 3) {
          logger.warn('Redis max retries reached - running without Redis');
          return null; // stop retrying
        }
        return Math.min(times * 200, 2000);
      },
      maxRetriesPerRequest: 2,
      lazyConnect: true,
    });

    redis.on('connect', () => {
      logger.info('Redis connected successfully');
    });

    redis.on('error', (err) => {
      logger.warn('Redis error (non-fatal):', err.message);
    });

    await redis.connect().catch((err) => {
      logger.warn('Redis connection failed (non-fatal):', err.message);
      redis = null;
    });

    return redis;
  } catch (error) {
    logger.warn('Redis initialization failed (non-fatal):', error.message);
    return null;
  }
};

const getRedis = () => redis;

module.exports = connectRedis;
module.exports.getRedis = getRedis;
