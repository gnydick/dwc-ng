import { render } from 'solid-js/web'
import './index.css'
import App from './App.tsx'
import { probeTransport } from './connector/createConnector.ts'
import { initialBackend, pinnedTransport } from './dev/backend.ts'

const root = document.getElementById('app')!

// The dialect has to be known BEFORE App runs: the connector is constructed in
// App's body and a session may never re-point it (C14), so there is no "detect
// later and switch" — that is exactly the half-switched state the design
// forbids. Hence resolving it here, then rendering.
//
// A production bundle needs no configuration for this. It is served by the
// printer, so it is same-origin; there is no target to name and no way to know
// what someone calls their machine. If the build pinned a dialect
// (DWC_TRANSPORT, which packages/deploy can set because it knows the target)
// that is used as-is; otherwise the board is asked. The probe is not a guess:
// /machine/status existing IS the DSF signature, and its absence IS the
// standalone signature.
const pinned = pinnedTransport()
const transport = pinned ?? await probeTransport('')
render(() => <App backend={initialBackend(transport)} />, root)
