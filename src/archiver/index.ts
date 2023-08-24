// Node.js sometimes doesn't show the rejection reason if it's not an instance of Error
process.on("unhandledRejection", (err) => {
	throw err;
});
process.on("uncaughtExceptionMonitor", () => {
	setProgress();
	console.error("ERROR: An unexpected error happened! Please report this.");
});

import * as DBT from "discord-user-api-types/v9";
import { AddSnapshotResult, getDatabaseConnection, RequestType } from "../db/index.js";
import { GatewayConnection } from "../discord-api/gateway/connection.js";
import { apiReq, mergeOptions, RequestResult } from "../discord-api/rest.js";
import { computeChannelPermissions, computeGuildPermissions, hasChannelPermissions } from "./permissions.js";
import { setProgress } from "../util/progress-display.js";
import { areMapsEqual } from "../util/map-equality.js";
import { abortError, waitForAbort } from "../util/abort.js";
import { parseArgs, ParseArgsConfig } from "node:util";
import log from "../util/log.js";
import { getTag } from "../discord-api/tag.js";
import { RateLimiter } from "../util/rate-limiter.js";
import { RequestInit } from "undici";
import { CachedChannel, CachedChannelWithSyncInfo, CachedGuild, createCachedChannel, extractThreadInfo, guilds, isChannelCacheable, ThreadInfo } from "./cache.js";
import { Account, AccountOptions, accounts } from "./accounts.js";

const args = {
	strict: true,
	allowPositionals: true,
	options: {
		"token": {
			type: "string",
			multiple: true,
		},
		"log": {
			type: "string",
		},
		"stats": {
			type: "string",
		},
		"sync-sqlite": {
			type: "boolean",
		},
		"guild": {
			type: "string",
			multiple: true,
		},
		"no-sync": {
			type: "boolean",
		},
		"no-reactions": {
			type: "boolean",
		},
	},
} satisfies ParseArgsConfig;

let options: ReturnType<typeof parseArgs<typeof args>>["values"], positionals: string[];
let stats: boolean;
try {
	({
		values: options,
		positionals,
	} = parseArgs(args));
	if (positionals.length !== 1 || options.token === undefined) {
		throw undefined;
	}
	log.setLevel(options.log ?? "info");
	switch (options.stats) {
		case "yes":
			stats = true;
			break;
		case "no":
			stats = false;
			break;
		case "auto":
		case undefined:
			stats = process.stdout.isTTY && !(process.stderr.isTTY && log.debug);
			break;
		default:
			throw undefined;
	}
} catch {
	console.error("\
Usage: node ./build/archiver/index.js --token <token> [--log (error | warning | info | verbose | debug)] [--stats (yes | no | auto)] [(--guild <guild id>)…] [--no-sync] [--no-reactions] <database path>");
	process.exit(1);
}

const dbOpenTimestamp = Date.now();
const db = await getDatabaseConnection(positionals[0], options["sync-sqlite"] ?? false);
await db.ready.then(() => {
	log.verbose?.(`Successfully opened the database in ${Date.now()-dbOpenTimestamp} ms.`);
});

const globalAbortController = new AbortController();
const globalAbortSignal = globalAbortController.signal;

let allReady = false;

// PROGRESS

type MessageSyncProgress = {
	progress: number | null;
	channel: CachedChannel | ThreadInfo;
};
type ArchivedThreadSyncProgress = {
	progress: null;
	channel: CachedChannel | ThreadInfo;
};
// TODO: Add member list sync progress
type SyncProgress = MessageSyncProgress | ArchivedThreadSyncProgress;
const downloadProgresses = new Set<SyncProgress>();
let messageSyncs = 0;
let threadEnumerations = 0;
let messagesArchived = 0;

function updateOutput() {
	if (!stats || globalAbortSignal.aborted) return;

	let min: SyncProgress = { progress: Infinity } as MessageSyncProgress;
	for (const progress of downloadProgresses) {
		if (progress.progress !== null && progress.progress < min.progress!) {
			min = progress;
		}
	}
	if (min.progress === Infinity && downloadProgresses.size > 0) {
		min = (downloadProgresses.values().next() as IteratorYieldResult<SyncProgress>).value;
	}
	if (min.progress === Infinity) {
		setProgress("Nothing to sync.");
	} else {
		setProgress(`\
${messageSyncs === 0 ? "" : `Downloading messages in ${messageSyncs} channels. `}\
${threadEnumerations === 0 ? "" : `Enumerating archived threads in ${threadEnumerations} channels. `}\
${messagesArchived} messages archived in this session.
${min.progress === null ? "" : ((min.progress * 100).toFixed(2) + "% ")}${min.channel.parent ? "thread" : min.channel.guild?.name ?? "dm"} #${min.channel.name}`);
	}
}

function getLeastRESTOccupiedAccount(iterable: Iterable<Account>): Account | undefined {
	let min: Account | undefined;
	for (const account of iterable) {
		if (min === undefined || account.numberOfOngoingRESTOperations < min.numberOfOngoingRESTOperations) {
			min = account;
		}
	}
	return min;
}
function getLeastGatewayOccupiedAccount(iterable: Iterable<Account>): Account | undefined {
	let min: Account | undefined;
	for (const account of iterable) {
		if (min === undefined || account.numberOfOngoingGatewayOperations < min.numberOfOngoingGatewayOperations) {
			min = account;
		}
	}
	return min;
}

// SYNCING

export async function syncMessages(account: Account, channel: CachedChannel | ThreadInfo): Promise<void> {
	const lastMessageID = channel.syncInfo?.lastMessageID;
	const parentChannel = channel.parent ?? channel;

	const abortController = new AbortController();
	const restOptions = mergeOptions(account.restOptions, { signal: abortController.signal });

	// Add this operation to the ongoing syncs list
	const sync = { abortController, channel };
	const ongoingSyncs = channel.parent !== null && channel.private ?
		account.ongoingPrivateThreadMessageSyncs :
		account.ongoingMessageSyncs;
	let ongoingChannelSyncs = ongoingSyncs.get(parentChannel);
	if (ongoingChannelSyncs !== undefined) {
		ongoingChannelSyncs.set(channel.id, sync);
	} else {
		ongoingChannelSyncs = new Map([[channel.id, sync]]);
		ongoingSyncs.set(parentChannel, ongoingChannelSyncs);
	}
	account.numberOfOngoingRESTOperations++;

	// Check if it is necessary to sync this channel based on last_message_id and the id of the last stored message
	const lastStoredMessageID = await db.request({ type: RequestType.GET_LAST_MESSAGE_ID, channelID: channel.id });
	if (lastMessageID == null || lastStoredMessageID == null || lastStoredMessageID < BigInt(lastMessageID)) {
		log.verbose?.(`${lastStoredMessageID == null ? "Started" : "Resumed"} syncing messages from #${channel.name} (${channel.id})${lastStoredMessageID == null ? "" : ` after message ${lastStoredMessageID}`} using ${account.name}.`);

		messageSyncs++;
		const progress: MessageSyncProgress = {
			channel,
			progress: 0,
		};
		downloadProgresses.add(progress);
		updateOutput();

		const lastMessageIDNum = lastMessageID != null ? Number.parseInt(lastMessageID) : null;
		let firstMessageIDNum: number | undefined;

		let messageID = lastStoredMessageID?.toString() ?? "0";

		function updateProgress(currentID: string, count: number) {
			progress.progress = lastMessageIDNum === null ? null : (Number.parseInt(currentID) - firstMessageIDNum!) / (lastMessageIDNum - firstMessageIDNum!);
			messagesArchived += count;
			updateOutput();
		}

		main:
		while (true) {
			try {
				const { response, data, rateLimitReset } = await account.request<DBT.APIMessage[]>(`/channels/${channel.id}/messages?limit=100&after=${messageID}`, restOptions, true);
				if (abortController.signal.aborted) break;
				if (response.status === 403 || response.status === 404) {
					// TODO: Maybe not ideal?
					log.verbose?.(`Hanging message sync from #${channel.name} (${channel.id}) using ${account.name} because we got a ${response.status} ${response.statusText} response.`);
					await waitForAbort(abortController.signal);
					throw abortError;
				} else if (!response.ok) {
					log.warning?.(`Stopped syncing messages from #${channel.name} (${channel.id}) using ${account.name} because we got a ${response.status} ${response.statusText} response.`);
					break;
				}

				const messages = data!;

				if (messages.length > 0) {
					// Messages must be added from oldest to newest so that the program can detect
					// which messages need to be archived solely based on the ID of the last archived message.
					// Every message with reactions is added on it own transaction. Messages without
					// reactions are grouped together in a single transaction to improve performance.

					firstMessageIDNum ??= Number.parseInt(messages.at(-1)!.id);
					messageID = messages[0].id;

					let lastMessageAddPromise: Promise<AddSnapshotResult>;
					let rateLimitReset: Promise<void> | undefined;
					let i: number;
					let startMWRIndex: number = messages.length - 1;

					function flushMessagesWithoutReactions() {
						if (startMWRIndex === i) return;
						// Since the message array is iterated in reverse, startIndex > endIndex.
						const startIndex = startMWRIndex; // inclusive
						const endIndex = i; // exclusive
						updateProgress(messages[endIndex + 1].id, startIndex - endIndex);
						db.transaction(async () => {
							for (let j = startIndex; j > endIndex; j--) {
								lastMessageAddPromise = db.request({
									type: RequestType.ADD_MESSAGE_SNAPSHOT,
									partial: false,
									message: messages[j],
								});
							}
						});
					}

					for (i = messages.length - 1; i >= 0; i--) {
						const message = messages[i];
						if (!options["no-reactions"] && message.reactions !== undefined && message.reactions.length !== 0) {
							flushMessagesWithoutReactions();
							startMWRIndex = i - 1;

							const reactions: {
								emoji: DBT.APIPartialEmoji;
								reactionType: 0 | 1;
								userIDs: string[];
							}[] = [];

							for (const reaction of message.reactions) {
								for (const [reactionType, expectedCount] of [
									...(reaction.count_details.normal > 0 ? [[0, reaction.count_details.normal]] : []),
									...(reaction.count_details.burst > 0 ? [[1, reaction.count_details.burst]] : []),
								] as [0 | 1, number][]) {
									const reactionData = {
										emoji: reaction.emoji,
										reactionType,
										userIDs: new Array<string>(expectedCount),
									};
									let i = 0;
									const emoji = reaction.emoji.id === null ? reaction.emoji.name : `${reaction.emoji.name}:${reaction.emoji.id}`;

									let userID = "0";
									while (true) {
										await rateLimitReset;
										let response, data;
										({ response, data, rateLimitReset } = await account.request<DBT.APIUser[]>(`/channels/${channel.id}/messages/${message.id}/reactions/${emoji}?limit=100&type=${reactionType}&after=${userID}`, restOptions, true));
										if (abortController.signal.aborted as boolean) break main;
										if (response.status === 403 || response.status === 404) {
											// TODO: Maybe not ideal?
											log.verbose?.(`Hanging message sync from #${channel.name} (${channel.id}) using ${account.name} because we got a ${response.status} ${response.statusText} response.`);
											await waitForAbort(abortController.signal);
											throw abortError;
										} else if (!response.ok) {
											log.warning?.(`Stopped syncing messages from #${channel.name} (${channel.id}) using ${account.name} because we got a ${response.status} ${response.statusText} response.`);
											break main;
										}
										const users = data!;

										for (const user of users) {
											reactionData.userIDs[i] = user.id;
											i++;
										}

										if (users.length < 100) {
											break;
										}
										userID = data!.at(-1)!.id;
									}
									reactions.push(reactionData);

									if (i !== expectedCount) {
										log.verbose?.(`The reaction count (${expectedCount}) is different from the length of the list (${i}) of users who reacted to the message with ID ${message.id} from #${channel.name} (${channel.id}).`);
									}
								}
							}

							db.transaction(async () => {
								lastMessageAddPromise = db.request({
									type: RequestType.ADD_MESSAGE_SNAPSHOT,
									partial: false,
									message,
								});
								for (const reactionData of reactions) {
									db.request({
										type: RequestType.ADD_INITIAL_REACTIONS,
										messageID: message.id,
										emoji: reactionData.emoji,
										reactionType: reactionData.reactionType,
										userIDs: reactionData.userIDs,
										timing: null,
									});
								}
							});

							updateProgress(message.id, 1);
						}
					}
					flushMessagesWithoutReactions();

					// Since there is at least 1 message, the promise variable will always be defined
					const done = await lastMessageAddPromise! !== AddSnapshotResult.ADDED_FIRST_SNAPSHOT;

					if (done) {
						// The last message was already in the database, so we reached the
						// point where we started getting messages from the gateway.
						log.verbose?.(`Finished syncing messages from #${channel.name} (${channel.id}) because a known message (${messages[0].id}) was found.`);
						break;
					}
				}

				if (messages.length < 100) {
					log.verbose?.(`Finished syncing messages from #${channel.name} (${channel.id}) using ${account.name}.`);
					progress.progress = 1;
					updateOutput();
					break;
				}

				await rateLimitReset;
			} catch (err) {
				if (err === abortError) {
					log.verbose?.(`Stopped syncing messages from #${channel.name} (${channel.id}) using ${account.name}.`);
					break;
				}
				throw err;
			}
		}

		messageSyncs--;
		downloadProgresses.delete(progress);
		updateOutput();
	}

	// Remove this operation from the ongoing syncs list
	if (ongoingChannelSyncs.size > 1) {
		ongoingChannelSyncs.delete(channel.id);
	} else {
		ongoingSyncs.delete(parentChannel);
	}
	account.numberOfOngoingRESTOperations--;
}

export function syncMessagesIfNotSyncing(account: Account, channel: CachedChannel | ThreadInfo): Promise<void> {
	if (channel.parent === null && channel.guild === null) throw new TypeError();
	const parentChannel = channel.parent ?? channel;
	for (const account of parentChannel.guild!.accountData.keys()) {
		if (account.ongoingMessageSyncs.get(parentChannel)?.has(channel.id)) {
			return Promise.resolve();
		}
	}
	return syncMessages(account, channel);
}

// TODO: This assumes that the thread enumeration is not interrupted
enum ArchivedThreadListType {
	PUBLIC,
	PRIVATE,
	JOINED_PRIVATE,
}
async function syncAllArchivedThreads(account: Account, channel: CachedChannel, type: ArchivedThreadListType) {
	log.verbose?.(`Started enumerating ${ArchivedThreadListType[type]} archived threads from #${channel.name} (${channel.id}) using ${account.name}.`);

	threadEnumerations++;
	const progress: ArchivedThreadSyncProgress = {
		channel,
		progress: null,
	};
	downloadProgresses.add(progress);
	updateOutput();

	const abortController = new AbortController();
	const restOptions = mergeOptions(account.restOptions, { signal: abortController.signal });

	const ongoingMap =
		type === ArchivedThreadListType.PUBLIC ? account.ongoingPublicThreadListSyncs :
		type === ArchivedThreadListType.PRIVATE ? account.ongoingPrivateThreadListSyncs :
		account.ongoingJoinedPrivateThreadListSyncs;

	ongoingMap.set(channel, { abortController });

	let threadID = "";
	while (true) {
		try {
			const { response, data, rateLimitReset } = await account.request<DBT.APIThreadList>(
				type === ArchivedThreadListType.PUBLIC ? `/channels/${channel.id}/threads/archived/public?limit=100&before=${threadID}` :
				type === ArchivedThreadListType.PRIVATE ? `/channels/${channel.id}/threads/archived/private?limit=100&before=${threadID}` :
				`/channels/${channel.id}/users/@me/threads/archived/private?limit=100&before=${threadID}`,
				restOptions,
				true
			);
			if (abortController.signal.aborted) break;
			if (response.status === 403 || response.status === 404) {
				// TODO: Maybe not ideal?
				log.verbose?.(`Hanging ${ArchivedThreadListType[type]} archived thread enumeration from #${channel.name} (${channel.id}) using ${account.name} because we got a ${response.status} ${response.statusText} response.`);
				await waitForAbort(abortController.signal);
				throw abortError;
			} else if (!response.ok) {
				log.warning?.(`Stopped enumerating ${ArchivedThreadListType[type]} archived threads from #${channel.name} (${channel.id}) using ${account.name} because we got a ${response.status} ${response.statusText} response.`);
				break;
			}
			const timestamp = Date.now();
			const list = data!;

			if (list.threads.length > 0) {
				db.transaction(async () => {
					for (let i = list.threads.length - 1; i >= 0; i--) {
						db.request({
							type: RequestType.ADD_CHANNEL_SNAPSHOT,
							channel: list.threads[i],
							timing: {
								timestamp,
								realtime: false,
							},
						});
					}
				});

				// TODO: The program will always attempt to sync all threads at the same time.
				// This means that the memory usage is proportional to the number of threads.
				for (const thread of list.threads) {
					// channel.accountsWithReadPermission is guaranteed to have an account because
					// if it doesn't, this sync would have been aborted.
					syncMessages(getLeastRESTOccupiedAccount(channel.accountsWithReadPermission)!, extractThreadInfo(thread, channel));
				}

				threadID = list.threads.at(-1)!.id;
			}
			if (!list.has_more) {
				log.verbose?.(`Finished enumerating ${ArchivedThreadListType[type]} archived threads from #${channel.name} (${channel.id}) using ${account.name}.`);
				break;
			}

			await rateLimitReset;
		} catch (err) {
			if (err === abortError) {
				log.verbose?.(`Stopped enumerating ${ArchivedThreadListType[type]} archived threads from #${channel.name} (${channel.id}) using ${account.name}.`);
				break;
			}
			throw err;
		}
	}

	ongoingMap.delete(channel);
	account.numberOfOngoingRESTOperations--;

	threadEnumerations--;
	downloadProgresses.delete(progress);
	updateOutput();
}


// GATEWAY

function updateGuildPermissions(cachedGuild: CachedGuild) {
	for (const cachedChannel of cachedGuild.textChannels.values()) {
		updateGuildChannelPermissions(cachedChannel);
	}
}

/**
 * Updates the account sets in the cached channel object and aborts syncs for accounts which lost
 * permission.
 */
function updateGuildChannelPermissions(cachedChannel: CachedChannel) {
	const accountWithReadPermExisted = cachedChannel.accountsWithReadPermission.size > 0;
	const accountWithManagePermExisted = cachedChannel.accountsWithManageThreadsPermission.size > 0;
	const accountsThatLostReadPermission: Set<Account> = new Set();
	const accountsThatLostManageThreadsPermission: Set<Account> = new Set();

	for (const [account, accountData] of cachedChannel.guild!.accountData.entries()) {
		const permissions = computeChannelPermissions(account, cachedChannel.guild!, cachedChannel, accountData);
		const hasReadPermission = hasChannelPermissions(permissions, DBT.PermissionFlagsBits.ReadMessageHistory);
		const hasManageThreadsPermission = hasReadPermission && hasChannelPermissions(permissions, DBT.PermissionFlagsBits.ManageThreads);

		if (hasReadPermission) {
			cachedChannel.accountsWithReadPermission.add(account);
			account.references.add(cachedChannel.accountsWithReadPermission);
		} else if (cachedChannel.accountsWithReadPermission.has(account)) {
			cachedChannel.accountsWithReadPermission.delete(account);
			account.references.delete(cachedChannel.accountsWithReadPermission);
			accountsThatLostReadPermission.add(account);
		}

		if (hasManageThreadsPermission) {
			cachedChannel.accountsWithManageThreadsPermission.add(account);
			account.references.add(cachedChannel.accountsWithManageThreadsPermission);
		} else if (cachedChannel.accountsWithReadPermission.has(account)) {
			cachedChannel.accountsWithManageThreadsPermission.delete(account);
			account.references.delete(cachedChannel.accountsWithManageThreadsPermission);
			accountsThatLostManageThreadsPermission.add(account);
		}
	}

	if (!options["no-sync"] && (
		cachedChannel.guild === null ||
		options.guild === undefined ||
		options.guild.includes(cachedChannel.guild.id)
	)) {
		// Abort all message syncs and switch to new account if possible
		for (const account of accountsThatLostReadPermission) {
			for (const sync of account.ongoingMessageSyncs.get(cachedChannel)?.values() ?? []) {
				sync.abortController.abort();
				const newAccount = getLeastRESTOccupiedAccount(cachedChannel.accountsWithReadPermission);
				if (newAccount !== undefined) {
					syncMessages(newAccount, sync.channel);
				}
			}
		}
		// Abort all private thread list and private thread message syncs and switch to new account if possible
		for (const account of accountsThatLostManageThreadsPermission) {
			account.ongoingPrivateThreadListSyncs.get(cachedChannel)?.abortController.abort();
			const newAccount = getLeastRESTOccupiedAccount(cachedChannel.accountsWithManageThreadsPermission);
			if (newAccount) {
				// TODO: Switch thread enumeration to the other account
			}
			for (const sync of account.ongoingPrivateThreadMessageSyncs.get(cachedChannel)?.values() ?? []) {
				sync.abortController.abort();
				const newAccount = getLeastRESTOccupiedAccount(cachedChannel.accountsWithManageThreadsPermission);
				if (newAccount !== undefined) {
					syncMessages(newAccount, sync.channel);
				}
			}
		}

		if (allReady) {
			if (!accountWithReadPermExisted && cachedChannel.accountsWithReadPermission.size > 0) {
				log.verbose?.(`We gained permission to read channel #${cachedChannel.name} (${cachedChannel.id}).`);
				syncMessages(getLeastRESTOccupiedAccount(cachedChannel.accountsWithReadPermission)!, cachedChannel);
				syncAllArchivedThreads(getLeastRESTOccupiedAccount(cachedChannel.accountsWithReadPermission)!, cachedChannel, ArchivedThreadListType.PUBLIC);
			}
			if (!accountWithManagePermExisted && cachedChannel.accountsWithManageThreadsPermission.size > 0) {
				log.verbose?.(`We gained permission to manage channel #${cachedChannel.name} (${cachedChannel.id}).`);
				syncAllArchivedThreads(getLeastRESTOccupiedAccount(cachedChannel.accountsWithManageThreadsPermission)!, cachedChannel, ArchivedThreadListType.PRIVATE);
			}
		}
	}
}

function syncAllGuildMembers(account: Account, cachedGuild: CachedGuild) {
	log.verbose?.(`Requesting all guild members from ${cachedGuild.name} (${cachedGuild.id}) using ${account.name}.`);
	account.ongoingMemberRequests.add(cachedGuild.id);
	account.numberOfOngoingGatewayOperations++;
	account.gatewayConnection.sendPayload({
		op: DBT.GatewayOpcodes.RequestGuildMembers,
		d: {
			guild_id: cachedGuild.id,
			query: "",
			limit: 0,
		},
	});
}

function connectAccount(options: AccountOptions): Promise<void> {
	return new Promise((res, rej) => {
		const bot = options.mode === "bot";

		let ready = false;

		/** The number of guilds left to receive a Guild Create event for. Only used for bots. */
		let numberOfGuildsLeft: number;
		function receivedGuildInfo() {
			if (bot && !ready) {
				numberOfGuildsLeft--;
				if (numberOfGuildsLeft === 0) {
					ready = true;
					res();
				}
			}
		}

		const gatewayConnection = new GatewayConnection({
			identifyData: options.gatewayIdentifyData,
		});

		gatewayConnection.addListener("connecting", () => {
			log.verbose?.(`Connecting to the gateway using ${account.name}.`);
		});
		gatewayConnection.addListener("connectionLost", (wasConnected: boolean, code: number) => {
			log.verbose?.(`${wasConnected ? "Gateway connection lost" : "Failed to connect to the gateway"} (code: ${code}) using ${account.name}.`);
		});

		gatewayConnection.addListener("dispatch", async (payload: DBT.GatewayReceivePayload, realtime: boolean) => {
			const timestamp = Date.now();
			const timing = {
				timestamp,
				realtime,
			};
			switch (payload.t) {
				case DBT.GatewayDispatchEvents.Ready: {
					account.details = {
						id: payload.d.user.id,
						tag: getTag(payload.d.user),
					};
					log.info?.(`Gateway connection ready for ${account.name} (${account.details.tag}).`);
					numberOfGuildsLeft = payload.d.guilds.length;
					break;
				}

				case DBT.GatewayDispatchEvents.GuildDelete: {
					if (payload.d.unavailable) {
						receivedGuildInfo();
					}
					break;
				}

				case DBT.GatewayDispatchEvents.GuildCreate: {
					receivedGuildInfo();
					let cachedGuild: CachedGuild;
					const guild = payload.d;
					const rolePermissions = new Map(guild.roles.map(r => [r.id, BigInt(r.permissions)]));
					const ownMember = guild.members.find(m => m.user!.id === account.details!.id)!;

					if (!guilds.has(guild.id)) {
						cachedGuild = {
							id: guild.id,
							name: guild.name,
							ownerID: guild.owner_id,
							rolePermissions,
							accountData: new Map(),
							textChannels: new Map(),
							memberUserIDs: new Set(),
						};
						cachedGuild.textChannels = new Map(
							(payload.d.channels.filter(isChannelCacheable))
								.map(c => [c.id, {
									id: c.id,
									type: c.type,
									guild: cachedGuild,
									name: c.name,
									permissionOverwrites: new Map(c.permission_overwrites?.map(o => [o.id, { allow: BigInt(o.allow), deny: BigInt(o.deny) }])),
									accountsWithReadPermission: new Set(),
									accountsWithManageThreadsPermission: new Set(),
									parent: null,
									syncInfo: {
										activeThreads: new Set(),
										lastMessageID: c.last_message_id ?? null,
										messageCount: null,
									},
								} satisfies CachedChannelWithSyncInfo])
						);
						guilds.set(guild.id, cachedGuild);
						for (const channel of cachedGuild.textChannels.values()) {
							channel.guild = cachedGuild;
						}
						for (const thread of guild.threads) {
							const parent = cachedGuild.textChannels.get(thread.parent_id!)!;
							parent.syncInfo!.activeThreads.add(extractThreadInfo(thread, parent));
						}

						cachedGuild.accountData.set(account, {
							roles: new Set(ownMember.roles),
							guildPermissions: computeGuildPermissions(account, cachedGuild, ownMember.roles),
						});
						updateGuildPermissions(cachedGuild);

						updateOutput();

						db.transaction(async () => {
							db.request({
								type: RequestType.SYNC_GUILD_CHANNELS_AND_ROLES,
								guildID: BigInt(guild.id),
								channelIDs: new Set(guild.channels.map(c => BigInt(c.id))),
								roleIDs: new Set(guild.roles.map(r => BigInt(r.id))),
								timing: {
									timestamp,
									realtime: false,
								},
							});

							db.request({
								type: RequestType.ADD_GUILD_SNAPSHOT,
								guild,
								timing: {
									timestamp,
									realtime: false,
								},
							});

							for (const role of guild.roles) {
								db.request({
									type: RequestType.ADD_ROLE_SNAPSHOT,
									role,
									guildID: guild.id,
									timing: {
										timestamp,
										realtime: false,
									},
								});
							}

							for (const channel of guild.channels) {
								db.request({
									type: RequestType.ADD_CHANNEL_SNAPSHOT,
									channel: Object.assign(channel, { guild_id: guild.id }),
									timing: {
										timestamp,
										realtime: false,
									},
								});
							}

							for (const thread of guild.threads) {
								db.request({
									type: RequestType.ADD_CHANNEL_SNAPSHOT,
									channel: Object.assign(thread, { guild_id: guild.id }),
									timing: {
										timestamp,
										realtime: false,
									},
								});
							}
						});
						log.verbose?.(`Synced basic guild info for ${cachedGuild.name} (${cachedGuild.id}) using ${account.name}.`);
					} else {
						cachedGuild = guilds.get(guild.id)!;
					}

					if (allReady) {
						const syncAccount = getLeastGatewayOccupiedAccount(cachedGuild.accountData.keys());
						if (syncAccount !== undefined) {
							syncAllGuildMembers(syncAccount, cachedGuild);
						}
						// TODO: Resync
					}

					break;
				}
				case DBT.GatewayDispatchEvents.GuildUpdate: {
					// This assumes that no permission changes are caused by this event.
					db.request({
						type: RequestType.ADD_GUILD_SNAPSHOT,
						guild: payload.d,
						timing,
					});
					break;
				}

				case DBT.GatewayDispatchEvents.GuildRoleCreate:
				case DBT.GatewayDispatchEvents.GuildRoleUpdate:
				{
					db.transaction(async () => {
						db.request({
							type: RequestType.ADD_ROLE_SNAPSHOT,
							role: payload.d.role,
							guildID: payload.d.guild_id,
							timing,
						});
					});

					const cachedGuild = guilds.get(payload.d.guild_id);
					if (cachedGuild === undefined) {
						log.warning?.(`Received guild role ${payload.t === DBT.GatewayDispatchEvents.GuildRoleCreate ? "create" : "update"} event for an unknown guild with ID ${payload.d.guild_id}.`);
						return;
					}

					const perms = BigInt(payload.d.role.permissions);

					if (payload.t === DBT.GatewayDispatchEvents.GuildRoleCreate) {
						cachedGuild.rolePermissions.set(payload.d.role.id, perms);
					} else if (cachedGuild.rolePermissions.get(payload.d.role.id) !== perms) {
						// TODO: Recompute permissions only for accounts with the role
						// (also for role deletion and role list updates)
						log.verbose?.(`Role with ID ${payload.d.role.id} from guild ${cachedGuild.name} (${payload.d.guild_id}) was updated.`);
						cachedGuild.rolePermissions.set(payload.d.role.id, perms);
						updateGuildPermissions(cachedGuild);
					}
					break;
				}
				case DBT.GatewayDispatchEvents.GuildRoleDelete: {
					db.transaction(async () => {
						db.request({
							type: RequestType.MARK_ROLE_AS_DELETED,
							id: payload.d.role_id,
							timing,
						});
					});

					const cachedGuild = guilds.get(payload.d.guild_id);
					if (cachedGuild === undefined) {
						log.warning?.(`Received guild role delete event for an unknown guild with ID ${payload.d.guild_id}.`);
						return;
					}
					if (cachedGuild.rolePermissions.has(payload.d.role_id)) {
						log.verbose?.(`Role with ID ${payload.d.role_id} from guild ${cachedGuild.name} (${payload.d.guild_id}) was deleted.`);
						cachedGuild.rolePermissions.delete(payload.d.role_id);
						updateGuildPermissions(cachedGuild);
					}
					break;
				}

				case DBT.GatewayDispatchEvents.GuildMembersChunk: {
					db.transaction(async () => {
						for (const member of payload.d.members) {
							db.request({
								type: RequestType.ADD_USER_SNAPSHOT,
								user: member.user!,
								timing: {
									timestamp,
									realtime: false,
								},
							});
							db.request({
								type: RequestType.ADD_MEMBER_SNAPSHOT,
								partial: false,
								member,
								guildID: payload.d.guild_id,
								userID: member.user!.id,
								timing: {
									timestamp,
									realtime: false,
								},
							});
						}
					});

					const isLast = payload.d.chunk_index === payload.d.chunk_count - 1;
					const cachedGuild = guilds.get(payload.d.guild_id);
					if (cachedGuild === undefined) {
						log.warning?.(`Received guild members chunk for an unknown guild with ID ${payload.d.guild_id}.`);
					} else {
						for (const member of payload.d.members) {
							cachedGuild.memberUserIDs!.add(BigInt(member.user!.id));
						}
						if (isLast) {
							log.verbose?.(`Finished requesting guild members from ${cachedGuild.name} (${cachedGuild.id}) using ${account.name}.`);
							db.transaction(async () => {
								db.request({
									type: RequestType.SYNC_GUILD_MEMBERS,
									guildID: BigInt(cachedGuild.id),
									userIDs: cachedGuild.memberUserIDs!,
									timing: {
										timestamp,
										realtime: false,
									},
								});
							});
						}
					}
					if (isLast) {
						account.ongoingMemberRequests.delete(payload.d.guild_id);
						account.numberOfOngoingGatewayOperations--;
					}
					break;
				}

				case DBT.GatewayDispatchEvents.GuildMemberAdd: {
					db.transaction(async () => {
						db.request({
							type: RequestType.ADD_MEMBER_SNAPSHOT,
							partial: false,
							member: payload.d,
							guildID: payload.d.guild_id,
							userID: payload.d.user!.id,
							timing,
						});
					});
					break;
				}
				case DBT.GatewayDispatchEvents.GuildMemberUpdate: {
					const member = payload.d;
					// It seems that the API always returns a full member
					if (member.joined_at == null) {
						log.warning?.("`joined_at` is missing on a guild member update event. This snapshot won't be recorded.");
					} else {
						db.transaction(async () => {
							db.request({
								type: RequestType.ADD_MEMBER_SNAPSHOT,
								partial: false,
								member: member as DBT.APIGuildMember,
								guildID: member.guild_id,
								userID: member.user.id,
								timing,
							});
						});
					}

					const cachedGuild = guilds.get(payload.d.guild_id);
					if (cachedGuild === undefined) {
						log.warning?.(`Received guild member update event for an unknown guild with ID ${payload.d.guild_id}.`);
						return;
					}
					for (const [account, accountData] of cachedGuild.accountData) {
						if (account.details!.id === member.user.id) {
							if (
								member.roles.length !== accountData.roles.size ||
								member.roles.some(id => !accountData.roles.has(id))
							) {
								log.verbose?.(`Role list in guild ${cachedGuild.name} (${cachedGuild.id}) updated for ${account.name}.`);
								accountData.roles = new Set(member.roles);
								updateGuildPermissions(cachedGuild);
							}
							break;
						}
					}
					break;
				}
				case DBT.GatewayDispatchEvents.GuildMemberRemove: {
					db.transaction(async () => {
						db.request({
							type: RequestType.ADD_MEMBER_LEAVE,
							guildID: payload.d.guild_id,
							userID: payload.d.user.id,
							timing,
						});
					});
					break;
				}

				case DBT.GatewayDispatchEvents.ChannelCreate: {
					const channel = payload.d;
					db.transaction(async () => {
						db.request({
							type: RequestType.ADD_CHANNEL_SNAPSHOT,
							channel,
							timing: null,
						});
					});
					if (isChannelCacheable(channel)) {
						const cachedGuild = guilds.get(channel.guild_id!);
						if (cachedGuild === undefined) {
							log.warning?.(`Received channel create event for a guild channel in an unknown guild with ID ${channel.guild_id!}.`);
							return;
						}
						const cachedChannel = createCachedChannel(channel, cachedGuild);
						cachedGuild.textChannels.set(channel.id, cachedChannel);
						// There's no need to sync the messages since there are no messages in a newly-created channel
					}
					break;
				}

				case DBT.GatewayDispatchEvents.ChannelUpdate: {
					const channel = payload.d;
					db.transaction(async () => {
						db.request({
							type: RequestType.ADD_CHANNEL_SNAPSHOT,
							channel,
							timing,
						});
					});
					if (isChannelCacheable(channel)) {
						const cachedGuild = guilds.get(channel.guild_id!);
						const cachedChannel = cachedGuild?.textChannels.get(channel.id);
						if (cachedGuild === undefined || cachedChannel === undefined) {
							log.warning?.(`Received channel update event for an unknown guild channel with ID ${channel.parent_id!}.`);
						} else {
							cachedChannel.name = channel.name!;

							const permissionOverwrites = new Map(channel.permission_overwrites?.map(o => [o.id, { allow: BigInt(o.allow), deny: BigInt(o.deny) }]));
							const didPermsChange = areMapsEqual(cachedChannel.permissionOverwrites, cachedChannel.permissionOverwrites, (a, b) => a.allow === b.allow && a.deny === b.deny);
							if (didPermsChange) {
								log.verbose?.(`Permissions for channel #${cachedChannel.name} (${cachedChannel.id}) changed.`);

								cachedChannel.permissionOverwrites = permissionOverwrites;
								updateGuildChannelPermissions(cachedChannel);
							}
						}
					}
					break;
				}

				// It seems that, for user accounts, the READY event only contains joined active threads and this event is sent later with the non-joined but active threads.
				// This event is sent (containing all active threads) when the user gains access to a channel when and only if there are active threads in that channel.
				case DBT.GatewayDispatchEvents.ThreadListSync: {
					db.transaction(async () => {
						for (const thread of payload.d.threads) {
							db.request({
								type: RequestType.ADD_CHANNEL_SNAPSHOT,
								channel: thread,
								timing,
							});
						}
					});
					if (allReady) {
						const cachedGuild = guilds.get(payload.d.guild_id);
						if (cachedGuild === undefined) {
							log.warning?.(`Received a thread list sync event for an unknown guild with ID ${payload.d.guild_id}.`);
						} else {
							for (const thread of payload.d.threads) {
								const cachedChannel = cachedGuild.textChannels.get(thread.parent_id!);
								if (cachedChannel === undefined) {
									log.warning?.(`Received a thread list sync event for an unknown channel with ID ${thread.parent_id!}.`);
								} else {
									sync: {
										for (const account of cachedGuild.accountData.keys()) {
											if (account.ongoingMessageSyncs.get(cachedChannel)?.has(thread.id)) {
												// The thread is already being synced. Skip it.
												break sync;
											}
										}
										const threadInfo = extractThreadInfo(thread, cachedChannel);
										syncMessages(getLeastRESTOccupiedAccount(cachedChannel.accountsWithReadPermission)!, threadInfo);
									}
								}
							}
						}
					}
					break;
				}

				case DBT.GatewayDispatchEvents.ChannelDelete: {
					const channel = payload.d;
					db.transaction(async () => {
						db.request({
							type: RequestType.MARK_CHANNEL_AS_DELETED,
							id: channel.id,
							timing,
						});
					});
					if (isChannelCacheable(channel)) {
						const cachedGuild = guilds.get(channel.guild_id!);
						const cachedChannelExisted = cachedGuild?.textChannels.has(channel.id);
						if (cachedGuild === undefined || cachedChannelExisted === undefined) {
							log.warning?.(`Received channel update event for an unknown guild channel with ID ${channel.id} from guild with ID ${channel.guild_id}.`);
						} else {
							cachedGuild.textChannels.delete(channel.id);
						}
					}
					break;
				}

				case DBT.GatewayDispatchEvents.MessageCreate: {
					const message = payload.d;
					db.transaction(async () => {
						db.request({
							type: RequestType.ADD_MESSAGE_SNAPSHOT,
							partial: false,
							message,
						});
					});
					break;
				}
				case DBT.GatewayDispatchEvents.MessageUpdate: {
					const message = payload.d;
					db.transaction(async () => {
						db.request({
							type: RequestType.ADD_MESSAGE_SNAPSHOT,
							partial: true,
							message,
						});
					});
					break;
				}
				case DBT.GatewayDispatchEvents.MessageDelete: {
					db.transaction(async () => {
						db.request({
							type: RequestType.MARK_MESSAGE_AS_DELETED,
							id: payload.d.id,
							timing,
						});
					});
					break;
				}

				case DBT.GatewayDispatchEvents.MessageReactionAdd: {
					db.transaction(async () => {
						db.request({
							type: RequestType.ADD_REACTION_PLACEMENT,
							messageID: payload.d.message_id,
							emoji: payload.d.emoji,
							reactionType: payload.d.burst ? 1 : 0,
							userID: payload.d.user_id,
							timing,
						});
					});
					break;
				}
				case DBT.GatewayDispatchEvents.MessageReactionRemove: {
					db.transaction(async () => {
						db.request({
							type: RequestType.MARK_REACTION_AS_REMOVED,
							messageID: payload.d.message_id,
							emoji: payload.d.emoji,
							reactionType: payload.d.burst ? 1 : 0,
							userID: payload.d.user_id,
							timing,
						});
					});
					break;
				}
				case DBT.GatewayDispatchEvents.MessageReactionRemoveEmoji:
				case DBT.GatewayDispatchEvents.MessageReactionRemoveAll:
				{
					db.transaction(async () => {
						db.request({
							type: RequestType.MARK_REACTIONS_AS_REMOVED_BULK,
							messageID: payload.d.message_id,
							emoji: payload.t === DBT.GatewayDispatchEvents.MessageReactionRemoveEmoji ? payload.d.emoji : null,
							timing,
						});
					});
					break;
				}
				case "MESSAGE_REACTION_ADD_MANY" as any: {
					log.warning?.("WARNING: Received a MESSAGE_REACTION_ADD_MANY gateway event: %o", payload.d);
					break;
				}
			}
		});

		gatewayConnection.on("sessionLost", () => {
			log.warning?.(`Gateway session lost for ${account.name}. Some events may have been missed so it's necessary to resync.`);
			// Handle interrupted member requests
			account.numberOfOngoingGatewayOperations -= account.ongoingMemberRequests.size;
			for (const guildID of account.ongoingMemberRequests) {
				account.ongoingMemberRequests.delete(guildID);

				const guild = guilds.get(guildID);
				if (guild !== undefined) {
					log.verbose?.(`Member request for guild ${guild.name} (${guildID}) was interrupted.`);
					guild.memberUserIDs = null;
				}
			}
		});

		if (log.debug) {
			gatewayConnection.on("payloadReceived", (payload: DBT.GatewayReceivePayload) => {
				log.log(`<- ${account.name} %o`, payload);
			});
			gatewayConnection.on("payloadSent", (payload: DBT.GatewaySendPayload) => {
				log.log(`-> ${account.name} %o`, payload);
			});
		}

		// TODO: Handle gateway errors
		gatewayConnection.on("error", (err) => {
			if (!ready) {
				rej(err);
			} else {
				throw err;
			}
		});

		const globalRateLimiter = new RateLimiter(49, 1000);
		async function request<T>(endpoint: string, options?: RequestInit, abortIfFail?: boolean): Promise<RequestResult<T>> {
			await globalRateLimiter.whenFree();
			const result = await apiReq<T>(endpoint, options, abortIfFail);
			if (result.response.status === 401) {
				log.error?.(`Got HTTP status 401 Unauthorized while using ${account.name}. This account will be disconnected.`);
				// This will immediately abort all operations
				disconnectAccount(account);
				if (accounts.size === 0) {
					stop();
				}
			}
			return result;
		}

		const account: Account = {
			...options,
			bot,
			details: undefined,
			gatewayConnection,
			restOptions: {
				headers: {
					authorization: options.token,
				},
			},
			request,
			joinedGuilds: [],

			numberOfOngoingRESTOperations: 0,
			ongoingMessageSyncs: new Map(),
			ongoingPrivateThreadMessageSyncs: new Map(),

			ongoingPublicThreadListSyncs: new Map(),
			ongoingPrivateThreadListSyncs: new Map(),
			ongoingJoinedPrivateThreadListSyncs: new Map(),

			numberOfOngoingGatewayOperations: 0,
			ongoingMemberRequests: new Set(),

			references: new Set(),
		};
		accounts.add(account);
	});
}

function disconnectAccount(account: Account) {
	account.gatewayConnection.destroy();
	for (const set of account.ongoingMessageSyncs.values()) {
		for (const { abortController } of set.values()) {
			abortController.abort();
		}
	}
	for (const set of account.ongoingPrivateThreadMessageSyncs.values()) {
		for (const { abortController } of set.values()) {
			abortController.abort();
		}
	}
	for (const { abortController } of account.ongoingPublicThreadListSyncs.values()) {
		abortController.abort();
	}
	for (const { abortController } of account.ongoingPrivateThreadListSyncs.values()) {
		abortController.abort();
	}
	for (const { abortController } of account.ongoingJoinedPrivateThreadListSyncs.values()) {
		abortController.abort();
	}
	accounts.delete(account);
}

// Cleanup
function stop() {
	setProgress();
	log.info?.("Closing the database and exiting.");
	globalAbortController.abort();
	for (const account of accounts) {
		disconnectAccount(account);
	}
	db.close();
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

Promise.all(options.token.map((token, index) => connectAccount({
	name: `account #${index}`,
	mode: "bot",
	token,
	gatewayIdentifyData: {
		intents:
			DBT.GatewayIntentBits.Guilds |
			DBT.GatewayIntentBits.GuildMessages |
			DBT.GatewayIntentBits.GuildMessageReactions |
			DBT.GatewayIntentBits.DirectMessages |
			DBT.GatewayIntentBits.DirectMessageReactions |
			DBT.GatewayIntentBits.GuildMembers,
		properties: {
			os: process.platform,
			browser: "GammaArchiver/0.1.1",
			device: "GammaArchiver/0.1.1",
		},
		token,
	},
	restHeaders: {},
}))).then(() => {
	allReady = true;
	log.info?.("All accounts are ready.");
	{
		let totalChannels = 0, accessibleChannels = 0;
		for (const guild of guilds.values()) {
			if (options.guild !== undefined && !options.guild.includes(guild.id)) continue;

			totalChannels += guild.textChannels.size;
			for (const channel of guild.textChannels.values()) {
				if (channel.accountsWithReadPermission.size > 0) {
					accessibleChannels++;
				}
			}
		}
		log.info?.(`\
Statistics:
  ${options.guild?.length ?? guilds.size} guilds
  ${totalChannels} channels, out of which ${accessibleChannels} are accessible`);
	}

	if (!options["no-sync"]) {
		for (const guild of guilds.values()) {
			if (options.guild !== undefined && !options.guild.includes(guild.id)) continue;

			syncAllGuildMembers(getLeastGatewayOccupiedAccount(guild.accountData.keys())!, guild);

			for (const channel of guild.textChannels.values() as IterableIterator<CachedChannelWithSyncInfo>) {
				// TODO: Sync forum and voice channels
				if (channel.type === DBT.ChannelType.GuildText || channel.type === DBT.ChannelType.GuildAnnouncement) {
					if (channel.accountsWithReadPermission.size > 0) {
						if (channel.accountsWithReadPermission.size > 0) {
							if (channel.accountsWithManageThreadsPermission.size > 0) {
								syncAllArchivedThreads(getLeastRESTOccupiedAccount(channel.accountsWithManageThreadsPermission)!, channel, ArchivedThreadListType.PRIVATE);
							}

							for (const thread of channel.syncInfo.activeThreads) {
								syncMessages(getLeastRESTOccupiedAccount(channel.accountsWithReadPermission)!, thread);
							}

							syncAllArchivedThreads(getLeastRESTOccupiedAccount(channel.accountsWithReadPermission)!, channel, ArchivedThreadListType.PUBLIC);
						}
						syncMessages(getLeastRESTOccupiedAccount(channel.accountsWithReadPermission)!, channel);
					}
				}
				(channel as CachedChannel).syncInfo = null;
			}
		}
	}
});
