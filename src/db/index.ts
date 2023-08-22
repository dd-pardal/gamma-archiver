import { Worker } from "node:worker_threads";
import { IteratorRequest, IteratorResponseFor, SingleRequest } from "./types.js";
import { ConcurrencyLimiter } from "../util/concurrency-limiter.js";
import { RequestType, ResponseFor } from "./types.js";
import { WorkerMessage, WorkerMessageType } from "./worker.js";
import { RequestHandler } from "./request-handler.js";
import log from "../util/log.js";

type IteratorContext = {
	resultQueue: IteratorResult<any>[];
	res: ((result: IteratorResult<IteratorResponseFor<IteratorRequest>>) => void) | undefined;
	rej: ((error: unknown) => void) | undefined;
	errored: boolean;
	error: unknown;
};

type BaseDatabaseConnection = {
	errored: boolean;
	error: unknown;
	ready: Promise<void>;

	request<R extends SingleRequest>(req: R): Promise<ResponseFor<R>>;
	iteratorRequest<R extends IteratorRequest>(req: R): AsyncIterableIterator<IteratorResponseFor<R>>;
	transaction(callback: () => Promise<void>): Promise<void>;
	close(): Promise<void>;
};

class AsyncDatabaseConnection implements BaseDatabaseConnection {
	#worker: Worker;
	#callbackQueue: { res: (res?: any) => void; rej: (error: unknown) => void }[] = [];
	errored = false;
	error: unknown;
	ready: Promise<void>;
	#readyCallbacks: { res: () => void; rej: (error: unknown) => void } | undefined;
	#transactionLimiter = new ConcurrencyLimiter(1);
	#iteratorContextQueue: IteratorContext[] = [];

	constructor(path: string) {
		this.ready = new Promise((res, rej) => {
			this.#readyCallbacks = { res, rej };
		});
		this.#worker = new Worker(new URL("./worker.js", import.meta.url), {
			workerData: {
				path,
				maxLevelNumber: log.maxLevelNumber,
			},
		});
		this.#worker.on("message", (msg: WorkerMessage) => {
			if (msg.type === WorkerMessageType.LOG) {
				log.log(...msg.args);
			} else if (msg.type === WorkerMessageType.READY) {
				this.#readyCallbacks!.res();
			} else if (this.#iteratorContextQueue.length > 0) {
				// We are currently receiving the results from an iterator request
				const ctx = this.#iteratorContextQueue[0];
				if (msg.type === WorkerMessageType.ERROR) {
					ctx.errored = true;
					ctx.error = msg.error;
					if (ctx.rej !== undefined) {
						ctx.rej(msg.error);
						ctx.res = undefined;
						ctx.rej = undefined;
					}
					this.#iteratorContextQueue.shift();
				} else if (msg.type === WorkerMessageType.ITERATOR_RESULT) {
					if (ctx.res !== undefined) {
						ctx.res(msg.result);
						ctx.res = undefined;
						ctx.rej = undefined;
					} else {
						ctx.resultQueue.push(msg.result);
					}
					if (msg.result.done) {
						this.#iteratorContextQueue.shift();
					}
				} else {
					throw new TypeError("Got invalid response from worker.");
				}
			} else {
				// We were waiting for the response from a single request
				if (msg.type === WorkerMessageType.ERROR) {
					this.#callbackQueue.shift()!.rej(msg.error);
				} else if (msg.type === WorkerMessageType.SINGLE) {
					this.#callbackQueue.shift()!.res(msg.response);
				} else {
					throw new TypeError("Got invalid response from worker.");
				}
			}
		});
		this.#worker.on("exit", () => {
			if (!this.errored) {
				this.#callbackQueue.shift()!.res();
				this.error = new Error("The database connection was closed.");
				this.errored = true;
				for (const { rej } of this.#callbackQueue) {
					rej(this.error);
				}
				this.#callbackQueue.length = 0;
			}
		});
		this.#worker.on("error", (error) => {
			this.error = error;
			this.errored = true;
			this.#readyCallbacks?.rej(error);
			for (const { rej } of this.#callbackQueue) {
				rej(error);
			}
			this.#callbackQueue.length = 0;
		});
	}

	request<R extends SingleRequest>(req: R): Promise<ResponseFor<R>> {
		return new Promise((res, rej) => {
			if (this.errored) {
				rej(this.error);
			} else {
				this.#callbackQueue.push({ res, rej });
				this.#worker.postMessage(req);
			}
		});
	}

	iteratorRequest<R extends IteratorRequest>(req: R): AsyncIterableIterator<IteratorResponseFor<R>> {
		if (this.errored) {
			return {
				next: () => {
					return Promise.reject(this.error);
				},
				[Symbol.asyncIterator]() {
					return this;
				},
			};
		} else {
			this.#worker.postMessage(req);
			const ctx: IteratorContext = {
				resultQueue: [],
				res: undefined,
				rej: undefined,
				errored: false,
				error: undefined,
			};
			this.#iteratorContextQueue.push(ctx);
			return {
				next: () => {
					return new Promise((res, rej) => {
						if (ctx.errored) {
							rej(ctx.error);
						} else if (ctx.resultQueue.length > 0) {
							res(ctx.resultQueue.shift()!);
						} else if (ctx.res !== undefined) {
							throw new Error("next() was called multiple times between results");
						} else {
							ctx.res = res as (result: IteratorResult<IteratorResponseFor<IteratorRequest>>) => void;
							ctx.rej = rej;
						}
					});
				},
				[Symbol.asyncIterator]() {
					return this;
				},
			};
		}
	}

	transaction<T>(callback: () => Promise<T>): Promise<T> {
		return this.#transactionLimiter.runWhenFree(async () => {
			this.request({ type: RequestType.BEGIN_TRANSACTION });
			const ret = await callback();
			this.request({ type: RequestType.COMMIT_TRANSACTION });
			return ret;
		});
	}

	close(): Promise<void> {
		return this.#transactionLimiter.runWhenFree(async () => {
			this.request({ type: RequestType.CLOSE });
		});
	}
}

class SyncDatabaseConnection implements BaseDatabaseConnection {
	errored = false;
	error = undefined;
	ready = Promise.resolve();

	#requestHandler: RequestHandler;
	#transactionLimiter = new ConcurrencyLimiter(1);

	constructor(requestHandler: RequestHandler) {
		this.#requestHandler = requestHandler;
	}

	requestSync<R extends SingleRequest>(req: R): ResponseFor<R> {
		return this.#requestHandler(req);
	}
	async request<R extends SingleRequest>(req: R): Promise<ResponseFor<R>> {
		return this.requestSync(req);
	}

	iteratorRequestSync<R extends IteratorRequest>(req: R): IterableIterator<IteratorResponseFor<R>> {
		return this.#requestHandler(req);
	}
	async *iteratorRequest<R extends IteratorRequest>(req: R): AsyncIterableIterator<IteratorResponseFor<R>> {
		yield* this.iteratorRequestSync(req);
	}

	transaction(callback: () => Promise<void>): Promise<void> {
		return this.#transactionLimiter.runWhenFree(async () => {
			this.requestSync({ type: RequestType.BEGIN_TRANSACTION });
			await callback();
			this.requestSync({ type: RequestType.COMMIT_TRANSACTION });
		});
	}

	close(): Promise<void> {
		return this.#transactionLimiter.runWhenFree(async () => {
			this.request({ type: RequestType.CLOSE });
		});
	}
}

export async function getDatabaseConnection(path: string, synchronous?: false): Promise<AsyncDatabaseConnection>;
export async function getDatabaseConnection(path: string, synchronous: true): Promise<SyncDatabaseConnection>;
export async function getDatabaseConnection(path: string, synchronous: boolean): Promise<AsyncDatabaseConnection>;
export async function getDatabaseConnection(path: string, synchronous = false): Promise<AsyncDatabaseConnection | SyncDatabaseConnection> {
	if (synchronous) {
		const requestHandler = (await import("./request-handler.js")).getRequestHandler({
			path,
			log,
		});
		return new SyncDatabaseConnection(requestHandler);
	} else {
		return new AsyncDatabaseConnection(path);
	}
}

export * from "./types.js";
