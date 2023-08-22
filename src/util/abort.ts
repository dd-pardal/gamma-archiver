class AbortError extends Error {
	constructor() {
		super("The operation was aborted.");
	}
}
AbortError.prototype.name = "AbortError";

export const abortError = new AbortError();

export type AbortSignal = {
	aborted: boolean;
	addEventListener(type: "abort", listener: () => void, options?: { once: boolean } | undefined): void;
	removeEventListener(type: "abort", listener: () => void): void;
};

/**
 * Returns a promise that resolves after a specified amount of time or rejects with `abortError` if the `AbortSignal` is aborted.
 */
export function timeout(ms: number, abortSignal?: AbortSignal | null | undefined): Promise<void> {
	return new Promise((res, rej) => {
		const abortHandler = () => {
			clearTimeout(timeoutID);
			rej(abortError);
		};
		abortSignal?.addEventListener("abort", abortHandler, { once: true });
		const timeoutID = setTimeout(() => {
			abortSignal?.removeEventListener("abort", abortHandler);
			res();
		}, ms);
	});
}

/**
 * Returns a promise that resolves when the abort signal fires
 */
export function waitForAbort(signal: AbortSignal): Promise<void> {
	return new Promise((res) => {
		signal.addEventListener("abort", res, { once: true });
	});
}

/**
 * Creates a controller that will be aborted if the provided signal receives an abort event.
 * @returns the newly created controller and a function to be called when the created controller will on longer be aborted
 */
export function extendAbortSignal(signal: AbortSignal | null | undefined): { controller: AbortController; done: () => void } {
	const controller = new AbortController();

	if (signal == null) {
		return { controller, done: () => {} };

	} else if (signal.aborted) {
		controller.abort();
		return { controller, done: () => {} };

	} else {
		const abortHandler = controller.abort.bind(controller);
		signal.addEventListener("abort", abortHandler);
		return {
			controller,
			done: () => {
				signal.removeEventListener("abort", abortHandler);
			},
		};
	}
}
