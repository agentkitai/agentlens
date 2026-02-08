/**
 * Tests for cosine similarity utility (Story 2.1)
 */

import { describe, it, expect } from 'vitest';
import { cosineSimilarity } from '../math.js';

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
  });

  it('returns -1.0 for opposite vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([-1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
  });

  it('computes correct similarity for known vectors', () => {
    // [1,2,3] · [4,5,6] = 4+10+18 = 32
    // ||[1,2,3]|| = sqrt(14) ≈ 3.7417
    // ||[4,5,6]|| = sqrt(77) ≈ 8.7749
    // cos = 32 / (3.7417 * 8.7749) ≈ 0.9746
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([4, 5, 6]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.9746, 3);
  });

  it('handles normalized vectors', () => {
    // Pre-normalized unit vectors
    const a = new Float32Array([1 / Math.sqrt(2), 1 / Math.sqrt(2), 0]);
    const b = new Float32Array([1, 0, 0]);
    // cos(45°) ≈ 0.7071
    expect(cosineSimilarity(a, b)).toBeCloseTo(1 / Math.sqrt(2), 4);
  });

  it('returns 0 for zero vector', () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('throws on dimension mismatch', () => {
    const a = new Float32Array([1, 2]);
    const b = new Float32Array([1, 2, 3]);
    expect(() => cosineSimilarity(a, b)).toThrow('Vector dimension mismatch');
  });

  it('throws on zero-length vectors', () => {
    const a = new Float32Array([]);
    const b = new Float32Array([]);
    expect(() => cosineSimilarity(a, b)).toThrow('zero-length');
  });

  it('works with high-dimensional vectors (384d)', () => {
    // Simulate embedding dimensions
    const a = new Float32Array(384);
    const b = new Float32Array(384);
    for (let i = 0; i < 384; i++) {
      a[i] = Math.random() - 0.5;
      b[i] = a[i]!; // same vector
    }
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 4);
  });

  it('is symmetric: cos(a,b) === cos(b,a)', () => {
    const a = new Float32Array([1, 3, -5]);
    const b = new Float32Array([4, -2, 1]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 6);
  });
});
