# Supabase production foundation

This folder contains the first production-backend milestone for Matching Rivals.

## Included

- Anonymous Supabase Auth-compatible user ownership.
- Rooms, two-player membership, question sets, attempts, and authoritative results.
- Row Level Security policies that expose a room only to its members.
- Atomic RPC functions for creating and joining rooms, readying players, opening a round, submitting a match, and rematching.
- Database timestamps for countdowns and finish times.
- Private Realtime Broadcast triggers for `rooms` and `room_players` with topic-level authorization.
- The six Demo pairs as the `starter` question set.

## Environment contract

The browser application will use only:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

These values are intentionally absent from source control. The anonymous key is a browser credential protected by RLS; a Supabase service-role key must never be exposed to the browser.

## Apply order

1. Create a Supabase project and enable Anonymous Sign-Ins.
2. Apply `migrations/202608200001_initial_schema.sql` with the Supabase CLI or SQL editor.
3. Add the two public environment variables locally and to the production host.
4. Replace the Demo repository (`localStorage` and `BroadcastChannel`) with Supabase Auth, RPC, private Realtime Broadcast, and table reads.

No migration has been applied to a remote project yet.
