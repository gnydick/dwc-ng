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
