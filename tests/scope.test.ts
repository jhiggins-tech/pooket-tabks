import { describe, expect, it } from 'vitest';
import { Emitter } from '../src/core/emitter';
import { Scope } from '../src/ui/online/scope';

describe('Scope (one online attempt)', () => {
  it('runs its ends once, newest first, and anything added afterwards straight away', () => {
    const scope = new Scope();
    const ran: string[] = [];
    scope.onEnd(() => ran.push('a'));
    const drop = scope.onEnd(() => ran.push('dropped'));
    scope.onEnd(() => ran.push('b'));
    drop();
    expect(scope.alive).toBe(true);
    scope.end();
    scope.end();
    expect(ran).toEqual(['b', 'a']);
    expect(scope.alive).toBe(false);
    scope.onEnd(() => ran.push('late'));
    expect(ran).toEqual(['b', 'a', 'late']);
  });
});

describe('Emitter', () => {
  it('calls listeners in the order they were added; on() returns how to stop listening', () => {
    const e = new Emitter<{ ping: [n: number] }>();
    const got: string[] = [];
    e.on('ping', (n) => got.push(`a${n}`));
    const off = e.on('ping', (n) => got.push(`b${n}`));
    e.emit('ping', 1);
    off();
    e.emit('ping', 2);
    expect(got).toEqual(['a1', 'b1', 'a2']);
  });
});
