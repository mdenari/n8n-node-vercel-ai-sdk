import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

// Export as default class
export default class GoogleGenerativeAiApi implements ICredentialType {
	name = 'googleGenerativeAiApi';
	displayName = 'Google Generative AI API';
	documentationUrl = 'https://ai.google.dev/docs';
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
				'x-goog-api-key': '={{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://generativelanguage.googleapis.com',
			url: '/v1/models',
			method: 'GET',
		},
	};
} 