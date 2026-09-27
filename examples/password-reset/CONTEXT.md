# Context

Human/AI-maintained working state. Update at meaningful checkpoints, before quota runs out.
Read this first, then retrieve only relevant CODE_MAP.md entries. Verify claims against the working tree.

## Goal

Build the demo password-reset flow while preserving login behavior.

## Constraints

- This is illustrative code, not production authentication.

## Decisions

- Reuse the existing account store.

## Completed

- Token lookup and reset orchestration are implemented.

## Current work

Expiry validation is missing in validateToken.

## Pending

- Reject expired tokens.
- Map invalid and expired token errors to client responses.
- Add regression tests.

## Next action

Add an expiry guard to src/reset.ts::validateToken and test it.

## Verification

No tests have been added for this demo yet.

## Relevant symbols

src/reset.ts::validateToken, src/store.ts::findAccount, src/route.ts::postReset

## Open questions

_Not recorded._

<!-- context-bridge:checkpoint:start -->
## Checkpoint

Saved: 2026-09-27T06:33:18.904Z
Branch: unavailable
Commit: unavailable \(no commit or no Git repository\)
Map snapshot: 687737b706e77d8b9a702f49636df819ec6e47b83c418d40bc32fc6f4fd6361e
Working tree at checkpoint:
- Git unavailable.
<!-- context-bridge:checkpoint:end -->
