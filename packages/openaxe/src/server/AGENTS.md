# HTTP SERVER

## OVERVIEW

Effect HTTP API server for openaxe. HttpApi groups, middleware, handlers, SSE streaming, WebSocket upgrade routes. ~9 server files + ~42 route files + ~9 middleware files.

## STRUCTURE

```
src/server/
├── server.ts              Server assembly — HttpApi + middleware provision
├── routes/
│   └── instance/httpapi/
│       ├── groups/        21 files — HttpApiBuilder.group endpoint groups
│       ├── handlers/      21 files — Per-endpoint handler implementations
│       └── middleware/    9 files — Request-level middleware (auth, workspace)
├── shared/                Shared server utilities
└── AGENTS.md (parent)     [see HttpApi route patterns]
```

## WHERE TO LOOK

| Task            | File                                             |
| --------------- | ------------------------------------------------ |
| Server assembly | `src/server/server.ts`                           |
| Route groups    | `src/server/routes/instance/httpapi/groups/`     |
| Handlers        | `src/server/routes/instance/httpapi/handlers/`   |
| Middleware      | `src/server/routes/instance/httpapi/middleware/` |
| Route patterns  | `src/server/routes/instance/httpapi/AGENTS.md`   |
| Shared utils    | `src/server/shared/`                             |

## KEY PATTERNS

- **Route Groups**: `HttpApiBuilder.group(...)` for endpoint groups. Yield stable services once at group construction, close over them in handlers.
- **SSE Streaming**: Return `HttpServerResponse.stream(...)` from handler. Annotate success schema with `HttpApiSchema.asText({ contentType: "text/event-stream" })`.
- **WebSocket**: Use `handleRaw(...)` in `HttpApiBuilder.group` for WebSocket upgrade routes.
- **Non-API Routes**: `HttpRouter.use(...)` only for routes outside declared API surface (e.g., catch-all UI fallback).
- **Dependency Provision**: Never `Effect.provide(Layer)` inside handlers. Stable layers at assembly boundary in server.ts. `HttpRouter.provideRequest` only for request-derived context.
- **Error Contracts**: Public JSON errors use explicit `Schema.ErrorClass` declared on each endpoint. Translate domain errors at the handler boundary.

## TESTING

- `NodeHttpServer.layerTest` for in-test Effect HTTP server.
- `testEffect(Layer)` with `NodeHttpServer.layerTest` for client requests.
- Tiny `HttpApiBuilder` probe groups for focused middleware tests.
- For upstream server tests, `NodeHttpServer.layer(...)` with `Layer.build` scoped to test.
