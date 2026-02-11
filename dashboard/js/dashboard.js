// Configuration: use environment variable, same origin, or localhost:8000
const API_BASE = (typeof window !== 'undefined' && window.ENV_API_BASE) 
    ? window.ENV_API_BASE 
    : (typeof window !== 'undefined' && (window.location.port === '8000' || !/^localhost$/i.test(window.location.hostname))) 
        ? '' 
        : 'http://localhost:8000';
let FEATURE_COUNT = 78;
let CLASS_NAMES = [];
let predictionHistory = [];
let totalPredictions = 0;
let attackCount = 0;
/** When set, Attack Distribution and Top Attack Types use this (full CSV summary) so dashboard matches CSV page. */
let lastClassDistribution = null;

// Initialize dashboard
(async function init() {
    updateClock();
    setInterval(updateClock, 1000);

    const loadCsvBtn = document.getElementById('loadCSVBtn');
    if (loadCsvBtn) loadCsvBtn.addEventListener('click', loadCSVResultsClick);

    await checkHealth();
    await getConfig();

    initializeCharts();

    // Load last CSV analysis from backend (or localStorage) so dashboard shows CSV results
    const hasCSV = await loadSavedCSVAnalysisAsync();
    if (!hasCSV) {
        setTimeout(() => runPrediction(), 1000);
    }
})();

// Update clock
function updateClock() {
    const el = document.getElementById('clock');
    if (el && typeof moment !== 'undefined') el.textContent = moment().format('MMM DD, YYYY | HH:mm:ss');
}

// Check backend health
async function checkHealth() {
    try {
        const response = await fetch(`${API_BASE}/health`);
        if (response.ok) {
            setStatus(true, 'Connected');
        } else {
            setStatus(false, 'Disconnected');
        }
    } catch (error) {
        setStatus(false, 'Backend Offline');
        console.error('Health check failed:', error);
    }
}

// Get model configuration
async function getConfig() {
    try {
        const response = await fetch(`${API_BASE}/config`);
        const data = await response.json();
        if (data.input_dim > 0) {
            FEATURE_COUNT = data.input_dim;
        }
        if (data.class_names && data.class_names.length > 0) {
            CLASS_NAMES = data.class_names;
        }
        console.log(`Model config: ${FEATURE_COUNT} features, ${CLASS_NAMES.length} classes`);
    } catch (error) {
        console.error('Config fetch failed:', error);
    }
}

// Called when user clicks "Load CSV results"
function loadCSVResultsClick() {
    loadSavedCSVAnalysisAsync().then(loaded => {
        if (!loaded) {
            alert('No CSV analysis found.\n\n1. Go to the "CSV Analysis" page.\n2. Upload your CICIDS2017 CSV file.\n3. Click "Analyze File".\n4. Then return here and click "Load CSV results" or "Run Prediction".\n\nMake sure the backend (localhost:8000) is running.');
        }
    });
}

// Apply a loaded CSV analysis object to the dashboard (KPIs, charts, alerts, table)
function applyCSVAnalysis(data) {
    const preds = data && Array.isArray(data.predictions) ? data.predictions : null;
    if (!preds || preds.length === 0) return false;
predictionHistory = preds.map(p => ({
            predicted_class: p.predicted_class,
            confidence: p.confidence,
            actual_label: p.actual_label
        }));
        totalPredictions = data.total_rows != null ? data.total_rows : predictionHistory.length;
        if (data.summary && data.summary.total_attacks != null) {
            attackCount = data.summary.total_attacks;
        } else {
            attackCount = predictionHistory.filter(p => p.predicted_class !== 'BENIGN').length;
        }
        lastClassDistribution = (data.summary && data.summary.class_distribution) ? data.summary.class_distribution : null;
        updateKPIs();
    updateCharts();
    populateAlertsFromHistory();
    populateCSVResultsTable(preds);
    const section = document.getElementById('csvResultsSection');
    if (section) section.style.display = 'block';
    setStatus(true, 'CSV data loaded');
    return true;
}

// Load CSV analysis: try backend first (GET /api/last-analysis), then localStorage. Works even if dashboard is file:// and CSV page was localhost.
async function loadSavedCSVAnalysisAsync() {
    try {
        const response = await fetch(`${API_BASE}/api/last-analysis`);
        if (response.ok) {
            const data = await response.json();
            if (data && Array.isArray(data.predictions) && data.predictions.length > 0) {
                return applyCSVAnalysis(data);
            }
        }
    } catch (e) {
        console.warn('Backend last-analysis not available', e);
    }
    try {
        const saved = localStorage.getItem('lastAnalysis');
        if (!saved) return false;
        const data = JSON.parse(saved);
        return applyCSVAnalysis(data);
    } catch (e) {
        console.error('Load CSV analysis failed', e);
        return false;
    }
}


// Fill Recent Alerts from current prediction history (e.g. after loading CSV)
function populateAlertsFromHistory() {
    const container = document.getElementById('alertsTable');
    if (!container) return;
    container.innerHTML = '';
    const last = predictionHistory.slice(-20).reverse();
    last.forEach((pred, i) => {
        const alertItem = document.createElement('div');
        const className = pred.predicted_class || 'Unknown';
        const confidence = ((pred.confidence || 0) * 100).toFixed(1);
        let severity = 'benign';
        if (className !== 'BENIGN') {
            if (confidence > 90) severity = 'critical';
            else if (confidence > 75) severity = 'high';
            else if (confidence > 50) severity = 'medium';
            else severity = 'low';
        }
        alertItem.className = `alert-item ${severity}`;
        alertItem.innerHTML = `
            <div class="alert-header">
                <span class="alert-type">${className}</span>
                <span class="alert-time">—</span>
            </div>
            <div class="alert-confidence">Confidence: ${confidence}%</div>
        `;
        container.appendChild(alertItem);
    });
}

// Populate CSV results table (Entry #, Predicted, Confidence, Actual, Correct/Incorrect)
function populateCSVResultsTable(predictions) {
    const tbody = document.getElementById('csvResultsTableBody');
    const section = document.getElementById('csvResultsSection');
    if (!tbody || !section) return;
    tbody.innerHTML = '';
    (predictions || []).forEach(pred => {
        const tr = document.createElement('tr');
        const hasActual = pred.actual_label != null;
        const isCorrect = hasActual ? pred.predicted_class === pred.actual_label : null;
        const badgeClass = (pred.predicted_class || '').toLowerCase().replace(/\s+/g, '-');
        tr.innerHTML = `
            <td>${(pred.index || 0) + 1}</td>
            <td><span class="class-badge ${badgeClass}">${pred.predicted_class || 'Unknown'}</span></td>
            <td>${((pred.confidence || 0) * 100).toFixed(1)}%</td>
            <td>${hasActual ? pred.actual_label : 'N/A'}</td>
            <td>${hasActual ? (isCorrect ? '<span class="status-correct">✓ Correct</span>' : '<span class="status-incorrect">✗ Incorrect</span>') : 'N/A'}</td>
        `;
        tbody.appendChild(tr);
    });
}

// Clear CSV data and reset dashboard to live mode
function clearCSVData() {
    localStorage.removeItem('lastAnalysis');
    localStorage.removeItem('lastAnalysisTime');
    lastClassDistribution = null;
    predictionHistory = [];
    totalPredictions = 0;
    attackCount = 0;
    updateKPIs();
    initializeCharts();
    const container = document.getElementById('alertsTable');
    if (container) container.innerHTML = '';
    const section = document.getElementById('csvResultsSection');
    if (section) section.style.display = 'none';
    const tbody = document.getElementById('csvResultsTableBody');
    if (tbody) tbody.innerHTML = '';
    setStatus(true, 'Connected');
    setTimeout(() => runPrediction(), 500);
}

// Set status indicator
function setStatus(connected, text) {
    const indicator = document.getElementById('statusIndicator');
    const statusText = document.getElementById('statusText');
    
    if (connected) {
        indicator.classList.add('connected');
    } else {
        indicator.classList.remove('connected');
    }
    statusText.textContent = text;
}

// Generate random features
function generateRandomFeatures() {
    return Array.from({ length: FEATURE_COUNT }, () => Math.random() * 100);
}

// Run prediction — if CSV results exist (backend or localStorage), load and show them; otherwise run one live prediction
async function runPrediction() {
    const btn = document.getElementById('runPredictionBtn');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = 'Processing...';

    // Prefer loading CSV results from backend, then localStorage
    const hasCSV = await loadSavedCSVAnalysisAsync();
    if (hasCSV) {
        btn.disabled = false;
        btn.textContent = 'Run Prediction';
        return;
    }

    try {
        lastClassDistribution = null;
        const features = generateRandomFeatures();
        const response = await fetch(`${API_BASE}/predict`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ features })
        });

        const data = await response.json();

        predictionHistory.push(data);
        if (predictionHistory.length > 50) {
            predictionHistory.shift();
        }

        totalPredictions++;
        if (data.predicted_class !== 'BENIGN') {
            attackCount++;
        }

        updateKPIs();
        updateCharts();
        addAlert(data);

        setStatus(true, 'Connected');
    } catch (error) {
        console.error('Prediction failed:', error);
        setStatus(false, 'Request Failed');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Run Prediction';
    }
}

// Update KPIs
function updateKPIs() {
    document.getElementById('totalEvents').textContent = totalPredictions.toLocaleString();
    document.getElementById('eventsChange').textContent = predictionHistory.length;
    document.getElementById('attackEvents').textContent = attackCount.toLocaleString();
    
    const attackPercent = totalPredictions > 0 ? ((attackCount / totalPredictions) * 100).toFixed(1) : 0;
    document.getElementById('attackPercent').textContent = attackPercent;
    
    // Update threat level
    const threatLevelEl = document.getElementById('threatLevel');
    const threatDescEl = document.getElementById('threatDesc');
    
    if (attackPercent >= 50) {
        threatLevelEl.textContent = 'CRITICAL';
        threatLevelEl.className = 'CRITICAL';
        threatDescEl.textContent = 'Immediate Action Required';
    } else if (attackPercent >= 30) {
        threatLevelEl.textContent = 'HIGH';
        threatLevelEl.className = 'HIGH';
        threatDescEl.textContent = 'Elevated Threat Activity';
    } else if (attackPercent >= 15) {
        threatLevelEl.textContent = 'MEDIUM';
        threatLevelEl.className = 'MEDIUM';
        threatDescEl.textContent = 'Moderate Risk Detected';
    } else if (attackPercent > 0) {
        threatLevelEl.textContent = 'LOW';
        threatLevelEl.className = 'LOW';
        threatDescEl.textContent = 'Minimal Threats Observed';
    } else {
        threatLevelEl.textContent = 'NORMAL';
        threatLevelEl.className = 'NORMAL';
        threatDescEl.textContent = 'System Secure';
    }
}

// Update all charts (each in try/catch so one failure doesn't break others)
function updateCharts() {
    try { updateAttackDistPie(); } catch (e) { console.warn('Attack dist pie', e); }
    try { updateTopAttacksBar(); } catch (e) { console.warn('Top attacks bar', e); }
    try { updateSeverityLine(); } catch (e) { console.warn('Severity line', e); }
    try { updateEventsTimeline(); } catch (e) { console.warn('Events timeline', e); }
    try { updateFeatureImportance(); } catch (e) { console.warn('Feature importance', e); }
}

// Initialize empty charts
function initializeCharts() {
    const darkTemplate = {
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        font: { color: '#e0f2fe', family: 'Inter, Segoe UI' },
        xaxis: { gridcolor: '#2d5a7b', zerolinecolor: '#2d5a7b' },
        yaxis: { gridcolor: '#2d5a7b', zerolinecolor: '#2d5a7b' }
    };
    
    // Attack Distribution Pie
    Plotly.newPlot('attackDistPie', [{
        values: [1],
        labels: ['No Data'],
        type: 'pie',
        hole: 0.4,
        marker: { colors: ['#2d5a7b'] }
    }], {
        ...darkTemplate,
        showlegend: true,
        legend: { x: 0, y: 1, font: { size: 10 } },
        margin: { l: 20, r: 20, t: 20, b: 20 }
    }, { responsive: true });
    
    // Top Attacks Bar
    Plotly.newPlot('topAttacksBar', [{
        x: [0],
        y: ['No Data'],
        type: 'bar',
        orientation: 'h',
        marker: { color: '#2d5a7b' }
    }], {
        ...darkTemplate,
        margin: { l: 120, r: 20, t: 20, b: 40 }
    }, { responsive: true });
    
    // Severity Line
    Plotly.newPlot('severityLine', [{
        x: [],
        y: [],
        type: 'scatter',
        mode: 'lines',
        fill: 'tozeroy',
        line: { color: '#00d4aa', width: 2 }
    }], {
        ...darkTemplate,
        margin: { l: 40, r: 20, t: 20, b: 40 }
    }, { responsive: true });
    
    // Events Timeline
    Plotly.newPlot('eventsTimeline', [], {
        ...darkTemplate,
        margin: { l: 50, r: 20, t: 20, b: 40 }
    }, { responsive: true });
    
    // Feature Importance
    Plotly.newPlot('featureImportance', [{
        x: [0],
        y: ['No Data'],
        type: 'bar',
        orientation: 'h',
        marker: { color: '#2d5a7b' }
    }], {
        ...darkTemplate,
        margin: { l: 150, r: 20, t: 20, b: 40 }
    }, { responsive: true });
}

// Update Attack Distribution Pie Chart (uses full CSV class_distribution when available so it matches CSV page)
function updateAttackDistPie() {
    const classCounts = {};
    if (lastClassDistribution && typeof lastClassDistribution === 'object') {
        Object.assign(classCounts, lastClassDistribution);
    } else {
        predictionHistory.forEach(pred => {
            const className = pred.predicted_class || 'Unknown';
            classCounts[className] = (classCounts[className] || 0) + 1;
        });
    }
    const labels = Object.keys(classCounts);
    const values = Object.values(classCounts);
    const colors = [
        '#00d4aa', '#3b82f6', '#ef4444', '#f59e0b', '#22c55e',
        '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#84cc16'
    ];
    if (labels.length === 0) {
        Plotly.react('attackDistPie', [{
            values: [1],
            labels: ['No Data'],
            type: 'pie',
            hole: 0.4,
            marker: { colors: ['#2d5a7b'] }
        }], { showlegend: false, margin: { l: 20, r: 20, t: 20, b: 20 }, height: 280 }, { responsive: true });
        return;
    }
    Plotly.react('attackDistPie', [{
        values: values,
        labels: labels,
        type: 'pie',
        hole: 0.4,
        marker: { colors: colors.slice(0, labels.length) },
        textinfo: 'percent',
        textposition: 'inside',
        insidetextorientation: 'radial',
        hoverinfo: 'label+percent+value'
    }], {
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        font: { color: '#e0f2fe', size: 12 },
        showlegend: true,
        legend: {
            x: 0.5,
            y: -0.12,
            xanchor: 'center',
            yanchor: 'top',
            orientation: 'h',
            font: { size: 11 },
            tracegroupgap: 16
        },
        margin: { l: 20, r: 20, t: 30, b: 70 },
        height: 280
    }, { responsive: true });
}

// Update Top Attack Types bar (uses full CSV class_distribution when available so it matches CSV page)
function updateTopAttacksBar() {
    const classCounts = {};
    if (lastClassDistribution && typeof lastClassDistribution === 'object') {
        Object.assign(classCounts, lastClassDistribution);
    } else {
        predictionHistory.forEach(pred => {
            const className = pred.predicted_class || 'Unknown';
            classCounts[className] = (classCounts[className] || 0) + 1;
        });
    }
    const sorted = Object.entries(classCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
    const labels = sorted.map(([label]) => label);
    const values = sorted.map(([, count]) => count);
    if (labels.length === 0) {
        Plotly.react('topAttacksBar', [{
            x: [0],
            y: ['No Data'],
            type: 'bar',
            orientation: 'h',
            marker: { color: '#2d5a7b' }
        }], { paper_bgcolor: 'transparent', plot_bgcolor: 'transparent', margin: { l: 120, r: 20, t: 20, b: 40 } }, { responsive: true });
        return;
    }
    const colorScale = values.map((v, i) => {
        const ratio = i / Math.max(values.length - 1, 1);
        return `rgb(${59 + ratio * 196}, ${130 + ratio * 126}, ${246 - ratio * 90})`;
    });
    Plotly.react('topAttacksBar', [{
        x: values,
        y: labels,
        type: 'bar',
        orientation: 'h',
        marker: { color: colorScale, line: { color: '#2d5a7b', width: 1 } }
    }], {
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        font: { color: '#e0f2fe' },
        xaxis: { gridcolor: '#2d5a7b', zerolinecolor: '#2d5a7b' },
        yaxis: { gridcolor: '#2d5a7b', zerolinecolor: '#2d5a7b' },
        margin: { l: 120, r: 20, t: 20, b: 40 }
    }, { responsive: true });
}

// Update Severity Line Chart (use react so chart updates with many points from CSV)
function updateSeverityLine() {
    const severityScores = predictionHistory.map((pred) => {
        const confidence = pred.confidence || 0;
        const isAttack = pred.predicted_class !== 'BENIGN' ? 1 : 0;
        return confidence * isAttack;
    });
    const indices = severityScores.map((_, idx) => idx + 1);
    const layout = {
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        font: { color: '#e0f2fe', family: 'Inter, Segoe UI' },
        xaxis: { title: 'Event #', gridcolor: '#2d5a7b', zerolinecolor: '#2d5a7b' },
        yaxis: { title: 'Severity Score', gridcolor: '#2d5a7b', zerolinecolor: '#2d5a7b', range: [0, 1] },
        margin: { l: 40, r: 20, t: 20, b: 40 }
    };
    if (indices.length === 0) {
        Plotly.react('severityLine', [{
            x: [],
            y: [],
            type: 'scatter',
            mode: 'lines',
            fill: 'tozeroy',
            line: { color: '#00d4aa', width: 2 }
        }], layout, { responsive: true });
        return;
    }
    Plotly.react('severityLine', [{
        x: indices,
        y: severityScores,
        type: 'scatter',
        mode: 'lines',
        fill: 'tozeroy',
        line: { color: '#00d4aa', width: 2 }
    }], layout, { responsive: true });
}

// Update Events Timeline (Total / Attacks / Benign over event sequence)
function updateEventsTimeline() {
    const totalEvents = [];
    const attackEvents = [];
    const benignEvents = [];
    const timestamps = [];
    let runningTotal = 0;
    let runningAttacks = 0;
    let runningBenign = 0;
    predictionHistory.forEach((pred, idx) => {
        runningTotal++;
        if (pred.predicted_class === 'BENIGN') {
            runningBenign++;
        } else {
            runningAttacks++;
        }
        totalEvents.push(runningTotal);
        attackEvents.push(runningAttacks);
        benignEvents.push(runningBenign);
        timestamps.push(idx + 1);
    });
    const layout = {
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        font: { color: '#e0f2fe', family: 'Inter, Segoe UI' },
        xaxis: { title: 'Event Sequence', gridcolor: '#2d5a7b', zerolinecolor: '#2d5a7b' },
        yaxis: { title: 'Count', gridcolor: '#2d5a7b', zerolinecolor: '#2d5a7b' },
        showlegend: true,
        legend: { x: 0, y: 1, font: { size: 10 } },
        margin: { l: 50, r: 20, t: 20, b: 40 }
    };
    const traces = [
        { x: timestamps, y: totalEvents, name: 'Total', type: 'scatter', mode: 'lines', line: { color: '#3b82f6', width: 2 } },
        { x: timestamps, y: attackEvents, name: 'Attacks', type: 'scatter', mode: 'lines', line: { color: '#ef4444', width: 2 } },
        { x: timestamps, y: benignEvents, name: 'Benign', type: 'scatter', mode: 'lines', line: { color: '#22c55e', width: 2 } }
    ];
    Plotly.react('eventsTimeline', traces, layout, { responsive: true });
}

// Update Feature Importance
function updateFeatureImportance() {
    // Mock feature importance (in real scenario, call /predict/explain endpoint)
    const features = [
        'Flow Duration',
        'Total Fwd Packets',
        'Total Bwd Packets',
        'Flow Bytes/s',
        'Flow Packets/s',
        'Fwd Packet Length Mean',
        'Bwd Packet Length Mean',
        'Flow IAT Mean',
        'Active Mean',
        'Idle Mean'
    ];
    
    const importance = features.map(() => Math.random());
    const sorted = features
        .map((f, i) => ({ feature: f, importance: importance[i] }))
        .sort((a, b) => b.importance - a.importance);
    
    const labels = sorted.map(item => item.feature);
    const values = sorted.map(item => item.importance);
    
    const colors = values.map(v => {
        if (v > 0.7) return '#ef4444';
        if (v > 0.4) return '#f59e0b';
        return '#3b82f6';
    });
    
    Plotly.update('featureImportance', {
        x: [values],
        y: [labels],
        marker: { 
            color: [colors],
            line: { color: '#2d5a7b', width: 1 }
        }
    }, {
        xaxis: { title: 'Importance Score', gridcolor: '#2d5a7b', range: [0, 1] },
        yaxis: { gridcolor: '#2d5a7b' }
    });
}

// Add alert to table
function addAlert(prediction) {
    const alertsContainer = document.getElementById('alertsTable');
    const alertItem = document.createElement('div');
    
    const className = prediction.predicted_class || 'Unknown';
    const confidence = ((prediction.confidence || 0) * 100).toFixed(1);
    const timestamp = moment().format('HH:mm:ss');
    
    let severity = 'benign';
    if (className !== 'BENIGN') {
        if (confidence > 90) severity = 'critical';
        else if (confidence > 75) severity = 'high';
        else if (confidence > 50) severity = 'medium';
        else severity = 'low';
    }
    
    alertItem.className = `alert-item ${severity}`;
    alertItem.innerHTML = `
        <div class="alert-header">
            <span class="alert-type">${className}</span>
            <span class="alert-time">${timestamp}</span>
        </div>
        <div class="alert-confidence">Confidence: ${confidence}%</div>
    `;
    
    alertsContainer.insertBefore(alertItem, alertsContainer.firstChild);
    
    // Keep only last 20 alerts
    while (alertsContainer.children.length > 20) {
        alertsContainer.removeChild(alertsContainer.lastChild);
    }
}

// Clear alerts
function clearAlerts() {
    const alertsContainer = document.getElementById('alertsTable');
    alertsContainer.innerHTML = '';
    predictionHistory = [];
    totalPredictions = 0;
    attackCount = 0;
    updateKPIs();
    initializeCharts();
}