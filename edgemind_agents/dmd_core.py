"""
dmd_core.py — Dynamic Mode Decomposition (DMD) math engine.

Implements Exact DMD (Schmid 2010) using a thin/truncated SVD.
No external dependencies beyond numpy and scipy (already in requirements.txt).

Usage
-----
    dmd = DMDForecaster()
    dmd.fit(X)                              # X: (n_features, n_snapshots)
    forecasts = dmd.forecast(x_now, n_steps=8)  # returns (n_steps, n_features)
    if dmd.max_growth_rate_per_sec() > 0.001:
        print("Unstable mode detected!")

Mathematics
-----------
Given snapshot pairs (X1, X2) where X2[:, k] = A @ X1[:, k]:

1. Thin SVD:    X1 ≈ U Σ V*       (rank-r truncation where σ_r/σ_0 > tol)
2. Reduced op:  Ã  = U* X2 V Σ⁻¹  (r×r matrix)
3. Eig:         Ã  W = W Λ         (eigenvalues λ_i, eigenvectors w_i)
4. DMD modes:   Φ  = X2 V Σ⁻¹ W   (n_features × r)
5. Amplitudes:  b  = Φ⁺ x₀        (least-squares fit to initial condition)
6. Forecast:    x(t+k) = Re[Φ (Λᵏ ⊙ b)]
"""

import logging
from typing import Optional, Tuple

import numpy as np
from numpy.linalg import lstsq
from scipy.linalg import svd, eig

log = logging.getLogger(__name__)

# Singular value truncation: drop modes where σ_k / σ_0 < SVD_TOL
_SVD_TOL = 1e-6
# Maximum eigenvalue magnitude cap — prevents runaway extrapolation
_EIG_MAG_CAP = 5.0


class DMDForecaster:
    """Exact Dynamic Mode Decomposition with forecast and growth-rate analysis."""

    def __init__(
        self,
        n_modes: Optional[int] = None,
        dt: float = 15.0,
        svd_tol: float = _SVD_TOL,
    ):
        """
        Parameters
        ----------
        n_modes : int | None
            Maximum number of DMD modes to retain. None keeps all non-negligible modes.
        dt : float
            Time step between snapshots (seconds). Used to convert discrete eigenvalues
            to continuous growth rates.
        svd_tol : float
            Relative singular value threshold for truncation.
        """
        self.n_modes = n_modes
        self.dt = dt
        self.svd_tol = svd_tol

        # Fitted attributes (set by .fit())
        self._eigenvalues: Optional[np.ndarray] = None   # complex (r,)
        self._modes: Optional[np.ndarray] = None         # complex (n_features, r)
        self._amplitudes: Optional[np.ndarray] = None    # complex (r,)
        self._n_features: int = 0
        self._fitted: bool = False

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def fit(self, X: np.ndarray) -> "DMDForecaster":
        """
        Fit DMD to snapshot matrix X.

        Parameters
        ----------
        X : np.ndarray, shape (n_features, n_snapshots)
            Column-major time series. Each column is one observation in time.
            Must have n_snapshots >= n_features + 2 for a well-conditioned solve.

        Returns
        -------
        self
        """
        self._fitted = False
        n_features, n_snapshots = X.shape

        if n_snapshots < 4:
            log.debug("DMD: too few snapshots (%d < 4), skipping fit", n_snapshots)
            return self

        X1 = X[:, :-1]   # (n_features, n_snapshots-1)
        X2 = X[:, 1:]    # (n_features, n_snapshots-1)

        # Step 1: thin SVD of X1
        try:
            U, sigma, Vt = svd(X1, full_matrices=False)
        except Exception as exc:
            log.warning("DMD: SVD failed: %s", exc)
            return self

        # Step 2: truncate by relative singular value threshold
        tol_abs = sigma[0] * self.svd_tol if sigma[0] > 0 else self.svd_tol
        keep = sigma > tol_abs
        if self.n_modes is not None:
            keep[self.n_modes:] = False

        r = int(keep.sum())
        if r < 1:
            log.debug("DMD: no significant modes after truncation")
            return self

        U_r = U[:, :r]
        sigma_r = sigma[:r]
        Vt_r = Vt[:r, :]

        sigma_inv = np.diag(1.0 / sigma_r)

        # Step 3: reduced DMD operator  Ã = U_r* X2 V_r Σ_r⁻¹
        A_tilde = U_r.T @ X2 @ Vt_r.T @ sigma_inv   # (r, r)

        # Step 4: eigendecomposition of Ã
        try:
            eigenvalues, W = eig(A_tilde)
        except Exception as exc:
            log.warning("DMD: eig failed: %s", exc)
            return self

        # Step 5: DMD modes in original space  Φ = X2 V_r Σ_r⁻¹ W
        Phi = X2 @ Vt_r.T @ sigma_inv @ W    # (n_features, r)

        # Step 6: amplitudes from initial condition (first snapshot)
        x0 = X1[:, 0].astype(complex)
        b, _, _, _ = lstsq(Phi, x0, rcond=None)

        # Cap eigenvalue magnitudes to prevent runaway extrapolation
        mags = np.abs(eigenvalues)
        too_large = mags > _EIG_MAG_CAP
        if too_large.any():
            log.debug("DMD: capping %d eigenvalue(s) with |λ| > %.1f", too_large.sum(), _EIG_MAG_CAP)
            eigenvalues[too_large] *= (_EIG_MAG_CAP / mags[too_large])

        self._eigenvalues = eigenvalues
        self._modes = Phi
        self._amplitudes = b
        self._n_features = n_features
        self._fitted = True
        return self

    @property
    def is_fitted(self) -> bool:
        return self._fitted

    def forecast(self, x_current: np.ndarray, n_steps: int) -> Optional[np.ndarray]:
        """
        Forecast n_steps into the future from x_current.

        Parameters
        ----------
        x_current : np.ndarray, shape (n_features,)
            Current (latest) observation.
        n_steps : int
            Number of time steps to forecast.

        Returns
        -------
        np.ndarray, shape (n_steps, n_features), or None if not fitted.
            Real part of the DMD reconstruction at each future step.
        """
        if not self._fitted:
            return None

        # Re-compute amplitudes from x_current for a more accurate forecast
        b, _, _, _ = lstsq(self._modes, x_current.astype(complex), rcond=None)

        results = np.zeros((n_steps, self._n_features))
        for k in range(1, n_steps + 1):
            x_pred = self._modes @ (self._eigenvalues ** k * b)
            results[k - 1] = np.real(x_pred)

        return results

    def growth_rates(self) -> Optional[np.ndarray]:
        """
        Continuous growth rates per mode: σ_i = log(|λ_i|) / dt  (1/second).

        Positive values → growing mode (bad).
        Negative values → decaying mode (self-stabilizing).
        Near-zero → oscillatory / steady state.
        """
        if not self._fitted:
            return None
        return np.log(np.abs(self._eigenvalues)) / self.dt

    def max_growth_rate_per_sec(self) -> float:
        """Return the largest (most dangerous) growth rate. 0.0 if not fitted."""
        rates = self.growth_rates()
        if rates is None or len(rates) == 0:
            return 0.0
        return float(np.max(rates))

    def dominant_mode_index(self) -> Optional[int]:
        """Index of the fastest-growing eigenmode."""
        rates = self.growth_rates()
        if rates is None:
            return None
        return int(np.argmax(rates))

    def n_growing_modes(self, threshold: float = 0.0) -> int:
        """Count of modes with growth rate > threshold."""
        rates = self.growth_rates()
        if rates is None:
            return 0
        return int(np.sum(rates > threshold))

    def eigenvalue_magnitudes(self) -> Optional[np.ndarray]:
        """|λ_i| for each mode."""
        if not self._fitted:
            return None
        return np.abs(self._eigenvalues)


# ---------------------------------------------------------------------------
# Normalisation helpers
# ---------------------------------------------------------------------------

def normalize_features(X: np.ndarray) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Normalise each feature row to zero mean, unit std.

    Returns
    -------
    X_norm : normalised matrix (same shape as X)
    mu     : per-row mean     (n_features,)
    sigma  : per-row std      (n_features,), zeros replaced with 1.0
    """
    mu = X.mean(axis=1, keepdims=True)       # (n_features, 1)
    sigma = X.std(axis=1, keepdims=True)      # (n_features, 1)
    sigma[sigma < 1e-12] = 1.0               # avoid divide-by-zero on flat signals
    return (X - mu) / sigma, mu.squeeze(), sigma.squeeze()


def denormalize_forecast(
    forecasts_norm: np.ndarray,
    mu: np.ndarray,
    sigma: np.ndarray,
) -> np.ndarray:
    """
    Invert the normalisation applied by normalize_features().

    Parameters
    ----------
    forecasts_norm : (n_steps, n_features)
    mu, sigma      : (n_features,)
    """
    return forecasts_norm * sigma[np.newaxis, :] + mu[np.newaxis, :]


def build_feature_matrix(
    history: list,
    feature_keys: list,
    limits: dict,
) -> Optional[np.ndarray]:
    """
    Build the snapshot matrix X from a list of per-timestep dicts.

    Parameters
    ----------
    history : list of dicts, each mapping feature_key → float value
    feature_keys : ordered list of key names (defines row order in X)
    limits : dict mapping key → upper_limit (used for ratio normalisation)

    Returns
    -------
    X : (n_features, n_snapshots) ndarray, or None if history is empty.
    """
    if not history:
        return None
    rows = []
    for key in feature_keys:
        lim = limits.get(key, 1.0) or 1.0
        row = [h.get(key, 0.0) / lim for h in history]
        rows.append(row)
    return np.array(rows, dtype=float)
