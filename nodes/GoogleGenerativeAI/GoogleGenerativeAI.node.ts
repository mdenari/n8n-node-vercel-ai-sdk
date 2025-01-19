import {
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	NodeConnectionType,
	NodeOperationError,
	type IDataObject,
	type ILoadOptionsFunctions,
	type INodePropertyOptions,
} from 'n8n-workflow';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText, generateObject, type Message as AIMessage } from 'ai';
import type { GoogleGenerativeAIProviderMetadata } from '@ai-sdk/google';

type Role = 'system' | 'user' | 'assistant';

interface TextPart {
	type: 'text';
	text: string;
}

interface ImagePart {
	type: 'image';
	image: Buffer | string;
}

interface FilePart {
	type: 'file';
	data: Buffer | string;
	mimeType: string;
}

type ContentPart = TextPart | ImagePart | FilePart;

interface Message {
	id?: string;
	role: Role;
	content: string | ContentPart[];
}

type SafetyCategory =
	| 'HARM_CATEGORY_HATE_SPEECH'
	| 'HARM_CATEGORY_DANGEROUS_CONTENT'
	| 'HARM_CATEGORY_HARASSMENT'
	| 'HARM_CATEGORY_SEXUALLY_EXPLICIT'
	| 'HARM_CATEGORY_UNSPECIFIED'
	| 'HARM_CATEGORY_CIVIC_INTEGRITY';

type SafetyThreshold =
	| 'BLOCK_LOW_AND_ABOVE'
	| 'BLOCK_MEDIUM_AND_ABOVE'
	| 'BLOCK_ONLY_HIGH'
	| 'BLOCK_NONE'
	| 'HARM_BLOCK_THRESHOLD_UNSPECIFIED';

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
				noDataExpression: true,
				options: [
					{
						name: 'Complete',
						value: 'complete',
						description: 'Generate a completion',
						action: 'Generate a completion',
					},
					{
						name: 'Chat',
						value: 'chat',
						description: 'Have a chat conversation',
						action: 'Have a chat conversation',
					},
					{
						name: 'Generate Object',
						value: 'generateObject',
						description: 'Generate a structured object',
						action: 'Generate a structured object',
					},
				],
				default: 'complete',
			},
			{
				displayName: 'Model',
				name: 'model',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getModels',
				},
				default: 'gemini-2.0-flash-exp',
				description: 'The Google Generative AI model to use',
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
						operation: ['complete', 'generateObject'],
					},
				},
				default: '',
				required: true,
				description: 'The prompt to generate completion for',
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
				default: '{}',
				required: true,
				description: 'The JSON schema for the object to generate',
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
						operation: ['chat'],
						jsonParameters: [false],
					},
				},
				description: 'The messages for the conversation',
				default: {},
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
							},
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
										contentType: ['text'],
									},
								},
								default: '',
								description: 'The text content of the message',
							},
							{
								displayName: 'Input Binary Field',
								name: 'fileContent',
								type: 'string',
								displayOptions: {
									show: {
										contentType: ['file'],
									},
								},
								default: 'data',
								description: 'The name of the input binary field containing the file',
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
										contentType: ['file'],
									},
								},
								default: 'Please analyze this file.',
								description: 'Additional text to send with the file',
							},
							{
								displayName: 'Options',
								name: 'fileOptions',
								type: 'collection',
								displayOptions: {
									show: {
										contentType: ['file'],
									},
								},
								default: {},
								options: [
									{
										displayName: 'Force Image Type',
										name: 'forceImageType',
										type: 'boolean',
										default: false,
										description: 'Whether to force treating the file as an image, even if the MIME type does not indicate an image',
									},
									{
										displayName: 'Force File Type',
										name: 'forceFileType',
										type: 'boolean',
										default: false,
										description: 'Whether to force treating the file as a regular file, even if the MIME type indicates an image',
									},
								],
							},
						],
					},
				],
			},
			{
				displayName: 'JSON Parameters',
				name: 'jsonParameters',
				type: 'boolean',
				default: false,
				displayOptions: {
					show: {
						operation: ['chat'],
					},
				},
				description: 'Whether to pass the messages as JSON object',
			},
			{
				displayName: 'Messages (JSON)',
				name: 'messagesJson',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['chat'],
						jsonParameters: [true],
					},
				},
				default: '=[{"role": "user", "content": "Hello!"}]',
				description: 'Messages array as JSON string or expression. Must be an array of objects with role and content properties.',
				required: true,
				typeOptions: {
					rows: 4,
				},
				noDataExpression: false,
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
						},
						default: 0.7,
						description: 'The sampling temperature to use',
					},
					{
						displayName: 'Include Request Body',
						name: 'includeRequestBody',
						type: 'boolean',
						default: false,
						description: 'Whether to include the full request body in the response (can be very large with files)',
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
			},
			{
				displayName: 'Use Search Grounding',
				name: 'useSearchGrounding',
				type: 'boolean',
				default: false,
				description: 'Whether to use search grounding for current information',
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
								const version = modelId.includes('latest') ? '(Latest)' : `(${model.version || 'v1'})`;
								
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
					// If API call fails, return default models
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

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;
				const model = this.getNodeParameter('model', i) as string;
				const options = this.getNodeParameter('options', i, {}) as {
					maxTokens?: number;
					temperature?: number;
					includeRequestBody?: boolean;
				};

				const safetySettings = this.getNodeParameter('safetySettings.settings', i, []) as Array<{
					category: SafetyCategory;
					threshold: SafetyThreshold;
				}>;
				const useSearchGrounding = this.getNodeParameter('useSearchGrounding', i, false) as boolean;

				const credentials = await this.getCredentials('googleGenerativeAIApi');
				const googleProvider = createGoogleGenerativeAI({
					apiKey: credentials.apiKey as string,
					baseURL: 'https://generativelanguage.googleapis.com/v1beta',
					headers: {
						'x-goog-api-key': credentials.apiKey as string,
					},
				});

				let response: IDataObject = {};

				if (operation === 'complete') {
					const prompt = this.getNodeParameter('prompt', i) as string;
					const messages: Message[] = [{ role: 'user', content: prompt, id: `msg_${Date.now()}` }];

					const result = await generateText({
						model: googleProvider(model, {
							safetySettings: safetySettings,
							useSearchGrounding: useSearchGrounding,
						}),
						messages: messages as AIMessage[],
						maxTokens: options.maxTokens,
						temperature: options.temperature,
					});

					response = {
						text: result.text,
						toolCalls: result.toolCalls || [],
						toolResults: result.toolResults || [],
						finishReason: result.finishReason,
						usage: {
							promptTokens: result.usage?.promptTokens,
							completionTokens: result.usage?.completionTokens,
							totalTokens: result.usage?.totalTokens,
						},
						...(options.includeRequestBody && {
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
					};

					if (useSearchGrounding) {
						const metadata = (await result.experimental_providerMetadata)?.google as GoogleGenerativeAIProviderMetadata | undefined;
						if (metadata) {
							response.groundingMetadata = metadata.groundingMetadata;
							response.safetyRatings = metadata.safetyRatings;
						}
					}
				} else if (operation === 'chat') {
					const jsonParameters = this.getNodeParameter('jsonParameters', i) as boolean;
					let messages: Message[];

					if (jsonParameters) {
						const messagesJson = this.getNodeParameter('messagesJson', i) as string;
						const parsedMessages = JSON.parse(messagesJson);
						messages = parsedMessages.map((msg: any) => ({
							...msg,
							id: msg.id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
						}));
					} else {
						const messagesUi = this.getNodeParameter('messages.messagesUi', i, []) as Array<{
							role: string;
							contentType: 'text' | 'file';
							content?: string;
							fileContent?: string;
						}>;

						messages = await Promise.all(messagesUi.map(async (msg) => {
							if (msg.contentType === 'file') {
								const item = items[i];
								if (!msg.fileContent) {
									throw new NodeOperationError(this.getNode(), 'Input binary field not specified');
								}
								if (!item.binary?.[msg.fileContent]) {
									throw new NodeOperationError(this.getNode(), `Binary field "${msg.fileContent}" not found in input`);
								}

								const binaryData = item.binary[msg.fileContent];
								const buffer = await this.helpers.getBinaryDataBuffer(i, msg.fileContent);
								const fileOptions = (msg as any).fileOptions || {};
								
								const isImage = fileOptions.forceImageType || 
									(!fileOptions.forceFileType && binaryData.mimeType.startsWith('image/'));

								const content: ContentPart[] = [
									{
										type: 'text',
										text: msg.content || 'Please analyze this file.',
									},
									isImage
										? {
												type: 'image',
												image: buffer,
										  }
										: {
												type: 'file',
												data: buffer,
												mimeType: binaryData.mimeType,
										  },
								];

								return {
									role: msg.role as Role,
									content,
									id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
								};
							}

							return {
								role: msg.role as Role,
								content: msg.content || '',
								id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
							};
						}));
					}

					const result = await generateText({
						model: googleProvider(model, {
							safetySettings: safetySettings,
							useSearchGrounding: useSearchGrounding,
						}),
						messages: messages as AIMessage[],
						maxTokens: options.maxTokens,
						temperature: options.temperature,
					});

					response = {
						text: result.text,
						toolCalls: result.toolCalls || [],
						toolResults: result.toolResults || [],
						finishReason: result.finishReason,
						usage: {
							promptTokens: result.usage?.promptTokens,
							completionTokens: result.usage?.completionTokens,
							totalTokens: result.usage?.totalTokens,
						},
						...(options.includeRequestBody && {
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
					};

					if (useSearchGrounding) {
						const metadata = (await result.experimental_providerMetadata)?.google as GoogleGenerativeAIProviderMetadata | undefined;
						if (metadata) {
							response.groundingMetadata = metadata.groundingMetadata;
							response.safetyRatings = metadata.safetyRatings;
						}
					}
				} else if (operation === 'generateObject') {
					const prompt = this.getNodeParameter('prompt', i) as string;
					const schema = JSON.parse(this.getNodeParameter('schema', i) as string);

					const result = await generateObject({
						model: googleProvider(model, {
							safetySettings: safetySettings,
							useSearchGrounding: useSearchGrounding,
						}),
						prompt,
						schema,
					});

					response = {
						generatedObject: result.object as IDataObject | IDataObject[] | string | number | boolean | null,
						usage: result.usage,
						finishReason: result.finishReason,
						...(options.includeRequestBody && {
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
						experimental_providerMetadata: result.experimental_providerMetadata,
					};

					if (useSearchGrounding) {
						const metadata = (await result.experimental_providerMetadata)?.google as GoogleGenerativeAIProviderMetadata | undefined;
						if (metadata) {
							response.groundingMetadata = metadata.groundingMetadata;
							response.safetyRatings = metadata.safetyRatings;
						}
					}
				}

				returnData.push({
					json: response,
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: error.message,
						},
					});
					continue;
				}
				throw new NodeOperationError(this.getNode(), error as Error, {
					itemIndex: i,
				});
			}
		}

		return [returnData];
	}
} 