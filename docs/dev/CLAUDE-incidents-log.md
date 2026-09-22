# CLAUDE.md incident log (client repo)

The sibling file in `olea-service` carries the private-repo incidents. This one starts with the
first incident this repo's own `CLAUDE.md` needs the story for, rather than duplicating that
repo's format wholesale — see its own file for the test of what belongs here versus staying
inline in `CLAUDE.md`.

## A stale "no production caller" comment survives its own fix, and gets trusted

`ol-ppxj.43` [DOS-C9]. The 2026-09-21 dossier review found three reachability verdicts that were
wrong for the same reason: a bead wires a real production caller for a capability, the fix commit
does not touch the doc comment a few lines above it that still says "no production caller exists,"
and every later reader — human or agent — trusts the comment, because a document that is present
and cited is treated as currency by every control this project has (this repo's own `CLAUDE.md`,
"Every live document is current, or it is labelled archive"). The register itself can go stale in
the same way and did, more than once, before `check-wiring-register.mjs` learned to re-derive
"wired" from source rather than trust the register's own prose (see that script's module doc,
"WHAT COUNTS AS A 'PRODUCTION CALLER'" and "CAN A 'NONE' CLAIM BE TRUSTED?"). This incident is the
same failure one layer out: a FREE-TEXT DOC COMMENT, not a register cell, making a claim nothing
was re-checking.

David ruled `[D-280]` (`ol-egov.153`) the same day: `[D-072]` clause 5's Definition-of-Done gains
a retraction duty — a bead that creates a production caller must retract every "no production
caller" claim about that capability in the same commit — and `check-wiring-register.mjs` gets a
mechanical check for the stale shape.

**What now catches it.** The checker scans production source (`packages/core/src`,
`packages/plugin/src`, no tests, no `packages/workbench`) for a line explicitly claiming "no
production caller" (or its "no caller exists" sibling — a narrow, literal phrase list, extended
by adding another literal phrase found in the wild, never by loosening the match) that also names,
ON THE SAME LINE, a backticked symbol the wiring register already confirms wired this run. Built
and tuned against two real false positives found while writing it, both worth keeping in mind
before widening the match: a generic "nothing calls this yet" phrase attaching to the nearest port
name on the page rather than the function it was actually about (`concept/wiring.ts`), and a claim
phrase and an unrelated, already-wired symbol sharing one sentence across two lines
(`groundedContext.ts`'s `AssessSupportPort` doc, which correctly says *no* caller exists for
itself while naming `GroundingJudgePort`, wired, one line later). Same-line-only matching is what
keeps both of those from becoming false alarms — see the checker's own module doc section, "STALE
'NO PRODUCTION CALLER' CLAIMS," and its fixture tests for the worked examples.

A retraction is not a deletion: the checker treats a claim as handled once the word `RETRACTED`
appears near it, because the house style (see `packages/plugin/src/ingestion/outcomes-extract-adapter.ts`'s
and `packages/plugin/src/ingestion/wiring.ts`'s own retractions, landed alongside this check) keeps
the old claim quoted for the record rather than silently editing it away.
