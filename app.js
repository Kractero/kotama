import express from 'express'
import cors from 'cors'
import { trophies } from './util/trophies.js'
import { rateLimit } from 'express-rate-limit'
import compression from 'compression'
import { getOrSetToCache } from './util/getOrSetToCache.js'
import { logger } from './util/logger.js'
import 'dotenv/config.js'
import { schedule } from 'node-cron'
import { getDatabase } from './util/db.js'

const port = process.env.PORT || 3000

const app = express()
app.use(express.json())
app.set('trust proxy', 1)

const limiter = rateLimit({
  windowMs: 30 * 1000,
  max: 50,
  message: { error: 'Rate limit exceeded', status: 429 },
})

let cardsCteStatus = {}

async function loadCardsCteStatus() {
  const currentDate = new Date()
  const utcMinus7Date = new Date(currentDate.getTime() - 7 * 60 * 60 * 1000)
  utcMinus7Date.setDate(utcMinus7Date.getDate() - 1)
  const date = utcMinus7Date.toISOString().slice(0, 10)

  try {
    const response = await fetch(
      `https://raw.githubusercontent.com/Kractero/region-xml-dump/main/data/${date}-cards.json`
    )
    if (!response.ok) {
      logger.error({ status: response.status, statusText: response.statusText }, 'Failed to update cards CTE status')
      return
    }
    const json = await response.json()
    cardsCteStatus = json
    logger.info(
      {
        type: 'system',
      },
      `Successfully updated cte statuses for ${date}`
    )
  } catch (error) {
    logger.error(
      {
        type: 'system',
        error: err,
      },
      `An error occured while fetching the latest CTE status`
    )
    logger.error({ error: error.message }, 'Failed to fetch or update cards CTE status')
  }
}

loadCardsCteStatus()

schedule('0 7 * * *', () => {
  loadCardsCteStatus()
})

app.use(cors())
app.use(compression())

app.get('/api', limiter, async (req, res) => {
  try {
    const db = getDatabase()
    let query = ''
    if (req.query.select && ['all', 'min'].includes(req.query.select)) {
      if (req.query.select === 'all') query += `SELECT *`
      else query += `SELECT id, name, season`
    } else query += `SELECT *`

    if (req.query.from && ['S1', 'S2', 'S3'].includes(req.query.from)) query += ` FROM ${req.query.from} WHERE`
    else query += ` FROM S3 WHERE`
    const clauseBuilder = req.query.clauses
      ? req.query.clauses
          .split(',')
          .map(clause => {
            const clauser = clause.split('-')
            if (clauser[3] === 'rare') {
              clauser[2] = 'ultra-rare'
              clauser.pop()
            }
            return {
              qualifier: 'AND',
              whereValue: clauser[0],
              conditionValue: clauser[1],
              badgeTrophyValue: '',
              input: clauser[2],
              trophyPercentage: clauser[3] ? clauser[3] : '',
            }
          })
          .filter(clause => clause)
      : []

    for (let i = 0; i < clauseBuilder.length; i++) {
      const clause = clauseBuilder[i]
      if (clause.whereValue === 'status') continue
      if (clause.whereValue !== '') {
        if (i > 0 && !query.endsWith('WHERE')) query += ` ${clause.qualifier}`

        if (clause.whereValue === 'exnation') {
          query += ` REGION ${clause.input === 'TRUE' ? 'IS' : 'IS NOT'} NULL`
        } else {
          if (['badges', 'trophies'].includes(clause.whereValue)) {
            if (clause.whereValue === 'badges') {
              if (clause.conditionValue === 'HAS NO') {
                query += ` JSON_EXTRACT(badges, '$') = '{}';;`
              } else {
                query += ` JSON_EXTRACT(${clause.whereValue}, '$.${clause.input}') ${
                  clause.conditionValue === 'IS' ? ' >= 1' : 'IS NULL'
                }`
              }
            } else {
              if (clause.conditionValue === 'HAS NO') {
                query += ` JSON_EXTRACT(trophies, '$') = '{}';;`
              } else {
                query += ` JSON_EXTRACT(${clause.whereValue}, '$.${trophies[clause.input]}-${
                  clause.trophyPercentage
                }') ${clause.conditionValue === 'IS' ? ' IS NOT NULL' : 'IS NULL'}`
              }
            }
          } else {
            query += ` ${clause.whereValue} ${clause.conditionValue} ${
              clause.conditionValue.includes('LIKE') ? `'%${clause.input}%'` : `'${clause.input}'`
            } COLLATE NOCASE`
          }
        }
      }
    }

    let getCardsFromDB = await getOrSetToCache(req.query, () => db.prepare(query).all())

    getCardsFromDB.forEach(card => {
      if (card.badges) {
        card.badges = JSON.parse(card.badges)
      }
      if (card.trophies) {
        card.trophies = JSON.parse(card.trophies)
      }
      card.cte = cardsCteStatus[String(card.id)]
    })

    /* If its cached, the response will most likely already take care
      of checking if this was a cte query, but the information could be
      out of date, so reverify with an updated cte sheet. If this hurts
      server resources this will be reconsidered
    */
    const checkCTEs = clauseBuilder.find(clause => clause.whereValue === 'status')

    if (checkCTEs) {
      getCardsFromDB = getCardsFromDB.filter(card =>
        checkCTEs.input === 'Exists' ? card.cte === false : card.cte === true
      )
    }

    res.send(getCardsFromDB)
  } catch (error) {
    logger.error(
      {
        type: 'user request',
        params: req.query,
        error: error.message,
      },
      `An error occured on the / route`
    )
  }
})

app.get('/health', limiter, async (req, res) => {
  res.status(200).send()
})

app.listen(port, () => {
  logger.info(
    {
      type: 'system',
    },
    `App started and listening on ${port}`
  )
})

process.on('SIGINT', () => {
  logger.info(
    {
      type: 'system',
    },
    'SIGINT signal received: closing database connection.'
  )
  const db = getDatabase()
  if (db) {
    db.close()
    logger.info(
      {
        type: 'system',
      },
      'Database connection closed.'
    )
  }
  process.exit(0)
})
