import {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
    NodeOperationError,
    IDataObject,
    ILoadOptionsFunctions,
    INodePropertyOptions,
} from 'n8n-workflow';

import { createGroq } from '@ai-sdk/groq';
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

            // Validate shape
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
                    'Messages must be an array of objects with { role, content }.',
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
    let text = result.text;
    let reasoning = result.reasoning;

    // Extract reasoning from <think> tags if present
    if (text.includes('<think>')) {
        const thinkMatch = text.match(/<think>(.*?)<\/think>/s);
        if (thinkMatch) {
            reasoning = thinkMatch[1].trim();
            // Remove the <think> section from the text and clean up
            text = text.replace(/<think>.*?<\/think>\s*/s, '').trim();
        }
    }

    const out: IDataObject = {
        text,
        reasoning,
        finishReason: result.finishReason,
        usage: {
            promptTokens: result.usage?.promptTokens,
            completionTokens: result.usage?.completionTokens,
            totalTokens: result.usage?.totalTokens,
            cacheMetrics: {
                promptCacheHitTokens:
                    result.experimental_providerMetadata?.groq?.promptCacheHitTokens,
                promptCacheMissTokens:
                    result.experimental_providerMetadata?.groq?.promptCacheMissTokens,
            },
        },
        response: {
            id: result.response?.id,
            modelId: result.response?.modelId,
            timestamp: result.response?.timestamp,
            headers: result.response?.headers,
        },
        warnings: result.warnings ?? [],
    };

    if (includeRequestBody) {
        out.request = { body: result.request?.body };
    }

    return out;
}

/**
 * Helper function to format GenerateObjectResult for n8n
 */
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
        },
        response: {
            id: result.response?.id,
            modelId: result.response?.modelId,
            timestamp: result.response?.timestamp,
            headers: result.response?.headers,
        },
        warnings: result.warnings ?? [],
    };

    if (includeRequestBody) {
        out.request = { body: result.request?.body };
    }

    return out;
}

export class Groq implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Groq',
        name: 'groq',
        icon: 'file:icons/groq.svg', // Add an SVG in /nodes/Groq/icons/groq.svg if you like
        group: ['transform'],
        version: 1,
        subtitle: '={{$parameter["operation"] + ": " + $parameter["model"]}}',
        description: 'Use Groq models via the AI SDK',
        defaults: {
            name: 'Groq',
        },
        inputs: ['main'],
        outputs: ['main'],
        credentials: [
            {
                name: 'groqApi',
                required: true,
            },
        ],
        properties: [
            {
                displayName: 'Model Name or ID',
                name: 'model',
                type: 'options',
                required: true,
                typeOptions: {
                    loadOptionsMethod: 'getModels',
                },
                default: '',
                description:
                    'Select which Groq model to use. Choose from the list, or specify an ID using an expression.',
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
                default: 'generateText',
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
                            content: 'Hello from n8n!',
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
                default: `{\n\t"type": "object",\n\t"properties": {\n\t\t"sentiment": {\n\t\t"type": "string",\n\t\t"enum": ["positive","negative","neutral"],\n\t\t"description": "The sentiment"\n\t\t},\n\t\t"score": {\n\t\t"type": "number",\n\t\t"description": "Score from -1 to 1"\n\t\t},\n\t\t"text": {\n\t\t"type": "string",\n\t\t"description": "The text content"\n\t\t}\n\t}\n}`,
                required: true,
                description: 'JSON schema describing the structure of the object to generate',
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

    methods = {
        loadOptions: {
            // Dynamically load model list
            async getModels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
                const credentials = await this.getCredentials('groqApi');
                try {
                    const response = await this.helpers.request({
                        method: 'GET',
                        url: 'https://api.groq.com/openai/v1/models',
                        headers: {
                            Authorization: `Bearer ${credentials.apiKey as string}`,
                        },
                        json: true,
                    });

                    // The response is typically an object with a "data" array
                    const returnData: INodePropertyOptions[] = [];

                    if (Array.isArray(response.data)) {
                        for (const model of response.data) {
                            /**
                             * Each model object might have shape:
                             *   { id: "gemma2-9b-it", object: "model", owned_by: "groq", ...}
                             * We'll use `model.id` or fallback to something else
                             */
                            returnData.push({
                                name: model.id,
                                value: model.id,
                                description: `Groq model: ${model.id}`,
                            });
                        }
                    }

                    return returnData.sort((a, b) => a.name.localeCompare(b.name));
                } catch (error) {
                    // Return fallback list if error
                    return [
                        {
                            name: 'gemma2-9b-it',
                            value: 'gemma2-9b-it',
                            description: 'Groq example model (fallback)',
                        },
                        {
                            name: 'llama-3.1-8b-instant',
                            value: 'llama-3.1-8b-instant',
                            description: 'Groq example model (fallback)',
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
        const credentials = await this.getCredentials('groqApi');
        if (!credentials?.apiKey) {
            throw new NodeOperationError(this.getNode(), 'No API key provided in Groq credentials');
        }

        // 2) Create the Groq provider instance
        const groqProvider = createGroq({
            apiKey: credentials.apiKey as string,
        });

        // 3) Process each item
        for (let i = 0; i < items.length; i++) {
            try {
                const model = this.getNodeParameter('model', i) as string;
                const operation = this.getNodeParameter('operation', i) as 'generateText' | 'generateObject';
                const options = this.getNodeParameter('options', i, {}) as {
                    maxTokens?: number;
                    temperature?: number;
                    includeRequestBody?: boolean;
                };

                // Build input (prompt or messages)
                const input = await buildInput(this, i);

                if (operation === 'generateText') {
                    /**
                     * Generate Text
                     */
                    const result = await generateText({
                        model: groqProvider(model),
                        messages: input.messages,
                        maxTokens: options.maxTokens,
                        temperature: options.temperature,
                        prompt: input.prompt,
                        system: input.system,
                    });

                    const formatted = formatTextResult(result, options.includeRequestBody);
                    returnData.push({ json: formatted });
                } else {
                    /**
                     * Generate Object
                     */
                    const schemaName = this.getNodeParameter('schemaName', i, '') as string;
                    const schemaDescription = this.getNodeParameter('schemaDescription', i, '') as string;
                    const rawSchema = this.getNodeParameter('schema', i) as string;

                    let parsedSchema: any;
                    try {
                        parsedSchema = JSON.parse(rawSchema);
                    } catch (err) {
                        throw new NodeOperationError(
                            this.getNode(),
                            `Schema is not valid JSON: ${(err as Error).message}`,
                        );
                    }

                    // Validate with Ajv
                    const ajv = new Ajv();
                    if (!ajv.validateSchema(parsedSchema)) {
                        throw new NodeOperationError(
                            this.getNode(),
                            `Invalid JSON Schema: ${ajv.errorsText(ajv.errors)}`,
                        );
                    }

                    const result = await generateObject({
                        model: groqProvider(model),
                        schema: jsonSchema(parsedSchema),
                        schemaName,
                        schemaDescription,
                        prompt: input.prompt,
                        system: input.system,
                        messages: input.messages,
                        maxTokens: options.maxTokens,
                        temperature: options.temperature,
                    });

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