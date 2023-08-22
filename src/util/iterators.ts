export function mapIterator<TIn, TOut>(iterator: Iterator<TIn>, func: (value: TIn) => TOut): IterableIterator<TOut> {
	return {
		next() {
			const { value, done } = iterator.next();
			if (done) {
				return { done: true, value };
			} else {
				return { done: false, value: func(value) };
			}
		},
		[Symbol.iterator]() {
			return this;
		},
	};
}
