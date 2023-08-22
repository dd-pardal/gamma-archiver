// ~~Stolen from~~ Inspired by FFmpeg
const stringToLevelNumberMap = new Map([
	["error", 0],
	["warning", 1],
	["info", 2],
	["verbose", 3],
	["debug", 4],
]);
const levels = ["error", "warning", "info", "verbose", "debug"] as const;

export const enum LoggingLevel {
	ERROR = 0,
	WARNING = 1,
	INFO = 2,
	VERBOSE = 3,
	DEBUG = 4,
}

function levelToNumber(level: string | number): LoggingLevel {
	let levelNumber;
	if (typeof level === "number") {
		levelNumber = level;
	} else {
		levelNumber = stringToLevelNumberMap.get(level);
		if (levelNumber === undefined) {
			levelNumber = Number.parseInt(level);
			if (Number.isNaN(levelNumber) || levelNumber < 0 || levelNumber > 4) {
				throw new TypeError(`The logging level must be one of ${[...stringToLevelNumberMap.keys()].join(", ")} or an integer between 0 and 4, inclusive.`);
			}
		}
	}
	return levelNumber;
}

function log(...args: unknown[]) {
	console.error(...args);
}

export default {
	log,
	maxLevelNumber: 2,
	setLevel(level: string | number) {
		this.maxLevelNumber = levelToNumber(level);
		let i;
		for (i = 0; i <= (this.maxLevelNumber as number); i++) {
			this[levels[i]] = this.log;
		}
		for (; i < levels.length; i++) {
			this[levels[i]] = undefined;
		}
	},
	error: log,
	warning: log,
	info: log,
	verbose: undefined,
	debug: undefined,
} as {
	log: (this: void, ...args: unknown[]) => void;
	maxLevelNumber: LoggingLevel;
	setLevel: (level: string | number) => void;
	error: ((this: void, ...args: unknown[]) => void) | undefined;
	warning: ((this: void, ...args: unknown[]) => void) | undefined;
	info: ((this: void, ...args: unknown[]) => void) | undefined;
	verbose: ((this: void, ...args: unknown[]) => void) | undefined;
	debug: ((this: void, ...args: unknown[]) => void) | undefined;
};
