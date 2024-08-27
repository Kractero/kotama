import pino from 'pino';

export const logger = pino({
	level: process.env.PINO_LOG_LEVEL || 'trace',
	bindings: () => {
		return {
			node_version: process.version
		};
	},
	transport: {
		targets: [
			{ target: 'pino/file', options: { destination: 'app.log' } },
			{
				target: 'pino/file',
				options: { destination: 1 }
			}
		]
	},
	timestamp: pino.stdTimeFunctions.isoTime
});
