# @opencode-ai/server

HTTP server and API layer for openaxe. HttpApi groups, handlers, middleware, WebSocket and SSE endpoints.

## Structure

```
packages/server/src/
  handlers/     HttpApi endpoint handlers by group
  groups/       HttpApi group declarations
  server.ts     Server bootstrap, listener, mDNS, WebSocket tracking
```

## Conventions

- Use `HttpApiBuilder.group(...)` for normal HTTP endpoints including SSE
- Handlers yield stable services once at layer construction, close over in implementations
- For SSE: return `HttpServerResponse.stream(...)` and annotate with `HttpApiSchema.asText({ contentType: "text/event-stream" })`
- Use `handleRaw(...)` for WebSocket upgrades and raw request/response needs
- Avoid `Effect.provide(SomeLayer)` inside request handlers — stable layers at app boundary
- Use `HttpRouter.use(...)` only for routes outside declared API surface (catch-all UI fallback)
- Public JSON errors: explicit `Schema.ErrorClass` contracts on each endpoint
- Declare middleware on `HttpApiGroup`, provide implementation at assembly in `server.ts`

## Anti-Patterns

- No per-request layer provision — provide once at boundary
- No request-level `HttpRouter.provideRequest(...)` for stable services
- No domain/storage services leaking HttpApi types — translate at handler boundary