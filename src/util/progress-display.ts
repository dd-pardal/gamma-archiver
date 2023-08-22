let text = "";
let lines = 0;

if (process.stdout.isTTY) {
	function clear() {
		process.stdout.write(`${lines > 0 ? `\x1B[${lines}A` : ""}\x1B[G\x1B[J`);
	}
	function write() {
		process.stdout.write(text);
	}

	for (const methodName of [
		"count",
		"debug",
		"dir",
		"dirxml",
		...(process.stderr.isTTY ? ["error"] as const : [] as const),
		"info",
		"log",
		"table",
		"timeEnd",
		"timeLog",
		"trace",
		"warn",
	] as const) {
		const oldMethod = console[methodName];
		console[methodName] = function consoleMethod(...args: any[]) {
			clear();
			oldMethod.apply(console, args);
			write();
		};
	}
}

export function setProgress(newText: string | undefined = ""): void {
	if (process.stdout.isTTY) {
		process.stdout.write(`${lines > 0 ? `\x1B[${lines}A` : ""}\x1B[G${newText.replaceAll("\n", "\x1B[K\n")}\x1B[J`);

		text = newText;
		lines = 0;
		for (let i = 0; i < text.length; i++) {
			if (text[i] === "\n") lines++;
		}
	} else {
		process.stdout.write(newText + "\n");
	}
}
