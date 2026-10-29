# Jordan Vale season stat labels

Original acceptance criteria for the later Issue-to-PR demonstration.
Keep this file and the fixture bytes unchanged when implementing the fix.

1. Open NBA search and search for Jordan.
2. Open Jordan Vale. The historical `pointsPerGame` stat must display PTS and 18.5 together with a useful accessibility label.
3. The unknown `demoUnknownMetric` must have a safe nonempty label or be omitted. It must never create a blank tile label or duplicate React key.
4. Avery Stone's current PTS, REB, and AST labels must remain intact.
5. Back navigation must return to the search results.

The baseline intentionally drops historical and unknown stat names during schema parsing.
This fixture seeds the defect. It does not implement its fix.
