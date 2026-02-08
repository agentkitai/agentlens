/**
 * StatisticalComparator (Story 3.3)
 *
 * Hypothesis testing for benchmark variant comparisons.
 * Implements Welch's t-test and chi-squared test with numerical p-value computation.
 */

import type {
  BenchmarkMetric,
  MetricComparison,
  MetricStats,
  VariantMetrics,
} from '@agentlensai/core';

// ─── Metric Classification ────────────────────────────────

/** Continuous metrics → Welch's t-test */
const CONTINUOUS_METRICS: Set<BenchmarkMetric> = new Set([
  'avg_cost',
  'avg_latency',
  'avg_tokens',
  'avg_duration',
  'health_score',
]);

/** Proportion metrics → chi-squared test */
const PROPORTION_METRICS: Set<BenchmarkMetric> = new Set([
  'error_rate',
  'completion_rate',
  'tool_success_rate',
]);

/**
 * Lower-is-better metrics. For these, a *lower* mean in variant B means B is "better".
 * For higher-is-better metrics, a *higher* mean in B means B is better.
 */
const LOWER_IS_BETTER: Set<BenchmarkMetric> = new Set([
  'avg_cost',
  'avg_latency',
  'error_rate',
  'avg_duration',
]);

// ─── T-Test Result ─────────────────────────────────────────

export interface TTestResult {
  tStatistic: number;
  degreesOfFreedom: number;
  pValue: number;
  confidenceInterval: { lower: number; upper: number };
  cohenD: number;
}

// ─── Chi-Squared Result ────────────────────────────────────

export interface ChiSquaredResult {
  chiSquared: number;
  pValue: number;
  phi: number;
}

// ─── Numerical Approximations ──────────────────────────────

/**
 * Error function approximation (Abramowitz and Stegun, formula 7.1.26).
 * Maximum error: 1.5×10⁻⁷.
 */
function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  const a = Math.abs(x);

  const p = 0.3275911;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;

  const t = 1.0 / (1.0 + p * a);
  const t2 = t * t;
  const t3 = t2 * t;
  const t4 = t3 * t;
  const t5 = t4 * t;

  const y = 1.0 - (a1 * t + a2 * t2 + a3 * t3 + a4 * t4 + a5 * t5) * Math.exp(-a * a);
  return sign * y;
}

/**
 * Standard normal CDF using error function.
 */
function normalCDF(x: number): number {
  return 0.5 * (1.0 + erf(x / Math.SQRT2));
}

/**
 * Log-gamma function using Stirling's approximation (Lanczos).
 */
function logGamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];

  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }

  x -= 1;
  let a = c[0]!;
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) {
    a += c[i]! / (x + i);
  }

  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/**
 * Regularized incomplete beta function I_x(a, b) using continued fraction.
 * Used for computing t-distribution CDF.
 */
function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  // Use symmetry relation if needed for better convergence
  if (x > (a + 1) / (a + b + 2)) {
    return 1 - regularizedBeta(1 - x, b, a);
  }

  const lnBeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta) / a;

  // Lentz's continued fraction
  const maxIter = 200;
  const eps = 1e-14;

  let f = 1;
  let c = 1;
  let d = 1 - (a + b) * x / (a + 1);
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  f = d;

  for (let m = 1; m <= maxIter; m++) {
    // Even step
    let num = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1 + num * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + num / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    f *= c * d;

    // Odd step
    num = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + num * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + num / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = c * d;
    f *= delta;

    if (Math.abs(delta - 1) < eps) break;
  }

  return front * f;
}

/**
 * Student's t-distribution CDF using the regularized incomplete beta function.
 */
function tCDF(t: number, df: number): number {
  const x = df / (df + t * t);
  const prob = 0.5 * regularizedBeta(x, df / 2, 0.5);
  return t >= 0 ? 1 - prob : prob;
}

/**
 * Two-tailed p-value from t-statistic and degrees of freedom.
 */
function twoTailedPValue(t: number, df: number): number {
  return 2 * (1 - tCDF(Math.abs(t), df));
}

/**
 * Chi-squared CDF for 1 degree of freedom using error function.
 * P(X ≤ x) for X ~ χ²(1) = P(Z² ≤ x) = erf(√(x/2))
 */
function chiSquaredCDF1(x: number): number {
  if (x <= 0) return 0;
  return erf(Math.sqrt(x / 2));
}

/**
 * t critical value for 95% CI (two-tailed).
 * Approximation for large df; uses normal for df > 200.
 */
function tCritical95(df: number): number {
  if (df > 200) return 1.96;
  // Newton-Raphson or use a simple lookup for common values
  // Use an approximation: t ≈ z * (1 + (z² + 1) / (4 * df))
  // where z = 1.96 for 95% CI
  const z = 1.96;
  if (df <= 1) return 12.706;
  if (df <= 2) return 4.303;
  if (df <= 3) return 3.182;
  if (df <= 4) return 2.776;
  if (df <= 5) return 2.571;
  // Cornish-Fisher approximation
  return z + (z * z * z + z) / (4 * df);
}

// ─── StatisticalComparator ─────────────────────────────────

export class StatisticalComparator {
  /**
   * Welch's t-test for comparing two sets of continuous metric statistics.
   */
  welchTTest(statsA: MetricStats, statsB: MetricStats): TTestResult {
    // Edge case: insufficient samples
    if (statsA.count < 2 || statsB.count < 2) {
      const diff = statsB.mean - statsA.mean;
      return {
        tStatistic: 0,
        degreesOfFreedom: 0,
        pValue: 1,
        confidenceInterval: { lower: diff, upper: diff },
        cohenD: 0,
      };
    }

    const nA = statsA.count;
    const nB = statsB.count;
    const varA = statsA.stddev * statsA.stddev;
    const varB = statsB.stddev * statsB.stddev;
    const seA = varA / nA;
    const seB = varB / nB;
    const seDiff = Math.sqrt(seA + seB);

    // Edge case: zero variance in both groups
    if (seDiff === 0) {
      const diff = statsB.mean - statsA.mean;
      return {
        tStatistic: diff === 0 ? 0 : Infinity,
        degreesOfFreedom: nA + nB - 2,
        pValue: diff === 0 ? 1 : 0,
        confidenceInterval: { lower: diff, upper: diff },
        cohenD: 0,
      };
    }

    // t-statistic
    const t = (statsA.mean - statsB.mean) / seDiff;

    // Welch-Satterthwaite degrees of freedom
    const num = (seA + seB) ** 2;
    const denom = (seA * seA) / (nA - 1) + (seB * seB) / (nB - 1);
    const df = num / denom;

    // p-value (two-tailed)
    const pValue = twoTailedPValue(t, df);

    // 95% CI for difference of means
    const diffMeans = statsB.mean - statsA.mean;
    const tCrit = tCritical95(df);
    const marginOfError = tCrit * seDiff;

    // Cohen's d — pooled standard deviation
    const pooledVar =
      ((nA - 1) * varA + (nB - 1) * varB) / (nA + nB - 2);
    const pooledSD = Math.sqrt(pooledVar);
    const cohenD = pooledSD > 0 ? Math.abs(statsA.mean - statsB.mean) / pooledSD : 0;

    return {
      tStatistic: t,
      degreesOfFreedom: df,
      pValue: Math.min(1, Math.max(0, pValue)),
      confidenceInterval: {
        lower: diffMeans - marginOfError,
        upper: diffMeans + marginOfError,
      },
      cohenD,
    };
  }

  /**
   * Chi-squared test with Yates' continuity correction for comparing two proportions.
   */
  chiSquaredTest(
    successesA: number,
    totalA: number,
    successesB: number,
    totalB: number,
  ): ChiSquaredResult {
    const failuresA = totalA - successesA;
    const failuresB = totalB - successesB;
    const n = totalA + totalB;

    // Edge case: empty samples
    if (n === 0 || totalA === 0 || totalB === 0) {
      return { chiSquared: 0, pValue: 1, phi: 0 };
    }

    // Expected counts
    const totalSuccess = successesA + successesB;
    const totalFailure = failuresA + failuresB;

    // Edge case: no variation (all successes or all failures)
    if (totalSuccess === 0 || totalFailure === 0) {
      return { chiSquared: 0, pValue: 1, phi: 0 };
    }

    const eA1 = (totalA * totalSuccess) / n;
    const eA0 = (totalA * totalFailure) / n;
    const eB1 = (totalB * totalSuccess) / n;
    const eB0 = (totalB * totalFailure) / n;

    // Chi-squared with Yates' correction
    const yates = (observed: number, expected: number): number => {
      const diff = Math.abs(observed - expected) - 0.5;
      return diff > 0 ? (diff * diff) / expected : 0;
    };

    const chiSq = yates(successesA, eA1) + yates(failuresA, eA0) +
                  yates(successesB, eB1) + yates(failuresB, eB0);

    // p-value using chi-squared CDF with 1 df
    const pValue = 1 - chiSquaredCDF1(chiSq);

    // Phi coefficient
    const phi = Math.sqrt(chiSq / n);

    return {
      chiSquared: chiSq,
      pValue: Math.min(1, Math.max(0, pValue)),
      phi,
    };
  }

  /**
   * Compare two variants on a single metric. Selects appropriate test.
   */
  compare(
    variantA: { id: string; name: string; metrics: Record<string, MetricStats> },
    variantB: { id: string; name: string; metrics: Record<string, MetricStats> },
    metric: BenchmarkMetric,
  ): MetricComparison {
    const statsA = variantA.metrics[metric];
    const statsB = variantB.metrics[metric];

    if (!statsA || !statsB) {
      throw new Error(`Metric ${metric} not found in one or both variants`);
    }

    const lowerIsBetter = LOWER_IS_BETTER.has(metric);

    if (PROPORTION_METRICS.has(metric)) {
      return this.compareProportions(variantA, variantB, metric, statsA, statsB, lowerIsBetter);
    }

    return this.compareContinuous(variantA, variantB, metric, statsA, statsB, lowerIsBetter);
  }

  private compareContinuous(
    variantA: { id: string; name: string },
    variantB: { id: string; name: string },
    metric: BenchmarkMetric,
    statsA: MetricStats,
    statsB: MetricStats,
    lowerIsBetter: boolean,
  ): MetricComparison {
    const result = this.welchTTest(statsA, statsB);

    const diff = statsB.mean - statsA.mean;
    const percentDiff = statsA.mean !== 0 ? (diff / statsA.mean) * 100 : 0;

    // Determine winner based on metric direction
    let winner: string | undefined;
    if (result.pValue < 0.05) {
      if (lowerIsBetter) {
        winner = statsA.mean < statsB.mean ? variantA.id : variantB.id;
      } else {
        winner = statsA.mean > statsB.mean ? variantA.id : variantB.id;
      }
    }

    return {
      metric,
      variantA: { id: variantA.id, name: variantA.name, stats: statsA },
      variantB: { id: variantB.id, name: variantB.name, stats: statsB },
      absoluteDiff: diff,
      percentDiff,
      testType: 'welch_t',
      testStatistic: result.tStatistic,
      pValue: result.pValue,
      confidenceInterval: result.confidenceInterval,
      effectSize: result.cohenD,
      significant: result.pValue < 0.05,
      winner,
      confidence: this.confidenceStars(result.pValue),
    };
  }

  private compareProportions(
    variantA: { id: string; name: string },
    variantB: { id: string; name: string },
    metric: BenchmarkMetric,
    statsA: MetricStats,
    statsB: MetricStats,
    lowerIsBetter: boolean,
  ): MetricComparison {
    // For proportions, mean represents the rate, count is total observations
    // Successes = mean * count (since mean = successes / total)
    const successesA = Math.round(statsA.mean * statsA.count);
    const successesB = Math.round(statsB.mean * statsB.count);

    const result = this.chiSquaredTest(successesA, statsA.count, successesB, statsB.count);

    const diff = statsB.mean - statsA.mean;
    const percentDiff = statsA.mean !== 0 ? (diff / statsA.mean) * 100 : 0;

    // For chi-squared we also compute a CI on the difference of proportions
    const pA = statsA.count > 0 ? successesA / statsA.count : 0;
    const pB = statsB.count > 0 ? successesB / statsB.count : 0;
    const sePropDiff = Math.sqrt(
      (pA * (1 - pA)) / Math.max(statsA.count, 1) +
      (pB * (1 - pB)) / Math.max(statsB.count, 1),
    );
    const marginOfError = 1.96 * sePropDiff;

    let winner: string | undefined;
    if (result.pValue < 0.05) {
      if (lowerIsBetter) {
        winner = statsA.mean < statsB.mean ? variantA.id : variantB.id;
      } else {
        winner = statsA.mean > statsB.mean ? variantA.id : variantB.id;
      }
    }

    return {
      metric,
      variantA: { id: variantA.id, name: variantA.name, stats: statsA },
      variantB: { id: variantB.id, name: variantB.name, stats: statsB },
      absoluteDiff: diff,
      percentDiff,
      testType: 'chi_squared',
      testStatistic: result.chiSquared,
      pValue: result.pValue,
      confidenceInterval: {
        lower: diff - marginOfError,
        upper: diff + marginOfError,
      },
      effectSize: result.phi,
      significant: result.pValue < 0.05,
      winner,
      confidence: this.confidenceStars(result.pValue),
    };
  }

  /**
   * Confidence star rating based on p-value.
   */
  confidenceStars(pValue: number): '★★★' | '★★' | '★' | '—' {
    if (pValue < 0.01) return '★★★';
    if (pValue < 0.05) return '★★';
    if (pValue < 0.1) return '★';
    return '—';
  }
}
