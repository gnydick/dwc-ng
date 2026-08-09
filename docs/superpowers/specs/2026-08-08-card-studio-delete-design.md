# Card deletion moves to the Card Studio

**Date:** 2026-08-08 · **Status:** approved by Gabe (in session)

## Problem

Custom-card deletion currently lives in the compose drawer (`ComposedScreen.tsx`:
two-step ✕ → Confirm per custom-card row). That surface mixes per-screen
composition (checkboxes) with global lifecycle (a delete that removes the card
from *every* screen) — the ✕ needs a tooltip warning precisely because of that
mismatch. The Card Lab, where cards are authored and edited, has no delete at
all, and no delete path tells the user which screens the card is used on.

Ruling (Gabe): **there should be no compose-drawer delete.** Deletion becomes a
function of the Card Studio, and the confirmation must report which screens use
the card.

## Design

### 1. Studio footer gains a Delete — edit mode only

When `props.cardId !== null`, the studio footer row (`Save card` / `Cancel`)
gains a danger button pushed to the far end, away from Save/Cancel. It follows
the app's standard two-step arm pattern (same as file deletes, heater resets,
the screen delete):

- First click arms: label flips "Delete card" → "Confirm delete".
- Any interaction elsewhere disarms (same dismiss behavior as the drawer's
  armed states).
- Second click deletes and closes the studio.

While armed, the **existing reserved message line** (`.fb-msg`, reserved so "an
error appearing must not shove the buttons") shows the usage report instead of
an error:

- Used: `On screens: Machine, Spindle bench (hidden) — confirm to remove it
  from all of them.`
- Unused: `Not on any screen.`

No new geometry appears; buttons never move. The line may wrap in the rare
many-screens case. New-card mode (`cardId === null`) renders no delete button.

The studio performs the delete itself via `app.config.removeCustomCard(id)`
and then calls `props.onClose()`. No new callback prop.

### 2. `screensUsing(config, cardId)` helper in `compose/screens.ts`

Returns `Array<{ id: string; name: string; hidden: boolean }>` — every screen
whose composition contains the card's slot id:

- **Built-ins:** only via their `screens.layouts` override — a built-in's
  *default* composition can never contain a custom card, so only the overlay
  needs checking. Renames apply (`screens.renames`).
- **Custom screens:** via their stored `cards`.
- **Hidden built-ins included** and flagged `hidden: true` — `screenList()`
  cannot be reused as-is because it filters hidden screens out.

Pure function over `UiConfig`; unit-tested directly.

### 3. The compose drawer's ✕ is removed

Custom-card rows in the drawer keep: checkbox (on/off *this* screen), Edit,
export (⤓). The `armedCardDelete` signal and `deleteCard` function in
`ComposedScreen.tsx` are deleted. The screen-level "Delete screen" button
stays. Deletion is reachable only through the studio — opened from the lab's
✎ Edit or the drawer's Edit — one lifecycle surface.

### 4. The lab survives the delete by construction

`featured()` in `CardLab.tsx` may point at the just-deleted card. Add a small
effect: if the featured id is a custom card that no longer exists in
`config.cards`, fall back to the default featured card
(`active-job-detailed`). This guards every deletion path (studio, import
purge, future ones), not just the one added here.

Screens already degrade safely: `parseComposition` drops any slot whose card
definition no longer exists (`screens.ts` — "deleting a custom card degrades
screens by exactly that slot"). The usage list is informational, not an
integrity guard.

## Error handling

None new. Delete is config-overlay data only; `removeCustomCard` already
exists and cannot fail locally. Persistence rides the existing config-save
flow.

## Testing

- `screensUsing`: usage via built-in layout override, via custom screen,
  hidden built-in flagged, unused card → empty, renamed built-in reports the
  rename.
- Studio: delete button absent in new-card mode; arm → message line shows
  usage; disarm on outside interaction; confirm → card gone from config and
  studio closed.
- Drawer: custom-card rows render no delete control.
- CardLab: featured falls back when the featured custom card disappears.