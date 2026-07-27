import { describe, it, expect } from 'vitest';
import { sum } from '../src/smoke';

describe('toolchain', () => {
  it('addiert', () => {
    expect(sum(2, 3)).toBe(5);
  });
});
