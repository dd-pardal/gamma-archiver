import * as DBT from "discord-user-api-types/v9";
import { Account } from "./accounts.js";
import { CachedChannel, CachedGuild, GuildAccountData } from "./cache.js";

// Adapted from <https://github.com/discord/discord-api-docs/blob/aff1236f0e36b4e52b98cdc487b31c4ee52ab14e/docs/topics/Permissions.md?plain=1#L112-L157>

export function computeGuildPermissions(account: Account, guild: CachedGuild, accountRoles: string[]): bigint {
	if (guild.ownerID === account.details!.id) {
		return -1n;
	} else {
		let permissions = guild.rolePermissions.get(guild.id /* @everyone role */)!;
		for (const roleID of accountRoles) {
			permissions |= guild.rolePermissions.get(roleID)!;
		}

		if ((permissions & DBT.PermissionFlagsBits.Administrator) !== 0n) {
			return -1n;
		} else {
			return permissions;
		}
	}
}

export function computeChannelPermissions(account: Account, guild: CachedGuild, channel: CachedChannel, accountData?: GuildAccountData | undefined): bigint {
	accountData ??= guild.accountData.get(account)!;
	const guildPermissions = accountData.guildPermissions;

	if ((guildPermissions & DBT.PermissionFlagsBits.Administrator) !== 0n) {
		return -1n;
	} else {
		let permissions = guildPermissions;

		const atEveryoneOverwrites = channel.permissionOverwrites.get(guild.id /* @everyone role */);
		if (atEveryoneOverwrites != null) {
			permissions &= ~atEveryoneOverwrites.deny;
			permissions |= atEveryoneOverwrites.allow;
		}

		let allow = 0n, deny = 0n;
		for (const roleID of accountData.roles) {
			const roleOverwrite = channel.permissionOverwrites.get(roleID);
			if (roleOverwrite != null) {
				deny |= roleOverwrite.deny;
				allow |= roleOverwrite.allow;
			}
		}
		permissions &= ~deny;
		permissions |= allow;

		const memberOverwrite = channel.permissionOverwrites.get(account.details!.id);
		if (memberOverwrite != null) {
			permissions &= ~memberOverwrite.deny;
			permissions |= memberOverwrite.allow;
		}

		return permissions;
	}
}

export function hasChannelPermissions(channelPermissions: bigint, testPermissions: bigint): boolean {
	return (channelPermissions & DBT.PermissionFlagsBits.ViewChannel) !== 0n && (channelPermissions & testPermissions) === testPermissions;
}
