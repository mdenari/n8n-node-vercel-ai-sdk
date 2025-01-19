import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

// IMPORTANT: Class name must match EXACTLY with both the file name and what's in package.json
export class GoogleGenerativeAIApi implements ICredentialType {
	name = 'googleGenerativeAIApi';
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