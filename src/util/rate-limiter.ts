/**
 * Class that handles actions that must happen at most L times every I milliseconds.
 */
export class RateLimiter {
	limit: number;
	interval: number;
	#lastTimestamps: number[] = [];
	#pending: (() => void)[] = [];
	#executeFirstPending: () => void;

	constructor(limit: number, interval: number) {
		this.limit = limit;
		this.interval = interval;
		this.#executeFirstPending = () => {
			const now = Date.now();
			this.#lastTimestamps.push(now);
			this.#pending.shift()!();
			if (this.#pending.length > 0) {
				setTimeout(this.#executeFirstPending, this.#lastTimestamps.shift()! + this.interval - now);
			}
		};
	}

	getPendingAmount(): number {
		return this.#pending.length;
	}

	/**
	 * Returns a promise that only resolves `this.limit` times every `this.interval` milliseconds.
	 * Promises returned from earlier calls will be resolved first.
	 */
	whenFree(): Promise<void> {
		return new Promise((res) => {
			while (this.#lastTimestamps.length > 0 && this.#lastTimestamps[0] + this.interval < Date.now()) {
				this.#lastTimestamps.shift();
			}
			if (this.#lastTimestamps.length < this.limit && this.#pending.length === 0) {
				// There is time to do it right now
				this.#lastTimestamps.push(Date.now());
				res();
			} else {
				// We are over the limit, schedule it for later
				if (this.#pending.length === 0) {
					setTimeout(this.#executeFirstPending, this.#lastTimestamps.shift()! + this.interval - Date.now());
				}
				this.#pending.push(res);
			}
		});
	}
}
