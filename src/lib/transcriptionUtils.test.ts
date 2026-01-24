import assert from 'node:assert/strict';
import { compileQuestFromQuestJson } from '../runtime-core/compileQuest';
import { normalizeTime } from './transcriptionUtils';

{
  assert.equal(normalizeTime(0.25), 0.25);
  assert.equal(normalizeTime('0.25'), 0.25);
  assert.equal(normalizeTime({ toNumber: () => 0.25 }), 0.25);
  assert.equal(normalizeTime({ $numberDecimal: '0.25' }), 0.25);
  assert.equal(normalizeTime({ N: '0.25' }), 0.25);
  assert.equal(normalizeTime({ n: '0.25' }), 0.25);
  assert.equal(normalizeTime({ value: '0.25' }), 0.25);
  assert.equal(normalizeTime({ value: 0.25 }), 0.25);
}

{
  const questJson = {
    quest: { name: 'T', description: '' },
    objects: [
      {
        id: 'o1',
        name: 'Obj 1',
        description: '',
        coordinates: { lat: 0, lng: 0 },
        images: [],
        status: 'published',
        createdAt: new Date().toISOString(),
        mediaTimeline: {
          version: 1,
          items: [
            {
              id: 'a1',
              type: 'audio',
              enabled: true,
              order: 0,
              url: 'https://example.com/audio.mp3',
              // Bad source (all-zero timings).
              transcription_words: [{ word: 'hello', start: 0, end: 0 }],
              // Good source (editor timings).
              transcription_data: { text: 'hello', words: [{ word: 'hello', start: 0.5, end: 1.0 }] },
              transcription_text: 'hello',
            },
          ],
        },
      },
    ],
  };

  const compiled = compileQuestFromQuestJson(questJson as any, {
    questId: 'T',
    questVersion: 'v1',
  });

  const node = (compiled.timelineNodes as any)['tl_o1:a1'];
  assert.ok(node);
  assert.equal(node.type, 'audio');
  assert.equal(node.payload.audioKind, 'narration');
  assert.ok(node.payload.transcription);
  assert.equal(node.payload.transcription.words.length, 1);
  assert.equal(node.payload.transcription.words[0].start, 0.5);
  assert.equal(node.payload.transcription.words[0].end, 1.0);
}

console.log('PASS: transcriptionUtils');
