export function getTag({ username, discriminator }: { username: string; discriminator?: string | null | undefined }): string {
	return discriminator == null || discriminator === "0" ? `@${username}` : `@${username}#${discriminator}`;
}
