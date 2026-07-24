| Badge              | Meaning                                                                          |
|:-------------------|:---------------------------------------------------------------------------------|
| ✅ **FIXED**       | Fixed in dwc-ng (file / commit cited)                                            |
| 🟡 **PARTIAL**     | Exists but approximated / incomplete / missing sub-cases                         |
| ❌ **TODO**        | Not present — net-new work                                                       |
| 🟦 **DEFERRED**    | Implemented on a branch but needs architecture reconciliation before re-applying |
| 🔬 **CORNER CASE** | A specific edge case that is easy to get wrong; verify with a fixture            |

| Status | Bug | Fix |
|--------|-----|-----|
| ✅ | re-probe for bed must subtract the probe's **Z** trigger height (G31 Z) to get the spot's map value — the probe doesn't sit at Z=0 | `heightmapValue = stopHeight − triggerHeight`, live `sensors.probes[0].triggerHeight`; `heightmap/probeReply.ts` + `cards/BedCards.tsx` (da16b87) |
| ✅ | file-list scroll position not restored on return / reload | gate the scroll-restore on `!browser.loading()` so the one-shot offset isn't consumed onto the empty loading list (which clamps it to 0); `files/FileBrowserView.tsx` |
| 🟡 | bed maintenance screen: height map on it, tram controls, mesh controls like loading, unloading csvs, being able to choose which csv you load as a heightmap | screen renamed **Bed maintenance** (id stays `bed` so saved layouts survive); new **Mesh** card = CSV picker over `0:/sys/*.csv` + Probe (`G29`) / Use this map (`G29 S1 P`) / Save as (`G29 S3 P`) / Clear (`G29 S2`); new **Bed tram** card = `G32` + `M561`; `heightmap/store.ts` now carries the loaded path so Save writes back to — and reloads — the file being edited. Remaining: leadscrew-position solver from continuous tram error (needs captured G32 runs first) |
