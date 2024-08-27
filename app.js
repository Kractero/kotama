import express from 'express';
import cors from 'cors';
import { trophies } from './trophies.js';
import { rateLimit } from 'express-rate-limit';
import compression from 'compression';
import { getOrSetToCache } from './getOrSetToCache.js';
import { logger } from './logger.js';
import 'dotenv/config.js';
import { schedule } from 'node-cron';
import { getDatabase } from './db.js';

const port = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.set('trust proxy', 1);

const limiter = rateLimit({
	windowMs: 30 * 1000,
	max: 50,
	message: { error: 'Rate limit exceeded', status: 429 }
});

let cardsCteStatus = {};

async function loadCardsCteStatus() {
	const currentDate = new Date();
	const utcMinus7Date = new Date(currentDate.getTime() - 7 * 60 * 60 * 1000);
	utcMinus7Date.setDate(utcMinus7Date.getDate() - 1);
	const date = utcMinus7Date.toISOString().slice(0, 10);

	try {
		const response = await fetch(
			`https://raw.githubusercontent.com/Kractero/region-xml-dump/main/data/${date}-cards.json`
		);
		if (!response.ok) {
			logger.error(
				{ status: response.status, statusText: response.statusText },
				'Failed to update cards CTE status'
			);
			return;
		}
		const json = await response.json();
		cardsCteStatus = json;
		logger.info(`Successfully updated cte statuses for ${date}`);
	} catch (error) {
		logger.error({ error: error.message }, 'Failed to fetch or update cards CTE status');
	}
}

loadCardsCteStatus();

schedule('0 7 * * *', () => {
	loadCardsCteStatus();
});

app.use(cors());
app.use(compression());

app.get('/api', limiter, async (req, res) => {
	try {
		const db = getDatabase();
		let query = '';
		if (req.query.select && ['all', 'min'].includes(req.query.select)) {
			if (req.query.select === 'all') query += `SELECT *`;
			else query += `SELECT id, name, season`;
		} else query += `SELECT *`;

		if (req.query.from && ['S1', 'S2', 'S3'].includes(req.query.from))
			query += ` FROM ${req.query.from} WHERE`;
		else query += ` FROM S3 WHERE`;
		const clauseBuilder = req.query.clauses
			? req.query.clauses.split(',').map((clause) => {
					const clauser = clause.split('-');
					if (clauser[3] === 'rare') {
						clauser[2] = 'ultra-rare';
						clauser.pop();
					}
					return {
						qualifier: ['OR', 'AND'].includes(clauser[0]) ? clauser[0] : '',
						whereValue: ['OR', 'AND'].includes(clauser[0]) ? clauser[1] : clauser[0],
						conditionValue: ['OR', 'AND'].includes(clauser[0]) ? clauser[2] : clauser[1],
						badgeTrophyValue: '',
						input: ['OR', 'AND'].includes(clauser[0]) ? clauser[3] : clauser[2],
						trophyPercentage: ['OR', 'AND'].includes(clauser[0])
							? clauser[4]
								? clauser[4]
								: ''
							: clauser[3]
								? clauser[3]
								: ''
					};
				})
			: [];
		for (let i = 0; i < clauseBuilder.length; i++) {
			const clause = clauseBuilder[i];

			if (clause.whereValue !== '') {
				query += ` ${clause.qualifier}`;

				if (clause.whereValue === 'exnation') {
					query += ` REGION ${clause.input === 'true' ? 'IS NOT' : 'IS'} NULL`;
				} else {
					if (['badges', 'trophies'].includes(clause.whereValue)) {
						if (clause.whereValue === 'badges') {
							if (clause.conditionValue === 'HAS NO') {
								query += ` JSON_EXTRACT(badges, '$') = '{}';;`;
							} else {
								query += ` JSON_EXTRACT(${clause.whereValue}, '$.${clause.input}') ${clause.conditionValue === 'IS' ? ' >= 1' : 'IS NULL'}`;
							}
						} else {
							if (clause.conditionValue === 'HAS NO') {
								query += ` JSON_EXTRACT(trophies, '$') = '{}';;`;
							} else {
								query += ` JSON_EXTRACT(${clause.whereValue}, '$.${trophies[clause.input]}-${clause.trophyPercentage}') ${clause.conditionValue === 'IS' ? ' IS NOT NULL' : 'IS NULL'}`;
							}
						}
					} else {
						query += ` ${clause.whereValue} ${clause.conditionValue} ${clause.conditionValue.includes('LIKE') ? `'%${clause.input}%'` : `'${clause.input}'`} COLLATE NOCASE`;
					}
				}
			}
		}

		let getCardsFromDB = await getOrSetToCache(query, () => db.prepare(query).all());

		getCardsFromDB.forEach((card) => {
			if (card.badges) {
				card.badges = JSON.parse(card.badges);
			}
			if (card.trophies) {
				card.trophies = JSON.parse(card.trophies);
			}
			card.cte = cardsCteStatus[String(card.id)];
		});

		res.send(getCardsFromDB);
	} catch (err) {
		logger.error(
			{
				params: req.query
			},
			`An error occured on the / route: ${err}`
		);
	}
});

app.get('/health', async (req, res) => {
	logger.info('We live');
	res.status(200).send();
});

app.listen(port, () => {
	logger.info(`App started and listening on ${port}`);
});

process.on('SIGINT', () => {
	logger.info('SIGINT signal received: closing database connection.');
	const db = getDatabase();
	if (db) {
		db.close();
		logger.info('Database connection closed.');
	}
	process.exit(0);
});
