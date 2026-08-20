# Supabase production foundation

This folder contains the first production-backend milestone for Matching Rivals.

## Included

- Anonymous Supabase Auth-compatible user ownership.
- Rooms, two-player membership, question sets, attempts, and authoritative results.
- Row Level Security policies that expose a room only to its members.
- Atomic RPC functions for creating and joining rooms, readying players, opening a round, submitting a match, rematching, and loading one authoritative room snapshot.
- Database timestamps for countdowns and finish times, plus a read-only server clock used to correct client display skew.
- Private Realtime Broadcast triggers for `rooms` and `room_players` with topic-level authorization.
- The six Demo pairs as the `starter` question set.

## Environment contract

The browser application will use only:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

These values are intentionally absent from source control. The publishable key is a browser credential protected by RLS; a Supabase service-role key must never be exposed to the browser.

## Apply order

1. Create a Supabase project and enable Anonymous Sign-Ins.
2. Apply the SQL files in `migrations/` in filename order with the Supabase CLI or SQL editor.
3. Add the two public environment variables locally and to the production host.
4. Connect the application through Supabase Auth, RPC, private Realtime Broadcast, and RLS-protected table reads.

The migrations are applied to the Matching Rivals remote project. Anonymous sign-ins and the three Vercel environment scopes are configured.
