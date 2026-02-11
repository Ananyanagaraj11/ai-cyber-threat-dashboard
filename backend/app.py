from fastapi import FastAPI, File, UploadFile, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import torch
from torch import nn
import joblib
import numpy as np
from pathlib import Path
import pandas as pd
from io import StringIO
from typing import List

app = FastAPI()

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Exact model architecture matching training code
class CyberThreatModel(nn.Module):
    def __init__(self, input_dim, num_classes, hidden_dims=[128, 64], dropout=0.3):
        super().__init__()
        layers = []
        prev_dim = input_dim
        
        for hidden_dim in hidden_dims:
            layers.extend([
                nn.Linear(prev_dim, hidden_dim),
                nn.BatchNorm1d(hidden_dim),
                nn.ReLU(),
                nn.Dropout(dropout)
            ])
            prev_dim = hidden_dim
        
        self.backbone = nn.Sequential(*layers)
        self.head = nn.Linear(prev_dim, num_classes)
    
    def forward(self, x):
        x = self.backbone(x)
        return self.head(x)

# Load model artifacts
artifacts_dir = Path("backend/artifacts")
device = torch.device("cpu")

try:
    # Load metadata first
    classes = torch.load(artifacts_dir / "classes.pt", map_location=device, weights_only=False)
    scaler = joblib.load(artifacts_dir / "scaler.joblib")
    
    with open(artifacts_dir / "feature_names.txt", "r") as f:
        feature_names = [line.strip() for line in f]
    
    # Load model checkpoint
    checkpoint = torch.load(artifacts_dir / "model.pt", map_location=device, weights_only=False)
    
    # Extract model parameters
    input_dim = checkpoint.get('input_dim', len(feature_names))
    num_classes = checkpoint.get('num_classes', len(classes))
    hidden_dims = checkpoint.get('hidden_dims', [128, 64])
    dropout = checkpoint.get('dropout', 0.3)
    
    # Create model and load weights
    model = CyberThreatModel(input_dim, num_classes, hidden_dims, dropout)
    model.load_state_dict(checkpoint['model_state_dict'])
    model.eval()
    
    print(f"✓ Model loaded successfully!")
    print(f"✓ Features: {len(feature_names)}, Classes: {len(classes)}")
    print(f"✓ Architecture: {hidden_dims}, Dropout: {dropout}")
    print(f"✓ Classes: {', '.join(classes[:5])}..." if len(classes) > 5 else f"✓ Classes: {', '.join(classes)}")
except Exception as e:
    print(f"✗ Error loading model: {e}")
    import traceback
    traceback.print_exc()
    model = None
    scaler = None
    classes = []
    feature_names = []

# In-memory store for last CSV analysis (so dashboard can load it even when localStorage is not shared)
last_analysis_store = {}

# Request models
class PredictionRequest(BaseModel):
    features: List[float]

class BatchPredictionRequest(BaseModel):
    features: List[List[float]]

# Serve dashboard (one demo URL: open / or /dashboard/index.html)
_dashboard_dir = Path(__file__).resolve().parent.parent / "dashboard"
if _dashboard_dir.exists():
    app.mount("/dashboard", StaticFiles(directory=str(_dashboard_dir), html=True), name="dashboard")

@app.get("/")
def read_root():
    return RedirectResponse(url="/dashboard/index.html", status_code=302)

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "model_loaded": model is not None,
        "features": len(feature_names),
        "classes": len(classes)
    }

@app.get("/config")
def config():
    return {
        "input_dim": len(feature_names),
        "class_names": classes,
        "model_type": "PyTorch Neural Network"
    }

@app.post("/api/last-analysis")
async def store_last_analysis(request: Request):
    """Store last CSV analysis so the dashboard can load it (avoids localStorage cross-origin issues)."""
    try:
        data = await request.json()
        last_analysis_store["data"] = data
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}

@app.get("/api/last-analysis")
def get_last_analysis():
    """Return the last stored CSV analysis for the dashboard."""
    return last_analysis_store.get("data")

@app.post("/predict")
def predict(request: PredictionRequest):
    if model is None:
        return {"error": "Model not loaded"}
    
    try:
        features = np.array(request.features).reshape(1, -1)
        features = np.nan_to_num(features, nan=0.0, posinf=1e10, neginf=-1e10)
        features_scaled = scaler.transform(features)
        
        features_tensor = torch.FloatTensor(features_scaled)
        with torch.no_grad():
            outputs = model(features_tensor)
            probabilities = torch.softmax(outputs, dim=1)
            predicted_idx = torch.argmax(probabilities, dim=1).item()
            confidence = probabilities[0][predicted_idx].item()
        
        predicted_class = classes[predicted_idx]
        
        top_probs, top_indices = torch.topk(probabilities[0], k=min(3, len(classes)))
        top_predictions = [
            {"class": classes[idx.item()], "probability": prob.item()}
            for prob, idx in zip(top_probs, top_indices)
        ]
        
        return {
            "predicted_class": predicted_class,
            "confidence": confidence,
            "top_predictions": top_predictions,
            "all_probabilities": {classes[i]: probabilities[0][i].item() for i in range(len(classes))}
        }
    
    except Exception as e:
        return {"error": str(e)}

@app.post("/predict/batch")
def predict_batch(request: BatchPredictionRequest):
    if model is None:
        return {"error": "Model not loaded"}
    
    try:
        features = np.array(request.features)
        features = np.nan_to_num(features, nan=0.0, posinf=1e10, neginf=-1e10)
        features_scaled = scaler.transform(features)
        
        features_tensor = torch.FloatTensor(features_scaled)
        with torch.no_grad():
            outputs = model(features_tensor)
            probabilities = torch.softmax(outputs, dim=1)
            predicted_indices = torch.argmax(probabilities, dim=1)
        
        results = []
        for i in range(len(features)):
            predicted_idx = predicted_indices[i].item()
            confidence = probabilities[i][predicted_idx].item()
            predicted_class = classes[predicted_idx]
            
            results.append({
                "predicted_class": predicted_class,
                "confidence": confidence,
                "index": i
            })
        
        class_counts = {}
        for result in results:
            cls = result["predicted_class"]
            class_counts[cls] = class_counts.get(cls, 0) + 1
        
        attack_count = sum(count for cls, count in class_counts.items() if cls != "BENIGN")
        
        return {
            "total_predictions": len(results),
            "results": results,
            "summary": {
                "class_distribution": class_counts,
                "total_attacks": attack_count,
                "total_benign": class_counts.get("BENIGN", 0),
                "attack_percentage": (attack_count / len(results) * 100) if results else 0
            }
        }
    
    except Exception as e:
        return {"error": str(e)}

@app.post("/analyze/csv")
async def analyze_csv(file: UploadFile = File(...)):
    """Analyze uploaded CSV file (CICIDS2017 format)"""
    if model is None:
        return {"success": False, "error": "Model not loaded"}
    
    try:
        contents = await file.read()
        df = pd.read_csv(StringIO(contents.decode('utf-8')))
        
        print(f"✓ CSV uploaded: {len(df)} rows, {len(df.columns)} columns")
        
        has_labels = 'Label' in df.columns or ' Label' in df.columns
        label_col = 'Label' if 'Label' in df.columns else (' Label' if ' Label' in df.columns else None)
        
        if label_col:
            actual_labels = df[label_col].values
            df = df.drop(columns=[label_col])
        else:
            actual_labels = None
        
        numeric_df = df.select_dtypes(include=[np.number])
        
        if len(numeric_df.columns) > len(feature_names):
            numeric_df = numeric_df.iloc[:, :len(feature_names)]
        
        max_rows = 1000
        if len(numeric_df) > max_rows:
            numeric_df = numeric_df.head(max_rows)
            if actual_labels is not None:
                actual_labels = actual_labels[:max_rows]
        
        numeric_df = numeric_df.replace([np.inf, -np.inf], np.nan)
        numeric_df = numeric_df.fillna(0)
        
        features = numeric_df.values
        features_scaled = scaler.transform(features)
        features_tensor = torch.FloatTensor(features_scaled)
        
        with torch.no_grad():
            outputs = model(features_tensor)
            probabilities = torch.softmax(outputs, dim=1)
            predicted_indices = torch.argmax(probabilities, dim=1)
        
        predictions = []
        class_counts = {}
        
        for i in range(len(features)):
            predicted_idx = predicted_indices[i].item()
            confidence = probabilities[i][predicted_idx].item()
            predicted_class = classes[predicted_idx]
            
            class_counts[predicted_class] = class_counts.get(predicted_class, 0) + 1
            
            pred_dict = {
                "index": i,
                "predicted_class": predicted_class,
                "confidence": confidence
            }
            
            if actual_labels is not None:
                pred_dict["actual_label"] = str(actual_labels[i])
            
            predictions.append(pred_dict)
        
        accuracy = None
        if actual_labels is not None:
            correct = sum(1 for p in predictions if p["predicted_class"] == p["actual_label"])
            accuracy = correct / len(predictions)
        
        attack_count = sum(count for cls, count in class_counts.items() if cls != "BENIGN")
        
        result = {
            "success": True,
            "total_rows": len(predictions),
            "predictions": predictions[:100],
            "summary": {
                "class_distribution": class_counts,
                "total_attacks": attack_count,
                "total_benign": class_counts.get("BENIGN", 0),
                "attack_percentage": (attack_count / len(predictions) * 100),
                "accuracy": accuracy
            }
        }
        # Store so dashboard can load it via GET /api/last-analysis (works even if localStorage is not shared)
        last_analysis_store["data"] = result
        return result
    
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}

@app.post("/predict/explain")
def explain_prediction(request: PredictionRequest):
    """Return feature importance for a prediction"""
    if model is None:
        return {"error": "Model not loaded"}
    
    try:
        features = np.array(request.features).reshape(1, -1)
        features = np.nan_to_num(features, nan=0.0, posinf=1e10, neginf=-1e10)
        
        feature_importance = []
        for i, (name, value) in enumerate(zip(feature_names[:10], features[0][:10])):
            feature_importance.append({
                "feature": name,
                "value": float(value),
                "importance": abs(float(value)) / (abs(features[0]).max() + 1e-10)
            })
        
        feature_importance.sort(key=lambda x: x["importance"], reverse=True)
        
        return {
            "top_features": feature_importance[:10]
        }
    
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)