# AGENTS.md - Home Automation Cluster

## Build/Test Commands
- `cd composer && bun install` - Install dependencies
- `cd composer && bun run generate ../docker-compose.yml` - Generate docker-compose.yml from TypeScript
- `cd composer && bun run types:refresh` - Update Docker Compose type definitions
- No test commands defined - this is a configuration generator project

## Code Style Guidelines
- **Language**: TypeScript with strict typing
- **Imports**: Use ES6 imports, relative paths for local modules
- **Formatting**: Use double quotes for strings, camelCase for variables/functions
- **Types**: Leverage generated Docker Compose types from `generated/docker-compose-spec.ts`
- **Naming**: Use descriptive names (e.g., `createCaddyProxy`, `usingUpstreams`)
- **Functions**: Export pure functions that return configuration objects
- **Error Handling**: Use try/catch for file operations, throw descriptive errors

## Project Structure
- `composer/src/` - TypeScript configuration generators
- `composer/scripts/` - Build scripts
- `composer/generated/` - Auto-generated type definitions
- Root contains service-specific environment files and Docker configs

## Caddy Docker Proxy Labels
This project uses caddy-docker-proxy for reverse proxy configuration:
- Use `caddy: subdomain.domain.com` for basic routing
- Use `caddy.reverse_proxy: "{{upstreams PORT}}"` for upstream configuration
- Use numbered prefixes for ordering: `caddy.1_handle`, `caddy.2_handle`
- Use `@matcher` syntax for complex routing rules