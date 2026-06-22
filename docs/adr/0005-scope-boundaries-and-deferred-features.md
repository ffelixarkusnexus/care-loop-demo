# ADR 0005 — Scope boundaries and deferred features

- **Status:** Accepted
- **Date:** 2026-06-22
- **Decider:** Francisco

## Context

The demo must model the agentic pattern convincingly without sprawling into a product (YAGNI; a fixed
time-box).

## Decision

Build the four-phase workflow + triage dashboard + clinician sign-off. **Defer:** patient mobile app,
voice-to-text, real EHR write, the care-playbook screen, multiple screener types, and role hierarchies beyond
clinician/member. **Notifications are deferred but *simulated*** (an `alerts` row + dashboard badge); a real
Slack/Teams alert is a **small, proven add** (already built in BottleneckIQ) and is excluded only for scope,
not because it's hard.

## Options considered

1. **(Chosen) A faithful miniature of the pattern.**
2. **(Rejected) Build the full product** — violates the time-box and YAGNI.
3. **(Rejected) Silently omit the deferred pieces** — undocumented gaps erode a reviewer's trust and look like
   blind spots.

## Consequences

A bounded, shippable demo; every omission is a deliberate, documented decision; the notification is a known
small add, not a missing capability.
