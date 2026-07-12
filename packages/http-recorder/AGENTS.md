# @opencode-ai/http-recorder

Record and replay Effect HTTP client traffic deterministic test cassettes.

## STRUCTURE

```
src/
├── index.ts           Public entry: HttpRecorder.{http, socket}
├── effect.ts          HTTP recorder layer (FetchHttpClient decorator)
├── socket.ts          WebSocket recorder layer (Socket.Socket decorator)
├── websocket.ts       WebSocket executor (high-level sendText/messages/close)
├── recorder.ts        Auto-mode resolution (record/replay/passthrough), replay state machine
├── cassette.ts        Cassette I/O (fileSystem + memory layers), secret-gated writes
├── redactor.ts        Composable redaction pipeline (headers, url, body, json fields)
├── redaction.ts       Low-level redact helpers, secret pattern detection
├── matching.ts        Request equivalence (canonical JSON), diff output, sequential replay
├── schema.ts          Effect Schema definitions for cassette format (v1)
├── types.ts           Core types: RequestSnapshot, ResponseSnapshot, RecorderOptions
├── internal.ts        Barrel for @opencode-ai/http-recorder/internal
├── internal-effect.ts recordingLayer — the core Effect layer wiring record/replay
script/
├── build.ts           tsc declarations + Bun.build, prunes non-public .d.ts
├── pack.ts            Package tarball
└── verify-package.ts  Package readiness check
test/
├── record-replay.test.ts
└── fixtures/recordings/  Pre-recorded cassettes
```

## CONVENTIONS

- **Auto mode**: existing cassette = replay, missing = record (requires upstream). `CI=true` forces replay; missing cassette = failure.
- **Cassette format**: JSON with `version: 1`, `metadata`, `interactions[]`. Schema-validated on read/write.
- **Secret gating**: `cassette.ts` refuses to write a cassette containing bearer tokens, API keys, or env secrets. Detection in `redaction.ts`.
- **Redaction built-ins**: headers (`authorization`, `cookie`, `set-cookie`...), query params (`token`, `key`, `sig`...), URL credentials, JSON fields (`password`, `secret`, `api_key`...). `RedactOptions` extends these additively.
- **Request matching**: canonical JSON comparison (sorted keys, recursively). Custom `RequestMatcher` in `RecorderOptions.match`.
- **WebSocket replay**: client-text frames compared as canonical JSON by default; binary frames matched verbatim. `compareClientMessagesAsJson: false` for exact string comparison.
- **Replay position**: sequential — each interaction consumed in order. `makeReplayState` tracks position; finalizer warns on unconsumed interactions.
- **Effect layers**: `HttpRecorder.http(name, options)` returns `Layer<HttpClient>`; `HttpRecorder.socket(name, options)` returns `Layer<Socket>`. Both require upstream transport beneath.
- **No barrel exports** — `index.ts` exports only `HttpRecorder` namespace. Consumers import `{ HttpRecorder }` or `{ HttpRecorderInternal }` from `@opencode-ai/http-recorder/internal`.

## COMMANDS

| Command | Action |
|---------|--------|
| `bun test` | Run tests (`--only-failures`) |
| `bun typecheck` | `tsgo --noEmit` |
| `bun run build` | Build dist/ |
| `bun run verify:package` | Check package readiness |
