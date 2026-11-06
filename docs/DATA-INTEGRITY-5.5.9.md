# Sonoma 5.5.9 — phase 3 data integrity

Unpublished local development baseline. Scope: U05/U06/U14/U15/U17. All tests use temporary databases and synthetic files. Do not point tests at production storage. This phase adds schema metadata and recovery behavior; before a future production start, take and verify a consistent SQLite/WAL and uploads backup. No production start or migration was performed in this task.

## Legacy import

`data_migrations` records one-time JSON import decisions. Users initialize before messages. An existing nonempty SQLite table is authoritative; its legacy JSON is retained but not merged automatically. Empty/new tables import all valid JSON records, not only the newest 300. Import and completion marker share a transaction. Malformed JSON, invalid records, duplicate IDs or write errors abort rather than rewriting the source or silently discarding rows. Missing source files are recorded as an initialization decision. Explicit history deletion preserves the marker so old JSON is not resurrected on restart.

The original JSON is never modified by these import paths. Existing historical text is not truncated to the current send limit. Old forum-table replacement compares row counts and rolls back if any rows would be omitted; complete original rows, including obsolete columns, are retained in `legacy_table_archive` before replacement.

## Images

`post_image_refs` represents many-to-many image/post references. Bindings are rebuilt from all stored post HTML/plain content, independent of author ownership, and post creation/edit/deletion updates bindings inside its database transaction. Legacy `post_id`/`is_bound` remain compatibility summaries rather than the sole ownership reference.

Cleanup checks actual post content again under a write transaction. Only unreferenced images without a draft token and with at least 24 hours since becoming unbound qualify. Old unknown unbound times receive a fresh grace period. Offline drafts with a token are conservatively retained because the server cannot know whether browser-local drafts still exist.

Eligible files move to `image-quarantine/` outside public static serving. Metadata is retained with `quarantined_at`; no irreversible deletion occurs and reclaimed bytes are reported as zero. Failure during metadata update rolls back and moves the file back. Startup recovers interrupted moves or files referenced again; `recoverQuarantinedPostImages(true)` is the internal controlled restore-all operation, exercised in isolated tests. This phase does not add a public restore/purge endpoint. Conflicting files are never overwritten. Quarantine needs a future retention/disposal policy and still consumes disk space.

## Comments and deletion

Comment deletion is logical: the row and original database content remain, the API displays a deletion placeholder, likes/targeted notifications are removed, and replies remain visible beneath the tombstone. Reply/delete controls are disabled on deleted comments using existing UI styles. The server rejects new replies/likes to deleted comments. Tombstones reserve previous floor/reply numbers; allocation and insertion share a transaction. Legacy replies with a missing parent receive a placeholder without deleting their content. Valid existing floor values are not renumbered. Completely missing historical floors cannot be reconstructed without a backup; malformed cross-post/cyclic legacy relations are not automatically rewritten.

Post deletion transactionally removes comments, likes, favorites and corresponding notifications/references. Reports remain addressable audit records: `original_post_id` preserves the old identifier and `post_id=''` explicitly denotes an archived target. This avoids breaking report-resolution workflows after deleting a reported post. Shared files remain available; newly unbound files enter the grace period.

Room/history deletion transactionally removes dependent reactions, read states and relevant notifications; in-memory state and client broadcasts change only after successful commit. Existing unrelated legacy orphans are not silently purged by startup. This is not a wholesale foreign-key migration of every old table or a redesign of all moderation workflows.

## History protocol

Existing room-join and `history` response arrays remain compatible, now loaded directly from the room's SQLite records. The global 300-message memory window no longer determines room visibility. A `(room_id,created_at,id)` index supports stable keyset paging.

Additive Socket event:

```js
socket.emit('get room history', {
  roomId,
  limit: 100, // 1..300; default 300
  before: { timestamp, id } // omit for newest page; reuse nextCursor
}, result => { /* {ok:true,roomId,messages,hasMore,nextCursor} */ });
```

The server also emits `room history` with the page. Messages within each page are ascending; the cursor requests older records using timestamp and ID together. Every request checks current user/room access. Existing UI still displays the latest per-room window; this phase does not add an automatic older-history scrolling UI. Recall lookup falls back to SQLite instead of depending on the global cache.

## Validation

`npm test` contains 21 distinct top-level tests across three phases after this change. Initial concentrated execution passed 19 tests; follow-up changes for report archival/recovery were checked only with five related tests (including two additions), and the legacy startup fixture was checked with two U05 tests. Logs in the task outputs distinguish these runs; no unrelated full rerun was performed. Fault injection covers mid-import failure, omitted legacy rows, failed post/room deletion, quarantine metadata failure, interrupted file moves and restore metadata failure. Prior phases' original test files are unchanged.
