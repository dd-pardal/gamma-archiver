import { workerData, parentPort } from "node:worker_threads";
import { IteratorRequest, IteratorResponseFor, RequestType, ResponseFor, SingleRequest } from "./types.js";
import { getRequestHandler } from "./request-handler.js";
import { LoggingLevel } from "../util/log.js";

export const enum WorkerMessageType {
	READY,
	SINGLE,
	ITERATOR_RESULT,
	ERROR,
	LOG,
}

export type WorkerReadyMessage = {
	type: WorkerMessageType.READY;
};
export type WorkerSingleResponseMessage<R extends ResponseFor<SingleRequest>> = {
	type: WorkerMessageType.SINGLE;
	response: R;
};
export type WorkerIteratorResponseMessage<R extends IteratorResult<IteratorResponseFor<IteratorRequest>>> = {
	type: WorkerMessageType.ITERATOR_RESULT;
	result: R;
};
export type WorkerErrorMessage = {
	type: WorkerMessageType.ERROR;
	error: unknown;
};
export type WorkerLogMessage = {
	type: WorkerMessageType.LOG;
	args: unknown[];
};
export type WorkerMessage =
	WorkerReadyMessage |
	WorkerSingleResponseMessage<ResponseFor<SingleRequest>> |
	WorkerIteratorResponseMessage<IteratorResult<IteratorResponseFor<IteratorRequest>>> |
	WorkerErrorMessage |
	WorkerLogMessage;


if (!parentPort) {
	throw new Error("This script should not be imported directly.");
}

process.on("uncaughtExceptionMonitor", (err) => {
	console.error(err);
});

function logMessage(...args: unknown[]) {
	parentPort!.postMessage({
		type: WorkerMessageType.LOG,
		args,
	} satisfies WorkerLogMessage);
}

const requestHandler = getRequestHandler({
	path: workerData.path,
	log: {
		log: logMessage,
		maxLevelNumber: workerData.maxLevelNumber,
		setLevel: undefined as any,
		error: workerData.maxLevelNumber >= LoggingLevel.ERROR ? logMessage : undefined,
		warning: workerData.maxLevelNumber >= LoggingLevel.WARNING ? logMessage : undefined,
		info: workerData.maxLevelNumber >= LoggingLevel.INFO ? logMessage : undefined,
		verbose: workerData.maxLevelNumber >= LoggingLevel.VERBOSE ? logMessage : undefined,
		debug: workerData.maxLevelNumber >= LoggingLevel.DEBUG ? logMessage : undefined,
	},
});

function messageHandler(req: SingleRequest | IteratorRequest) {
	try {
		const resp = requestHandler(req);
		if (req.type === RequestType.CLOSE) {
			parentPort!.off("message", messageHandler);
			return;
		}
		if (typeof resp === "object" && resp !== null && Symbol.iterator in resp) {
			// Implement support for cancellation (return()) if needed
			while (true) {
				const result = resp.next();
				parentPort!.postMessage({
					type: WorkerMessageType.ITERATOR_RESULT,
					result,
				} satisfies WorkerIteratorResponseMessage<any>);
				if (result.done) break;
			}
		} else {
			parentPort!.postMessage({
				type: WorkerMessageType.SINGLE,
				response: resp,
			} satisfies WorkerSingleResponseMessage<any>);
		}
	} catch (error) {
		parentPort!.postMessage({
			type: WorkerMessageType.ERROR,
			error,
		} satisfies WorkerErrorMessage);
	}
}
parentPort.on("message", messageHandler);

// Indicate to the parent thread that the connection is ready
parentPort.postMessage({ type: WorkerMessageType.READY } satisfies WorkerReadyMessage);
