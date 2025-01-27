# n8n-nodes-vercel-ai-sdk

This is an n8n community node. It lets you use Google Generative AI (PaLM 2) in your n8n workflows.

Google Generative AI is Google's family of large language models that enables natural language interactions and content generation through an API.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

[Installation](#installation)  
[Operations](#operations)  
[Credentials](#credentials)  
[Compatibility](#compatibility)  
[Resources](#resources)  
[Version History](#version-history)  

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

## Operations

The Google Generative AI node supports the following operations:

- **Generate Text**: Generate text responses using the model
  - Support for both simple prompts and multi-turn conversations
  - Handles text and file inputs
  - Configure safety settings and model parameters
  - Get detailed response information including token usage

- **Generate Object**: Generate structured data responses using JSON schema
  - Define output structure using JSON schema
  - Get validated, structured responses from the model

## Credentials

You need to authenticate with Google Generative AI API:

1. Visit the [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Create a new API key
3. Use this API key in the node credentials

## Compatibility

Requires n8n version 1.0.0 or later.

## Resources

* [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
* [Google Generative AI Documentation](https://ai.google.dev/docs)

## Version History

### 0.1.5
- Added DeepSeek AI integration reasoning output support & cache token hits:
  - Reasoning is now shown under `reasoning.output`
  - Cache metrics are shown under `usage.cache_metrics`

### 0.1.4
- Added DeepSeek AI integration
- Updated dependencies
- Minor improvements to Google Generative AI node

### 0.1.3
- Enhanced documentation with detailed operation descriptions
- Added comprehensive installation and credential setup guide
- Improved resource links and compatibility information
- Added version history tracking

### 0.1.2
- Added support for file handling in messages
- Enhanced token usage reporting
- Improved error handling and validation
- Updated documentation

### 0.1.1
- Initial release with text generation and object generation features
- Support for both simple prompts and multi-turn conversations
- Integration with Google Generative AI API
- Safety settings and model parameter configuration