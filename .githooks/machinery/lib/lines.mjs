// The one home of the chunk-to-lines rule (#19 fix round 1): a second derivation would
// eventually disagree with the first. It was typed twice — lib/capture.mjs for the quiet-output
// capture, lib/git.mjs for the streamed diff — and the two would eventually have disagreed.
// No dependencies of its own, so both can import it and the installed gate can carry it.
//
// The rule: split what has arrived so far on '\n'. split() always yields at least one
// element, and the last one is exactly the part with no newline after it yet — '' when the
// text ended on a newline — so popping it is the entire rule. That remainder is carried
// into the next chunk rather than emitted, or a line straddling a chunk boundary would come
// out as two half-lines. Bytes, not strings, go in: a chunk boundary can fall inside a
// multi-byte character, and toString('utf8') on either half yields a replacement character,
// so ONE StringDecoder per splitter holds the partial bytes back (the mechanism capture.mjs
// already used; git.mjs's setEncoding('utf8') did the same thing by a second route).
import { StringDecoder } from 'node:string_decoder';

export function lineSplitter() {
  const decoder = new StringDecoder('utf8');
  let leftover = '';
  return {
    // Whole lines completed by this chunk, in order. The unterminated tail is kept back.
    push(chunk) {
      const parts = (leftover + decoder.write(chunk)).split('\n');
      leftover = parts.pop();
      return parts;
    },
    // The unterminated tail (plus any bytes the decoder was holding), handed over once.
    end() {
      const tail = leftover + decoder.end();
      leftover = '';
      return tail;
    },
  };
}
