import * as DT from "discord-user-api-types/v9";

export type Timing = {
	timestamp: number;
	realtime: boolean;
};

export const enum AddSnapshotResult {
	/** There were no snapshots in the database, this is the first. */
	ADDED_FIRST_SNAPSHOT,
	/** There were already snapshots in the database and a new one was added. */
	ADDED_ANOTHER_SNAPSHOT,
	/** The provided object was equal to the latest recorded snapshot. No snapshot was added. */
	SAME_AS_LATEST,
	/** A partial update was requested but there was no previous snapshot. The database wasn't modified. */
	PARTIAL_NO_SNAPSHOT,
}

export const enum RequestType {
	CLOSE,
	BEGIN_TRANSACTION,
	COMMIT_TRANSACTION,
	OPTIMIZE,
	VACUUM,
	ADD_USER_SNAPSHOT,
	SYNC_GUILD_CHANNELS_AND_ROLES,
	ADD_GUILD_SNAPSHOT,
	SYNC_GUILD_MEMBERS,
	ADD_MEMBER_SNAPSHOT,
	ADD_MEMBER_LEAVE,
	ADD_ROLE_SNAPSHOT,
	MARK_ROLE_AS_DELETED,
	ADD_CHANNEL_SNAPSHOT,
	MARK_CHANNEL_AS_DELETED,
	ADD_MESSAGE_SNAPSHOT,
	MARK_MESSAGE_AS_DELETED,
	ADD_INITIAL_REACTIONS,
	ADD_REACTION_PLACEMENT,
	MARK_REACTION_AS_REMOVED,
	MARK_REACTIONS_AS_REMOVED_BULK,
	GET_LAST_MESSAGE_ID,
	GET_GUILDS,
	GET_DM_CHANNELS,
	GET_GUILD_CHANNELS,
	GET_CHANNEL_MESSAGES,
	COUNT_CHANNEL_MESSAGES,
	SEARCH_MESSAGES,
}

// `timing === null` indicates that the snapshot depicts the state of the object upon creation.

export type CommandRequest = {
	type: RequestType.CLOSE | RequestType.BEGIN_TRANSACTION | RequestType.COMMIT_TRANSACTION | RequestType.OPTIMIZE | RequestType.VACUUM;
};
export type AddUserSnapshotRequest = {
	type: RequestType.ADD_USER_SNAPSHOT;
	timing: Timing | null;
	user: DT.APIUser;
};
export type SyncGuildChannelsAndRolesRequest = {
	type: RequestType.SYNC_GUILD_CHANNELS_AND_ROLES;
	timing: Timing;
	guildID: bigint;
	channelIDs: Set<bigint>;
	roleIDs: Set<bigint>;
};
export type AddGuildSnapshotRequest = {
	type: RequestType.ADD_GUILD_SNAPSHOT;
	timing: Timing | null;
	guild: DT.APIGuild;
};
export type AddRoleSnapshotRequest = {
	type: RequestType.ADD_ROLE_SNAPSHOT;
	timing: Timing | null;
	role: DT.APIRole;
	guildID: DT.Snowflake;
};
export type MarkRoleAsDeletedRequest = {
	type: RequestType.MARK_ROLE_AS_DELETED;
	timing: Timing;
	id: DT.Snowflake;
};
export type SyncGuildMembersRequest = {
	type: RequestType.SYNC_GUILD_MEMBERS;
	timing: Timing;
	guildID: bigint;
	userIDs: Set<bigint>;
};
export type AddMemberSnapshotFromFullRequest = {
	type: RequestType.ADD_MEMBER_SNAPSHOT;
	partial: false;
	timing: Timing | null;
	guildID: DT.Snowflake;
	userID: DT.Snowflake;
	member: DT.APIGuildMember;
};
export type AddMemberSnapshotFromPartialRequest = {
	type: RequestType.ADD_MEMBER_SNAPSHOT;
	partial: true;
	timing: Timing | null;
	guildID: DT.Snowflake;
	userID: DT.Snowflake;
	member: Partial<DT.APIGuildMember>;
};
export type AddMemberLeaveRequest = {
	type: RequestType.ADD_MEMBER_LEAVE;
	timing: Timing;
	guildID: DT.Snowflake;
	userID: DT.Snowflake;
};
export type AddChannelSnapshotRequest = {
	type: RequestType.ADD_CHANNEL_SNAPSHOT;
	timing: Timing | null;
	channel: DT.APIChannel;
};
export type MarkChannelAsDeletedRequest = {
	type: RequestType.MARK_CHANNEL_AS_DELETED;
	timing: Timing;
	id: DT.Snowflake;
};
export type AddMessageSnapshotFromFullRequest = {
	type: RequestType.ADD_MESSAGE_SNAPSHOT;
	partial: false;
	message: DT.APIMessage;
};
export type AddMessageSnapshotFromPartialRequest = {
	type: RequestType.ADD_MESSAGE_SNAPSHOT;
	partial: true;
	message: Partial<DT.APIMessage> & { id: DT.APIMessage["id"] };
};
export type MarkMessageAsDeletedRequest = {
	type: RequestType.MARK_MESSAGE_AS_DELETED;
	timing: Timing;
	id: DT.Snowflake;
};
export type AddInitialReactionsRequest = {
	type: RequestType.ADD_INITIAL_REACTIONS;
	messageID: DT.Snowflake;
	emoji: DT.APIPartialEmoji;
	reactionType: 0 | 1;
	userIDs: DT.Snowflake[];
};
export type AddReactionPlacementRequest = {
	type: RequestType.ADD_REACTION_PLACEMENT;
	messageID: DT.Snowflake;
	emoji: DT.APIPartialEmoji;
	reactionType: 0 | 1;
	userID: DT.Snowflake;
	timing: Timing;
};
export type MarkReactionAsRemovedRequest = {
	type: RequestType.MARK_REACTION_AS_REMOVED;
	messageID: DT.Snowflake;
	emoji: DT.APIPartialEmoji;
	reactionType: 0 | 1;
	userID: DT.Snowflake;
	timing: Timing;
};
export type MarkReactionAsRemovedBulkRequest = {
	type: RequestType.MARK_REACTIONS_AS_REMOVED_BULK;
	messageID: DT.Snowflake;
	emoji: DT.APIPartialEmoji | null;
	timing: Timing;
};
export type GetLastMessageIDRequest = {
	type: RequestType.GET_LAST_MESSAGE_ID;
	channelID: DT.Snowflake;
};
export type GetGuildsRequest = {
	type: RequestType.GET_GUILDS;
};
export type GetDMChannelsRequest = {
	type: RequestType.GET_DM_CHANNELS;
};
export type GetGuildChannelsRequest = {
	type: RequestType.GET_GUILD_CHANNELS;
	guildID: DT.Snowflake;
};
export type GetChannelMessagesRequest = {
	type: RequestType.GET_CHANNEL_MESSAGES;
	channelID: DT.Snowflake;
};
export type CountChannelMessagesRequest = {
	type: RequestType.COUNT_CHANNEL_MESSAGES;
	channelID: DT.Snowflake;
};
export type SearchMessagesRequest = {
	type: RequestType.SEARCH_MESSAGES;
	query: string;
	startDelimiter: string;
	endDelimiter: string;
};

export type SingleRequest =
	CommandRequest |
	AddUserSnapshotRequest |
	SyncGuildChannelsAndRolesRequest |
	AddGuildSnapshotRequest |
	AddRoleSnapshotRequest |
	MarkRoleAsDeletedRequest |
	SyncGuildMembersRequest |
	AddMemberSnapshotFromFullRequest |
	AddMemberSnapshotFromPartialRequest |
	AddMemberLeaveRequest |
	AddChannelSnapshotRequest |
	MarkChannelAsDeletedRequest |
	AddMessageSnapshotFromFullRequest |
	AddMessageSnapshotFromPartialRequest |
	MarkMessageAsDeletedRequest |
	AddInitialReactionsRequest |
	AddReactionPlacementRequest |
	MarkReactionAsRemovedRequest |
	MarkReactionAsRemovedBulkRequest |
	GetLastMessageIDRequest |
	CountChannelMessagesRequest;
export type IteratorRequest =
	GetGuildsRequest |
	GetDMChannelsRequest |
	GetGuildChannelsRequest |
	GetChannelMessagesRequest |
	SearchMessagesRequest;

export type ResponseFor<R extends SingleRequest> =
	R extends CommandRequest ? void :
	R extends AddUserSnapshotRequest ? AddSnapshotResult :
	R extends SyncGuildChannelsAndRolesRequest ? void :
	R extends AddGuildSnapshotRequest ? AddSnapshotResult :
	R extends AddRoleSnapshotRequest ? AddSnapshotResult :
	R extends MarkRoleAsDeletedRequest ? boolean :
	R extends SyncGuildMembersRequest ? void :
	R extends AddMemberSnapshotFromFullRequest ? AddSnapshotResult :
	R extends AddMemberSnapshotFromPartialRequest ? AddSnapshotResult :
	R extends AddMemberLeaveRequest ? AddSnapshotResult :
	R extends AddChannelSnapshotRequest ? AddSnapshotResult :
	R extends MarkChannelAsDeletedRequest ? boolean :
	R extends AddMessageSnapshotFromFullRequest ? AddSnapshotResult :
	R extends AddMessageSnapshotFromPartialRequest ? AddSnapshotResult :
	R extends MarkMessageAsDeletedRequest ? boolean :
	R extends AddInitialReactionsRequest ? void :
	R extends AddReactionPlacementRequest ? void :
	R extends MarkReactionAsRemovedRequest ? void :
	R extends MarkReactionAsRemovedBulkRequest ? void :
	R extends GetLastMessageIDRequest ? bigint | null :
	R extends CountChannelMessagesRequest ? bigint | null :
	never;

export type DeletableLatestSnapshotTimings = {
	timing: Timing | null;
	deletedTiming: Timing | null;
};

export type IteratorResponseFor<R extends IteratorRequest> =
	R extends GetGuildsRequest ? DeletableLatestSnapshotTimings & {
		guild: DT.APIGuild;
	} :
	R extends GetDMChannelsRequest ? DeletableLatestSnapshotTimings & {
		channel: DT.APIGuildChannel<DT.ChannelType>;
	} :
	R extends GetGuildChannelsRequest ? DeletableLatestSnapshotTimings & {
		channel: DT.APIGuildChannel<DT.ChannelType>;
	} :
	R extends GetChannelMessagesRequest ? DeletableLatestSnapshotTimings & {
		message: DT.APIMessage;
	} :
	R extends SearchMessagesRequest ? {
		_timestamp: bigint;
		_deleted: bigint | null;
		id: bigint;
		content: string;
		flags: bigint;
		embeds: string;
		user_id: bigint;
		username: string | null;
		discriminator: string | null;
		channel_id: bigint;
		channel_name: string | null;
		parent_channel_id: bigint | null;
		parent_channel_name: string | null;
		guild_id: bigint;
		guild_name: string | null;
	} :
	never;
