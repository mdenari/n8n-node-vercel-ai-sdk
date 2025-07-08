import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
	ILoadOptionsFunctions,
	INodePropertyOptions,
        NodeConnectionType,
} from 'n8n-workflow';
const { createGoogleGenerativeAI } = require('@ai-sdk/google');
/**
*import { createGoogleGenerativeAI } from '@ai-sdk/google';
*/
import {
	CoreAssistantMessage,
	CoreSystemMessage,
	CoreTool,
	CoreToolMessage,
	CoreUserMessage,
	generateObject,
	GenerateObjectResult,
	generateText,
	GenerateTextResult,
	jsonSchema,
} from 'ai';

import { z } from 'zod';
import Ajv from 'ajv';

/**
 * Provider-specific union types for categories & thresholds:
 * Adjust if your AI SDK enumerations differ.
 */
type GoogleHarmCategory =
	| 'HARM_CATEGORY_UNSPECIFIED'
	| 'HARM_CATEGORY_HATE_SPEECH'
	| 'HARM_CATEGORY_DANGEROUS_CONTENT'
	| 'HARM_CATEGORY_HARASSMENT'
	| 'HARM_CATEGORY_SEXUALLY_EXPLICIT'
	| 'HARM_CATEGORY_CIVIC_INTEGRITY';

type GoogleHarmThreshold =
	| 'HARM_BLOCK_THRESHOLD_UNSPECIFIED'
	| 'BLOCK_LOW_AND_ABOVE'
	| 'BLOCK_MEDIUM_AND_ABOVE'
	| 'BLOCK_ONLY_HIGH'
	| 'BLOCK_NONE';

type AiSdkMessage = CoreSystemMessage | CoreUserMessage | CoreAssistantMessage | CoreToolMessage;

/**
 * Helper function that builds either a single prompt/system or a messages array,
 * depending on the user's choice of "prompt" vs "messages".
 *
 * We define it as a top-level function (not a class method) so we don't get:
 *  "Property 'buildInput' does not exist on type 'IExecuteFunctions'"
 */
async function buildInput(
	exec: IExecuteFunctions,
	itemIndex: number,
): Promise<{ prompt?: string; system?: string; messages?: AiSdkMessage[] }> {
	const inputType = exec.getNodeParameter('inputType', itemIndex) as 'prompt' | 'messages';

	if (inputType === 'prompt') {
		const promptVal = exec.getNodeParameter('prompt', itemIndex) as string;
		const systemVal = exec.getNodeParameter('system', itemIndex) as string;
		return {
			prompt: promptVal,
			system: systemVal,
		};
	} else {
		// inputType === 'messages'
		const messageAsJson = exec.getNodeParameter('messageAsJson', itemIndex, false) as boolean;

		if (messageAsJson) {
			const rawJson = exec.getNodeParameter('messagesJson', itemIndex) as string;
			let arr: unknown[];
			try {
				arr = JSON.parse(rawJson);
			} catch (error) {
				throw new NodeOperationError(
					exec.getNode(),
					`Invalid JSON in "Messages (JSON)" field: ${(error as Error).message}`,
				);
			}

			// Basic shape check
			const parseRes = z
				.array(
					z.object({
						role: z.enum(['system', 'user', 'assistant']),
						content: z.any(),
					}),
				)
				.safeParse(arr);

			if (!parseRes.success) {
				throw new NodeOperationError(
					exec.getNode(),
					'Messages must be an array of objects with role and content.',
				);
			}

			const messages: AiSdkMessage[] = parseRes.data.map((m) => ({
				role: m.role,
				content: m.content,
			}));
			return { messages };
		} else {
			// Build from fixedCollection
			const items = exec.getInputData();
			const messagesUi = exec.getNodeParameter('messages.messagesUi', itemIndex, []) as Array<{
				role: string;
				systemContent?: string;
				contentType?: 'text' | 'file';
				fileDataSource?: 'binary' | 'url';
				fileContent?: string;
				fileUrl?: string;
				mimeType?: string;
				mimeTypeOther?: string;
				content?: string;
			}>;

			const builtMessages: AiSdkMessage[] = [];

			for (const msg of messagesUi) {
				const role = msg.role as 'system' | 'assistant' | 'user';

				if (role === 'system') {
					builtMessages.push({
						role,
						content: msg.systemContent || '',
					});
					continue;
				}

				// assistant or user
				if (msg.contentType === 'text') {
					builtMessages.push({
						role,
						content: msg.content || '',
					});
				} else {
					// contentType === 'file'
					const parts: Array<Record<string, unknown>> = [];

					// If there's additional text
					if (msg.content) {
						parts.push({
							type: 'text',
							text: msg.content,
						});
					}

					// figure out mime type
					let selectedMimeType = msg.mimeType || 'application/octet-stream';
					if (selectedMimeType === 'other' && msg.mimeTypeOther) {
						selectedMimeType = msg.mimeTypeOther;
					}

					if (msg.fileDataSource === 'url') {
						// If user wants to use a URL
						parts.push({
							type: 'file',
							data: msg.fileUrl,
							mimeType: selectedMimeType,
						});
					} else {
						// binary
						const binaryProperty = msg.fileContent || 'data';
						const itemBinary = items[itemIndex].binary;
						if (!itemBinary || !itemBinary[binaryProperty]) {
							throw new NodeOperationError(
								exec.getNode(),
								`Binary property "${binaryProperty}" not found on item index ${itemIndex}`,
							);
						}
						const binaryData = itemBinary[binaryProperty];
						const buffer = Buffer.from(binaryData.data, binaryData.data ? 'base64' : undefined);

						if (selectedMimeType === 'application/octet-stream' && binaryData.mimeType) {
							selectedMimeType = binaryData.mimeType;
						}

						parts.push({
							type: 'file',
							data: buffer,
							mimeType: selectedMimeType,
						});
					}

					builtMessages.push({
						role,
						// @ts-expect-error
						content: parts,
					});
				}
			}

			return { messages: builtMessages };
		}
	}
}

/**
 * Helper function to build a consistent JSON for n8n from a GenerateTextResult
 */
function formatTextResult(
	result: GenerateTextResult<Record<string, CoreTool<any, any>>, never>,
	includeRequestBody: boolean | undefined,
) {
	const out: Record<string, unknown> = {
		text: result.text,
		toolCalls: result.toolCalls || [],
		toolResults: result.toolResults || [],
		finishReason: result.finishReason,
		usage: {
			promptTokens: result.usage?.promptTokens,
			completionTokens: result.usage?.completionTokens,
			totalTokens: result.usage?.totalTokens,
		},
		response: {
			id: result.response?.id,
			modelId: result.response?.modelId,
			timestamp: result.response?.timestamp,
			headers: result.response?.headers,
		},
		steps: result.steps || [],
		warnings: result.warnings || [],
		experimental_providerMetadata: result.experimental_providerMetadata,
	};

	if (includeRequestBody) {
		out.request = { body: result.request?.body };
	}

	return out;
}

function formatObjectResult(
	result: GenerateObjectResult<unknown>,
	includeRequestBody: boolean | undefined,
) {
	const out: Record<string, unknown> = {
		object: result.object,
		finishReason: result.finishReason,
		usage: {
			promptTokens: result.usage?.promptTokens,
			completionTokens: result.usage?.completionTokens,
			totalTokens: result.usage?.totalTokens,
		},
		response: {
			id: result.response?.id,
			modelId: result.response?.modelId,
			timestamp: result.response?.timestamp,
			headers: result.response?.headers,
		},
		warnings: result.warnings || [],
		experimental_providerMetadata: result.experimental_providerMetadata,
	};

	if (includeRequestBody) {
		out.request = { body: result.request?.body };
	}

	return out;
}
/**
 * Main node class
 */
export class GoogleGenerativeAi implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Google Generative AI',
		name: 'googleGenerativeAi',
		icon: 'file:icons/GoogleGenerativeAI.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["model"]}}',
		description: 'Use Google Generative AI models via Vercel AI SDK',
		defaults: {
			name: 'Google Generative AI',
		},
                        inputs: ['main'],
                        outputs: ['main'],
		credentials: [
			{
				name: 'googleGenerativeAIApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				required: true,
				noDataExpression: true,
				options: [
					{
						name: 'Generate Text',
						value: 'generateText',
						description: 'Generate text using simple prompt or chat messages',
						action: 'Generate text',
					},
					{
						name: 'Generate Object',
						value: 'generateObject',
						description: 'Generate a structured object based on a JSON schema',
						action: 'Generate object',
					},
				],
				default: 'generateText',
				description: 'Which type of output you want to generate',
			},
			{
				displayName: 'Model Name or ID',
				name: 'model',
				type: 'options',
				required: true,
				typeOptions: {
					loadOptionsMethod: 'getModels',
				},
				default: '',
				description: 'Select which Google Generative AI model to use. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code-examples/expressions/">expression</a>. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Input Type',
				name: 'inputType',
				type: 'options',
				required: true,
				options: [
					{
						name: 'Simple Prompt',
						value: 'prompt',
						description: 'Use a single prompt',
					},
					{
						name: 'Messages',
						value: 'messages',
						description: 'Use a conversation with multiple messages',
					},
				],
				default: 'prompt',
				description: 'Choose how you want to provide input to the model',
			},
			{
				displayName: 'System',
				name: 'system',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				displayOptions: {
					show: {
						inputType: ['prompt'],
					},
				},
				default: 'You are a helpful assistant.',
				description: "System prompt that specifies the model's behavior",
				hint: "This field is optional, but can help guide the model's responses.",
				requiresDataPath: 'single',
			},
			{
				displayName: 'Prompt',
				name: 'prompt',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				displayOptions: {
					show: {
						inputType: ['prompt'],
					},
				},
				default: '',
				required: true,
				description: 'The single text prompt to generate a completion for',
				hint: 'You can drag data from previous nodes here using expressions.',
				requiresDataPath: 'single',
			},
			{
				displayName: 'Messages',
				name: 'messages',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
					sortable: true,
					minValue: 1,
				},
				displayOptions: {
					show: {
						inputType: ['messages'],
						messageAsJson: [false],
					},
				},
				description: 'The messages for the conversation',
				default: {
					messagesUi: [
						{
							role: 'system',
							systemContent: 'You are a helpful assistant.',
						},
						{
							role: 'user',
							contentType: 'text',
							content: 'How can you help me?',
						},
					],
				},
				required: true,
				options: [
					{
						name: 'messagesUi',
						displayName: 'Message',
						values: [
							{
								displayName: 'Role',
								name: 'role',
								type: 'options',
								options: [
									{
										name: 'Assistant',
										value: 'assistant',
									},
									{
										name: 'System',
										value: 'system',
									},
									{
										name: 'User',
										value: 'user',
									},
								],
								default: 'user',
								required: true,
							},
							// System content: only visible if role=system
							{
								displayName: 'System Content',
								name: 'systemContent',
								type: 'string',
								description: 'The text content if role is System',
								required: true,
								typeOptions: {
									rows: 4,
								},
								default: '',
								displayOptions: {
									show: {
										role: ['system'],
									},
								},
								requiresDataPath: 'single',
							},
							// Content type: only visible if role=assistant or role=user
							{
								displayName: 'Content Type',
								name: 'contentType',
								type: 'options',
								options: [
									{
										name: 'Text',
										value: 'text',
									},
									{
										name: 'Binary File',
										value: 'file',
									},
								],
								default: 'text',
								description: 'The type of content to send',
								required: true,
								displayOptions: {
									show: {
										role: ['assistant', 'user'],
									},
								},
							},
							{
								displayName: 'Text Content',
								name: 'content',
								type: 'string',
								typeOptions: {
									rows: 4,
								},
								displayOptions: {
									show: {
										role: ['assistant', 'user'],
										contentType: ['text'],
									},
								},
								default: '',
								description: 'The text content of the message',
								required: true,
								requiresDataPath: 'single',
							},
							// For file usage
							{
								displayName: 'File Source',
								name: 'fileDataSource',
								type: 'options',
								options: [
									{
										name: 'Binary',
										value: 'binary',
										description: 'Use a binary property from n8n input',
									},
									{
										name: 'URL',
										value: 'url',
										description: 'Send a URL for the AI to fetch',
									},
								],
								default: 'binary',
								description: 'Where the file is coming from',
								displayOptions: {
									show: {
										role: ['assistant', 'user'],
										contentType: ['file'],
									},
								},
							},
							{
								displayName: 'Binary Property',
								name: 'fileContent',
								type: 'string',
								default: 'data',
								description: 'Name of the binary property containing the file data',
								required: true,
								displayOptions: {
									show: {
										role: ['assistant', 'user'],
										contentType: ['file'],
										fileDataSource: ['binary'],
									},
								},
							},
							{
								displayName: 'File URL',
								name: 'fileUrl',
								type: 'string',
								default: '',
								description: 'URL of the file to download',
								required: true,
								displayOptions: {
									show: {
										role: ['assistant', 'user'],
										contentType: ['file'],
										fileDataSource: ['url'],
									},
								},
								requiresDataPath: 'single',
							},
							// MIME type selection
							{
								displayName: 'MIME Type',
								name: 'mimeType',
								type: 'options',
								default: 'application/octet-stream',
								description:
									'Select the MIME type of the file; choose Other to specify a custom MIME type',
								options: [
									{
										name: 'JPEG Image (Image/jpeg)',
										value: 'image/jpeg',
									},
									{
										name: 'JSON (Application/json)',
										value: 'application/json',
									},
									{
										name: 'MP3 Audio (Audio/mpeg)',
										value: 'audio/mpeg',
									},
									{
										name: 'MP4 Video (Video/mp4)',
										value: 'video/mp4',
									},
									{
										name: 'Octet Stream (Default)',
										value: 'application/octet-stream',
									},
									{
										name: 'Other (Specify Below)',
										value: 'other',
									},
									{
										name: 'PDF (Application/pdf)',
										value: 'application/pdf',
									},
									{
										name: 'Plain Text (Text/plain)',
										value: 'text/plain',
									},
									{
										name: 'PNG Image (Image/png)',
										value: 'image/png',
									},
									{
										name: 'WAV Audio (Audio/wav)',
										value: 'audio/wav',
									},
								],
								displayOptions: {
									show: {
										role: ['assistant', 'user'],
										contentType: ['file'],
										fileDataSource: ['url'],
									},
								},
							},
							{
								displayName: 'Other MIME Type',
								name: 'mimeTypeOther',
								type: 'string',
								default: '',
								description: 'Specify a custom MIME type, e.g. application/x-zip-compressed',
								displayOptions: {
									show: {
										role: ['assistant', 'user'],
										contentType: ['file'],
										mimeType: ['other'],
									},
								},
							},
							{
								displayName: 'Additional Text',
								name: 'content',
								type: 'string',
								typeOptions: {
									rows: 2,
								},
								displayOptions: {
									show: {
										role: ['assistant', 'user'],
										contentType: ['file'],
									},
								},
								default: 'Please analyze this file.',
								description: 'Additional text to include with the file',
								required: true,
								requiresDataPath: 'single',
							},
						],
					},
				],
			},
			{
				displayName: 'Messages as JSON',
				name: 'messageAsJson',
				type: 'boolean',
				default: false,
				description: 'Whether to input messages as a JSON array instead of using the UI',
				displayOptions: {
					show: {
						operation: ['generateText', 'generateObject'],
						inputType: ['messages'],
					},
				},
			},
			{
				displayName: 'Messages (JSON)',
				name: 'messagesJson',
				type: 'string',
				default: '=[{"role": "user", "content": "Hello!"}]',
				description: 'Enter an array of message objects in JSON format (role, content)',
				required: true,
				typeOptions: {
					rows: 4,
				},
				noDataExpression: false,
				requiresDataPath: 'single',
				displayOptions: {
					show: {
						operation: ['generateText', 'generateObject'],
						inputType: ['messages'],
						messageAsJson: [true],
					},
				},
			},
			{
				displayName: 'Schema Name',
				name: 'schemaName',
				type: 'string',
				default: '',
				description: 'Name of the output schema (optional)',
				hint: 'Some providers use this name for additional guidance when generating objects.',
				displayOptions: {
					show: {
						operation: ['generateObject'],
					},
				},
			},
			{
				displayName: 'Schema Description',
				name: 'schemaDescription',
				type: 'string',
				default: '',
				description: 'Description of the output schema (optional)',
				hint: 'Some providers use this description for additional guidance when generating objects.',
				displayOptions: {
					show: {
						operation: ['generateObject'],
					},
				},
			},
			{
				displayName: 'Schema',
				name: 'schema',
				type: 'json',
				displayOptions: {
					show: {
						operation: ['generateObject'],
					},
				},
				default: `{\n\t"type": "object",\n\t"properties": {\n\t\t"sentiment": {\n\t\t"type": "string",\n\t\t"enum": ["positive","negative","neutral"],\n\t\t"description": "The overall sentiment of the text"\n\t\t},\n\t\t"score": {\n\t\t"type": "number",\n\t\t"minimum": -1,\n\t\t"maximum": 1,\n\t\t"description": "Sentiment score from -1 (negative) to 1 (positive)"\n\t\t},\n\t\t"text": {\n\t\t"type": "string",\n\t\t"description": "The text content to analyze"\n\t\t}\n\t}\n}`,
				required: true,
				description:
					'JSON schema describing the structure and constraints of the object to generate',
				hint: 'For example, a schema describing sentiment analysis output.',
				requiresDataPath: 'single',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Max Tokens',
						name: 'maxTokens',
						type: 'number',
						typeOptions: {
							minValue: 1,
						},
						default: 2048,
						description: 'The maximum number of tokens to generate',
					},
					{
						displayName: 'Temperature',
						name: 'temperature',
						type: 'number',
						typeOptions: {
							minValue: 0,
							maxValue: 2,
							numberPrecision: 2,
						},
						default: 0.7,
						description: 'Higher values produce more random outputs',
					},
					{
						displayName: 'Include Request Body',
						name: 'includeRequestBody',
						type: 'boolean',
						default: false,
						description: 'Whether to include the request body in the output',
					},
				],
			},
			{
				displayName: 'Safety Settings',
				name: 'safetySettings',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				default: {},
				options: [
					{
						name: 'settings',
						displayName: 'Setting',
						values: [
							{
								displayName: 'Category',
								name: 'category',
								type: 'options',
								options: [
									{ name: 'Hate Speech', value: 'HARM_CATEGORY_HATE_SPEECH' },
									{ name: 'Dangerous Content', value: 'HARM_CATEGORY_DANGEROUS_CONTENT' },
									{ name: 'Harassment', value: 'HARM_CATEGORY_HARASSMENT' },
									{ name: 'Sexually Explicit', value: 'HARM_CATEGORY_SEXUALLY_EXPLICIT' },
								],
								default: 'HARM_CATEGORY_HATE_SPEECH',
							},
							{
								displayName: 'Threshold',
								name: 'threshold',
								type: 'options',
								options: [
									{ name: 'Block Low and Above', value: 'BLOCK_LOW_AND_ABOVE' },
									{ name: 'Block Medium and Above', value: 'BLOCK_MEDIUM_AND_ABOVE' },
									{ name: 'Block Only High', value: 'BLOCK_ONLY_HIGH' },
									{ name: 'Block None', value: 'BLOCK_NONE' },
								],
								default: 'BLOCK_MEDIUM_AND_ABOVE',
							},
						],
					},
				],
				description: 'Set safety categories and thresholds to block or filter certain outputs',
			},
			{
				displayName: 'Use Search Grounding',
				name: 'useSearchGrounding',
				type: 'boolean',
				default: false,
				description:
					'Whether to enable real-time or up-to-date information if supported by the model',
			},
		],
	};

	methods = {
		loadOptions: {
			async getModels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const credentials = await this.getCredentials('googleGenerativeAIApi');

				try {
					const response = await this.helpers.request({
						method: 'GET',
						url: 'https://generativelanguage.googleapis.com/v1beta/models',
						headers: {
							'x-goog-api-key': credentials.apiKey as string,
						},
						json: true,
					});

					const returnData: INodePropertyOptions[] = [];

					if (response.models) {
						for (const model of response.models) {
							if (model.name.includes('gemini')) {
								const modelId = model.name.split('/').pop() as string;
								const displayName = model.displayName || modelId;
								const version = modelId.includes('latest')
									? '(Latest)'
									: `(${model.version || 'v1'})`;

								returnData.push({
									name: `${displayName} ${version}`,
									value: modelId,
									description: model.description || '',
								});
							}
						}
					}

					return returnData.sort((a, b) => a.name.localeCompare(b.name));
				} catch (error) {
					// If API call fails, return a fallback list
					return [
						{
							name: 'Gemini 1.5 Pro (Latest)',
							value: 'gemini-1.5-pro-latest',
							description: 'Most capable Gemini model for text generation',
						},
						{
							name: 'Gemini 1.5 Pro Vision (Latest)',
							value: 'gemini-1.5-pro-vision-latest',
							description: 'Most capable Gemini model for text and vision tasks',
						},
						{
							name: 'Gemini 1.5 Flash (Latest)',
							value: 'gemini-1.5-flash-latest',
							description: 'Optimized for speed while maintaining high quality',
						},
					].sort((a, b) => a.name.localeCompare(b.name));
				}
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		// 1) Validate credentials
		const credentials = await this.getCredentials('googleGenerativeAIApi');
		if (!credentials?.apiKey) {
			throw new NodeOperationError(this.getNode(), 'No API key provided in credentials');
		}

		// 2) Create the GoogleGenerativeAI provider
		const googleProvider = createGoogleGenerativeAI({
			apiKey: credentials.apiKey as string,
			baseURL: 'https://generativelanguage.googleapis.com/v1beta',
			headers: {
				'x-goog-api-key': credentials.apiKey as string,
			},
		});

		// 3) Process each input item
		for (let i = 0; i < items.length; i++) {
			try {
				// Basic parameters
				const operation = this.getNodeParameter('operation', i) as
					| 'generateText'
					| 'generateObject';
				const model = this.getNodeParameter('model', i) as string;
				const options = this.getNodeParameter('options', i, {}) as {
					maxTokens?: number;
					temperature?: number;
					includeRequestBody?: boolean;
				};

				// Safety settings
				const safetySettingsRaw = this.getNodeParameter('safetySettings.settings', i, []) as Array<{
					category: string;
					threshold: string;
				}>;
				const useSearchGrounding = this.getNodeParameter('useSearchGrounding', i, false) as boolean;

				// Convert to narrower union types with a cast
				const safetySettings = safetySettingsRaw.map((s) => ({
					category: s.category as GoogleHarmCategory,
					threshold: s.threshold as GoogleHarmThreshold,
				}));

				// Build model config
				const modelSettings = {
					structuredOutputs: operation === 'generateObject', // optional
					safetySettings: safetySettings.length > 0 ? safetySettings : undefined,
					useSearchGrounding,
				};

				// Build input (prompt or messages)
				const input = await buildInput(this, i);

				// Branch on operation
				if (operation === 'generateText') {
					//  ~~~~~~~~~~~~~
					//  Generate Text
					//  ~~~~~~~~~~~~~

					const result = await generateText({
						model: googleProvider(model, {
							...modelSettings,
							// audioTimestamp: input.messages?.some((m) => Array.isArray(m.content) && m.content.some(part => 'type' in part && part.type === 'file' && 'mimeType' in part && part.mimeType?.startsWith('audio/'))) ?? false,
						}),
						messages: input.messages,
						maxTokens: options.maxTokens,
						temperature: options.temperature,
						prompt: input.prompt,
						system: input.system,
					});

					// Format output
					const formatted = formatTextResult(result, options.includeRequestBody);
					// @ts-expect-error
					returnData.push({ json: formatted });
				} else {
					//  ~~~~~~~~~~~~~
					//  Generate Object
					//  ~~~~~~~~~~~~~
					const schemaName = this.getNodeParameter('schemaName', i, '') as string;
					const schemaDescription = this.getNodeParameter('schemaDescription', i, '') as string;
					const rawSchema = this.getNodeParameter('schema', i) as string;

					let parsedSchema: any;
					try {
						parsedSchema = JSON.parse(rawSchema);
					} catch (err) {
						throw new NodeOperationError(
							this.getNode(),
							'Schema is not valid JSON: ' + (err as Error).message,
						);
					}

					// Validate the schema with Ajv
					const ajv = new Ajv();
					if (!ajv.validateSchema(parsedSchema)) {
						throw new NodeOperationError(
							this.getNode(),
							`Invalid JSON Schema: ${ajv.errorsText(ajv.errors)}`,
						);
					}

					// Now call generateObject
					const result = await generateObject({
						model: googleProvider(model, {
							...modelSettings,
							// audioTimestamp: input.messages?.some((m) => Array.isArray(m.content) && m.content.some(part => 'type' in part && part.type === 'file' && 'mimeType' in part && part.mimeType?.startsWith('audio/'))) ?? false,
						}),
						schema: jsonSchema(parsedSchema),
						schemaName,
						schemaDescription,
						prompt: input.prompt,
						system: input.system,
						messages: input.messages,
						maxTokens: options.maxTokens,
						temperature: options.temperature,
					});

					// The output is in result.object
					const formatted = formatObjectResult(result, options.includeRequestBody);

					// // Optionally validate final object
					// const validateFinal = ajv.compile(parsedSchema);
					// if (!validateFinal(result.object)) {
					// 	throw new NodeOperationError(
					// 		this.getNode(),
					// 		`The generated object doesn't match the schema: ${ajv.errorsText(validateFinal.errors)}`,
					// 	);
					// }

					// @ts-expect-error
					returnData.push({ json: formatted });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message } });
				} else {
					throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
				}
			}
		}

		// 4) Return final data
		return [returnData];
	}
}
