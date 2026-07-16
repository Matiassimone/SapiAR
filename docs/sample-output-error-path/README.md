# ERROR-path evidence (supplementary)

Real 19 s indoor recording with GPS starved by airplane mode — the first
real-hardware capture of the `ERROR` sentinel row: all numeric fields `-1`
including `Timestamp_unix_ms`, `is_interpolated=0`, `quality_flag=ERROR`,
exactly per GOAL.md §3. The zero `INTERP` rows are correct behavior, not a
gap: the session contains only one real fix, and interpolation requires two
real fixes to bound a gap (Architecture Rule #9 — no extrapolation).

This is supplementary evidence for the error path only; the primary GOAL.md
§3 deliverable is the outdoor-walk session in `docs/sample-output/`.
