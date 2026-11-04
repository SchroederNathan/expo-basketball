/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseUpdateChannel, updateDeepLink, updateQrImageUrl } from './channel';

describe('PR update links', () => {
  test('accepts a numeric PR channel', () => {
    assert.equal(parseUpdateChannel('pr-42'), 'pr-42');
    assert.equal(parseUpdateChannel(['pr-42']), 'pr-42');
  });

  test('rejects channels that are not PR-scoped', () => {
    assert.equal(parseUpdateChannel('production'), null);
    assert.equal(parseUpdateChannel('pr-0'), null);
    assert.equal(parseUpdateChannel(['pr-42', 'pr-43']), null);
  });

  test('builds a camera-scannable deep link and QR image URL', () => {
    assert.equal(updateDeepLink('pr-42'), 'basketball://update?channel=pr-42');
    assert.equal(updateQrImageUrl('pr-42', 240),
      'https://quickchart.io/qr?size=240&text=basketball%3A%2F%2Fupdate%3Fchannel%3Dpr-42',
    );
  });
});
