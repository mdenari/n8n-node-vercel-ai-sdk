import {
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	NodeConnectionType,
	NodeOperationError, type ILoadOptionsFunctions,
	type INodePropertyOptions
} from 'n8n-workflow';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { CoreTool, generateText, GenerateTextResult } from 'ai';
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
				description: 'The input prompt to generate the text from.',
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
				description: 'The system prompt to use that specifies the behavior of the model.',
				hint: 'The system prompt to use that specifies the behavior of the model.',
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
						messageAsJson: [false],
					},
				},
				description: 'The messages for the conversation',
				default: {
					messagesUi: [
						{
							role: 'system',
							contentType: 'text',
							content: 'You are a helpful assistant.',
						},
						{
							role: 'user',
							contentType: 'text',
							content: 'How can you help me?',
						}
					]
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
				displayName: 'Messages as JSON',
				name: 'messageAsJson',
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
						messageAsJson: [true],
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

		const credentials = await this.getCredentials('googleGenerativeAIApi');
		if (!credentials?.apiKey) {
			throw new NodeOperationError(this.getNode(), 'No API key provided in credentials');
		}

		const googleProvider = createGoogleGenerativeAI({
			apiKey: credentials.apiKey as string,
			baseURL: 'https://generativelanguage.googleapis.com/v1beta',
			headers: {
				'x-goog-api-key': credentials.apiKey as string,
			}
		});

		for (let i = 0; i < items.length; i++) {
			// Config
			const parsedOperation = z.enum(['generateText', 'generateObject']).safeParse(this.getNodeParameter('operation', i));
			if (!parsedOperation.success) {
				throw new NodeOperationError(this.getNode(), parsedOperation.error.message);
			}

			const parsedInputType = z.enum(['prompt', 'messages']).safeParse(this.getNodeParameter('inputType', i));
			if (!parsedInputType.success) {
				throw new NodeOperationError(this.getNode(), parsedInputType.error.message);
			}

			const parsedModel = z.string().safeParse(this.getNodeParameter('model', i));
			if (!parsedModel.success) {
				throw new NodeOperationError(this.getNode(), parsedModel.error.message);
			}

			const parsedOptions = z.object({
				maxTokens: z.number().optional(),
				temperature: z.number().optional(),
				includeRequestBody: z.boolean().optional(),
			}).safeParse(this.getNodeParameter('options', i, {}));


			if (!parsedOptions.success) {
				throw new NodeOperationError(this.getNode(), parsedOptions.error.message);
			}

			const parsedSafetySettings = z.array(z.object({
				category: z.enum(['HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_DANGEROUS_CONTENT', 'HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_UNSPECIFIED', 'HARM_CATEGORY_CIVIC_INTEGRITY']).optional(),
				threshold: z.enum(['BLOCK_LOW_AND_ABOVE', 'BLOCK_MEDIUM_AND_ABOVE', 'BLOCK_ONLY_HIGH', 'BLOCK_NONE', 'HARM_BLOCK_THRESHOLD_UNSPECIFIED']).optional(),
			})).safeParse(this.getNodeParameter('safetySettings.settings', i, []));

			if (!parsedSafetySettings.success) {
				throw new NodeOperationError(this.getNode(), parsedSafetySettings.error.message);
			}

			const useSearchGrounding = z.boolean().safeParse(this.getNodeParameter('useSearchGrounding', i, false));
			if (!useSearchGrounding.success) {
				throw new NodeOperationError(this.getNode(), useSearchGrounding.error.message);
			}

			const extractResponse = (result: GenerateTextResult<Record<string, CoreTool<any, any>>, never>) => {
				return {
					json: {
						// Main output
						text: result.text,

						// Tool-related information
						toolCalls: result.toolCalls || [],
						toolResults: result.toolResults || [],

						// Completion information
						finishReason: result.finishReason,

						// Token usage
						usage: {
							promptTokens: result.usage?.promptTokens,
							completionTokens: result.usage?.completionTokens,
							totalTokens: result.usage?.totalTokens,
						},

						// Request/Response metadata
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

						// Steps
						steps: result.steps || [],

						// Warnings
						warnings: result.warnings || [],

						// Provider-specific metadata
						experimental_providerMetadata: result.experimental_providerMetadata,
					},
				};
			}

			if (parsedOperation.data === 'generateText' && parsedInputType.data === 'prompt') {
				const parsedPrompt = z.string().safeParse(this.getNodeParameter('prompt', i));
				if (!parsedPrompt.success) {
					throw new NodeOperationError(this.getNode(), parsedPrompt.error.message);
				}

				const parsedSystem = z.string().safeParse(this.getNodeParameter('system', i));
				if (!parsedSystem.success) {
					throw new NodeOperationError(this.getNode(), parsedSystem.error.message);
				}

				const result = await generateText({
					model: googleProvider(parsedModel.data, {
						...(parsedSafetySettings.data.length > 0 ? {
							safetySettings: parsedSafetySettings.data.map(setting => ({
								category: setting.category!,
								threshold: setting.threshold!
							}))
						} : {}),
						useSearchGrounding: useSearchGrounding.data,
					}),
					prompt: parsedPrompt.data,
					system: parsedSystem.data,
					maxTokens: parsedOptions.data.maxTokens,
					temperature: parsedOptions.data.temperature,

				});

				returnData.push(extractResponse(result));
			}
		}

		return [returnData];
	}
} 