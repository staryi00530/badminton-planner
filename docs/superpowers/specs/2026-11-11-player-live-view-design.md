# Live player schedule sharing

## Intent and approved direction
Players need to see the whole session and their own planned games on phones. User chose live updates from the organizing iPad, including Finish, substitutions and regenerated games. Keep GitHub Pages and existing Firebase session storage. Release on beta first.

## Approach
Build a separate player viewer on the same app URL, with an explicit player-view query marker and share ID. Reuse the existing public share payload and read-only Firebase subscriptions. Do not render the planner component on this route: its state hydration, private player bank and organizer controls are inappropriate for this audience. Merely filtering the current planner would retain accidental progress/edit paths. A manually published snapshot was considered; user chose live updates.

## Player experience
- Branded Player view header and session summary.
- All games and My games tabs. All games defaults on first visit; selecting a player opens My games.
- Searchable/name-picker selection stored only as a share-scoped stable player ID on this device. No login, gender edits or roster mapping. Selection is a viewing filter, not identity authentication. If a selected player is removed, explain it and offer reselection rather than silently picking someone else.
- For older links without IDs, resolve only unique names for a temporary current-page filter. Do not persist guessed identity across refresh/rename; ambiguous names require organizer republishing. All games remains available.
- All games shows current courts, next/planned games, and a collapsible played-history section. My games shows the selected player's current game, remaining planned games and optional played history. Include partner, opponents, logical slot, planned time and court where known. Highlight the selected player.
- Current court comes from the actual runtime display court/lineup; future court/time is labeled planned/approximate. Future lineups are tentative and may change as games finish or the organizer regenerates. Never call a merely planned game ready or invite players to start it.
- Simple empty states for no plan, no assigned upcoming games, no completed games, unavailable player or missing selection. Retained ledger history survives recovery rerolls; avoid listing runtime completed references twice.
- No Start, Finish, Undo, editing, scores inputs, admin PIN, private levels, quality scores, bank, setup, transfer or publish controls. Show completed scores as text only.

## Organizer experience
Share opens a clearly labeled Player link, plus a separate organizer-session link for the organizer's own devices. Existing organizer links continue to work. Sharing a local session establishes the existing shared organizer connection so iPad actions publish automatically. An existing shared session reuses its stable ID and flushes pending changes before displaying the player link. A local independent iPad copy must be shared from that iPad to establish its own live source; a computer's disconnected copy cannot update it.

Keep the organizer's URL as the organizer link. Add a visible Player link action/status showing whether updates are being published, and explain that Use on this device disconnects the live source. Private organizer handoff remains a separate action and must never be substituted for the player URL.

Live player publication requires configured Firebase. Do not silently substitute Worker/hash snapshot fallbacks and claim they are live. On create/save/conflict failure retain the local draft and existing link, state that latest changes are not published, and offer retry. Only establish a newly shared organizer connection after successful creation. Preserve existing organizer-link fallback compatibility separately.

## Data and connection behavior
Read the existing public SharePayload, including stable IDs, public names, planned lineups, live refs, scores and immutable played history. Private player levels/preferences are not added. Player viewer never calls create/update/commit/action APIs, never deletes expired shares, and never writes planner/session storage. Store only its own selected-player preference under a separate share-scoped key.

Subscribe to share data and Firebase connection state. Distinguish initial loading, receiving updates, reconnecting/offline with last received view, permission/error, missing/expired link and invalid payload. Show last received revision/time without claiming a pending organizer draft has been published. Reconnect/resubscribe with cleanup and retry; ignore late callbacks after link changes/unmount. Keep the last valid view on transient failure and label it stale. If a link is deleted/expired, remove the displayed roster rather than presenting it as current. Refresh recovers the same share and player preference. No player-side expiry cleanup writes.

Check createdAt against the existing 30-day expiry rule locally, including a timer for expiry while an already-open viewer remains connected. Do not call existing fetchShare, whose expired-share cleanup deletes remote data. Subscribe/read directly and cancel the expiry timer on cleanup or replacement snapshot.

## Scope and validation
No generation, quality, attendance, organizer write authorization or database-rule redesign. Read-only is the viewer's behavior: backend permissions remain existing session permissions.

Test stable-ID filtering/renames/removed selection, actual live overrides, tentative future labels, ledger/reroll dedup, completed text scores, reader route isolation from all planner storage, no write APIs/tick writes, realtime updates and stale callbacks, connection/expiry/error/retry, organizer link reuse and pending-save handling. Browser test on phones/iPad with fake shared transport: organizer Finish/substitute/reroll updates All/My games without player refresh or write calls. Test old organizer links and private handoff unchanged. Run full tests/build, independent review, beta push and successful Pages verification.
