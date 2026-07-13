# M409: Query object model — snapshot

> **Vendored reference (read-only).** Verbatim snapshot of the `M409` section
> of the RepRapFirmware G-code dictionary. This is the authoritative source for
> the `rr_model` / M409 **flag letters** (`f v n o d a p`) and array-chunking
> semantics that are *not* present in the vendored connector source.
>
> - Source: https://docs.duet3d.com/User_manual/Reference/Gcodes (`#m409-query-object-model`)
> - Retrieved: 2026-07-10
> - Do not edit; re-fetch from the URL above to update.

---

## M409: Query object model

### Parameters

- **`K"key"`** — Key string, default empty
- **`F"flags"`** — Flags string, default empty
- **`Rnnn`** — Pass through request to RepRapFirmware (only for SBC mode, v3.5.2 or later)
- **`Innn`** — Increment sequence number of the given key (reserved for internal usage ONLY)

### Examples

```gcode
M409 K"move.axes" F"f"          ; report all frequently-changing properties of all axes
M409 K"move.axes[0]" F"v,n,d4"  ; report all properties of the first axis, including values not normally reported, to a maximum depth of 4
M409 K"move.axes[].homed"       ; for all axes, report whether it is homed
M409 K"#move.axes"              ; report the number of axes
M409 F"v"                       ; report the whole object model to the default depth
```

### Usage

The **key string** is just the path to the object model variables wanted, with
the following extensions:

- An element that is an array may be followed by either `[number]` to select
  just one element, or by `[]` to select all elements and report the results as
  an array.
- The path may be preceded by `#` in which case the path must refer to an array
  and just the number of array elements is returned.
- An empty key string selects the entire object model. Note, the entire object
  model may be very large, so there is typically insufficient buffer space to
  construct a JSON response that represents the whole object model. For this
  reason, RepRapFirmware sets a **default maximum depth of 1** if the key string
  is empty or not present and the `f` flag is not included in the flags string.

The **flags string** may include one or more of the following letters:

- **`f`** — return only those values in the object model that typically change
  frequently during a job.
- **`v`** — Verbose: include values that are rarely needed and not normally
  returned.
- **`n`** — include fields with null values.
- **`o`** — include obsolete fields (v3.3 and newer).
- **`d`** — limit the depth of the reported tree to the specified number
  following the letter `d`. Objects at the maximum depth will be returned as
  `{}`.
- **`a`** — use this only when the key requested is an array, e.g. `"tools"` or
  `"move.axes"`. When an array contains a lot of data, it may not be possible to
  return the entire array in one go. This parameter directs RRF to fetch array
  elements starting at the number that follows the letter `a`, default 0. The
  **`next`** field in the reply indicates the index of the first array element
  that was not fetched, or `0` if there are no more elements to fetch.
- **`p`** — this indicates that the requesting device is PanelDue or a similar
  device. It causes RRF not to return fields that are not of interest to
  PanelDue, thereby shortening the response. Supported in RRF 3.6.0 and later;
  ignored by earlier RRF versions.

The flags string may optionally use **spaces or commas** to separate the
individual flags.

The response is a JSON object of the following form:

```json
{"key":"key","flags":"flags","result":object-value}
```

If the key string is malformed or refers to a property that does not exist in
the object model, the `result` field is null.

### Notes

- For details of the Object Model supported by RepRapFirmware, see *Object Model
  of RepRapFirmware*.
- From RRF 3.6.0 some floating point values in the object model returned by
  M409 are now expressed using exponential format.
- As of RRF 3.5.0 some arrays in the M409 response may be **truncated** under
  some conditions, to ensure that the response will fit in the available buffer
  space. Currently the only array affected is `move.axes[]` which is truncated
  to **9 elements** unless the `f` flag is included. To retrieve the entire
  array, make a request for key `"move.axes"` with flag `"a0"`.
