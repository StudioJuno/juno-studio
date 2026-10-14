const { test } = require("node:test"),
  assert = require("node:assert/strict");
const {
  parseWords,
  validateWords,
} = require("../electron/video/transcript-words.cjs");
const M = require("../electron/video/model.cjs");
const word = (text, from, to, tokens) => ({
  text,
  offsets: { from, to },
  tokens,
});
test("Whisper word parser preserves measured pauses, pieces, punctuation and chunk offset", () => {
  const parsed = parseWords(
    {
      transcription: [
        word("[_BEG_]", 0, 0),
        word(" Bon", 100, 200),
        word("jour", 200, 350),
        word(" Juno", 500, 1000, [word(" Juno", 500, 700)]),
        word("!", 700, 750),
      ],
    },
    30,
    31,
  );
  assert.deepEqual(parsed, [
    {
      start: 30.1,
      end: 30.75,
      text: "Bonjour Juno!",
      words: [
        { start: 30.1, end: 30.35, text: "Bonjour" },
        { start: 30.5, end: 30.75, text: "Juno!" },
      ],
    },
  ]);
  validateWords(parsed[0]);
});
test("Whisper parser bounds overlaps and ignores invalid offsets", () => {
  const parsed = parseWords(
    {
      transcription: [
        word(" a", 0, 300),
        word(" b", 200, 600),
        word(" x", NaN, 700),
        word(" c", 700, 1200),
      ],
    },
    0,
    1,
  );
  for (const segment of parsed) validateWords(segment);
  assert.equal(parsed[0].words[1].start, 0.3);
  assert.equal(parsed.at(-1).end, 1);
  assert.throws(() =>
    validateWords({
      start: 0,
      end: 1,
      text: "a",
      words: [{ text: "b", start: 0, end: 0.5 }],
    }),
  );
});
test("sequence rejects out-of-range and overlapping word intervals", () => {
  const s = M.sequence();
  s.captionStyle = { wordMode: "highlight", highlightColor: "#ffe45c" };
  s.captions = [
    {
      id: "a",
      start: 0,
      duration: 50,
      text: "Un deux",
      words: [
        { start: 0, end: 10, from: 0, to: 2 },
        { start: 15, end: 40, from: 3, to: 7 },
      ],
    },
  ];
  assert.doesNotThrow(() => M.validateSequence(s, new Map()));
  s.captions[0].words[1].start = 5;
  assert.throws(() => M.validateSequence(s, new Map()));
  s.captions[0].words[1].start = 15;
  s.captions[0].words[1].end = 51;
  assert.throws(() => M.validateSequence(s, new Map()));
});
test('measured token confidence survives merging and rejects invalid confidence',()=>{
 const parsed=parseWords({transcription:[word(' Bon',0,100,[{...word(' Bon',0,100),p:.9}]),word('jour',100,200,[{...word('jour',100,200),p:.4}])]},0,1);
 assert.equal(parsed[0].words[0].confidence,.4);validateWords(parsed[0]);
 assert.throws(()=>validateWords({...parsed[0],words:[{...parsed[0].words[0],confidence:2}]}),/Confiance/);
});
