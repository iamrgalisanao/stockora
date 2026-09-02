import { SlidingWindowLimiter } from './rate-limit';

describe('SlidingWindowLimiter (unit)', () => {
  it('allows up to the limit within a window, then blocks', () => {
    const l = new SlidingWindowLimiter(1000);
    const key = 'auth:1.2.3.4';
    for (let i = 0; i < 3; i += 1) {
      expect(l.check(key, 3, 1000).allowed).toBe(true);
    }
    const blocked = l.check(key, 3, 1000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('decrements the remaining count', () => {
    const l = new SlidingWindowLimiter(1000);
    expect(l.check('k', 5, 0).remaining).toBe(4);
    expect(l.check('k', 5, 0).remaining).toBe(3);
  });

  it('resets after the window elapses', () => {
    const l = new SlidingWindowLimiter(1000);
    l.check('k', 1, 0);
    expect(l.check('k', 1, 500).allowed).toBe(false); // still in window
    expect(l.check('k', 1, 1001).allowed).toBe(true); // window rolled over
  });

  it('keys are independent', () => {
    const l = new SlidingWindowLimiter(1000);
    l.check('a', 1, 0);
    expect(l.check('a', 1, 0).allowed).toBe(false);
    expect(l.check('b', 1, 0).allowed).toBe(true);
  });

  it('prune drops expired buckets', () => {
    const l = new SlidingWindowLimiter(1000);
    l.check('a', 1, 0);
    l.prune(2000);
    // After prune the bucket is gone, so the next request starts a fresh window.
    expect(l.check('a', 1, 2000).allowed).toBe(true);
  });
});
