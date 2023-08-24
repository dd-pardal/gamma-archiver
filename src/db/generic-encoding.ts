/**
 * @fileoverview Handles the operations in the conversion from objects in the Discord API format to the database format and back that are common to all object types.
 *
 * Most of the conversion work is done here, with some operations specific to each object type being handled in `worker.ts`.
 */

import * as DBT from "discord-user-api-types/v9";

export enum ObjectType {
	USER,
	GUILD,
	ROLE,
	MEMBER,
	CHANNEL,
	MESSAGE,
	ATTACHMENT,
}

enum ValueType {
	STRING,
	INTEGER,
	/** Stored as an SQL `INTEGER` (0 or 1) and converted to a boolean */
	BOOLEAN,
	/** Same as BOOLEAN but converts `null` and `undefined` in the same way as `false` */
	STRICT_BOOLEAN,
	/** Stored as an SQL `INTEGER` and converted to a string */
	BIG_INTEGER,
	FLOAT,
	/** Stored as an SQL `BLOB` and encoded in base64 with padding */
	BASE64,
	/** Stored in the custom image hash format and converted to a string */
	IMAGE_HASH,
	/** Stored as an SQL `BLOB` containing 64-bit big-endian integers and converted to an array of strings */
	BIG_INTEGER_ARRAY,
	/** Stored as an SQL `INTEGER` containing the Unix timestamp in milliseconds and converted to a string containing the timestamp in the ISO 8601 extended format used by Discord */
	TIMESTAMP,
	/** Either a custom or a built-in emoji, stored as an SQL `INTEGER` with the id of the custom emoji or as an SQL `TEXT` with the Unicode emoji and converted to an object of the type `DiscordEmoji` */
	EMOJI,
	/** Arbitrary JSON value stored as SQL `TEXT` */
	JSON,
	/** Always stored as the SQL `INTEGER` 0 and always converted to `null` */
	NULL,
}

enum NullValue {
	/** `NULL` means that the property is not in the object */
	ABSENT,
	/** `NULL` is means that the value is `null` */
	NULL,
	/** `NULL` is means that the value is `[]` */
	EMPTY_ARRAY,
}

function getNullValue(value: NullValue | undefined) {
	if (value === undefined) {
		throw new TypeError("A required field was NULL");
	}
	switch (value) {
		case NullValue.ABSENT:
			return undefined;
		case NullValue.NULL:
			return null;
		case NullValue.EMPTY_ARRAY:
			return [];
	}
}

type PropertyInfo = [key: string, type: ValueType, nullValue?: NullValue];
type Schema = {
	properties: PropertyInfo[];
	subObjectProperties: [key: string, properties: PropertyInfo[], nullValue?: NullValue][];
};

const schemas: { [OT in ObjectType]: Schema } = {
	[ObjectType.USER]: {
		properties: [
			["id", ValueType.BIG_INTEGER],
			["bot", ValueType.STRICT_BOOLEAN],

			["username", ValueType.STRING],
			["global_name", ValueType.STRING, NullValue.NULL],
			["avatar", ValueType.IMAGE_HASH, NullValue.NULL],
			["public_flags", ValueType.INTEGER, NullValue.ABSENT],
		],
		subObjectProperties: [],
	},
	[ObjectType.GUILD]: {
		properties: [
			["id", ValueType.BIG_INTEGER],

			["name", ValueType.STRING],
			["icon", ValueType.IMAGE_HASH, NullValue.NULL],
			["splash", ValueType.IMAGE_HASH, NullValue.NULL],
			["discovery_splash", ValueType.IMAGE_HASH, NullValue.NULL],
			["owner_id", ValueType.BIG_INTEGER, NullValue.NULL],
			["afk_channel_id", ValueType.BIG_INTEGER, NullValue.NULL],
			["afk_timeout", ValueType.INTEGER],
			["widget_enabled", ValueType.STRICT_BOOLEAN],
			["widget_channel_id", ValueType.BIG_INTEGER, NullValue.NULL],
			["verification_level", ValueType.INTEGER],
			["default_message_notifications", ValueType.INTEGER],
			["explicit_content_filter", ValueType.INTEGER],
			["mfa_level", ValueType.INTEGER],
			["system_channel_id", ValueType.BIG_INTEGER, NullValue.NULL],
			["system_channel_flags", ValueType.BIG_INTEGER],
			["rules_channel_id", ValueType.BIG_INTEGER, NullValue.NULL],
			["max_presences", ValueType.INTEGER, NullValue.NULL],
			["max_members", ValueType.INTEGER, NullValue.NULL],
			["vanity_url_code", ValueType.STRING, NullValue.NULL],
			["description", ValueType.STRING, NullValue.NULL],
			["banner", ValueType.IMAGE_HASH, NullValue.NULL],
			["premium_tier", ValueType.INTEGER],
			["premium_subscription_count", ValueType.INTEGER, NullValue.ABSENT],
			["preferred_locale", ValueType.STRING],
			["public_updates_channel_id", ValueType.BIG_INTEGER, NullValue.NULL],
			["max_video_channel_users", ValueType.INTEGER, NullValue.ABSENT],
			["nsfw_level", ValueType.INTEGER],
			["premium_progress_bar_enabled", ValueType.STRICT_BOOLEAN],
		],
		subObjectProperties: [],
	},
	[ObjectType.ROLE]: {
		properties: [
			["id", ValueType.BIG_INTEGER],
			["managed", ValueType.BOOLEAN],

			["name", ValueType.STRING],
			["color", ValueType.INTEGER],
			["hoist", ValueType.BOOLEAN],
			["icon", ValueType.IMAGE_HASH, NullValue.NULL],
			["unicode_emoji", ValueType.STRING, NullValue.NULL],
			["position", ValueType.INTEGER],
			["permissions", ValueType.BIG_INTEGER],
			["mentionable", ValueType.BOOLEAN],
			["flags", ValueType.INTEGER],
		],
		subObjectProperties: [
			["tags", [
				["bot_id", ValueType.BIG_INTEGER, NullValue.ABSENT],
				["integration_id", ValueType.BIG_INTEGER, NullValue.ABSENT],
				["premium_subscriber", ValueType.NULL, NullValue.ABSENT],
				["subscription_listing_id", ValueType.BIG_INTEGER, NullValue.ABSENT],
				["available_for_purchase", ValueType.NULL, NullValue.ABSENT],
				["guild_connections", ValueType.NULL, NullValue.ABSENT],
			], NullValue.ABSENT],
		],
	},
	[ObjectType.MEMBER]: {
		properties: [
			["nick", ValueType.STRING, NullValue.NULL],
			["avatar", ValueType.IMAGE_HASH, NullValue.NULL],
			["roles", ValueType.BIG_INTEGER_ARRAY],
			["joined_at", ValueType.TIMESTAMP],
			["premium_since", ValueType.TIMESTAMP, NullValue.NULL],
			["flags", ValueType.INTEGER],
			["pending", ValueType.BOOLEAN, NullValue.ABSENT],
			["permissions", ValueType.BIG_INTEGER, NullValue.ABSENT],
			["communication_disabled_until", ValueType.TIMESTAMP, NullValue.NULL],
		],
		subObjectProperties: [],
	},
	[ObjectType.CHANNEL]: {
		properties: [
			// TODO: What the SQL `NULL` value should mean depends on the channel type. Currently we always decode those to `null`. Namely:
			// If the channel is a group DM, `name` and `icon` are never absent but may be null; if not, they are always absent.
			// If the channel is a guild text or announcement channel, `topic` is never absent but may be null; if not, it is always absent.
			// If the channel is a voice channel, `rtc_region` is never absent but may be null; if not, it is always absent.
			// If the channel is a forum channel, `default_reaction_emoji` is never absent but may be null; if not, it is always absent.
			["id", ValueType.BIG_INTEGER],
			["type", ValueType.INTEGER],
			["guild_id", ValueType.BIG_INTEGER, NullValue.ABSENT],
			["position", ValueType.INTEGER, NullValue.ABSENT],
			["name", ValueType.STRING, NullValue.NULL],
			["topic", ValueType.STRING, NullValue.NULL],
			["nsfw", ValueType.BOOLEAN, NullValue.ABSENT],
			["bitrate", ValueType.INTEGER, NullValue.ABSENT],
			["user_limit", ValueType.INTEGER, NullValue.ABSENT],
			["rate_limit_per_user", ValueType.INTEGER, NullValue.ABSENT],
			["icon", ValueType.IMAGE_HASH, NullValue.NULL],
			["owner_id", ValueType.BIG_INTEGER, NullValue.ABSENT],
			["parent_id", ValueType.BIG_INTEGER, NullValue.NULL],
			["rtc_region", ValueType.STRING, NullValue.NULL],
			["video_quality_mode", ValueType.INTEGER, NullValue.ABSENT],
			["default_auto_archive_duration", ValueType.INTEGER, NullValue.ABSENT],
			["flags", ValueType.INTEGER, NullValue.ABSENT],
			["default_reaction_emoji", ValueType.EMOJI, NullValue.NULL],
			["default_thread_rate_limit_per_user", ValueType.INTEGER, NullValue.ABSENT],
			["default_sort_order", ValueType.INTEGER, NullValue.NULL],
			["default_forum_layout", ValueType.INTEGER, NullValue.ABSENT],
		],
		subObjectProperties: [
			["thread_metadata", [
				["archived", ValueType.BOOLEAN],
				["auto_archive_duration", ValueType.INTEGER],
				["archive_timestamp", ValueType.TIMESTAMP],
				["locked", ValueType.BOOLEAN],
				["invitable", ValueType.BOOLEAN, NullValue.ABSENT],
				["create_timestamp", ValueType.TIMESTAMP, NullValue.ABSENT],
			], NullValue.ABSENT],
		],
	},
	[ObjectType.MESSAGE]: {
		properties: [
			["id", ValueType.BIG_INTEGER],
			["channel_id", ValueType.BIG_INTEGER],
			["tts", ValueType.BOOLEAN],
			["mention_everyone", ValueType.BOOLEAN],
			["mention_roles", ValueType.BIG_INTEGER_ARRAY],
			["type", ValueType.INTEGER],

			["content", ValueType.STRING],
			["flags", ValueType.INTEGER],
			["embeds", ValueType.JSON, NullValue.EMPTY_ARRAY],
			["components", ValueType.JSON, NullValue.EMPTY_ARRAY],
		],
		subObjectProperties: [
			["activity", [
				["type", ValueType.INTEGER],
				["party_id", ValueType.STRING],
			], NullValue.ABSENT],
			["interaction", [
				["id", ValueType.BIG_INTEGER],
				["type", ValueType.INTEGER],
				["name", ValueType.STRING],
			], NullValue.ABSENT],
		],
	},
	[ObjectType.ATTACHMENT]: {
		properties: [
			["id", ValueType.BIG_INTEGER],
			["filename", ValueType.STRING],
			["description", ValueType.STRING, NullValue.ABSENT],
			["content_type", ValueType.STRING, NullValue.ABSENT],
			["size", ValueType.INTEGER],

			["height", ValueType.INTEGER, NullValue.ABSENT],
			["width", ValueType.INTEGER, NullValue.ABSENT],
			["ephemeral", ValueType.STRICT_BOOLEAN],
			["duration_secs", ValueType.FLOAT, NullValue.ABSENT],
			["waveform", ValueType.BASE64, NullValue.ABSENT],
			["flags", ValueType.INTEGER, NullValue.ABSENT],
		],
		subObjectProperties: [],
	},
};

// TODO: Avatar decoration hashes (v2_*)
// It is unknown if there will be a v3, v4, etc. and if the format will stay consistent
const IMAGE_HASH_REGEX = /^(a_)?([0-9a-f]{32})$/;
export function encodeImageHash(hash: string): Uint8Array | string {
	if (typeof hash !== "string")
		throw TypeError("Only strings can be encoded into the image hash representation.");

	const match = hash.match(IMAGE_HASH_REGEX) as [string, string | undefined, string] | null;
	if (match === null) {
		return hash;
	} else {
		const buf = new Uint8Array(17);
		buf[0] = Number(match[1] !== undefined) << 0;
		buf.set(Buffer.from(match[2], "hex"), 1);
		return buf;
	}
}
export function decodeImageHash(encodedHash: Uint8Array | string): string {
	if (typeof encodedHash === "string") {
		return encodedHash;
	}
	if (!(encodedHash instanceof Uint8Array))
		throw TypeError("Not an Uint8Array.");
	if (encodedHash.byteLength !== 17)
		throw TypeError("Invalid size.");

	let hash = "";

	if (encodedHash[0] & 1 << 0)
		hash += "a_";
	hash += Buffer.from(encodedHash.subarray(1)).toString("hex");
	return hash;
}

export function encodeSnowflakeArray(array: string[]): Uint8Array {
	const dv = new DataView(new ArrayBuffer(array.length * 8));
	for (let i = 0; i < array.length; i++)
		dv.setBigUint64(i*8, BigInt(array[i]));
	return new Uint8Array(dv.buffer);
}
export function decodeSnowflakeArray(buf: Uint8Array): string[] {
	if (!(buf instanceof Uint8Array))
		throw TypeError("Not an Uint8Array.");
	if (buf.byteLength % 8 !== 0)
		throw TypeError("Size not a multiple of 8 bytes.");
	const length = buf.byteLength / 8;
	const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	const array: string[] = [];
	for (let i = 0; i < length; i++)
		array[i] = String(dv.getBigUint64(8*i));
	return array;
}

// I have observed some objects with both `emoji_id` and `emoji_name` being sent by the API.
// It probably isn't possible to create them with an unmodified client but it seems that the
// servers don't check that only one property is set.
export type DiscordEmoji = { emoji_id: string; emoji_name: null } | { emoji_id: null; emoji_name: string };
export function encodeEmojiProps(emoji: DiscordEmoji): bigint | string {
	return encodeEmoji({ id: emoji.emoji_id, name: emoji.emoji_name } as DBT.APIPartialEmoji);
}
export function decodeEmojiProps(data: bigint | string): DiscordEmoji {
	const emoji = decodeEmoji(data);
	return {
		emoji_id: emoji.id,
		emoji_name: emoji.name,
	} as DiscordEmoji;
}
export function encodeEmoji(emoji: DBT.APIPartialEmoji): bigint | string {
	if (emoji.id != null)
		return BigInt(emoji.id);
	else
		return emoji.name;
}
export function decodeEmoji(data: bigint | string): DBT.APIPartialEmoji {
	if (typeof data === "bigint")
		return { id: String(data), name: null };
	else
		return { id: null, name: data };
}

export function encodePermissionOverwrites(overwrites: DBT.APIOverwrite[]): Uint8Array {
	const dv = new DataView(new ArrayBuffer(overwrites.length * 25));
	for (let i = 0; i < overwrites.length; i++) {
		const overwrite = overwrites[i];
		const allow = BigInt(overwrite.allow);
		const deny = BigInt(overwrite.deny);
		if (allow >= 1n << 64n || deny >= 1n << 64n) {
			throw new RangeError("The permission integer is too chonky to fit into 64 bits");
		}
		const base = i * 25;
		dv.setUint8(base + 0, overwrite.type);
		dv.setBigUint64(base + 1, BigInt(overwrite.id));
		dv.setBigUint64(base + 9, allow);
		dv.setBigUint64(base + 17, deny);
	}
	return new Uint8Array(dv.buffer);
}
export function decodePermissionOverwrites(buf: Uint8Array): DBT.APIOverwrite[] {
	if (!(buf instanceof Uint8Array))
		throw TypeError("Not an Uint8Array.");
	if (buf.byteLength % 25 !== 0)
		throw TypeError("Size not a multiple of 25 bytes.");
	const length = buf.byteLength / 25;
	const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

	const overwrites: DBT.APIOverwrite[] = [];
	for (let i = 0; i < length; i++) {
		const base = i * 25;
		overwrites[i] = {
			type: dv.getUint8(base + 0),
			id: String(dv.getBigUint64(base + 1)),
			allow: String(dv.getBigUint64(base + 9)),
			deny: String(dv.getBigUint64(base + 17)),
		};
	}
	return overwrites;
}

function encodeValue(type: ValueType, nullValue: NullValue | undefined, value: any): unknown {
	if (
		type !== ValueType.STRICT_BOOLEAN && value === undefined ||
		!(type === ValueType.NULL || type === ValueType.STRICT_BOOLEAN) && value === null ||
		nullValue === NullValue.EMPTY_ARRAY && value instanceof Array && value.length === 0
	) {
		if (nullValue === undefined && !(type === ValueType.NULL || type === ValueType.STRICT_BOOLEAN)) {
			throw new TypeError("The NULL value is undefined.");
		}
		return null;
	}

	switch (type) {
		case ValueType.STRING:
		case ValueType.BIG_INTEGER: // better-sqlite3 converts strings to numbers
		case ValueType.FLOAT:
			return value;
		case ValueType.INTEGER:
		case ValueType.BOOLEAN:
		case ValueType.STRICT_BOOLEAN:
			return value == null ? 0n : BigInt(value);
		case ValueType.BASE64:
			return Buffer.from(value, "base64");
		case ValueType.IMAGE_HASH:
			return encodeImageHash(value);
		case ValueType.BIG_INTEGER_ARRAY:
			return encodeSnowflakeArray(value);
		case ValueType.TIMESTAMP:
			return new Date(value).getTime();
		case ValueType.EMOJI:
			return encodeEmojiProps(value);
		case ValueType.JSON:
			return JSON.stringify(value);
		case ValueType.NULL:
			return 0;
	}
}
function decodeValue(type: ValueType, nullValue: NullValue | undefined, value: any): unknown {
	if (value === null) {
		return getNullValue(nullValue);
	} else if (value === undefined) {
		throw new TypeError("Missing column in SQL result");
	}

	switch (type) {
		case ValueType.STRING:
		case ValueType.FLOAT:
			return value;
		case ValueType.INTEGER:
			return Number(value);
		case ValueType.BOOLEAN:
		case ValueType.STRICT_BOOLEAN:
			return Boolean(value);
		case ValueType.BIG_INTEGER:
			return String(value);
		case ValueType.BASE64:
			return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("base64");
		case ValueType.IMAGE_HASH:
			return decodeImageHash(value);
		case ValueType.BIG_INTEGER_ARRAY:
			return decodeSnowflakeArray(value);
		case ValueType.TIMESTAMP:
			return new Date(Number(value)).toISOString();
			// More accurate (sometimes) version:
			// return new Date(value).toISOString().slice(0, -1) + "000+00:00";
		case ValueType.EMOJI:
			return decodeEmojiProps(value);
		case ValueType.JSON:
			return JSON.parse(value);
		case ValueType.NULL:
			return null;
	}
}

export function encodeObject<OT extends ObjectType>(objectType: OT, object: any, partial = false): any {
	const schema = schemas[objectType];
	const sqlArguments: any = {};
	for (const [key, type, nullValue] of schema.properties) {
		if (!(partial && object[key] === undefined)) {
			try {
				sqlArguments[key] = encodeValue(type, nullValue, object[key]);
			} catch (err) {
				throw new TypeError(`Cannot encode ${ObjectType[objectType]}.${key} as ${ValueType[type]}. Value: ${JSON.stringify(object[key])}.${err instanceof Error ? ` Error: ${err.message}` : ""}`);
			}
		}
	}
	for (const [key, properties] of schema.subObjectProperties) {
		if (!(partial && object[key] === undefined)) {
			const subObject = object[key];
			for (const [subKey, type, nullValue] of properties) {
				try {
					sqlArguments[`${key}__${subKey}`] = subObject == null ? null : encodeValue(type, nullValue, subObject[subKey]);
				} catch (err) {
					throw new TypeError(`Cannot encode ${ObjectType[objectType]}.${key}.${subKey} as ${ValueType[type]}. Value: ${JSON.stringify(subObject[subKey])}.${err instanceof Error ? ` Error: ${err.message}` : ""}`);
				}
			}
		}
	}
	return sqlArguments;
}
export function decodeObject<OT extends ObjectType>(objectType: OT, sqlResult: any): any {
	const schema = schemas[objectType];
	const object: any = {};
	for (const [key, type, nullValue] of schema.properties) {
		try {
			const value = decodeValue(type, nullValue, sqlResult[key]);
			if (value !== undefined)
				object[key] = value;
		} catch (err) {
			throw new TypeError(`Cannot decode ${ObjectType[objectType]}.${key} as ${ValueType[type]}. Stored value: ${sqlResult[key]}.${err instanceof Error ? ` Error: ${err.message}` : ""}`);
		}
	}
	subObjects:
	for (const [key, properties, objNullValue] of schema.subObjectProperties) {
		const subObject: any = {};
		for (const [subKey, type, propNullValue] of properties) {
			try {
				if (sqlResult[`${key}__${subKey}`] === null && propNullValue === undefined) {
					// The property can't be null, so the sub-object itself must be null
					object[key] = getNullValue(objNullValue);
					continue subObjects;
				}
				subObject[subKey] = decodeValue(type, propNullValue, sqlResult[`${key}__${subKey}`]);
			} catch (err) {
				throw new TypeError(`Cannot decode ${ObjectType[objectType]}.${key}.${subKey} as ${ValueType[type]}. Stored value: ${sqlResult[`${key}__${subKey}`]}.${err instanceof Error ? ` Error: ${err.message}` : ""}`);
			}
		}
		object[key] = subObject;
	}
	return object;
}
