import * as DBT from "discord-user-api-types/v9";
import * as DUT from "discord-user-api-types/v9_user";

let ZlibSync: typeof import("zlib-sync") | undefined;
let erlpack: typeof import("erlpack") | undefined;

async function importZlibSync() {
	if (ZlibSync === undefined) {
		ZlibSync = (await import("zlib-sync")).default;
	}
}
async function importErlpack() {
	if (erlpack === undefined) {
		erlpack = (await import("erlpack")).default;
	}
}

export type GatewayEncoding = DBT.GatewayURLQuery["encoding"];
export type GatewayCompression = NonNullable<DBT.GatewayURLQuery["compress"]> | "";

export type GatewayReceivePayload = DBT.GatewayReceivePayload | DUT.GatewayReceivePayload;
export type GatewaySendPayload = DBT.GatewaySendPayload | DUT.GatewaySendPayload;

export type ServerMessageDecoder<RP extends GatewayReceivePayload> = (data: Buffer | string) => RP | undefined;
export async function getServerMessageDecoder<RP extends GatewayReceivePayload>(encoding: GatewayEncoding, compression: ""): Promise<(data: Buffer | string) => RP>;
export async function getServerMessageDecoder<RP extends GatewayReceivePayload>(encoding: GatewayEncoding, compression: GatewayCompression): Promise<ServerMessageDecoder<RP>>;
export async function getServerMessageDecoder<RP extends GatewayReceivePayload>(encoding: GatewayEncoding, compression: GatewayCompression): Promise<ServerMessageDecoder<RP>> {
	let inflate: import("zlib-sync").Inflate;

	const promises = [];
	if (compression === "zlib-stream") {
		promises.push(importZlibSync());
	}
	if (encoding === "etf") {
		promises.push(importErlpack());
	}
	await Promise.all(promises);

	if (compression === "zlib-stream") {
		inflate = new ZlibSync!.Inflate();
	}

	return function decodePayload(data: Buffer | string) {
		if ((typeof data !== "string") !== (compression !== "" || encoding !== "json")) {
			throw new Error("Unexpected binary frame when a text frame was expected or vice versa.");
		}

		if (compression === "zlib-stream") {
			// Decompress the message
			const buffer = data as Buffer;
			const sync = buffer.byteLength >= 4 && buffer.readInt32BE(buffer.byteLength - 4) === 0x0000FFFF;
			if (sync) {
				inflate.push(buffer, ZlibSync!.Z_SYNC_FLUSH);
			} else {
				inflate.push(buffer, false);
			}
			if (inflate.err) {
				throw new Error("Failed to decompress gateway packet.");
			}
			if (sync) {
				data = inflate.result as Buffer;
			} else {
				return undefined;
			}
		}

		// Decode the payload
		if (encoding === "etf") {
			return erlpack!.unpack(data as Buffer);
		} else {
			return JSON.parse(typeof data === "string" ? data : data.toString("utf-8"));
		}
	};
}

export type ClientMessageEncoder<SP extends GatewaySendPayload> = (payload: SP) => Buffer | string;
export async function getClientMessageEncoder<SP extends GatewaySendPayload>(encoding: "json"): Promise<(payload: SP) => string>;
export async function getClientMessageEncoder<SP extends GatewaySendPayload>(encoding: "etf"): Promise<(payload: SP) => Buffer>;
export async function getClientMessageEncoder<SP extends GatewaySendPayload>(encoding: GatewayEncoding): Promise<ClientMessageEncoder<SP>>;
export async function getClientMessageEncoder<SP extends GatewaySendPayload>(encoding: GatewayEncoding): Promise<ClientMessageEncoder<SP>> {
	const promises = [];
	if (encoding === "etf") {
		promises.push(importErlpack());
	}
	await Promise.all(promises);

	return function encodePayload(payload: SP) {
		if (encoding === "etf") {
			return erlpack!.pack(payload);
		} else {
			return JSON.stringify(payload);
		}
	};
}

export type ClientMessageDecoder<SP extends GatewaySendPayload> = (data: Buffer | string) => SP;
export async function getClientMessageDecoder<SP extends GatewaySendPayload>(encoding: "json"): Promise<(data: string) => SP>;
export async function getClientMessageDecoder<SP extends GatewaySendPayload>(encoding: "etf"): Promise<(data: Buffer) => SP>;
export async function getClientMessageDecoder<SP extends GatewaySendPayload>(encoding: GatewayEncoding): Promise<ClientMessageDecoder<SP>>;
export async function getClientMessageDecoder<SP extends GatewaySendPayload>(encoding: GatewayEncoding): Promise<ClientMessageDecoder<SP>> {
	const promises = [];
	if (encoding === "etf") {
		promises.push(importErlpack());
	}
	await Promise.all(promises);

	return function decodePayload(data: Buffer | string): SP {
		if ((typeof data !== "string") !== (encoding !== "json")) {
			throw new Error("Unexpected binary frame when a text frame was expected or vice versa.");
		}

		if (encoding === "etf") {
			return erlpack!.unpack(data as Buffer);
		} else {
			return JSON.parse(typeof data === "string" ? data : data.toString("utf-8"));
		}
	};

}
