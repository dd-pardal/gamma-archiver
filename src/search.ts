import { RequestType, getDatabaseConnection } from "./db/index.js";
import readline from "node:readline";
import { getTag } from "./discord-api/tag.js";

const db = await getDatabaseConnection(process.argv[2], true);

console.log("Input the terms you want to search for.");

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});
rl.prompt();

for await (const query of rl) {
	try {
		for (const result of db.iteratorRequestSync({
			type: RequestType.SEARCH_MESSAGES,
			query,
			startDelimiter: "\x1B[31m",
			endDelimiter: "\x1B[m",
		})) {
			console.log(`\
\x1b[1m${
	result.username === null ?
		`user ${result.user_id}` :
		getTag(result as { username: string; discriminator: string | null })
}\x1b[m${result.user_id < 281474976710656n ? " (webhook)" : ""} \
on \x1b[1m${result.guild_name ?? `guild ${result.guild_id}`}\x1b[m \
in ${
	result.parent_channel_id === null ?
		`\x1b[1m#${result.channel_name ?? `channel ${result.channel_id}`}\x1b[m` :
		`thread \x1b[1m${result.channel_name}\x1b[m of \x1b[1m#${result.parent_channel_name}\x1b[m`
} \
at ${new Date(Number(result._timestamp === 0n ? (result.id >> 22n) + 1420070400000n : result._timestamp)).toISOString()}\
${result._deleted === null ? "" : ` (deleted at ${new Date(Number(result._deleted >> 1n)).toISOString()})`}:\n\
${result.content}\n`);
		}
	} catch (err) {
		console.error("Error. Make sure the query isn’t empty and follows the SQLite FTS5 syntax <https://www.sqlite.org/fts5.html#full_text_query_syntax>.");
	}
	rl.prompt();
}

db.close();
