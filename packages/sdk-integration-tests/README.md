# SDK Integration Test Scenarios

Language-agnostic integration test scenarios for validating API parity across all AgentLens SDKs.

## Scenarios

Defined in `scenarios.yaml`. Each scenario specifies:
- `method` — SDK method to call
- `args` — arguments to pass
- `expect` — expected status code and response body assertions

## Running per SDK

### TypeScript
```bash
cd packages/sdk && npm test -- --integration
```

### Python
```bash
cd packages/python-sdk && AGENTLENS_SERVER_URL=http://localhost:3400 pytest tests/integration/
```

### Go
```bash
cd sdks/go && AGENTLENS_SERVER_URL=http://localhost:3400 AGENTLENS_API_KEY=test go test -tags=integration -v
```

### Java
```bash
cd sdks/java && AGENTLENS_SERVER_URL=http://localhost:3400 AGENTLENS_API_KEY=test ./gradlew test -Pintegration
```

## Prerequisites

- AgentLens server running at `AGENTLENS_SERVER_URL`
- Valid API key in `AGENTLENS_API_KEY`
