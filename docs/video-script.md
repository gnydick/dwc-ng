# dwc-ng — feature walkthrough video script

Read the **narration** aloud. Each `▶ SHOW` line is a screen direction: what to
have on screen (and what to click) while the paragraph under it plays. Screens
are reached from the left rail or by hash: `#/machine`, `#/control`, `#/jobs`,
`#/macros`, `#/system`, `#/settings`, `#/activity`, `#/bed`.

Cues assume the printer is **homed, idle, and cool** at the start; the tram and
print scenes heat and move the machine, so shoot them last or in a separate
take. Bold words in the narration are the ones to lean on.

Running time at a normal reading pace: about 11–12 minutes.

---

## 0. Cold open — 25 s

▶ SHOW `#/machine`, full width, nothing selected. Let the temperature chart
scroll for a beat before talking.

This is **dwc-ng** — a replacement web interface for Duet 3 printers. It's
built for one idea: the screen is a **control plane** for a specific machine,
not a generic dashboard. Every control sends exactly one G-code. Nothing is
hidden behind a wizard, and nothing you do here is something the firmware
wouldn't let you do at the console.

Let's walk through it, screen by screen.

---

## 1. The shell — 60 s

▶ SHOW Stay on Machine. Hover the preflight strip top-left (IDLE · HOT · T0).

Across the top is the **preflight strip**. It's always visible on every
screen: machine state, whether anything is hot, which tool is mounted, and
whether you're homed. You never have to go looking for the thing you most
need to know before you press a button.

▶ SHOW Click **STOP** (top-right) — *only if you're comfortable; it's a live
M112*. Otherwise just hover it.

Top-right, the red button is the emergency stop. It sends **M112 and M999**
and tells you if it didn't reach the board — a stop that silently failed is
worse than no stop button.

▶ SHOW Click **Graphite**, then **Vellum** in the theme toggle.

Two themes: **Vellum**, the paper-and-ink default, and **Graphite**, the dark
one. The chart palette is re-solved for each ground so the lines stay
distinguishable on both — that's measured, not eyeballed.

▶ SHOW Click **75**, then **150**, then back to **100** in the scale toggle.

Next to it, **UI scale**. One unit drives the whole layout — type, controls,
spacing, and the grid — so a layout you saved on the shop monitor fits on a
phone without re-dragging anything. Both of these are browser preferences;
they don't touch the machine.

▶ SHOW Click **CAMERA** to toggle the floating camera tile on and off.

The camera is a tile you can pin to any screen, and each screen remembers
where you put it.

---

## 2. Machine — the glance screen — 60 s

▶ SHOW `#/machine`. Pan slowly: Position, Sensors, Temperatures, Console,
Object model.

Machine is the **at-a-glance** screen.

▶ SHOW Hover the Position card.

**Position** — every axis with its homed state, and — this matters on a
toolchanger — each axis labelled by its **role**. U, V, W aren't mystery
letters; they're Z motor 1, 2, 3. C is the coupler. You name those once in
Settings and they show up everywhere.

▶ SHOW Hover the Sensors card.

**Sensors** — endstops, probes, filament monitors. Again, named by you, not
by index.

▶ SHOW Hover the Temperatures chart; click a legend checkbox to hide/show a line.

**Temperatures** — a live chart. Bed, chamber, and every tool get a colour
that's guaranteed not to be confusable with the others; you can override any
of them in Settings.

▶ SHOW Type `M114` in the Console and press Enter.

The **Console** lives on every screen. Send any G-code; replies come back
inline. There's a scroll-capture trick here: over the middle of a tall log the
wheel scrolls the *page*; over the edges it scrolls the *log*. You'll see the
edge light up when you're in the zone.

▶ SHOW Expand `heat` → `heaters` in the Object model card.

And the **Object model inspector** — the firmware's full live state, browsable.
Every card in this UI tells you which part of the object model it reads from
— that little tag next to the title — so you can always trace a number back to
its source.

---

## 3. Control — 90 s

▶ SHOW `#/control`. Pan across Tools & heaters, Fans, Homing, Movement,
Extruders.

Control is where you **drive** the machine.

▶ SHOW Hover Homing. Click **HOME** on X (safe — it's homed already).

**Homing** — per-axis home and release, plus home-all and tram. Each button
shows the code it's about to send; on this machine that's G28 per axis, G32
for tram.

▶ SHOW In Movement, click **1 MM**, then **+1** on X, then **–1** on X.

**Movement** — a jog pad with step sizes and a feed. You can lock the
coordinates with M120/M121 while you work. Again: each press is one G1, and
you can read it before you send it.

▶ SHOW Tools & heaters: type `200` in Tool 0's *Active* field, then click
**ACT**. Then click **OFF**.

**Tools and heaters** — active and standby setpoints per tool, and the three
mode keys: Active, Standby, Off. Here's a subtlety: when you type a new
setpoint, the key **arms** — you'll see it thicken — because now it's going
to send the setpoint *and* the mode change together. You always know which of
the two commands a key is about to send, because it's shown.

▶ SHOW Click a tool's name button (Tool 1) to select it; click **DESELECT**.

Selecting a tool is T1; deselect is T-1. The `P` field lets you choose whether
tool-change macros run.

▶ SHOW Fans: type `50` for Blower 0, click **SET**, then **OFF**. Hover **PIN**.

**Fans** — set a percentage, or pin it. A **pinned** command re-sends every
half-second, which is how you override a running job's fan without editing
the file. Pinned commands have their own card — we'll see it on Activity.

▶ SHOW Extruders: hover **LOAD** / **UNLOAD** and the filament dropdown; hover
**RETRACT** / **EXTRUDE**.

**Extruders** — load and unload filament by name, with the option to run the
load and unload macros, and manual feed in millimetres at a feed rate.

▶ SHOW Macros card (left): expand a folder, hover a **RUN** button. Tick and
untick **AUTOCONFIRM**.

And the **Macros** card — your `0:/macros` tree, inline. With autoconfirm off,
run takes two clicks, so a stray tap on a tablet can't fire a macro.

---

## 4. Jobs — and starting a print — 75 s

▶ SHOW `#/jobs`. Hover the file list.

Jobs is the inventory of `0:/gcodes`. Folders, upload, rename, delete,
download.

▶ SHOW **Click** `3DBenchy.gcode`. Wait for Job details to populate with the
thumbnail and facts.

One rule holds across every file view in this interface: **clicking a file
never runs it.** Clicking opens it. Here that means Job details: the slicer's
thumbnail, print time, filament, height, layer height.

▶ SHOW Hover **Simulate**.

**Simulate** runs the file without heating or moving, so the firmware can give
you its own time estimate.

▶ SHOW Click **Start print**. Switch to `#/activity` as soon as the state
changes. *(This heats the machine. Make sure the bed is clear.)*

And **Start print** is an explicit button — the only place a job starts from
this screen. That's M32 on the file. Let's follow it.

---

## 5. Activity — watching a job — 75 s

▶ SHOW `#/activity` with the print running. Pan: Printing · estimates, Tuning,
Toolpath, Layer times, Cancel objects.

Activity is the **during-a-print** screen.

▶ SHOW Hover Printing · estimates: progress, layer, elapsed, remaining,
Pause / Cancel.

Progress, layer, elapsed, remaining — with **Pause** and **Cancel** kept above
the fold on purpose.

▶ SHOW Tuning: drag the speed slider, click **+0.02** on babystep, then **ZERO**.

**Tuning** — speed factor and Z babystep, live. M220 and M290.

▶ SHOW Toolpath: click **Speed**, then **Layer time**, then back to
**Feature**. Click **Layer** then **Progressive**.

**Toolpath** — the G-code rendered as it prints. Colour by feature, by speed,
or by layer time. Show the whole model, the current layer, or progressive —
what's been laid down so far. Travel moves can be toggled.

▶ SHOW Layer times chart.

**Layer times** — a bar per layer, with min, max and average. A slow layer
jumps out.

▶ SHOW Cancel objects card.

**Cancel objects** — if the slicer labelled objects, they're listed here, and
any one of them can be cancelled mid-print with M486.

▶ SHOW Pinned commands: click **+ ADD**, type `M106 S128`, add it; then remove it.

And here's **Pinned commands** — any M-code, re-sent on an interval, for the
things you want to hold over a job: a fan speed, a feed override, whatever.

▶ SHOW Click **Cancel** on the job if you don't want the Benchy to finish.
Wait for IDLE.

---

## 6. Bed maintenance — tramming the bed — 90 s

▶ SHOW `#/bed`. Pan: Height map, Mesh, Bed tram, Probe point.

Bed maintenance is its own screen because on this machine the bed is
**three independent Z motors**, and that's worth a place of its own.

▶ SHOW Hover the Height map. Click **3D**, rotate it a little, click back.

The **Height map** — the current mesh, as a coloured grid or a 3D surface.
Range on the bar below.

▶ SHOW Mesh card: open the **Height map** dropdown. Hover **PROBE BED**,
**USE THIS MAP**, **CLEAR MESH**.

**Mesh** — probe a new map, load any saved map, save the current one under a
new name, or clear compensation. The tag tells you it's G29 and its variants.

▶ SHOW Bed tram card. Make sure the bed is clear and nothing is hot.
Click **TRAM BED**. Wait for the result.

Now, **tramming**. This is G32, which runs `bed.g` — on this machine that
probes the three screw positions and the firmware drives each Z motor to
level the bed. When it finishes, the reply is parsed into this card: the
correction applied to **each screw**, the deviation **before and after**, and
how many points were used.

▶ SHOW Point at the before → after deviation in the result.

That arrow — before to after — is the number you actually care about. If it's
not small, tram again; the firmware converges.

▶ SHOW Click **HOME Z**.

Tramming moves the bed, so the Z datum is stale afterwards. **Home Z** is
right here for that reason.

*(Do not demonstrate Probe point — it's out of scope for this video.)*

---

## 7. Macros and System — editing on the machine — 45 s

▶ SHOW `#/macros`. Click a macro file — it opens in the Editor, not runs.

Macros — the same tree as the Control card, but here clicking **opens the
file in an editor**. Syntax-highlighted G-code, with a revision history you
can step back through, and a check that the file on the board hasn't changed
under you before you save.

▶ SHOW `#/system`. Click `config.g`. Scroll the editor. Don't save.

System files — `0:/sys`. `config.g`, `bed.g`, `homeall.g`, your height-map
CSVs. Same editor, same history. (A firmware-update card is available for this
screen too; it isn't on the layout shown here.)

---

## 8. Settings — making it yours — 75 s

▶ SHOW `#/settings`. Pan all cards.

Settings is everything the firmware **can't know** about your machine.

▶ SHOW Axis roles.

**Axis roles** — the labels we saw on Position and Movement.

▶ SHOW Tool dock sensors.

**Tool dock sensors** — map a presence switch to each tool's dock. The UI will
show *docked* or *away* per tool. It deliberately doesn't say "mounted" — a
switch in the dock can't know that.

▶ SHOW Sensor names. Camera URL.

**Sensor names**, the **camera stream URL**.

▶ SHOW Filament editor: click **PETG**, click **CONFIG.G**, scroll the editor.

**Filament editor** — your filament profiles, with their config, load and
unload macros, editable in place.

▶ SHOW Chart colours: click a swatch, pick a colour. Temperature gradient.

**Chart colours** — override any heater's line. It warns you if your pick is
too close to another line, but it doesn't stop you. **Temperature gradient**
— the cold, warm and hot colours every temperature reading wears.

▶ SHOW Configuration card: point at **SAVE TO MACHINE** and **Saved versions**.

All of this lives in one file on the SD card. Changes are staged — the button
lights up when there's something to save — and every save keeps a **version**
you can roll back to.

---

## 9. Composing your own screens — 75 s

▶ SHOW `#/machine`. Click the palette icon at the bottom of the left rail.

Last thing, and the one that makes it *yours*. Every screen is a **layout of
cards**, and every layout is editable.

▶ SHOW Drag a card from the palette onto the canvas. Drag it by its handle to
a new spot. Drag the resize corner.

Open the palette, drag a card in. Move it by its handle — Ctrl-click to pick
up several. Resize from the corner; cards won't shrink below what their
content needs.

▶ SHOW Click **↺ Reset layout**.

Every layout is an overlay on an immutable default, so **Reset** is fearless:
it drops the overlay and you're back to stock. Nothing to repair.

▶ SHOW In the palette: type a name, click **+ New screen**. Show it appear in
the rail. Then delete it.

You can add whole **new screens** to the rail, rename the built-in ones, or
hide the ones you don't use.

▶ SHOW Hover **Download this screen** / **Import**.

And a screen — including any custom cards on it — can be **exported as a file**
and imported on another machine.

▶ SHOW `#/cards` (Card Lab) briefly, just to show the space exists.

Custom cards themselves are built in the Card Lab — that's a video of its own.

---

## 10. Close — 20 s

▶ SHOW `#/machine` again, Vellum, clean layout. Hold.

That's dwc-ng. One G-code per control. Layouts you can't break. A screen that
knows which machine it's for.

Links in the description.

---

## Shot list summary

| # | Screen | Key actions | Machine state needed |
|---|--------|-------------|---------------------|
| 0 | Machine | — | any |
| 1 | Machine | Theme, scale, camera toggles; (optional) STOP | any |
| 2 | Machine | Console `M114`; expand Object model | any |
| 3 | Control | Home X; jog ±1; setpoint + ACT/OFF; select/deselect tool; fan SET/OFF; macros folder | homed, tools docked |
| 4 | Jobs | Click file → details; **Start print** | homed, bed clear |
| 5 | Activity | Tuning, toolpath modes, pinned add/remove; Cancel | print running |
| 6 | Bed | 3D map; mesh dropdown; **TRAM BED**; **HOME Z** | cool, bed clear, homed |
| 7 | Macros, System | Open a macro; open config.g (no save) | any |
| 8 | Settings | Filament editor; chart colour pick; versions | any |
| 9 | Machine | Compose: add/move/resize card; reset; new screen; export | any |
| 10 | Machine | — | any |

Things deliberately **not** shown: re-probing a single height-map point,
firmware update, the dev-only backend toggle and write guard, Card Lab internals.
