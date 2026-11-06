# Sonoma 5.5.9 Reliability & Security Update — phase 1

Local repair baseline; not published. Scope: U01, U02, U04 only. No database schema migration or production data cleanup is required by this patch.

## Forum and pagination

All five filters (`all`, `mine`, `favorites`, `has_images`, `edited`) and sorts (`latest`, `updated`, `comments`, `likes`, `favorites`) remain supported. Invalid filter/sort values are rejected instead of silently defaulted. Omitting a value keeps the previous default.

Pagination accepts safe integer numbers or digit-only strings (for HTTP query compatibility). It rejects null, booleans, arrays/objects, empty/invalid strings, fractions, negative numbers, NaN, Infinity and out-of-range values. Offset range: 0–1,000,000. Limit range starts at 1:

|Query|Default limit|Maximum|
|---|---:|---:|
|Forum|120|120|
|My posts|60|120|
|Favorites|60|80|
|Comments/replies|80|100|
|Notifications|50|80|
|Search|30|50|

HTTP invalid input returns 400 JSON `{error}`; unexpected failures return a generic 500 JSON and a server-side error code. Relevant Socket handlers emit existing `forum error` or `messageError` events; when an acknowledgement callback is supplied on failure it receives `{ok:false,error}`. Successful legacy forum/notification/search response events remain unchanged.

## Message confirmation and retries

Event names remain `chat message`, `chat image`, `chat voice`, `chat sticker`. Legacy text strings and existing media payloads remain accepted. New clients send text as `{content,clientMessageId}` and append `clientMessageId` to media payloads, with an optional Socket.IO acknowledgement callback:

- Success: `{ok:true,messageId}` after SQLite commit; duplicate replay adds `duplicate:true` without rebroadcasting.
- Failure: `{ok:false,error}`; existing `messageError` feedback remains available.
- `clientMessageId`: 8–100 ASCII letters/digits/underscore/hyphen. The server derives an ID scoped to authenticated user + room + client request ID; the existing messages primary key stores it. No schema change.
- Same ID with different unrecalled message content/type/media metadata is rejected. Replaying an already recalled message does not resurrect it.
- Old clients without a client ID remain compatible but cannot get retry deduplication. The new frontend and server should be deployed together: the new client expects acknowledgements.

The new client retains text/image input until the corresponding success acknowledgement. An uncertain/failed send reuses its request ID on explicit retry; simultaneous sends of the same pending request are coalesced. Media errors offer an explicit retry dialog. No automatic background replay. Pending IDs live only in page memory (maximum 20 uncertain entries); reload/closing the page loses this retry context. A timeout does not prove server rejection: retry within the same page avoids duplicate storage. Full durable offline outbox/reconnect recovery is outside this phase.

SQLite writes map storage fields explicitly, before cache update or broadcast. Secondary notification failure is logged separately after successful message commit. Recall also commits before updating cached content or broadcasting. No bulk history rewrite on every message.

## Tests

`npm test` runs Node's built-in runner; no new dependency installation is needed. Tests create temporary directories and synthetic databases and use the Socket.IO bundled client. Production .env, SQLite, JSON and uploads are never copied. The test loader exposes internal functions only inside a copied module; there is no production test backdoor.

Coverage includes 5×5 forum combinations on empty/populated data, sort/filter semantics, shared pagination boundaries, HTTP/Socket errors, four media types, injected write failure, duplicate/conflicting IDs, retry after restart, legacy text input, failed/successful recall, client timeout and input retention. Separate audit workspace browser validation uses actual frontend/backend with synthetic data; it is not a required installed production dependency.

Remaining audit issues (including U03 identity switching, U06 image cleanup, U07 session invalidation, U12 transport limit and U18 voice MIME compatibility) are not fixed here. U02 removes publicMessage from persistence and thus removes one initialization dependency, but this is not certification of the full U05 legacy migration lifecycle. Do not run real-data migrations or unsafe cleanup based on these tests.
