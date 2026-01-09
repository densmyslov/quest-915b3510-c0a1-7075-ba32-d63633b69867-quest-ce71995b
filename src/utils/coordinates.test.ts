import assert from "node:assert/strict";
import { formatLatLng, parseLatLng } from "./coordinates";

{
  const coords = parseLatLng("45.1234567, 9.7654321");
  assert.ok(coords);
  assert.equal(coords[0], 45.1234567);
  assert.equal(coords[1], 9.7654321);
  assert.notEqual(coords[0], 45.12346);
  assert.notEqual(coords[1], 9.76543);
}

{
  const coords = parseLatLng({ lat: "45.1234567", lng: "9.7654321" });
  assert.ok(coords);
  assert.equal(coords[0], 45.1234567);
  assert.equal(coords[1], 9.7654321);
}

{
  const coords = parseLatLng({ lat: { N: "45.1234567" }, lng: { N: "9.7654321" } });
  assert.ok(coords);
  assert.equal(coords[0], 45.1234567);
  assert.equal(coords[1], 9.7654321);
}

{
  assert.equal(formatLatLng([45.1234567, 9.7654321]), "45.1234567, 9.7654321");
}

console.log("PASS: coordinates");
