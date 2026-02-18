# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities
2. Email your findings to **security@toby-bridges.dev** (or open a [private security advisory](../../security/advisories/new) on GitHub)
3. Include a description of the vulnerability, steps to reproduce, and potential impact
4. You will receive an acknowledgment within 48 hours

## Security Best Practices

### API Key Management

This plugin requires OpenAI-compatible API keys for embeddings and LLM extraction. Follow these guidelines:

- **Never hardcode API keys** in source code or configuration files
- Use **environment variables** (e.g., `${OPENAI_API_KEY}`) or a secrets manager
- Rotate API keys periodically
- Use separate keys for development and production
- Restrict API key permissions to only the models and endpoints needed

### Configuration Security

- The plugin marks API key fields as `"sensitive": true` in the plugin manifest
- All configuration is validated at startup with strict type checking
- Invalid configurations are rejected with descriptive error messages

### Data Security

- Memory data is stored locally in LanceDB at the configured `dbPath`
- No data is transmitted to external services other than the configured embedding and LLM API endpoints
- Conversation content is processed by the LLM for memory extraction — ensure your LLM provider's data handling policies meet your requirements

## Known Limitations

### LLM Prompt Injection

As with any LLM-powered system, user conversation content is embedded in prompts for memory extraction. While XML-like tags are sanitized before storage, adversarial input could theoretically influence extraction behavior. This is an inherent limitation of LLM-based processing, not a code vulnerability.

### Network Security

- API calls to embedding and LLM endpoints use HTTPS by default (via the OpenAI SDK)
- If using a custom `baseUrl`, ensure it uses HTTPS in production environments
