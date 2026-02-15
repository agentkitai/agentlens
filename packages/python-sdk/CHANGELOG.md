# Changelog

All notable changes to the AgentLens Python SDK will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.11.0] - 2025-02-15

### Added
- Multi-provider support: Anthropic, LangChain, LiteLLM, Bedrock, Vertex AI, Gemini, Azure OpenAI, Mistral, Cohere, Ollama
- `wrap()` decorator for automatic call capture
- Async support throughout the SDK
- Pydantic v2 models for type-safe API responses
- Comprehensive test suite with pytest-asyncio

### Changed
- Minimum Python version: 3.9

## [0.10.0] - 2025-01-15

### Added
- Initial public release
- Core `AgentLens` client with session and event APIs
- OpenAI integration via monkey-patching
- Type-safe request/response models
