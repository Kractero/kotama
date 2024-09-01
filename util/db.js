import Database from 'better-sqlite3';
import { logger } from './logger.js';

let db = null;

export function getDatabase() {
	if (!db) {
		try {
			db = new Database('cards.db');
			logger.info('Database connection established.');
		} catch (error) {
			logger.error({ error }, 'Failed to establish database connection.');
			throw error;
		}
	}
	return db;
}
