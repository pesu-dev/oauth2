# Security Policy

## Supported Versions

We maintain security fixes for the current release on the `main` branch. Deploy staging and production from tagged releases when available.

## Reporting a Vulnerability

**Do not open a public issue** for security vulnerabilities.

Contact maintainers via the PESU Developer Group (`#pesu-dev`) on [PESU Discord](https://discord.gg/eZ3uFs2), or email the maintainers directly.

Include:

- Steps to reproduce
- Impact assessment
- Suggested mitigations (if any)

We aim to acknowledge reports within 48 hours.

## Scope

This authorization server handles PESU Academy credentials, OAuth client secrets, refresh tokens, and (when delegated consent is granted) encrypted session material. Treat all of these as highly sensitive.

## Disclaimer

This is an **unofficial** project. We are not affiliated with PESU University or PESU Academy.

- We do not control third-party applications that register as OAuth clients.
- Developers and end users must verify trust before authorizing clients.
- Passwords and tokens must never appear in logs, issues, or git history.

## Best Practices

- Use HTTPS only in deployed environments.
- Never commit `.env`, X.509 client certificates (`.pem`), Atlas connection strings with embedded credentials, signing keys, or SMTP credentials.
- Rotate compromised secrets immediately.
- Prefer least-privilege GitHub and GCP access for deploy roles.

## Dependencies

We monitor and update Python dependencies via `uv.lock` and CI.

Thank you for helping keep PESU OAuth2 secure.
