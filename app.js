import express from 'express'
import cors from 'cors'
import { trophies } from './util/trophies.js'
import { rateLimit } from 'express-rate-limit'
import compression from 'compression'
import { getOrSetToCache, invalidateCache } from './util/getOrSetToCache.js'
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
    const response = await fetch(`https://raw.githubusercontent.com/Kractero/himari/main/data/${date}-cards.json`)
    if (!response.ok) {
      logger.error({ status: response.status, statusText: response.statusText }, 'Failed to update cards CTE status')
      return
    }
    const json = await response.json()
    cardsCteStatus = json

    await invalidateCache()
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
        error: error.message,
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

function buildWhereClause(req) {
  let where = ''
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
            input: clauser[2],
            trophyPercentage: clauser[3] ? clauser[3] : '',
          }
        })
        .filter(clause => clause)
    : []

  if (!(clauseBuilder.length === 1 && clauseBuilder[0].whereValue === 'status')) where += ' WHERE'

  for (let i = 0; i < clauseBuilder.length; i++) {
    const clause = clauseBuilder[i]
    if (clause.whereValue === 'status') continue
    if (clause.whereValue !== '') {
      if (i > 0 && !where.endsWith('WHERE')) where += ` ${clause.qualifier}`

      if (clause.whereValue === 'exnation') {
        where += ` REGION ${clause.input === 'TRUE' ? 'IS' : 'IS NOT'} NULL`
      } else {
        if (['badges', 'trophies'].includes(clause.whereValue)) {
          if (clause.whereValue === 'badges') {
            if (clause.conditionValue === 'HAS NO') {
              where += ` JSON_EXTRACT(badges, '$') = '{}'`
            } else {
              where += ` JSON_EXTRACT(${clause.whereValue}, '$.${clause.input}') ${
                clause.conditionValue === 'IS' ? ' >= 1' : 'IS NULL'
              }`
            }
          } else {
            if (clause.conditionValue === 'HAS NO') {
              where += ` JSON_EXTRACT(trophies, '$') = '{}'`
            } else {
              where += ` JSON_EXTRACT(${clause.whereValue}, '$.${trophies[clause.input]}-${
                clause.trophyPercentage
              }') ${clause.conditionValue === 'IS' ? ' IS NOT NULL' : 'IS NULL'}`
            }
          }
        } else {
          where += ` ${clause.whereValue} ${clause.conditionValue} ${
            clause.conditionValue.includes('LIKE') ? `'%${clause.input}%'` : `'${clause.input}'`
          } COLLATE NOCASE`
        }
      }
    }
  }

  return { where, clauseBuilder }
}

function getTable(req) {
  if (req.query.from && ['S1', 'S2', 'S3', 'S4'].includes(req.query.from)) return req.query.from
  return 'S3'
}

app.get('/api', limiter, async (req, res) => {
  try {
    const origin = req.headers['x-origin']
    const db = getDatabase()
    const limit = parseInt(req.query.limit) || 25
    const page = parseInt(req.query.page - 1) || 0
    const table = getTable(req)

    const select = req.query.select === 'all' ? 'SELECT *' : 'SELECT id, name'
    const { where, clauseBuilder } = buildWhereClause(req)

    const query = `${select} FROM ${table}${where} LIMIT ${limit} OFFSET ${page * limit}`

    let getCardsFromDB = await getOrSetToCache(query, () => db.prepare(query).all(), origin, 'userQuery')

    getCardsFromDB.forEach(card => {
      if (card.badges) {
        card.badges = JSON.parse(card.badges)
      }
      if (card.trophies) {
        card.trophies = JSON.parse(card.trophies)
      }
      card.cte = cardsCteStatus[String(card.id)]
    })

    const checkCTEs = clauseBuilder.find(clause => clause.whereValue === 'status')

    if (checkCTEs) {
      getCardsFromDB = getCardsFromDB.filter(card =>
        checkCTEs.input === 'Exists' ? card.cte === false : card.cte === true
      )
    }

    const countQuery = `SELECT COUNT(*) as total FROM ${table}${where}`
    const totalCount = await getOrSetToCache(countQuery, () => db.prepare(countQuery).get(), origin, 'countQuery')

    res.send({
      total: totalCount.total,
      limit: limit,
      page: limit * page + 1,
      cards: getCardsFromDB,
    })
  } catch (error) {
    const origin = req.headers['x-origin']

    logger.error(
      {
        type: 'user request',
        params: req.query,
        error: error.message,
        origin: origin === 'frontend' ? 'frontend' : 'api',
      },
      `An error occured on the /api route`
    )
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.get('/api/download', limiter, (req, res) => {
  try {
    const db = getDatabase()
    const table = getTable(req)
    const format = req.query.format || 'txt'
    const season = table[1]
    const ua = req.query.ua || ''

    const { where, clauseBuilder } = buildWhereClause(req)
    const checkCTEs = clauseBuilder.find(clause => clause.whereValue === 'status')

    const select = format === 'csv' ? 'SELECT *' : 'SELECT id, name'
    const query = `${select} FROM ${table}${where}`

    if (format === 'html') {
      res.setHeader('Content-Type', 'text/html')
      res.setHeader('Content-Disposition', 'attachment; filename="query.html"')
      res.write(`<html><head><style>
        td.createcol p { padding-left: 10em; }
        a { text-decoration: none; color: black; }
        a:visited { color: grey; }
        table { border-collapse: collapse; display: table-cell; max-width: 100%; border: 1px solid darkorange; }
        tr, td { border-bottom: 1px solid darkorange; }
        td p { padding: 0.5em; }
        tr:hover { background-color: lightgrey; }
        @media (prefers-color-scheme: dark) {
          html { background-color: black; }
          a, p { color: rgb(232, 211, 162); }
          a:visited { color: rgb(145, 23, 76); }
          table, tr, td { border: 1px solid rgb(51, 0, 111); }
        }
        </style></head><body><table>`)

      for (const card of db.prepare(query).iterate()) {
        card.cte = cardsCteStatus[String(card.id)]
        if (checkCTEs) {
          const passes = checkCTEs.input === 'Exists' ? card.cte === false : card.cte === true
          if (!passes) continue
        }
        res.write(
          `<tr><td><p>S${season} ${card.id}</p></td><td><p><a target="_blank" href="https://www.nationstates.net/page=deck/card=${card.id}/season=${season}?generated_by=Queries__author_main_nation_Kractero__usedBy_${ua}">Link to Card</a></p></td></tr>\n`
        )
      }

      res.write(
        `<tr><td><p><a target="_blank" href="https://this-page-intentionally-left-blank.org/">Done!</a></p></td><td><p><a target="_blank" href="https://this-page-intentionally-left-blank.org/">Done!</a></p></td></tr>`
      )
      res.write(
        `</table><script>document.querySelectorAll("td").forEach(function(el){el.addEventListener("click",function(){const row=el.parentNode;row.nextElementSibling.querySelector("a").focus();row.parentNode.removeChild(row);});});</script></body></html>`
      )
      res.end()
    } else if (format === 'txt') {
      res.setHeader('Content-Type', 'text/plain')
      res.setHeader('Content-Disposition', 'attachment; filename="query.txt"')

      for (const card of db.prepare(query).iterate()) {
        card.cte = cardsCteStatus[String(card.id)]
        if (checkCTEs) {
          const passes = checkCTEs.input === 'Exists' ? card.cte === false : card.cte === true
          if (!passes) continue
        }
        res.write(`${card.id},${season}\n`)
      }
      res.end()
    } else if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv')
      res.setHeader('Content-Disposition', 'attachment; filename="query.csv"')

      let headerWritten = false
      for (const card of db.prepare(query).iterate()) {
        if (card.badges) card.badges = JSON.parse(card.badges)
        if (card.trophies) card.trophies = JSON.parse(card.trophies)
        card.cte = cardsCteStatus[String(card.id)]

        if (checkCTEs) {
          const passes = checkCTEs.input === 'Exists' ? card.cte === false : card.cte === true
          if (!passes) continue
        }

        if (!headerWritten) {
          res.write(Object.keys(card).join(',') + '\n')
          headerWritten = true
        }
        const values = Object.values(card).map(v => {
          const str = typeof v === 'object' ? JSON.stringify(v) : String(v)
          return `"${str.replace(/"/g, '""')}"`
        })
        res.write(values.join(',') + '\n')
      }
      res.end()
    } else {
      res.status(400).json({ error: 'Invalid format. Use html, txt, or csv.' })
    }
  } catch (error) {
    const origin = req.headers['x-origin']

    logger.error(
      {
        type: 'user request',
        params: req.query,
        error: error.message,
        origin: origin === 'frontend' ? 'frontend' : 'api',
      },
      `An error occured on the /api/download route`
    )
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' })
    } else {
      res.end()
    }
  }
})

app.post('/api/cte', async (req, res) => {
  try {
    const origin = req.headers['x-origin']
    let cardIds = req.body
    if (!Array.isArray(cardIds)) {
      cardIds = [cardIds]
    }

    const fetchCteStatus = async () => {
      const cteCards = cardIds.reduce((acc, cardId) => {
        acc[cardId] = cardsCteStatus[String(cardId)] || false
        return acc
      }, {})
      return cteCards
    }

    const cteCards = await getOrSetToCache(JSON.stringify(cardIds), fetchCteStatus, origin, 'cteCards')

    res.json(cteCards)
  } catch (error) {
    const origin = req.headers['x-origin']

    logger.error(
      {
        type: 'user request',
        params: req.query,
        error: error.message,
        origin: origin === 'frontend' ? 'frontend' : 'api',
      },
      `An error occured on the /api/cte route`
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
