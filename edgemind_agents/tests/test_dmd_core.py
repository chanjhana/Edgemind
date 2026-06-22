"""
test_dmd_core.py — Unit tests for the DMD math engine.

Covers:
  1. Growing signal  — exponentially growing sin; all eigenvalues should have |λ|>1
  2. Stable signal   — pure sine wave; all eigenvalues should have |λ|≈1
  3. Forecast shape  — output is (n_steps, n_features)
  4. Normalisation round-trip — denormalise(normalise(X)) ≈ X
  5. Edge cases      — too few snapshots, constant signals
"""

import numpy as np
import pytest

from edgemind_agents.dmd_core import DMDForecaster, normalize_features, denormalize_forecast


# ── Helpers ────────────────────────────────────────────────────────────────

def make_growing(n_features=4, n_snapshots=30, growth=1.1):
    """Exponentially growing multivariate signal."""
    t = np.arange(n_snapshots)
    X = np.zeros((n_features, n_snapshots))
    for i in range(n_features):
        X[i] = (growth ** t) * (1 + 0.05 * np.sin(t * (i + 1)))
    return X


def make_stable_sine(n_features=4, n_snapshots=30):
    """Pure sine wave — steady oscillation, no growth."""
    t = np.arange(n_snapshots)
    X = np.zeros((n_features, n_snapshots))
    for i in range(n_features):
        X[i] = np.sin(t * 0.3 + i * 0.5) + 2.0   # offset so values are positive
    return X


# ── Tests ──────────────────────────────────────────────────────────────────

class TestDMDForecaster:

    def test_growing_signal_positive_growth_rate(self):
        """DMD on an exponentially growing signal should detect |λ|>1."""
        X = make_growing(n_features=3, n_snapshots=25, growth=1.05)
        dmd = DMDForecaster(dt=15.0)
        dmd.fit(X)
        assert dmd.is_fitted
        gr = dmd.max_growth_rate_per_sec()
        # growth=1.05 per step, dt=15s → σ = log(1.05)/15 ≈ 0.00325/s
        assert gr > 0.0, f"Expected positive growth rate, got {gr}"
        assert dmd.n_growing_modes() >= 1

    def test_stable_signal_near_zero_growth(self):
        """DMD on a pure sine should have growth rates near zero."""
        X = make_stable_sine(n_features=3, n_snapshots=30)
        dmd = DMDForecaster(dt=15.0)
        dmd.fit(X)
        assert dmd.is_fitted
        gr = dmd.max_growth_rate_per_sec()
        # Allow a small numerical tolerance
        assert gr < 0.05, f"Stable signal should have ~0 growth rate, got {gr}"

    def test_forecast_shape(self):
        """forecast() returns (n_steps, n_features) array."""
        X = make_growing(n_features=4, n_snapshots=25)
        dmd = DMDForecaster(dt=15.0)
        dmd.fit(X)
        x_now = X[:, -1]
        forecasts = dmd.forecast(x_now, n_steps=8)
        assert forecasts is not None
        assert forecasts.shape == (8, 4), f"Expected (8, 4), got {forecasts.shape}"

    def test_forecast_growing_increases(self):
        """For a growing signal, forecast values should trend upward."""
        X = make_growing(n_features=2, n_snapshots=25, growth=1.08)
        dmd = DMDForecaster(dt=15.0)
        dmd.fit(X)
        x_now = X[:, -1]
        forecasts = dmd.forecast(x_now, n_steps=8)
        assert forecasts is not None
        # First feature: last forecast step should be >= first step
        assert forecasts[-1, 0] >= forecasts[0, 0], "Growing signal forecast should trend up"

    def test_too_few_snapshots(self):
        """DMD with fewer than 4 snapshots should return unfitted."""
        X = np.random.randn(3, 3)
        dmd = DMDForecaster()
        dmd.fit(X)
        assert not dmd.is_fitted
        assert dmd.forecast(np.zeros(3), n_steps=4) is None
        assert dmd.max_growth_rate_per_sec() == 0.0

    def test_constant_signal(self):
        """Constant (zero-variance) signal should not raise exceptions."""
        X = np.ones((3, 20)) * 5.0
        dmd = DMDForecaster()
        # May or may not fit; should not raise
        try:
            dmd.fit(X)
        except Exception as exc:
            pytest.fail(f"DMD raised on constant signal: {exc}")

    def test_eigenvalue_magnitudes_available(self):
        """eigenvalue_magnitudes() returns array of same length as modes."""
        X = make_growing(n_features=3, n_snapshots=20)
        dmd = DMDForecaster()
        dmd.fit(X)
        mags = dmd.eigenvalue_magnitudes()
        assert mags is not None
        assert len(mags) > 0

    def test_n_modes_truncation(self):
        """n_modes truncation should reduce the number of eigenvalues."""
        X = make_growing(n_features=6, n_snapshots=30)
        dmd_full  = DMDForecaster(n_modes=None)
        dmd_trunc = DMDForecaster(n_modes=3)
        dmd_full.fit(X)
        dmd_trunc.fit(X)
        mags_full  = dmd_full.eigenvalue_magnitudes()
        mags_trunc = dmd_trunc.eigenvalue_magnitudes()
        assert len(mags_trunc) <= len(mags_full)
        assert len(mags_trunc) <= 3


class TestNormalisation:

    def test_round_trip(self):
        """normalize then denormalize should recover original matrix."""
        X = make_growing(n_features=4, n_snapshots=20)
        X_norm, mu, sigma = normalize_features(X)
        X_back = denormalize_forecast(X_norm.T, mu, sigma).T   # (n_features, n_snapshots)
        np.testing.assert_allclose(X_back, X, rtol=1e-5, atol=1e-8)

    def test_normalised_mean_zero(self):
        """Each row of X_norm should have mean ≈ 0."""
        X = make_growing(n_features=4, n_snapshots=20)
        X_norm, _, _ = normalize_features(X)
        row_means = X_norm.mean(axis=1)
        np.testing.assert_allclose(row_means, 0.0, atol=1e-10)

    def test_flat_row_not_nan(self):
        """A constant row (zero std) should not produce NaN after normalisation."""
        X = np.random.randn(3, 20)
        X[1, :] = 5.0   # flat row
        X_norm, _, _ = normalize_features(X)
        assert not np.isnan(X_norm).any(), "NaN in normalised matrix with flat row"
