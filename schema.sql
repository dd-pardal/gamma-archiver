-- In the snapshot tables, making the primary key be (id, _timestamp), in that order, allows SQLite to find
-- all snapshots for a given object and a specific snapshot for a given object faster.

-- Common columns:
--   * _timestamp: Contains the UNIX timestamp of when the snapshot was taken in bits 1-63 and the
--     least significant bit indicates if the snapshot was taken in reaction to a gateway event
--     (1 if it was, 0 if not). The special value 0 indicates that the snapshot depicts the state
--     of the object when it was created (e.g. message with edited_timestamp === null or snapshot
--     taken in reaction to a create event).
--   * _deleted: Contains the UNIX timestamp of when the first snapshot where the object was found
--     to be deleted wa taken in bits 1-63 and the least significant bit indicates if the
--     deletion was caught in a gateway event. NULL if it wasn't deleted.

BEGIN;

PRAGMA application_id = -829210254;
PRAGMA user_version = -1;


CREATE TABLE latest_user_snapshots (
	id INTEGER NOT NULL PRIMARY KEY,
	_deleted INTEGER,
	bot INTEGER NOT NULL, -- 0 if the user isn't a bot, 1 if it is a bot
	---
	_timestamp INTEGER NOT NULL,
	username TEXT NOT NULL, -- the user's username, not unique across the platform
	discriminator TEXT, -- the user's 4-digit discord-tag, NULL if the user has none (represented as "0" in the API)
	global_name TEXT, -- the user's display name, if it is set. For bots, this is the application name
	avatar BLOB, -- the user's avatar hash
	-- avatar_decoration BLOB, -- the user's avatar decoration hash
	-- banner BLOB, -- the user's banner hash
	public_flags INTEGER -- the public flags on a user's account
);
CREATE TABLE previous_user_snapshots (
	id INTEGER NOT NULL,
	_timestamp INTEGER NOT NULL,
	username TEXT NOT NULL, -- the user's username, not unique across the platform
	discriminator TEXT, -- the user's 4-digit discord-tag, NULL if the user has none (represented as "0" in the API)
	global_name TEXT, -- the user's display name, if it is set. For bots, this is the application name
	avatar BLOB, -- the user's avatar hash
	avatar_decoration BLOB, -- the user's avatar decoration hash
	-- banner BLOB, -- the user's banner hash
	public_flags INTEGER, -- the public flags on a user's account
	PRIMARY KEY (id, _timestamp)
) WITHOUT ROWID;
-- Because presences are updated very often, the presence updates are stored in a separate table.
-- If there are no records here for a specific user, then that user has never been seen online.
CREATE TABLE user_presence_snapshots (
	id INTEGER NOT NULL, -- user id
	_timestamp INTEGER NOT NULL,
	client_status BLOB, -- the encoded status of the user
	PRIMARY KEY (id, _timestamp)
) WITHOUT ROWID;


-- TODO: Should guilds be deletable? It seems to be impossible to distinguish account leave from deletion.

CREATE TABLE latest_guild_snapshots (
	id INTEGER NOT NULL PRIMARY KEY,
	_deleted INTEGER,
	---
	_timestamp INTEGER NOT NULL,
	name TEXT NOT NULL, -- guild name (2-100 characters, excluding trailing and leading whitespace)
	icon BLOB, -- icon hash
	splash BLOB, -- splash hash
	discovery_splash BLOB, -- discovery splash hash; only present for guilds with the "DISCOVERABLE" feature
	owner_id INTEGER, -- id of owner
	afk_channel_id INTEGER, -- id of afk channel
	afk_timeout INTEGER NOT NULL, -- afk timeout in seconds
	widget_enabled INTEGER NOT NULL, -- 1 if the server widget is enabled
	widget_channel_id INTEGER, -- the channel id that the widget will generate an invite to, or NULL if set to no invite
	verification_level INTEGER NOT NULL, -- verification level required for the guild
	default_message_notifications INTEGER NOT NULL, -- default message notifications level
	explicit_content_filter INTEGER NOT NULL, -- explicit content filter level
	mfa_level INTEGER NOT NULL, -- required MFA level for the guild
	system_channel_id INTEGER, -- the id of the channel where guild notices such as welcome messages and boost events are posted      
	system_channel_flags INTEGER NOT NULL, -- system channel flags
	rules_channel_id INTEGER, -- the id of the channel where Community guilds can display rules and/or guidelines
	max_presences INTEGER, -- the maximum number of members for the guild
	max_members INTEGER, -- the maximum number of members for the guild
	vanity_url_code TEXT, -- the vanity url code for the guild
	description TEXT, -- the description of a Community guild
	banner TEXT, -- banner hash
	premium_tier INTEGER NOT NULL, -- premium tier (Server Boost level)
	premium_subscription_count INTEGER, -- the number of boosts this guild currently has
	preferred_locale TEXT NOT NULL, -- the preferred locale of a Community guild; used in server discovery and notices from Discord, and sent in interactions; defaults to "en-US"
	public_updates_channel_id INTEGER, -- the id of the channel where admins and moderators of Community guilds receive notices from Discord
	max_video_channel_users INTEGER, -- the maximum amount of users in a video channel
	nsfw_level INTEGER NOT NULL, -- guild NSFW level
	premium_progress_bar_enabled INTEGER NOT NULL, -- whether the guild has the boost progress bar enabled
	safety_alerts_channel_id INTEGER -- the id of the channel where admins and moderators of Community guilds receive safety alerts from Discord
);
CREATE TABLE previous_guild_snapshots (
	_timestamp INTEGER NOT NULL, -- when this snapshot was taken
	id INTEGER NOT NULL,
	name TEXT, -- guild name (2-100 characters, excluding trailing and leading whitespace)
	icon BLOB, -- icon hash
	splash BLOB, -- splash hash
	discovery_splash BLOB, -- discovery splash hash; only present for guilds with the "DISCOVERABLE" feature
	owner_id INTEGER, -- id of owner
	afk_channel_id INTEGER, -- id of afk channel
	afk_timeout INTEGER NOT NULL, -- afk timeout in seconds
	widget_enabled INTEGER NOT NULL, -- 1 if the server widget is enabled
	widget_channel_id INTEGER, -- the channel id that the widget will generate an invite to, or NULL if set to no invite
	verification_level INTEGER NOT NULL, -- verification level required for the guild
	default_message_notifications INTEGER NOT NULL, -- default message notifications level
	explicit_content_filter INTEGER NOT NULL, -- explicit content filter level
	mfa_level INTEGER NOT NULL, -- required MFA level for the guild
	system_channel_id INTEGER, -- the id of the channel where guild notices such as welcome messages and boost events are posted      
	system_channel_flags INTEGER NOT NULL, -- system channel flags
	rules_channel_id INTEGER, -- the id of the channel where Community guilds can display rules and/or guidelines
	max_presences INTEGER, -- the maximum number of members for the guild
	max_members INTEGER, -- the maximum number of members for the guild
	vanity_url_code TEXT, -- the vanity url code for the guild
	description TEXT, -- the description of a Community guild
	banner TEXT, -- banner hash
	premium_tier INTEGER NOT NULL, -- premium tier (Server Boost level)
	premium_subscription_count INTEGER, -- the number of boosts this guild currently has
	preferred_locale TEXT NOT NULL, -- the preferred locale of a Community guild; used in server discovery and notices from Discord, and sent in interactions; defaults to "en-US"
	public_updates_channel_id INTEGER, -- the id of the channel where admins and moderators of Community guilds receive notices from Discord
	max_video_channel_users INTEGER, -- the maximum amount of users in a video channel
	nsfw_level INTEGER NOT NULL, -- guild NSFW level
	premium_progress_bar_enabled INTEGER NOT NULL, -- whether the guild has the boost progress bar enabled
	safety_alerts_channel_id INTEGER, -- the id of the channel where admins and moderators of Community guilds receive safety alerts from Discord
	PRIMARY KEY (id, _timestamp)
) WITHOUT ROWID;


CREATE TABLE latest_role_snapshots (
	id INTEGER NOT NULL PRIMARY KEY,
	_deleted INTEGER,
	_guild_id INTEGER NOT NULL, -- the id of the guild
	managed INTEGER NOT NULL, -- whether this role is managed by an integration
	tags__bot_id INTEGER, -- the id of the bot this role belongs to
	tags__premium_subscriber INTEGER, -- whether this is the guild's Booster role
	---
	_timestamp INTEGER NOT NULL,
	name TEXT NOT NULL, -- role name
	color INTEGER NOT NULL, -- integer representation of hexadecimal color code
	hoist INTEGER NOT NULL, -- if this role is pinned in the user listing
	icon BLOB, -- role icon hash
	unicode_emoji TEXT, -- role unicode emoji
	position INTEGER NOT NULL, -- position of this role
	permissions INTEGER NOT NULL, -- permission bit set
	mentionable INTEGER NOT NULL, -- whether this role is mentionable
	flags INTEGER NOT NULL, -- role flags combined as a bitfield
	tags__integration_id INTEGER, -- the id of the integration this role belongs to
	tags__subscription_listing_id INTEGER, -- the id of this role's subscription sku and listing
	tags__available_for_purchase INTEGER, -- whether this role is available for purchase
	tags__guild_connections INTEGER -- whether this role is a guild's linked role
);
CREATE INDEX role_by_guild_id ON latest_role_snapshots (_guild_id);
CREATE TABLE previous_role_snapshots (
	id INTEGER NOT NULL,
	_timestamp INTEGER NOT NULL,
	name TEXT NOT NULL, -- role name
	color INTEGER NOT NULL, -- integer representation of hexadecimal color code
	hoist INTEGER NOT NULL, -- if this role is pinned in the user listing
	icon TEXT, -- role icon hash
	unicode_emoji TEXT, -- role unicode emoji
	position INTEGER NOT NULL, -- position of this role
	permissions INTEGER NOT NULL, -- permission bit set
	mentionable INTEGER NOT NULL, -- whether this role is mentionable
	flags INTEGER NOT NULL, -- role flags combined as a bitfield
	tags__integration_id INTEGER, -- the id of the integration this role belongs to
	tags__subscription_listing_id INTEGER, -- the id of this role's subscription sku and listing
	tags__available_for_purchase INTEGER, -- whether this role is available for purchase
	tags__guild_connections INTEGER, -- whether this role is a guild's linked role
	PRIMARY KEY (id, _timestamp)
) WITHOUT ROWID;


-- Since members can leave and join again, there's no _deleted column. Instead, when a user leaves
-- a guild, a special snapshot is saved with joined_at set to NULL.
CREATE TABLE latest_member_snapshots (
	_user_id INTEGER NOT NULL,
	_guild_id INTEGER NOT NULL,
	---
	_timestamp INTEGER NOT NULL,
	nick TEXT, -- this user's guild nickname
	avatar BLOB, -- the member's guild avatar hash
	roles BLOB, -- array of role ids
	joined_at INTEGER, -- when the user joined the guild, or NULL if this snapshot indicates that the user left the guild
	premium_since INTEGER, -- when the user started boosting the guild
	-- deaf INTEGER, -- whether the user is deafened in voice channels
	-- mute INTEGER, -- whether the user is muted in voice channels
	pending INTEGER, -- whether the user has not yet passed the guild's Membership Screening requirements
	communication_disabled_until INTEGER, -- when the user's timeout will expire and the user will be able to communicate in the guild again, null or a time in the past if the user is not timed out
	PRIMARY KEY (_user_id, _guild_id)
) WITHOUT ROWID;
CREATE TABLE previous_member_snapshots (
	_user_id INTEGER NOT NULL, -- the user id, not present in the Discord object
	_guild_id INTEGER NOT NULL,
	_timestamp INTEGER NOT NULL,
	nick TEXT, -- this user's guild nickname
	avatar BLOB, -- the member's guild avatar hash
	roles BLOB, -- array of role ids
	joined_at INTEGER, -- when the user joined the guild, or NULL if this snapshot indicates that the user left the guild
	premium_since INTEGER, -- when the user started boosting the guild
	-- deaf INTEGER, -- whether the user is deafened in voice channels
	-- mute INTEGER, -- whether the user is muted in voice channels
	pending INTEGER, -- whether the user has not yet passed the guild's Membership Screening requirements
	communication_disabled_until INTEGER, -- when the user's timeout will expire and the user will be able to communicate in the guild again, null or a time in the past if the user is not timed out
	PRIMARY KEY (_user_id, _guild_id, _timestamp)
) WITHOUT ROWID;


CREATE TABLE latest_channel_snapshots (
	id INTEGER NOT NULL PRIMARY KEY,
	_deleted INTEGER,
	type INTEGER NOT NULL, -- the type of channel
	guild_id INTEGER, -- the id of the guild, 0 for DM channels and NULL for threads
	---
	_timestamp INTEGER NOT NULL,
	position INTEGER, -- sorting position of the channel
	permission_overwrites BLOB, -- explicit permission overwrites for members and roles
	name TEXT, -- the name of the channel (1-100 characters)
	topic TEXT, -- the channel topic (0-1024 characters)
	nsfw INTEGER, -- whether the channel is nsfw
	bitrate INTEGER, -- the bitrate (in bits) of the voice channel
	user_limit INTEGER, -- the user limit of the voice channel
	rate_limit_per_user INTEGER, -- amount of seconds a user has to wait before sending another message (0-21600); bots, as well as users with the permission manage_messages or manage_channel, are unaffected
	icon TEXT, -- icon hash of the group DM
	owner_id INTEGER, -- id of the creator of the group DM or thread
	-- `application_id` and `managed` are missing because they're not useful
	parent_id INTEGER, -- for guild channels: id of the parent category for a channel (each parent category can contain up to 50 channels), for threads: id of the text channel this thread was created
	rtc_region TEXT, -- voice region id for the voice channel, automatic when set to null
	video_quality_mode INTEGER, -- the camera video quality mode of the voice channel, 1 when not present
	thread_metadata__archived INTEGER, -- whether the thread is archived
	thread_metadata__auto_archive_duration INTEGER, -- the thread will stop showing in the channel list after auto_archive_duration minutes of inactivity, can be set to: 60, 1440, 4320, 10080
	thread_metadata__archive_timestamp INTEGER, -- timestamp when the thread's archive status was last changed, used for calculating recent activity
	thread_metadata__locked INTEGER, -- whether the thread is locked; when a thread is locked, only users with MANAGE_THREADS can unarchive it
	thread_metadata__invitable INTEGER, -- whether non-moderators can add other non-moderators to a thread; only available on private threads
	thread_metadata__create_timestamp INTEGER, -- timestamp when the thread was created; only populated for threads created after 2022-01-09
	default_auto_archive_duration INTEGER, -- default duration that the clients (not the API) will use for newly created threads, in minutes, to automatically archive the thread after recent activity, can be set to: 60, 1440, 4320, 10080
	flags INTEGER, -- channel flags combined as a bitfield
	-- TODO: Add support for forum channel tags
	default_reaction_emoji BLOB, -- the id of a guild's custom emoji (if INTEGER) or the unicode character of the emoji (if TEXT) to show in the add reaction button on a thread in a GUILD_FORUM channel
	default_thread_rate_limit_per_user INTEGER, -- the initial rate_limit_per_user to set on newly created threads in a channel. this field is copied to the thread at creation time and does not live update
	default_sort_order INTEGER, -- the default sort order type used to order posts in GUILD_FORUM channels. Defaults to null, which indicates a preferred sort order hasn't been set by a channel admin
	default_forum_layout INTEGER -- the default forum layout view used to display posts in GUILD_FORUM channels. Defaults to 0, which indicates a layout view has not been set by a channel admin
);
CREATE INDEX channel_by_guild_id ON latest_channel_snapshots (guild_id) WHERE guild_id IS NOT NULL;
CREATE TABLE previous_channel_snapshots (
	id INTEGER NOT NULL,
	_timestamp INTEGER NOT NULL,
	position INTEGER, -- sorting position of the channel
	permission_overwrites BLOB, -- explicit permission overwrites for members and roles
	name TEXT, -- the name of the channel (1-100 characters)
	topic TEXT, -- the channel topic (0-1024 characters)
	nsfw INTEGER, -- whether the channel is nsfw
	bitrate INTEGER, -- the bitrate (in bits) of the voice channel
	user_limit INTEGER, -- the user limit of the voice channel
	rate_limit_per_user INTEGER, -- amount of seconds a user has to wait before sending another message (0-21600); bots, as well as users with the permission manage_messages or manage_channel, are unaffected
	icon TEXT, -- icon hash of the group DM
	owner_id INTEGER, -- id of the creator of the group DM or thread
	-- `application_id` and `managed` are missing because they're not useful
	parent_id INTEGER, -- for guild channels: id of the parent category for a channel (each parent category can contain up to 50 channels), for threads: id of the text channel this thread was created
	rtc_region TEXT, -- voice region id for the voice channel, automatic when set to null
	video_quality_mode INTEGER, -- the camera video quality mode of the voice channel, 1 when not present
	thread_metadata__archived INTEGER, -- whether the thread is archived
	thread_metadata__auto_archive_duration INTEGER, -- the thread will stop showing in the channel list after auto_archive_duration minutes of inactivity, can be set to: 60, 1440, 4320, 10080
	thread_metadata__archive_timestamp INTEGER, -- timestamp when the thread's archive status was last changed, used for calculating recent activity
	thread_metadata__locked INTEGER, -- whether the thread is locked; when a thread is locked, only users with MANAGE_THREADS can unarchive it
	thread_metadata__invitable INTEGER, -- whether non-moderators can add other non-moderators to a thread; only available on private threads
	thread_metadata__create_timestamp INTEGER, -- timestamp when the thread was created; only populated for threads created after 2022-01-09
	default_auto_archive_duration INTEGER, -- default duration that the clients (not the API) will use for newly created threads, in minutes, to automatically archive the thread after recent activity, can be set to: 60, 1440, 4320, 10080
	flags INTEGER, -- channel flags combined as a bitfield
	default_reaction_emoji BLOB, -- the id of a guild's custom emoji (if INTEGER) or the unicode character of the emoji (if TEXT) to show in the add reaction button on a thread in a GUILD_FORUM channel
	default_thread_rate_limit_per_user INTEGER, -- the initial rate_limit_per_user to set on newly created threads in a channel. this field is copied to the thread at creation time and does not live update
	default_sort_order INTEGER, -- the default sort order type used to order posts in GUILD_FORUM channels. Defaults to null, which indicates a preferred sort order hasn't been set by a channel admin
	default_forum_layout INTEGER, -- the default forum layout view used to display posts in GUILD_FORUM channels. Defaults to 0, which indicates a layout view has not been set by a channel admin
	PRIMARY KEY (id, _timestamp)
) WITHOUT ROWID;

-- TODO: Recipient list for DM channels


-- You can determine whether a message is from a webhook by comparing author__id with
-- 281474976710656 (2^48): if author__id is smaller, then it refers to a webhook user in
-- webhook__users; it it's bigger, then it refers to a normal user.
CREATE TABLE latest_message_snapshots (
	id INTEGER NOT NULL PRIMARY KEY,
	_deleted INTEGER,
	channel_id INTEGER NOT NULL, -- id of the channel the message was sent in
	author__id INTEGER NOT NULL, -- id of the user who sent the message or internal id of the webhook user
	tts INTEGER NOT NULL, -- whether this was a TTS message
	mention_everyone INTEGER NOT NULL, -- whether this message mentions everyone
	mention_roles BLOB NOT NULL, -- ids of the roles specifically mentioned in this message, stored as 64-bit big-endian integers concatenated
	type INTEGER NOT NULL, -- type of message
	activity__type INTEGER, -- type of message activity
	activity__party_id TEXT, -- partyId from a Rich Presence event
	message_reference__message_id INTEGER, -- id of the originating message
	message_reference__channel_id INTEGER, -- id of the originating message's channel
	message_reference__guild_id INTEGER, -- id of the originating message's guild
	interaction__id INTEGER, -- id of the interaction this message is a response to
	interaction__type INTEGER, -- the type of the interaction this message is a response to
	interaction__name TEXT, -- the name of the application command this message is a response to
	interaction__user__id INTEGER, -- the user who invoked the interaction this message is a response to
	_sticker_ids BLOB NOT NULL, -- ids of the stickers in the message, stored as 64-bit big-endian integers concatenated
	---
	_timestamp INTEGER NOT NULL, -- edited_timestamp if the message was edited, 0 if not. The least significant bit has no special meaning.
	content TEXT, -- contents of the message
	flags INTEGER, -- message flags combined as a bitfield
	embeds TEXT, -- any embedded content, stored as JSON
	components TEXT, -- components like buttons, action rows, or other interactive components, stored as JSON
	_attachment_ids BLOB -- ids of the attachments in the message, stored as 64-bit big-endian integers concatenated
);
CREATE INDEX message_by_channel_id ON latest_message_snapshots (channel_id);
CREATE INDEX message_by_author_id ON latest_message_snapshots (author__id);
CREATE VIRTUAL TABLE message_fts_index USING fts5(content, content=latest_message_snapshots, content_rowid=id, detail=full);
-- Triggers to keep the FTS index up to date
CREATE TRIGGER latest_message_snapshots_ai AFTER INSERT ON latest_message_snapshots BEGIN
  INSERT INTO message_fts_index (rowid, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER latest_message_snapshots_ad AFTER DELETE ON latest_message_snapshots BEGIN
  INSERT INTO message_fts_index (message_fts_index, rowid, content) VALUES ('delete', old.id, old.content);
END;
CREATE TRIGGER latest_message_snapshots_au AFTER UPDATE ON latest_message_snapshots BEGIN
  INSERT INTO message_fts_index (message_fts_index, rowid, content) VALUES ('delete', old.id, old.content);
  INSERT INTO message_fts_index (rowid, content) VALUES (new.id, new.content);
END;
CREATE TABLE previous_message_snapshots (
	id INTEGER NOT NULL,
	_timestamp INTEGER NOT NULL, -- edited_timestamp if the message was edited, 0 if not. The least significant bit is just the least significant bit of the timestamp.
	content TEXT, -- contents of the message
	flags INTEGER, -- message flags combined as a bitfield
	embeds TEXT, -- any embedded content, stored as JSON
	components TEXT, -- components like buttons, action rows, or other interactive components, stored as JSON
	_attachment_ids BLOB, -- ids of the attachments in the message, stored as 64-bit big-endian integers concatenated
	UNIQUE (id, _timestamp)
);

-- This table does not represent a Discord object. It's used to avoid repetition.
CREATE TABLE webhook_users (
	id INTEGER NOT NULL PRIMARY KEY,
	webhook_id INTEGER NOT NULL,
	username TEXT NOT NULL,
	avatar BLOB,
	UNIQUE (webhook_id, username, avatar)
);

-- Apparently, all properties of attachments are immutable
CREATE TABLE attachments (
	id INTEGER NOT NULL PRIMARY KEY,
	_message_id INTEGER NOT NULL REFERENCES latest_message_snapshots (id), -- the id of the parent message
	filename TEXT NOT NULL, -- name of file attached
	description TEXT, -- description for the file
	content_type TEXT, -- the attachment's media type
	size INTEGER NOT NULL, -- size of file in bytes
	-- `url` and `proxy_url` are omitted because they can be generated from other data
	height INTEGER, -- height of file (if image)
	width INTEGER, -- width of file (if image)
	ephemeral INTEGER NOT NULL, -- whether this attachment is ephemeral
	duration_secs REAL, -- the duration of the audio file (currently for voice messages)
	waveform BLOB, -- byte array representing a sampled waveform, decoded from Base64 (currently for voice messages)
	flags INTEGER -- attachment flags combined as a bitfield
);


COMMIT;
