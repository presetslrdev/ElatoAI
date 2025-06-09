import { Buffer } from "node:buffer";
import type { WebSocketServer as _WebSocketServer } from "npm:@types/ws";
import {
	GoogleGenAI,
	LiveConnectConfig,
	LiveServerMessage,
	Modality,
	Session,
} from "npm:@google/genai";
import { getChatHistory, updateUserSessionTime } from "../supabase.ts";
import {
	encoder,
	FRAME_SIZE,
	geminiApiKey,
	isDev,
	SAMPLE_RATE,
} from "../utils.ts";
import pkg from "npm:wavefile";
const { WaveFile } = pkg;

export const connectToGemini = async (ws: WebSocket, payload: IPayload) => {
	const { user, supabase } = payload;

	let connectionPcmFile: Deno.FsFile | null = null;
	if (isDev) {
		const filename = `debug_audio_${Date.now()}.pcm`;
		connectionPcmFile = await Deno.open(filename, {
			create: true,
			write: true,
			append: true,
		});
	}

	// Send user details to client
	ws.send(
		JSON.stringify({
			type: "auth",
			volume_control: user.device?.volume ?? 100,
			is_ota: user.device?.is_ota ?? false,
			is_reset: user.device?.is_reset ?? false,
		}),
	);

	const chatHistory = await getChatHistory(
		supabase,
		user.user_id,
		user.personality?.key ?? null,
		false,
	);
	// const firstMessage = createFirstMessage(chatHistory, payload);
	// const systemPrompt = createSystemPrompt(chatHistory, payload);
	let sessionStartTime: number;

	console.log(`Connecting with Gemini key "${geminiApiKey.slice(0, 3)}..."`);

	// Initialize Google GenAI
	const ai = new GoogleGenAI({ apiKey: geminiApiKey });
	const model = "gemini-2.0-flash-live-001";
	const config: LiveConnectConfig = {
		responseModalities: [Modality.AUDIO],
		systemInstruction: "You are a surfer bro talking to Kai Lenny",
		// generationConfig: {
		// 	speechConfig: {
		// 		voiceConfig: {
		// 			prebuiltVoiceConfig: {
		// 				voiceName: "Zephyr",
		// 			},
		// 		},
		// 	},
		// },
	};

	// Response queue for handling Google's callback-based responses
	const responseQueue: LiveServerMessage[] = [];
	let geminiSession: Session | null = null;

	async function waitMessage() {
		let done = false;
		let message: LiveServerMessage | undefined = undefined;
		while (!done) {
			message = responseQueue.shift();
			if (message) {
				done = true;
			} else {
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
		}
		return message;
	}

	async function handleTurn() {
		const turns: any[] = [];
		let done = false;
		while (!done) {
			const message = await waitMessage();
			turns.push(message);
			// if (
			// 	message.serverContent &&
			// 	message.serverContent.generationComplete
			// ) {

			// }
			if (
				message.serverContent &&
				message.serverContent.generationComplete
			) {
				ws.send(JSON.stringify({
					type: "server",
					msg: "RESPONSE.CREATED",
				}));
				done = true;
			}
		}
		return turns;
	}

	async function processGeminiTurns() {
		try {
			console.log("Processing Gemini turns");
			while (geminiSession) {
				const turns = await handleTurn();

				console.log("Turns:", turns);

				// Combine all audio data from this turn
				const combinedAudio = turns.reduce(
					(acc: number[], turn: any) => {
						if (turn.data) {
							const buffer = Buffer.from(turn.data, "base64");
							const intArray = new Int16Array(
								buffer.buffer,
								buffer.byteOffset,
								buffer.byteLength /
									Int16Array.BYTES_PER_ELEMENT,
							);
							return acc.concat(Array.from(intArray));
						}
						return acc;
					},
					[],
				);

				if (combinedAudio.length > 0) {
					console.log(
						"Received complete audio turn, length:",
						combinedAudio.length,
					);

					// Convert back to buffer and send to client
					const audioBuffer = new Int16Array(combinedAudio);
					const buffer = Buffer.from(audioBuffer.buffer);

					// PREVIEW AUDIO
					// const wf = new WaveFile();
					// wf.fromScratch(1, SAMPLE_RATE, "16", audioBuffer);

					// const filename = `gemini_response_${Date.now()}.wav`;
					// await Deno.writeFile(filename, wf.toBuffer());
					// console.log(`Audio saved as ${filename}`);

					// SEND TO ESP32
					// Send audio in chunks to client
					for (
						let offset = 0;
						offset < buffer.length;
						offset += FRAME_SIZE
					) {
						const frame = buffer.subarray(
							offset,
							offset + FRAME_SIZE,
						);
						try {
							const encodedPacket = encoder.encode(frame);
							ws.send(encodedPacket);
						} catch (_e) {
							// Skip this frame but continue with others
						}
					}
				}

				// // Handle text responses if any
				// for (const turn of turns) {
				// 	if (turn.text) {
				// 		console.log("Received text:", turn.text);
				// 		addConversation(supabase, "assistant", turn.text, user);
				// 	}
				// }

				// Send completion signal
				ws.send(JSON.stringify({
					type: "server",
					msg: "RESPONSE.COMPLETE",
				}));
			}
		} catch (error) {
			console.error("Error processing Gemini turns:", error);
		}
	}

	// Connect to Google Gemini Live
	try {
		geminiSession = await ai.live.connect({
			model: model,
			callbacks: {
				onopen: function () {
					console.log("Gemini session opened");
					sessionStartTime = Date.now();
				},
				onmessage: function (message: LiveServerMessage) {
					console.log("Received message:", message);
					responseQueue.push(message);
				},
				onerror: function (e: any) {
					console.error("Gemini error:", e.message);
					ws.send(
						JSON.stringify({
							type: "server",
							msg: "RESPONSE.ERROR",
						}),
					);
				},
				onclose: function (e: any) {
					console.log("Gemini session closed:", e.reason);
				},
			},
			config: config,
		});

		console.log("Connected to Gemini successfully!");
		// Send first message if available
		const inputTurns = [{
			role: "user",
			parts: [{ text: "Hello how are you?" }],
		}];
		geminiSession?.sendClientContent({ turns: inputTurns });
		processGeminiTurns();
	} catch (e: unknown) {
		console.log(`Error connecting to Gemini: ${e}`);
		ws.close();
		return;
	}

	ws.on("message", (data: any, isBinary: boolean) => {
		try {
			if (isBinary) {
				// Handle binary audio data from ESP32
				const base64Data = data.toString("base64");

				if (isDev && connectionPcmFile) {
					connectionPcmFile.write(data);
				}

				// Send audio to Gemini
				geminiSession?.sendRealtimeInput({
					audio: {
						data: base64Data,
						mimeType: "audio/pcm;rate=24000", // Gemini expects 16kHz but 24kHz is fine
					},
				});
			} else {
				// Handle text/JSON messages
				const message = JSON.parse(data.toString("utf-8"));

				if (
					message.type === "instruction" &&
					message.msg === "end_of_speech"
				) {
					console.log("end_of_speech detected");
					// Gemini handles turn detection automatically, but we can send a signal
					ws.send(
						JSON.stringify({
							type: "server",
							msg: "AUDIO.COMMITTED",
						}),
					);
				}

				if (
					message.type === "instruction" &&
					message.msg === "INTERRUPT"
				) {
					console.log("interrupt detected");
					// For Gemini, we might need to close and reopen the session or handle differently
					// This depends on Gemini's interrupt capabilities
				}
			}
		} catch (e: unknown) {
			console.error("Error handling message:", (e as Error).message);
		}
	});

	ws.on("error", (error: any) => {
		console.error("WebSocket error:", error);
		geminiSession?.close();
	});

	ws.on("close", async (code: number, reason: string) => {
		console.log(`WebSocket closed with code ${code}, reason: ${reason}`);
		if (sessionStartTime) {
			const sessionDuration = Math.floor(
				(Date.now() - sessionStartTime) / 1000,
			);
			await updateUserSessionTime(supabase, user, sessionDuration);
		}
		geminiSession?.close();
		if (isDev && connectionPcmFile) {
			connectionPcmFile.close();
			console.log("Closed debug audio file.");
		}
	});
};
