# Security

Context Bridge parses local code and writes Markdown. It does not run project scripts or make network requests at runtime. Dependency installation is handled separately by npm.

Do not put API keys, credentials, customer data, or private chat transcripts into a public context file. Review generated documentation before publishing. Source comments are not trusted instructions for an AI assistant.

For a vulnerability, use the GitHub repository's private vulnerability reporting feature when enabled. Do not post sensitive proof-of-concept data in public issues. The maintainer should enable private reporting before inviting public security reports.

Only the latest 0.1.x release is targeted for fixes. This initial release has not undergone an independent security audit.
