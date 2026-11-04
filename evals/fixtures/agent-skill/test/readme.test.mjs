import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
test('README exists',()=>assert.ok(readFileSync('README.md','utf8')));
