import assert from 'node:assert/strict';
import { getVideoConfig } from './timelineUtils';

{
  const config = getVideoConfig({});
  assert.equal(config.autoPlay, true);
  assert.equal(config.muted, true);
  assert.equal(config.loop, false);
}

{
  const config = getVideoConfig({ autoPlay: false });
  assert.equal(config.autoPlay, false);
  assert.equal(config.muted, false);
}

{
  const config = getVideoConfig({ autoPlay: true, muted: false });
  assert.equal(config.autoPlay, true);
  assert.equal(config.muted, false);
}

{
  const config = getVideoConfig({ autoplay: true });
  assert.equal(config.autoPlay, true);
  assert.equal(config.muted, true);
}

console.log('PASS: timelineUtils');
