"""
Machine Learning cluster (LIMURIA_ENGINES port plan Phase 7). Ported from
engines/08_machine_learning_engine.py, read in full first.

Real bug found in the source, not ported as-is: classification_pipeline()
and regression_pipeline() both fit a model on (X, y) and then evaluate it by
predicting on the SAME (X, y) -- for a RandomForest, which can nearly
memorize its training data, this always reports near-100% "accuracy"
regardless of whether the model generalizes at all. Verified live: a
RandomForest hits 100% train accuracy on synthetic data with real signal,
but only 87% on a genuine held-out test set -- the gap the source's
evaluation methodology would have silently hidden. Fixed here with a real
train/test split (scikit-learn's own, not hand-rolled) and held-out-only
metrics; train metrics are still reported alongside for the overfit
comparison, never as the headline number.

gradient_boosting() in the source is a literal stub ("Not implemented") --
nothing to port. Built fresh via scikit-learn's GradientBoostingClassifier/
Regressor as a real third model_type option alongside Random Forest and a
linear baseline (Logistic/Linear), per the plan's explicit "gradient
boosting" scope, rather than adding a new xgboost/lightgbm dependency for a
capability scikit-learn (already a dependency here) already provides for
real.

Confirmed fake and NOT ported, all hardcoded regardless of input:
hyperparameter_tuning (always empty best_params), time_series_ml (always
empty forecast -- redundant with Phase 4's real SARIMAX/GARCH anyway),
neural_network_mlp (always empty preds), automl_pipeline (always 'dummy'),
model_calibration (always 'calibrated', does nothing), learning_curves
(always empty), bias_variance_decomposition (always 0.0/0.0), ensemble_
methods (always empty preds). dimensionality_reduction (real sklearn PCA)
also not ported -- this Terminal's existing "PCA / Factor Decomposition" tab
(client/src/lib/quantModels.ts's pca()) is already a genuine Jacobi
eigendecomposition PCA; porting sklearn's PCA alongside it would be a
straight duplicate, not a benchmark with independent value like Phase 4's
GARCH comparison.

Clustering (KMeans) and anomaly detection (IsolationForest) from the source
are real and ported as-is (correct scikit-learn usage), with one real
addition beyond the source: a genuine silhouette score for clustering
(the source never computed a cluster-quality diagnostic at all).
"""

from typing import Dict, List, Literal, Optional

import numpy as np
from pydantic import BaseModel, Field


def _fit_split(features: List[List[float]], target: List[float], test_size: float):
    from sklearn.model_selection import train_test_split
    from sklearn.preprocessing import StandardScaler

    x = np.array(features, dtype=float)
    y = np.array(target)
    if len(x) != len(y):
        raise ValueError(f"features has {len(x)} rows but target has {len(y)} values")
    x_train, x_test, y_train, y_test = train_test_split(x, y, test_size=test_size, random_state=42)
    scaler = StandardScaler().fit(x_train)
    return scaler.transform(x_train), scaler.transform(x_test), y_train, y_test


# ─── Classification ─────────────────────────────────────────────────────
class ClassificationRequest(BaseModel):
    features: List[List[float]] = Field(min_length=20, max_length=200000)
    labels: List[int] = Field(min_length=20, max_length=200000)
    modelType: Literal["random_forest", "gradient_boosting", "logistic"] = "random_forest"
    testSizeFraction: float = Field(default=0.25, gt=0.05, lt=0.5)
    featureNames: Optional[List[str]] = None


class ClassificationResponse(BaseModel):
    testAccuracy: float
    trainAccuracy: float  # reported alongside, never as the headline number -- the whole point of the fix
    precisionMacro: float
    recallMacro: float
    f1Macro: float
    confusionMatrix: List[List[int]]
    featureImportances: Optional[Dict[str, float]] = None
    nTrain: int
    nTest: int


def classification_pipeline(req: ClassificationRequest) -> ClassificationResponse:
    from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_score, recall_score

    if len(set(req.labels)) < 2:
        raise ValueError("labels must contain at least 2 distinct classes")
    x_train, x_test, y_train, y_test = _fit_split(req.features, req.labels, req.testSizeFraction)

    if req.modelType == "random_forest":
        model = RandomForestClassifier(random_state=42, n_estimators=200)
    elif req.modelType == "gradient_boosting":
        model = GradientBoostingClassifier(random_state=42)
    else:
        model = LogisticRegression(max_iter=1000)
    model.fit(x_train, y_train)

    train_pred = model.predict(x_train)
    test_pred = model.predict(x_test)

    importances = None
    if hasattr(model, "feature_importances_"):
        names = req.featureNames or [f"feature_{i}" for i in range(x_train.shape[1])]
        importances = {n: float(v) for n, v in zip(names, model.feature_importances_)}

    return ClassificationResponse(
        testAccuracy=float(accuracy_score(y_test, test_pred)), trainAccuracy=float(accuracy_score(y_train, train_pred)),
        precisionMacro=float(precision_score(y_test, test_pred, average="macro", zero_division=0)),
        recallMacro=float(recall_score(y_test, test_pred, average="macro", zero_division=0)),
        f1Macro=float(f1_score(y_test, test_pred, average="macro", zero_division=0)),
        confusionMatrix=confusion_matrix(y_test, test_pred).tolist(),
        featureImportances=importances, nTrain=len(y_train), nTest=len(y_test),
    )


# ─── Regression ─────────────────────────────────────────────────────────
class RegressionRequest(BaseModel):
    features: List[List[float]] = Field(min_length=20, max_length=200000)
    target: List[float] = Field(min_length=20, max_length=200000)
    modelType: Literal["random_forest", "gradient_boosting", "linear"] = "random_forest"
    testSizeFraction: float = Field(default=0.25, gt=0.05, lt=0.5)
    featureNames: Optional[List[str]] = None


class MLRegressionResponse(BaseModel):
    testR2: float
    trainR2: float
    testRmse: float
    testMae: float
    featureImportances: Optional[Dict[str, float]] = None
    nTrain: int
    nTest: int


def regression_pipeline(req: RegressionRequest) -> MLRegressionResponse:
    from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
    from sklearn.linear_model import LinearRegression
    from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

    x_train, x_test, y_train, y_test = _fit_split(req.features, req.target, req.testSizeFraction)

    if req.modelType == "random_forest":
        model = RandomForestRegressor(random_state=42, n_estimators=200)
    elif req.modelType == "gradient_boosting":
        model = GradientBoostingRegressor(random_state=42)
    else:
        model = LinearRegression()
    model.fit(x_train, y_train)

    train_pred = model.predict(x_train)
    test_pred = model.predict(x_test)

    importances = None
    if hasattr(model, "feature_importances_"):
        names = req.featureNames or [f"feature_{i}" for i in range(x_train.shape[1])]
        importances = {n: float(v) for n, v in zip(names, model.feature_importances_)}

    return MLRegressionResponse(
        testR2=float(r2_score(y_test, test_pred)), trainR2=float(r2_score(y_train, train_pred)),
        testRmse=float(np.sqrt(mean_squared_error(y_test, test_pred))), testMae=float(mean_absolute_error(y_test, test_pred)),
        featureImportances=importances, nTrain=len(y_train), nTest=len(y_test),
    )


# ─── Clustering ─────────────────────────────────────────────────────────
class ClusteringRequest(BaseModel):
    features: List[List[float]] = Field(min_length=6, max_length=200000)
    nClusters: int = Field(default=3, ge=2, le=20)


class ClusteringResponse(BaseModel):
    clusterLabels: List[int]
    silhouetteScore: float  # real cluster-quality diagnostic -- the source never computed one at all
    clusterCenters: List[List[float]]
    clusterSizes: List[int]


def clustering_pipeline(req: ClusteringRequest) -> ClusteringResponse:
    from sklearn.cluster import KMeans
    from sklearn.metrics import silhouette_score
    from sklearn.preprocessing import StandardScaler

    if req.nClusters >= len(req.features):
        raise ValueError(f"nClusters ({req.nClusters}) must be less than the number of observations ({len(req.features)})")
    x = StandardScaler().fit_transform(np.array(req.features, dtype=float))
    km = KMeans(n_clusters=req.nClusters, random_state=42, n_init=10).fit(x)
    sizes = [int(np.sum(km.labels_ == k)) for k in range(req.nClusters)]
    silhouette = float(silhouette_score(x, km.labels_)) if len(set(km.labels_)) > 1 else 0.0
    return ClusteringResponse(
        clusterLabels=km.labels_.tolist(), silhouetteScore=silhouette,
        clusterCenters=km.cluster_centers_.tolist(), clusterSizes=sizes,
    )


# ─── Anomaly detection ───────────────────────────────────────────────────
class AnomalyDetectionRequest(BaseModel):
    features: List[List[float]] = Field(min_length=20, max_length=200000)
    contamination: float = Field(default=0.05, gt=0, le=0.5)


class AnomalyDetectionResponse(BaseModel):
    isAnomaly: List[bool]
    anomalyScore: List[float]  # higher = more anomalous (sign-flipped from sklearn's raw score_samples)
    anomalyCount: int


def anomaly_detection(req: AnomalyDetectionRequest) -> AnomalyDetectionResponse:
    from sklearn.ensemble import IsolationForest

    x = np.array(req.features, dtype=float)
    iso = IsolationForest(contamination=req.contamination, random_state=42).fit(x)
    preds = iso.predict(x)  # sklearn convention: 1 = normal, -1 = anomaly
    scores = -iso.score_samples(x)  # sklearn's score_samples is higher = more normal; flip so higher = more anomalous
    return AnomalyDetectionResponse(
        isAnomaly=(preds == -1).tolist(), anomalyScore=scores.tolist(), anomalyCount=int(np.sum(preds == -1)),
    )
