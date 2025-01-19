import {
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	NodeConnectionType,
	NodeOperationError,
	type IDataObject,
} from 'n8n-workflow';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';
import type { GoogleGenerativeAIProviderMetadata } from '@ai-sdk/google';

type Role = 'system' | 'user' | 'assistant';

interface ChatMessage {
	role: Role;
	content: string;
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
				],
				default: 'complete',
			},
			{
				displayName: 'Model',
				name: 'model',
				type: 'options',
				options: [
					{
						name: 'Gemini 1.5 Pro',
						value: 'gemini-1.5-pro-latest',
					},
					{
						name: 'Gemini 1.5 Pro Vision',
						value: 'gemini-1.5-pro-vision-latest',
					},
					{
						name: 'Gemini 1.5 Flash',
						value: 'gemini-1.5-flash-latest',
					},
				],
				default: 'gemini-1.5-pro-latest',
				description: 'The Google Generative AI model to use',
			},
			{
				displayName: 'Prompt',
				name: 'prompt',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: '',
				displayOptions: {
					show: {
						operation: ['complete'],
					},
				},
				description: 'The prompt to generate completion for',
				required: true,
			},
			{
				displayName: 'Messages',
				name: 'messages',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
					sortable: true,
				},
				displayOptions: {
					show: {
						operation: ['chat'],
					},
				},
				description: 'The messages for the conversation',
				default: {},
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
								displayName: 'Content',
								name: 'content',
								type: 'string',
								typeOptions: {
									rows: 4,
								},
								default: '',
							},
						],
					},
				],
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
					const messages: ChatMessage[] = [{ role: 'user', content: prompt }];

					const result = await generateText({
						model: googleProvider(model, {
							safetySettings: safetySettings,
							useSearchGrounding: useSearchGrounding,
						}),
						messages,
						maxTokens: options.maxTokens,
						temperature: options.temperature,
					});

					response = { text: result.text };

					// Add metadata if using search grounding
					if (useSearchGrounding) {
						const metadata = (await result.experimental_providerMetadata)?.google as GoogleGenerativeAIProviderMetadata | undefined;
						if (metadata) {
							response.groundingMetadata = metadata.groundingMetadata;
							response.safetyRatings = metadata.safetyRatings;
						}
					}
				} else if (operation === 'chat') {
					const messagesUi = this.getNodeParameter('messages.messagesUi', i, []) as Array<{
						role: string;
						content: string;
					}>;

					const messages: ChatMessage[] = messagesUi.map(msg => ({
						role: msg.role as Role,
						content: msg.content,
					}));

					const result = await generateText({
						model: googleProvider(model, {
							safetySettings: safetySettings,
							useSearchGrounding: useSearchGrounding,
						}),
						messages,
						maxTokens: options.maxTokens,
						temperature: options.temperature,
					});

					response = { text: result.text };

					// Add metadata if using search grounding
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