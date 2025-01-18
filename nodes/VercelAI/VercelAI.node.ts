import {
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	NodeConnectionType,
	NodeOperationError,
	type IDataObject,
} from 'n8n-workflow';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { streamText } from 'ai';

type Role = 'system' | 'user' | 'assistant';

interface ChatMessage {
	role: Role;
	content: string;
}

export class VercelAI implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Vercel AI',
		name: 'vercelAi',
		icon: 'file:vercel.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["model"]}}',
		description: 'Use Vercel AI SDK',
		defaults: {
			name: 'Vercel AI',
		},
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
		credentials: [
			{
				name: 'openAiApi',
				required: false,
				displayOptions: {
					show: {
						provider: ['openai'],
					},
				},
			},
			{
				name: 'anthropicApi',
				required: false,
				displayOptions: {
					show: {
						provider: ['anthropic'],
					},
				},
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
				displayName: 'Provider',
				name: 'provider',
				type: 'options',
				options: [
					{
						name: 'OpenAI',
						value: 'openai',
					},
					{
						name: 'Anthropic',
						value: 'anthropic',
					},
				],
				default: 'openai',
				description: 'The AI provider to use',
			},
			{
				displayName: 'Model',
				name: 'model',
				type: 'options',
				displayOptions: {
					show: {
						provider: ['openai'],
					},
				},
				options: [
					{
						name: 'GPT-4',
						value: 'gpt-4',
					},
					{
						name: 'GPT-3.5 Turbo',
						value: 'gpt-3.5-turbo',
					},
				],
				default: 'gpt-3.5-turbo',
				description: 'The OpenAI model to use',
			},
			{
				displayName: 'Model',
				name: 'model',
				type: 'options',
				displayOptions: {
					show: {
						provider: ['anthropic'],
					},
				},
				options: [
					{
						name: 'Claude 3 Opus',
						value: 'claude-3-opus-20240229',
					},
					{
						name: 'Claude 3 Sonnet',
						value: 'claude-3-sonnet-20240229',
					},
					{
						name: 'Claude 3 Haiku',
						value: 'claude-3-haiku-20240307',
					},
				],
				default: 'claude-3-opus-20240229',
				description: 'The Anthropic model to use',
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
					{
						displayName: 'Stream',
						name: 'stream',
						type: 'boolean',
						default: false,
						description: 'Whether to stream the response',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;
				const provider = this.getNodeParameter('provider', i) as string;
				const model = this.getNodeParameter('model', i) as string;
				const options = this.getNodeParameter('options', i, {}) as {
					maxTokens?: number;
					temperature?: number;
					stream?: boolean;
				};

				let response: IDataObject = {};

				// Initialize the provider with credentials
				let aiProvider;
				if (provider === 'openai') {
					const credentials = await this.getCredentials('openAiApi');
					const openAiProvider = createOpenAI({
						apiKey: credentials.apiKey as string,
					});
					aiProvider = openAiProvider;
				} else {
					const credentials = await this.getCredentials('anthropicApi');
					const anthropicProvider = createAnthropic({
						apiKey: credentials.apiKey as string,
					});
					aiProvider = anthropicProvider;
				}

				if (operation === 'complete') {
					const prompt = this.getNodeParameter('prompt', i) as string;
					const messages: ChatMessage[] = [{ role: 'user', content: prompt }];

					const result = await streamText({
						model: aiProvider(model),
						messages,
						maxTokens: options.maxTokens,
						temperature: options.temperature,
					});

					let text = '';
					for await (const chunk of result.textStream) {
						text += chunk;
						if (!options.stream) {
							continue;
						}
						returnData.push({
							json: { text: chunk, complete: false },
						});
					}

					if (!options.stream) {
						response = { text };
					} else {
						response = { text, complete: true };
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

					const result = await streamText({
						model: aiProvider(model),
						messages,
						maxTokens: options.maxTokens,
						temperature: options.temperature,
					});

					let text = '';
					for await (const chunk of result.textStream) {
						text += chunk;
						if (!options.stream) {
							continue;
						}
						returnData.push({
							json: { text: chunk, complete: false },
						});
					}

					if (!options.stream) {
						response = { text };
					} else {
						response = { text, complete: true };
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