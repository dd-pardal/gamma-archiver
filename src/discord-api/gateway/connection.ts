import EventEmitter from "node:events";
import type * as http from "node:http";
import * as DBT from "discord-user-api-types/v9";
import * as DUT from "discord-user-api-types/v9_user";
import WebSocket from "ws";
import { ClientMessageEncoder, GatewayCompression, GatewayEncoding, getClientMessageEncoder, getServerMessageDecoder, ServerMessageDecoder } from "./encoding.js";
import { RateLimiter } from "../../util/rate-limiter.js";

export type BotGatewayTypes = {
	identifyData: Omit<DBT.GatewayIdentifyData, "compress">;
	sendPayload: DBT.GatewaySendPayload;
	receivePayload: DBT.GatewayReceivePayload;
};
export type UserGatewayTypes = {
	identifyData: Omit<DUT.GatewayIdentifyData, "compress">;
	sendPayload: DUT.GatewaySendPayload;
	receivePayload: DUT.GatewayReceivePayload;
};
export type GatewayTypes = BotGatewayTypes | UserGatewayTypes;

export type ResumeState = {
	url: string;
	sessionID: string;
	seq: number;
};

const enum ConnectionState {
	CONNECTING,
	IDENTIFYING,
	READY,
	DESTROYED,
}

export class GatewayCloseError extends Error {
	code: number;
	reason: Buffer | undefined;

	constructor(code: number, reason?: Buffer) {
		super(`WS connection closed with code ${code} (${reason ? reason.toString("utf-8") : "no reason given"}).`);
		this.code = code;
		this.reason = reason;
	}
}
GatewayCloseError.prototype.name = "GatewayCloseError";

export class GatewayConnection<GT extends GatewayTypes = GatewayTypes> extends EventEmitter {
	#url: URL;
	#compression: GatewayCompression;
	#encoding: GatewayEncoding;
	#identifyData: GT["identifyData"];
	#headers: http.OutgoingHttpHeaders | undefined;
	#reidentify: boolean;

	#ws: WebSocket | undefined;
	#wsError: Error | undefined;

	#decodePayload: ServerMessageDecoder<GT["receivePayload"]> | undefined;
	#encodePayload: ClientMessageEncoder<GT["sendPayload"]> | undefined;

	#resumeState: ResumeState | undefined;
	#state: ConnectionState = ConnectionState.CONNECTING;
	// false if the server is replaying missed events after resuming
	#live = true;
	#wasHeartbeatAcknowledged = true;
	#heartbeatTimer: NodeJS.Timeout | undefined;

	#sendPayloadRateLimiter: RateLimiter | undefined;

	getResumeState(): ResumeState {
		return Object.assign({}, this.#resumeState);
	}

	/**
	 * Handles the authentication and connection to the gateway.
	 *
	 * @param identifyData The data to send in the IDENTIFY payload.
	 * @param resumeState Information to use for resuming a session.
	 * @param compression The compression method to request the server to use. Defaults to `"zlib-stream"`.
	 * @param encoding The encoding to request the server to use. Defaults to `"etf"`.
	 * @param headers The HTTP headers to use in the request.
	 * @param reidentify Whether to start a new session when the old one can't be resumed.
	 */
	constructor({
		identifyData,
		resumeState,
		bot,
		compression,
		encoding,
		headers,
		reidentify,
	}: {
		identifyData: GT["identifyData"];
		resumeState?: ResumeState | undefined;
		bot?: boolean | undefined;
		compression?: GatewayCompression | undefined;
		encoding?: GatewayEncoding | undefined;
		headers?: http.OutgoingHttpHeaders | undefined;
		reidentify?: boolean | undefined;
	}) {
		super();

		bot ??= true;
		this.#compression = compression ?? "zlib-stream";
		this.#encoding = encoding ?? "etf";
		this.#identifyData = Object.assign(identifyData, { compress: false });
		this.#resumeState = resumeState === undefined ? undefined : Object.assign({}, resumeState);
		this.#url = this.#addURLParams(resumeState?.url ?? "wss://gateway.discord.gg/");
		this.#headers = headers;
		this.#reidentify = reidentify ?? true;

		process.nextTick(() => {
			this.#connect();
		});
	}

	#error(error: Error) {
		this.emit("error", error);
		this.#disconnect(4000);
	}

	#addURLParams(url: string) {
		const parsedURL = new URL(url);
		parsedURL.searchParams.set("v", "9");
		if (this.#compression !== "") {
			parsedURL.searchParams.set("compress", this.#compression);
		}
		parsedURL.searchParams.set("encoding", this.#encoding);
		return parsedURL;
	}

	async #connect() {
		this.emit("connecting");
		this.#state = ConnectionState.CONNECTING;
		this.#wasHeartbeatAcknowledged = true;
		this.#sendPayloadRateLimiter = new RateLimiter(120, 60_000);

		[this.#decodePayload, this.#encodePayload] = await Promise.all([
			getServerMessageDecoder(this.#encoding, this.#compression),
			getClientMessageEncoder(this.#encoding),
		]);

		const ws = new WebSocket(this.#url, { headers: this.#headers });
		this.#ws = ws;
		ws.on("message", (data, isBinary) => {
			const buffer =
				data instanceof Array ? Buffer.concat(data) :
				data instanceof ArrayBuffer ? Buffer.from(data) :
				data;
			let payload;
			try {
				payload = this.#decodePayload!(isBinary ? buffer : buffer.toString("utf-8"));
			} catch (err) {
				this.emit("decodingError", buffer);
				this.#reconnect(1000);
				return;
			}
			if (payload !== undefined) {
				this.#onPayload(payload);
			}
		});
		ws.once("close", (code, reason) => {
			if (ws === this.#ws) {
				this.#onClose(code, reason);
			}
		});
		ws.once("error", (err) => {
			this.#wsError = err;
		});
	}
	#disconnect(code: number) {
		this.#stopHeartbeating();
		this.#ws?.close(code);
		this.#ws = undefined;
	}
	#reconnect(code: number) {
		this.#disconnect(code);
		this.#connect();
	}

	#onClose(code: number, reason?: Buffer) {
		if (code < 4000 || (code >= 4000 && code < 4010 && code !== 4004)) {
			this.#stopHeartbeating();
			if (this.#ws !== undefined) {
				// Reconnect if the destroy() method wasn't called
				this.emit("connectionLost", this.#state !== ConnectionState.CONNECTING, code, reason?.toString("utf-8"));
				setTimeout(() => {
					this.#connect();
				}, 1000);
			}
			this.#ws = undefined;
			this.#sendPayloadRateLimiter = undefined;
		} else {
			this.#error(new GatewayCloseError(code, reason));
		}
	}

	#onPayload(payload: GT["receivePayload"]) {
		this.emit("payloadReceived", payload);
		if (this.#state === ConnectionState.DESTROYED) return;
		switch (payload.op) {
			case DBT.GatewayOpcodes.Dispatch:
				if (payload.t === DBT.GatewayDispatchEvents.Ready) {
					this.#state = ConnectionState.READY;
					this.#resumeState = {
						url: payload.d.resume_gateway_url,
						sessionID: payload.d.session_id,
						seq: 0,
					};
				}
				if (this.#resumeState === undefined) {
					this.#error(new Error("The first dispatched event was not the READY event."));
					return;
				}
				this.#resumeState.seq = payload.s;
				this.emit("dispatch", payload, this.#live);
				break;

			case DBT.GatewayOpcodes.Hello: {
				if (this.#state !== ConnectionState.CONNECTING) {
					this.#error(new Error("Got hello opcode twice."));
				}

				this.#startHeartbeating(payload.d.heartbeat_interval);
				this.#resumeOrIdentify();
				break;
			}

			case DBT.GatewayOpcodes.Heartbeat:
				this.#sendHeartbeat();
				break;

			case DBT.GatewayOpcodes.HeartbeatAck:
				this.#wasHeartbeatAcknowledged = true;
				break;

			case DBT.GatewayOpcodes.InvalidSession:
				if (!payload.d) {
					this.emit("sessionLost");
					this.#resumeState = undefined;
					if (this.#reidentify) {
						this.#resumeOrIdentify();
					} else {
						this.destroy();
					}
				} else {
					this.#resumeOrIdentify();
				}
				break;

			case DBT.GatewayOpcodes.Reconnect:
				this.#reconnect(4000);
				break;
		}
	}

	async #sendPayload(payload: DBT.GatewaySendPayload | DUT.GatewaySendPayload) {
		await this.#sendPayloadRateLimiter!.whenFree();
		this.emit("payloadSent", payload);
		this.#ws!.send(this.#encodePayload!(payload));
	}
	async sendPayload(payload: DBT.GatewaySendPayload | DUT.GatewaySendPayload): Promise<void> {
		if (this.#state !== ConnectionState.READY) throw new Error("The connection isn't ready yet");
		// TODO: Implement a queue system? This error can happen very rarely when exiting the archiver.
		if (this.#ws === undefined) throw new Error("There is currently no connection");
		this.#sendPayload(payload);
	}

	#sendHeartbeat() {
		this.#sendPayload({
			op: DBT.GatewayOpcodes.Heartbeat,
			d: this.#resumeState?.seq ?? 0,
		});
	}
	#startHeartbeating(interval: number) {
		const handler = () => {
			if (this.#wasHeartbeatAcknowledged) {
				this.#heartbeatTimer = setTimeout(handler, interval);
				this.#wasHeartbeatAcknowledged = false;
				this.#sendHeartbeat();
			} else {
				this.#heartbeatTimer = undefined;
				this.#reconnect(4000);
			}
		};
		this.#heartbeatTimer = setTimeout(handler, interval * Math.random());
	}
	#stopHeartbeating() {
		clearTimeout(this.#heartbeatTimer);
	}

	#resumeOrIdentify() {
		this.#state = ConnectionState.IDENTIFYING;
		if (this.#resumeState === undefined) {
			this.#live = true;
			this.#sendPayload({
				op: DBT.GatewayOpcodes.Identify,
				d: this.#identifyData as any,
			});
		} else {
			this.#live = false;
			this.#sendPayload({
				op: DBT.GatewayOpcodes.Resume,
				d: {
					token: this.#identifyData.token,
					session_id: this.#resumeState.sessionID,
					seq: this.#resumeState.seq,
				},
			});
		}
	}

	destroy(): void {
		this.#disconnect(1000);
		this.#state = ConnectionState.DESTROYED;
	}
}
