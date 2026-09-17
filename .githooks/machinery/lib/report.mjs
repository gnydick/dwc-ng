// Every executed check prints its denominator, zero included, so a pass for a bad reason stays visible (spec I25).
export function report(check, n, of, note) {
  process.stdout.write(`${check}: ${n} of ${of}${note ? ' ' + note : ''}\n`);
}
