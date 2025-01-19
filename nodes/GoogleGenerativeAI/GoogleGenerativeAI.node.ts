import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeConnectionType,
	NodeOperationError,
	ILoadOptionsFunctions,
	INodePropertyOptions,
} from 'n8n-workflow';

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import {
	CoreAssistantMessage,
	CoreSystemMessage,
	CoreTool,
	CoreToolMessage,
	CoreUserMessage,
	generateText,
	GenerateTextResult,
} from 'ai';

import { z } from 'zod';

export class GoogleGenerativeAI implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Google Generative AI',
		name: 'googleGenerativeAI',
		icon: 'file:icons/GoogleGenerativeAI.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["model"]}}',
		description: 'Use Google Generative AI models via Vercel AI SDK',
		defaults: {
			name: 'Google Generative AI',
		},
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
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
				description: 'Which type of output you want to generate.',
			},
			{
				displayName: 'Model',
				name: 'model',
				type: 'options',
				required: true,
				typeOptions: {
					loadOptionsMethod: 'getModels',
				},
				default: 'gemini-2.0-flash-exp',
				description: 'Select which Google Generative AI model to use.',
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
				description: 'Choose how you want to provide input to the model.',
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
				description: 'System prompt that specifies the model’s behavior.',
				hint: 'This field is optional, but can help guide the model’s responses.',
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
				description: 'The single text prompt to generate a completion for.',
				hint: 'You can drag data from previous nodes here using expressions.',
				requiresDataPath: 'single',
			},
			{
				displayName: 'Schema Name',
				name: 'schemaName',
				type: 'string',
				default: '',
				description: 'Name of the output schema (optional).',
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
				description: 'Description of the output schema (optional).',
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
				default: `{
  "type": "object",
  "properties": {
    "sentiment": {
      "type": "string",
      "enum": ["positive","negative","neutral"],
      "description": "The overall sentiment of the text"
    },
    "score": {
      "type": "number",
      "minimum": -1,
      "maximum": 1,
      "description": "Sentiment score from -1 (negative) to 1 (positive)"
    },
    "text": {
      "type": "string",
      "description": "The text content to analyze"
    }
  }
}`,
				required: true,
				description: 'JSON schema describing the structure and constraints of the object to generate.',
				hint: 'For example, a schema describing sentiment analysis output.',
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
				description: 'The messages for the conversation.',
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
										name: 'Octet Stream (Default)',
										value: 'application/octet-stream',
									},
									{
										name: 'PDF (application/pdf)',
										value: 'application/pdf',
									},
									{
										name: 'Plain Text (text/plain)',
										value: 'text/plain',
									},
									{
										name: 'JPEG Image (image/jpeg)',
										value: 'image/jpeg',
									},
									{
										name: 'PNG Image (image/png)',
										value: 'image/png',
									},
									{
										name: 'JSON (application/json)',
										value: 'application/json',
									},
									{
										name: 'MP3 Audio (audio/mpeg)',
										value: 'audio/mpeg',
									},
									{
										name: 'WAV Audio (audio/wav)',
										value: 'audio/wav',
									},
									{
										name: 'MP4 Video (video/mp4)',
										value: 'video/mp4',
									},
									{
										name: 'Other (Specify Below)',
										value: 'other',
									},
								],
								displayOptions: {
									show: {
										role: ['assistant', 'user'],
										contentType: ['file'],
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
				description: 'Toggle to provide the entire message array as a JSON string.',
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
				description: 'Enter an array of message objects in JSON format (role, content).',
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
						description: 'The maximum number of tokens to generate.',
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
						description: 'Higher values produce more random outputs.',
					},
					{
						displayName: 'Include Request Body',
						name: 'includeRequestBody',
						type: 'boolean',
						default: false,
						description:
							'Whether to include the full request body in the response. Warning: can be large if files are included.',
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
									{
										name: 'Hate Speech',
										value: 'HARM_CATEGORY_HATE_SPEECH',
									},
									{
										name: 'Dangerous Content',
										value: 'HARM_CATEGORY_DANGEROUS_CONTENT',
									},
									{
										name: 'Harassment',
										value: 'HARM_CATEGORY_HARASSMENT',
									},
									{
										name: 'Sexually Explicit',
										value: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
									},
								],
								default: 'HARM_CATEGORY_HATE_SPEECH',
							},
							{
								displayName: 'Threshold',
								name: 'threshold',
								type: 'options',
								options: [
									{
										name: 'Block Low and Above',
										value: 'BLOCK_LOW_AND_ABOVE',
									},
									{
										name: 'Block Medium and Above',
										value: 'BLOCK_MEDIUM_AND_ABOVE',
									},
									{
										name: 'Block Only High',
										value: 'BLOCK_ONLY_HIGH',
									},
									{
										name: 'Block None',
										value: 'BLOCK_NONE',
									},
								],
								default: 'BLOCK_MEDIUM_AND_ABOVE',
							},
						],
					},
				],
				description: 'Set safety categories and thresholds to block or filter certain outputs.',
			},
			{
				displayName: 'Use Search Grounding',
				name: 'useSearchGrounding',
				type: 'boolean',
				default: false,
				description: 'Enable for real-time or up-to-date information if supported by the model.',
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

					returnData.sort((a, b) => a.name.localeCompare(b.name));
					return returnData;
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

		const credentials = await this.getCredentials('googleGenerativeAIApi');
		if (!credentials?.apiKey) {
			throw new NodeOperationError(this.getNode(), 'No API key provided in credentials');
		}

		const googleProvider = createGoogleGenerativeAI({
			apiKey: credentials.apiKey as string,
			baseURL: 'https://generativelanguage.googleapis.com/v1beta',
			headers: {
				'x-goog-api-key': credentials.apiKey as string,
			},
		});

		for (let i = 0; i < items.length; i++) {
			const parsedOperation = z
				.enum(['generateText', 'generateObject'])
				.safeParse(this.getNodeParameter('operation', i));
			if (!parsedOperation.success) {
				throw new NodeOperationError(this.getNode(), parsedOperation.error.message);
			}

			const parsedInputType = z
				.enum(['prompt', 'messages'])
				.safeParse(this.getNodeParameter('inputType', i));
			if (!parsedInputType.success) {
				throw new NodeOperationError(this.getNode(), parsedInputType.error.message);
			}

			const parsedModel = z.string().safeParse(this.getNodeParameter('model', i));
			if (!parsedModel.success) {
				throw new NodeOperationError(this.getNode(), parsedModel.error.message);
			}

			const parsedOptions = z
				.object({
					maxTokens: z.number().optional(),
					temperature: z.number().optional(),
					includeRequestBody: z.boolean().optional(),
				})
				.safeParse(this.getNodeParameter('options', i, {}));
			if (!parsedOptions.success) {
				throw new NodeOperationError(this.getNode(), parsedOptions.error.message);
			}

			const parsedSafetySettings = z
				.array(
					z.object({
						category: z
							.enum([
								'HARM_CATEGORY_HATE_SPEECH',
								'HARM_CATEGORY_DANGEROUS_CONTENT',
								'HARM_CATEGORY_HARASSMENT',
								'HARM_CATEGORY_SEXUALLY_EXPLICIT',
								'HARM_CATEGORY_UNSPECIFIED',
								'HARM_CATEGORY_CIVIC_INTEGRITY',
							])
							.optional(),
						threshold: z
							.enum([
								'BLOCK_LOW_AND_ABOVE',
								'BLOCK_MEDIUM_AND_ABOVE',
								'BLOCK_ONLY_HIGH',
								'BLOCK_NONE',
								'HARM_BLOCK_THRESHOLD_UNSPECIFIED',
							])
							.optional(),
					}),
				)
				.safeParse(this.getNodeParameter('safetySettings.settings', i, []));
			if (!parsedSafetySettings.success) {
				throw new NodeOperationError(this.getNode(), parsedSafetySettings.error.message);
			}

			const useSearchGrounding = z
				.boolean()
				.safeParse(this.getNodeParameter('useSearchGrounding', i, false));
			if (!useSearchGrounding.success) {
				throw new NodeOperationError(this.getNode(), useSearchGrounding.error.message);
			}

			/**
			 * Helper function to wrap the result in n8n’s data structure.
			 */
			const extractResponse = (
				result: GenerateTextResult<Record<string, CoreTool<any, any>>, never>,
			) => {
				return {
					json: {
						text: result.text,
						toolCalls: result.toolCalls || [],
						toolResults: result.toolResults || [],
						finishReason: result.finishReason,
						usage: {
							promptTokens: result.usage?.promptTokens,
							completionTokens: result.usage?.completionTokens,
							totalTokens: result.usage?.totalTokens,
						},
						...(parsedOptions.data.includeRequestBody && {
							request: {
								body: result.request?.body,
							},
						}),
						response: {
							id: result.response?.id,
							modelId: result.response?.modelId,
							timestamp: result.response?.timestamp,
							headers: result.response?.headers,
						},
						steps: result.steps || [],
						warnings: result.warnings || [],
						experimental_providerMetadata: result.experimental_providerMetadata,
					},
				};
			};

			/**
			 * Handle "Generate Text"
			 */
			if (parsedOperation.data === 'generateText') {
				if (parsedInputType.data === 'prompt') {
					const promptVal = this.getNodeParameter('prompt', i) as string;
					const systemVal = this.getNodeParameter('system', i) as string;

					const parsedPrompt = z.string().safeParse(promptVal);
					if (!parsedPrompt.success) {
						throw new NodeOperationError(this.getNode(), parsedPrompt.error.message);
					}
					const parsedSystem = z.string().safeParse(systemVal);
					if (!parsedSystem.success) {
						throw new NodeOperationError(this.getNode(), parsedSystem.error.message);
					}

					const result = await generateText({
						model: googleProvider(parsedModel.data, {
							...(parsedSafetySettings.data.length > 0
								? {
									safetySettings: parsedSafetySettings.data.map((setting) => ({
										category: setting.category!,
										threshold: setting.threshold!,
									})),
								}
								: {}),
							useSearchGrounding: useSearchGrounding.data,
						}),
						prompt: parsedPrompt.data,
						system: parsedSystem.data,
						maxTokens: parsedOptions.data.maxTokens,
						temperature: parsedOptions.data.temperature,
					});

					returnData.push(extractResponse(result));
				} else if (parsedInputType.data === 'messages') {
					let messages: Array<
						CoreSystemMessage | CoreUserMessage | CoreAssistantMessage | CoreToolMessage
					> | undefined = undefined;

					const parsedMessageAsJson = z
						.boolean()
						.safeParse(this.getNodeParameter('messageAsJson', i, false));
					if (!parsedMessageAsJson.success) {
						throw new NodeOperationError(this.getNode(), parsedMessageAsJson.error.message);
					}

					if (parsedMessageAsJson.data) {
						// If user opted to provide raw JSON
						const messagesJsonParam = this.getNodeParameter('messagesJson', i) as string;
						let parsedJson: unknown;
						try {
							parsedJson = JSON.parse(messagesJsonParam?.toString() || '[]');
						} catch (error) {
							throw new NodeOperationError(
								this.getNode(),
								'Invalid JSON in Messages (JSON) field',
							);
						}

						const parsedMessagesJson = z
							.array(
								z.object({
									role: z.enum(['system', 'user', 'assistant']),
									content: z.any(),
								}),
							)
							.safeParse(parsedJson);
						if (!parsedMessagesJson.success) {
							throw new NodeOperationError(
								this.getNode(),
								'Invalid message format in Messages (JSON) field. Must be an array of objects with role and content.',
							);
						}

						messages = parsedMessagesJson.data.map((m) => ({
							role: m.role,
							content: m.content,
						}));
					} else {
						// Parse from the UI-based collection
						const messagesUi = this.getNodeParameter('messages.messagesUi', i, []) as Array<{
							role: string;
							systemContent?: string;
							contentType?: 'text' | 'file';
							fileDataSource?: 'binary' | 'url';
							fileContent?: string;
							fileUrl?: string;
							mimeType?: string; // Could be 'other' or a known type
							mimeTypeOther?: string; // If user picks 'other'
							content?: string;
						}>;

						messages = messagesUi.map((m) => {
							const role = m.role as 'system' | 'assistant' | 'user';

							// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
							// SYSTEM MESSAGES
							// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
							if (role === 'system') {
								return {
									role,
									content: m.systemContent || '',
								};
							}

							// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
							// USER / ASSISTANT MESSAGES
							// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
							if (m.contentType === 'text') {
								// single text part
								return {
									role,
									content: m.content || '',
								};
							} else {
								// contentType === 'file'
								// We'll build an array of parts: optional text part + a file part
								const parts: Array<Record<string, any>> = [];

								if (m.content) {
									// Additional text
									parts.push({
										type: 'text',
										text: m.content,
									});
								}

								// Determine final MIME type from the dropdown or "Other"
								let selectedMimeType = m.mimeType || 'application/octet-stream';
								if (selectedMimeType === 'other' && m.mimeTypeOther) {
									selectedMimeType = m.mimeTypeOther;
								}

								if (m.fileDataSource === 'url') {
									// If user wants to use a URL
									parts.push({
										type: 'file',
										data: m.fileUrl, // The AI SDK will fetch if this is an http(s) string
										mimeType: selectedMimeType,
									});
								} else {
									// fileDataSource === 'binary'
									const binaryPropertyName = m.fileContent || 'data';
									const itemBinary = items[i].binary;
									if (!itemBinary || !itemBinary[binaryPropertyName]) {
										throw new NodeOperationError(
											this.getNode(),
											`Binary property "${binaryPropertyName}" not found on item index ${i}`,
										);
									}
									// Convert base64 string to Buffer
									const binaryData = itemBinary[binaryPropertyName];
									const buffer = Buffer.from(
										binaryData.data,
										binaryData.data ? 'base64' : undefined,
									);

									// If user had not picked a known MIME type, or "Default", we fallback:
									if (
										selectedMimeType === 'application/octet-stream' &&
										binaryData.mimeType
									) {
										selectedMimeType = binaryData.mimeType;
									}

									parts.push({
										type: 'file',
										data: buffer,
										mimeType: selectedMimeType,
									});
								}

								return {
									role,
									content: parts,
								};
							}
						});
					}

					const result = await generateText({
						model: googleProvider(parsedModel.data, {
							...(parsedSafetySettings.data.length > 0
								? {
									safetySettings: parsedSafetySettings.data.map((setting) => ({
										category: setting.category!,
										threshold: setting.threshold!,
									})),
								}
								: {}),
							useSearchGrounding: useSearchGrounding.data,
						}),
						messages,
						maxTokens: parsedOptions.data.maxTokens,
						temperature: parsedOptions.data.temperature,
					});

					returnData.push(extractResponse(result));
				}
			}

			/**
			 * Handle "Generate Object"
			 * (You could parse the schema and call generateText similarly)
			 */
			if (parsedOperation.data === 'generateObject') {
				throw new NodeOperationError(
					this.getNode(),
					'Generate Object is not yet implemented in this example.',
				);
			}
		}

		return [returnData];
	}
}