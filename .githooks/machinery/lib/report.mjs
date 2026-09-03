// Every executed check prints its denominator, zero included (union: rules/tool-output.md § Proof lines and denominators; spec I25).
export function report(check, n, of, note) {
  process.stdout.write(`${check}: ${n} of ${of}${note ? ' ' + note : ''}\n`);
}
