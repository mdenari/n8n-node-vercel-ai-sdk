import {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
    NodeOperationError, IDataObject
} from 'n8n-workflow';

import { createDeepSeek } from '@ai-sdk/deepseek';
import {
    CoreAssistantMessage,
    CoreSystemMessage,
    CoreUserMessage,
    generateObject,
    GenerateObjectResult,
    generateText,
    GenerateTextResult,
    jsonSchema,
} from 'ai';

import { z } from 'zod';
import Ajv from 'ajv';

type AiSdkMessage = CoreSystemMessage | CoreUserMessage | CoreAssistantMessage;

/**
 * Helper function that builds either a single prompt/system or a messages array
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
                        content: z.string(),
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
            const messagesUi = exec.getNodeParameter('messages.messagesUi', itemIndex, []) as Array<{
                role: string;
                systemContent?: string;
                content?: string;
            }>;

            const messages: AiSdkMessage[] = messagesUi.map((msg) => {
                const role = msg.role as 'system' | 'assistant' | 'user';
                return {
                    role,
                    content: role === 'system' ? msg.systemContent || '' : msg.content || '',
                };
            });

            return { messages };
        }
    }
}

/**
 * Helper function to build a consistent JSON for n8n from a GenerateTextResult
 */
function formatTextResult(
    result: GenerateTextResult<Record<string, never>, never>,
    includeRequestBody: boolean | undefined,
): IDataObject {
    const out: IDataObject = {
        text: result.text,
        finishReason: result.finishReason,
        usage: {
            promptTokens: result.usage?.promptTokens,
            completionTokens: result.usage?.completionTokens,
            totalTokens: result.usage?.totalTokens,
        } as IDataObject,
        response: {
            id: result.response?.id,
            modelId: result.response?.modelId,
            timestamp: result.response?.timestamp,
            headers: result.response?.headers,
        } as IDataObject,
        warnings: result.warnings || [],
    };

    if (includeRequestBody) {
        out.request = { body: result.request?.body } as IDataObject;
    }

    return out;
}

function formatObjectResult(
    result: GenerateObjectResult<unknown>,
    includeRequestBody: boolean | undefined,
): IDataObject {
    const out: IDataObject = {
        object: result.object as IDataObject,
        finishReason: result.finishReason,
        usage: {
            promptTokens: result.usage?.promptTokens,
            completionTokens: result.usage?.completionTokens,
            totalTokens: result.usage?.totalTokens,
        } as IDataObject,
        response: {
            id: result.response?.id,
            modelId: result.response?.modelId,
            timestamp: result.response?.timestamp,
            headers: result.response?.headers,
        } as IDataObject,
        warnings: result.warnings || [],
    };

    if (includeRequestBody) {
        out.request = { body: result.request?.body } as IDataObject;
    }

    return out;
}

export class DeepSeek implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'DeepSeek',
        name: 'deepSeek',
        icon: 'file:deepseek.svg',
        group: ['transform'],
        version: 1,
        subtitle: '={{$parameter["operation"] + ": " + $parameter["model"]}}',
        description: 'Use DeepSeek models via Vercel AI SDK',
        defaults: {
            name: 'DeepSeek',
        },
        inputs: ['main'],
        outputs: ['main'],
        credentials: [
            {
                name: 'deepSeekApi',
                required: true,
            },
        ],
        properties: [
            {
                displayName: 'Model',
                name: 'model',
                type: 'options',
                required: true,
                options: [
                    {
                        name: 'DeepSeek Chat',
                        value: 'deepseek-chat',
                        description: 'Chat model optimized for conversations and structured outputs',
                    },
                    {
                        name: 'DeepSeek Reasoner',
                        value: 'deepseek-reasoner',
                        description: 'Model optimized for reasoning and problem-solving',
                    },
                ],
                default: 'deepseek-chat',
                description: 'Select which DeepSeek model to use',
            },
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
                displayOptions: {
                    show: {
                        model: ['deepseek-chat'],
                    },
                },
                default: 'generateText',
                description: 'Which type of output you want to generate',
            },
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
                ],
                displayOptions: {
                    show: {
                        model: ['deepseek-reasoner'],
                    },
                },
                default: 'generateText',
                description: 'Which type of output you want to generate',
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
                description: 'System prompt that specifies the model\'s behavior',
                hint: 'This field is optional, but can help guide the model\'s responses.',
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
                            {
                                displayName: 'Content',
                                name: 'content',
                                type: 'string',
                                typeOptions: {
                                    rows: 4,
                                },
                                displayOptions: {
                                    show: {
                                        role: ['assistant', 'user'],
                                    },
                                },
                                default: '',
                                description: 'The text content of the message',
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
                        model: ['deepseek-chat'],
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
                        model: ['deepseek-chat'],
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
                        model: ['deepseek-chat'],
                    },
                },
                default: `{\n\t"type": "object",\n\t"properties": {\n\t\t"sentiment": {\n\t\t"type": "string",\n\t\t"enum": ["positive","negative","neutral"],\n\t\t"description": "The overall sentiment of the text"\n\t\t},\n\t\t"score": {\n\t\t"type": "number",\n\t\t"minimum": -1,\n\t\t"maximum": 1,\n\t\t"description": "Sentiment score from -1 (negative) to 1 (positive)"\n\t\t},\n\t\t"text": {\n\t\t"type": "string",\n\t\t"description": "The text content to analyze"\n\t\t}\n\t}\n}`,
                required: true,
                description: 'JSON schema describing the structure and constraints of the object to generate',
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
        ],
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const returnData: INodeExecutionData[] = [];

        // 1) Validate credentials
        const credentials = await this.getCredentials('deepSeekApi');
        if (!credentials?.apiKey) {
            throw new NodeOperationError(this.getNode(), 'No API key provided in credentials');
        }

        // 2) Create the DeepSeek provider
        const deepSeekProvider = createDeepSeek({
            apiKey: credentials.apiKey as string,
        });

        // 3) Process each input item
        for (let i = 0; i < items.length; i++) {
            try {
                // Basic parameters
                const model = this.getNodeParameter('model', i) as 'deepseek-chat' | 'deepseek-reasoner';
                const operation = this.getNodeParameter('operation', i) as 'generateText' | 'generateObject';
                const options = this.getNodeParameter('options', i, {}) as {
                    maxTokens?: number;
                    temperature?: number;
                    includeRequestBody?: boolean;
                };

                // Build input (prompt or messages)
                const input = await buildInput(this, i);

                // Branch on operation
                if (operation === 'generateText') {
                    //  ~~~~~~~~~~~~~
                    //  Generate Text
                    //  ~~~~~~~~~~~~~

                    const result = await generateText({
                        model: deepSeekProvider(model),
                        messages: input.messages,
                        maxTokens: options.maxTokens,
                        temperature: options.temperature,
                        prompt: input.prompt,
                        system: input.system,
                    });

                    // Format output
                    const formatted = formatTextResult(result, options.includeRequestBody);
                    returnData.push({ json: formatted });
                } else if (operation === 'generateObject' && model === 'deepseek-chat') {
                    //  ~~~~~~~~~~~~~
                    //  Generate Object (only for deepseek-chat)
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
                        model: deepSeekProvider(model),
                        schema: jsonSchema(parsedSchema),
                        schemaName,
                        schemaDescription,
                        prompt: input.prompt,
                        system: input.system,
                        messages: input.messages,
                        maxTokens: options.maxTokens,
                        temperature: options.temperature,
                    });

                    // Format output
                    const formatted = formatObjectResult(result, options.includeRequestBody);
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