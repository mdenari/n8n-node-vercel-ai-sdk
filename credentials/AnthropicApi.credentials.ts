import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export default class AnthropicApi implements ICredentialType {
	name = 'anthropicApi';
	displayName = 'Anthropic API';
	documentationUrl = 'https://docs.anthropic.com/claude/reference/getting-started-with-the-api';
	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'x-api-key': '={{$credentials.apiKey}}',
				'anthropic-version': '2023-06-01',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.anthropic.com/v1',
			url: '/messages',
			method: 'POST',
			body: {
				model: 'claude-3-opus-20240229',
				max_tokens: 1,
				messages: [{ role: 'user', content: 'Hi' }],
			},
		},
	};
} 