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
import { generateText, generateObject, type Message as AIMessage, jsonSchema } from 'ai';
import type { GoogleGenerativeAIProviderMetadata } from '@ai-sdk/google';
import Ajv from 'ajv';

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
						name: 'Generate Text',
						value: 'generateText',
						description: 'Generate text using simple prompt or chat messages',
						action: 'Generate text using simple prompt or chat messages',
					},
					{
						name: 'Generate Object',
						value: 'generateObject',
						description: 'Generate a structured object',
						action: 'Generate a structured object',
					},
				],
				default: 'generateText',
			},
			{
				displayName: 'Input Type',
				name: 'inputType',
				type: 'options',
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
				description: 'Whether to use a simple prompt or a conversation with multiple messages',
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
				description: 'The prompt to generate completion for',
			},
			{
				displayName: 'Schema Name',
				name: 'schemaName',
				type: 'string',
				default: undefined,
				description: 'Optional name of the output that should be generated. Used by some providers for additional LLM guidance, e.g. via tool or schema name.',
				hint: 'This is used by some providers for additional LLM guidance, e.g. via tool or schema name.',
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
				default: undefined,
				description: 'Optional description of the output that should be generated. Used by some providers for additional LLM guidance, e.g. via tool or schema name. ',
				hint: 'This is used by some providers for additional LLM guidance, e.g. via tool or schema name. ',
				displayOptions: {
					show: {
						operation: ['generateObject'],
					},
				},
				validateType: 'string',
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
				default: `{"type":"object","properties":{"sentiment":{"type":"string","enum":["positive","negative","neutral"],"description":"The overall sentiment of the text"},"score":{"type":"number","minimum":-1,"maximum":1,"description":"Sentiment score from -1 (most negative) to 1 (most positive)"},"text":{"type":"string","description":"The analyzed text content"}}}`,
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
						inputType: ['messages'],
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
						operation: ['generateText', 'generateObject'],
						inputType: ['messages'],
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
						operation: ['generateText', 'generateObject'],
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

				// Add debug logging
				console.log('Operation:', operation);
				console.log('Model:', model);
				console.log('Credentials:', !!this.getCredentials('googleGenerativeAIApi'));

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
				if (!credentials?.apiKey) {
					throw new NodeOperationError(this.getNode(), 'No API key provided in credentials');
				}

				try {
					const googleProvider = createGoogleGenerativeAI({
						apiKey: credentials.apiKey as string,
						baseURL: 'https://generativelanguage.googleapis.com/v1beta',
						headers: {
							'x-goog-api-key': credentials.apiKey as string,
						},
					});

					let response: IDataObject = {};

					if (operation === 'generateText') {
						const inputType = this.getNodeParameter('inputType', i) as string;
						let messages: Message[];

						if (inputType === 'prompt') {
							const prompt = this.getNodeParameter('prompt', i) as string;
							messages = [{ role: 'user', content: prompt, id: `msg_${Date.now()}` }];
						} else {
							const jsonParameters = this.getNodeParameter('jsonParameters', i) as boolean;
							if (jsonParameters) {
								const messagesJson = this.getNodeParameter('messagesJson', i) as string;
								try {
									const parsedMessages = JSON.parse(messagesJson);
									messages = parsedMessages.map((msg: any) => ({
										...msg,
										id: msg.id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
									}));
								} catch (error) {
									throw new NodeOperationError(
										this.getNode(),
										`Failed to parse messages JSON: ${error.message}`,
										{
											description: 'Please ensure the messages JSON is properly formatted',
											itemIndex: i,
										},
									);
								}
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
						}

						console.log({ messages });

						const result = await generateText({
							model: googleProvider(model, {
								safetySettings: safetySettings,
								useSearchGrounding: useSearchGrounding,
							}),
							messages: messages as AIMessage[],
							maxTokens: options.maxTokens,
							temperature: options.temperature,
						}).catch((error: any) => {
							console.error('Generate text error details:', {
								error: error,
								response: error.response?.data,
								status: error.response?.status,
								code: error.code,
							});

							let errorMessage = 'Text generation failed';
							let errorDescription = '';

							if (error.response?.data) {
								const apiError = error.response.data;
								errorMessage = `API Error: ${apiError.error?.message || 'Unknown API error'}`;
								errorDescription = `Status: ${error.response.status}\nDetails: ${JSON.stringify(apiError.error?.details || {}, null, 2)}`;
							} else if (error.code === 'ECONNREFUSED') {
								errorMessage = 'Failed to connect to Google AI API';
								errorDescription = 'Please check your internet connection and try again';
							} else if (error.code === 'ETIMEDOUT') {
								errorMessage = 'Connection to Google AI API timed out';
								errorDescription = 'The request took too long to complete. Please try again';
							} else if (error.message?.includes('api key')) {
								errorMessage = 'Invalid or missing API key';
								errorDescription = 'Please check your API key in the credentials';
							} else {
								errorDescription = error.stack || error.message;
							}

							throw new NodeOperationError(
								this.getNode(),
								errorMessage,
								{
									description: errorDescription,
									itemIndex: i,
								},
							);
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
						const schemaInput = this.getNodeParameter('schema', i) as string;
						const schemaName = this.getNodeParameter('schemaName', i) as string;
						const schemaDescription = this.getNodeParameter('schemaDescription', i) as string;
						let schema;
						try {
							schema = JSON.parse(schemaInput);
							const ajv = new Ajv();

							// First validate that the schema itself is valid
							const validateSchema = ajv.validateSchema(schema);
							if (!validateSchema) {
								throw new NodeOperationError(
									this.getNode(),
									`Invalid JSON Schema: ${ajv.errorsText(ajv.errors)}`,
								);
							}

						} catch (error) {
							if (error instanceof NodeOperationError) {
								throw error;
							}
							throw new NodeOperationError(this.getNode(), `Schema parsing error: ${error.message}`);
						}

						const result = await generateObject({
							model: googleProvider(model, {
								safetySettings: safetySettings,
								useSearchGrounding: useSearchGrounding,
								structuredOutputs: true,
							}),
							prompt,
							schema: jsonSchema(schema),
							schemaName,
							schemaDescription,
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
				} catch (error: any) {
					console.error('Provider initialization error:', error);

					let errorMessage = 'Failed to initialize Google AI provider';
					let errorDescription = '';

					if (error.code === 'ENOTFOUND') {
						errorMessage = 'Could not reach Google AI API';
						errorDescription = 'Please check your internet connection and DNS settings';
					} else if (error.code === 'CERT_HAS_EXPIRED') {
						errorMessage = 'SSL Certificate error';
						errorDescription = 'There was a problem with the SSL certificate. Please check your system certificates';
					} else if (error instanceof NodeOperationError) {
						// Re-throw NodeOperationError as is
						throw error;
					}

					throw new NodeOperationError(
						this.getNode(),
						errorMessage,
						{
							description: errorDescription || error.stack,
							itemIndex: i,
						},
					);
				}
			} catch (error: any) {
				if (this.continueOnFail()) {
					const errorDetails = error instanceof NodeOperationError ?
						{ message: error.message, description: error.description } :
						{ message: error.message, stack: error.stack };

					returnData.push({
						json: {
							error: errorDetails,
							success: false,
						},
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
} 