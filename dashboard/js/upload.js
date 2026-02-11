// API Configuration: use environment variable, same origin, or localhost:8000
const API_BASE = (typeof window !== 'undefined' && window.ENV_API_BASE) 
    ? window.ENV_API_BASE 
    : (typeof window !== 'undefined' && (window.location.port === '8000' || !/^localhost$/i.test(window.location.hostname))) 
        ? '' 
        : 'http://localhost:8000';
let selectedFile = null;

// Initialize page
document.addEventListener('DOMContentLoaded', function() {
    setupFileUpload();
    loadPreviousAnalysis(); // Load if exists
});

// Load previous analysis from localStorage
function loadPreviousAnalysis() {
    try {
        const saved = localStorage.getItem('lastAnalysis');
        if (saved) {
            const data = JSON.parse(saved);
            console.log('Restoring previous analysis...');
            displayResults(data);
        }
    } catch(e) {
        console.log('No previous analysis to restore');
    }
}

// Setup file upload handlers
function setupFileUpload() {
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');
    
    if (!uploadArea || !fileInput) return;
    
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('drag-over');
    });
    
    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('drag-over');
    });
    
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('drag-over');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFileSelect(files[0]);
        }
    });
    
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
        }
    });
}

// Handle file selection
function handleFileSelect(file) {
    if (!file.name.endsWith('.csv')) {
        alert('Please select a CSV file');
        return;
    }
    
    selectedFile = file;
    
    document.getElementById('fileName').textContent = file.name;
    document.getElementById('fileSize').textContent = formatFileSize(file.size);
    document.getElementById('fileInfo').style.display = 'block';
    document.getElementById('resultsSection').style.display = 'none';
}

// Format file size
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// Analyze file
async function analyzeFile() {
    if (!selectedFile) {
        alert('Please select a file first');
        return;
    }
    
    document.getElementById('analysisProgress').style.display = 'block';
    document.getElementById('progressFill').style.width = '0%';
    document.getElementById('progressText').textContent = 'Uploading file...';
    
    try {
        const formData = new FormData();
        formData.append('file', selectedFile);
        
        document.getElementById('progressFill').style.width = '30%';
        document.getElementById('progressText').textContent = 'Analyzing with ML model...';
        
        const response = await fetch(`${API_BASE}/analyze/csv`, {
            method: 'POST',
            body: formData
        });
        
        document.getElementById('progressFill').style.width = '70%';
        
        if (!response.ok) {
            throw new Error('Analysis failed');
        }
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Analysis failed');
        }
        
        document.getElementById('progressFill').style.width = '100%';
        document.getElementById('progressText').textContent = 'Complete!';
        
        // Save to localStorage
        localStorage.setItem('lastAnalysis', JSON.stringify(data));
        localStorage.setItem('lastAnalysisTime', new Date().toISOString());
        
        setTimeout(() => {
            document.getElementById('analysisProgress').style.display = 'none';
            displayResults(data);
        }, 500);
        
    } catch (error) {
        console.error('Analysis error:', error);
        alert('Error analyzing file: ' + error.message);
        document.getElementById('analysisProgress').style.display = 'none';
    }
}

// Display analysis results
function displayResults(data) {
    const summary = data.summary;
    const predictions = data.predictions;
    
    document.getElementById('totalRows').textContent = data.total_rows.toLocaleString();
    document.getElementById('attackCount').textContent = summary.total_attacks.toLocaleString();
    document.getElementById('benignCount').textContent = summary.total_benign.toLocaleString();
    document.getElementById('attackPercent').textContent = summary.attack_percentage.toFixed(1) + '%';
    
    if (summary.accuracy !== null) {
        document.getElementById('modelAccuracy').textContent = (summary.accuracy * 100).toFixed(2) + '%';
        document.getElementById('accuracyItem').style.display = 'flex';
    }
    
    createAttackDistributionChart(summary.class_distribution);
    populateResultsTable(predictions);
    
    document.getElementById('resultsSection').style.display = 'block';
    document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth' });
}

// Create attack distribution pie chart
function createAttackDistributionChart(classDistribution) {
    const labels = Object.keys(classDistribution);
    const values = Object.values(classDistribution);
    
    const colors = {
        'BENIGN': '#22c55e',
        'Bot': '#f59e0b',
        'DDoS': '#ef4444',
        'PortScan': '#3b82f6'
    };
    
    const chartColors = labels.map(label => colors[label] || '#8b5cf6');
    
    const data = [{
        values: values,
        labels: labels,
        type: 'pie',
        hole: 0.4,
        marker: { colors: chartColors },
        textinfo: 'percent',
        textposition: 'inside',
        insidetextorientation: 'radial',
        hoverinfo: 'label+percent+value'
    }];
    
    const layout = {
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        font: { color: '#e0f2fe', family: 'Inter' },
        showlegend: true,
        legend: {
            x: 0.5,
            y: -0.08,
            xanchor: 'center',
            yanchor: 'top',
            orientation: 'h',
            font: { size: 11 },
            tracegroupgap: 16
        },
        margin: { l: 20, r: 20, t: 30, b: 70 },
        height: 340
    };
    
    Plotly.newPlot('attackDistChart', data, layout, { responsive: true, displayModeBar: false });
}

// Populate results table
function populateResultsTable(predictions) {
    const tbody = document.getElementById('resultsTableBody');
    tbody.innerHTML = '';
    
    predictions.forEach(pred => {
        const row = document.createElement('tr');
        
        const hasActual = 'actual_label' in pred;
        const isCorrect = hasActual ? pred.predicted_class === pred.actual_label : null;
        
        row.innerHTML = `
            <td>${pred.index + 1}</td>
            <td><span class="class-badge ${pred.predicted_class.toLowerCase()}">${pred.predicted_class}</span></td>
            <td>${(pred.confidence * 100).toFixed(1)}%</td>
            <td>${hasActual ? pred.actual_label : 'N/A'}</td>
            <td>${hasActual ? (isCorrect ? '<span class="status-correct">✓ Correct</span>' : '<span class="status-incorrect">✗ Incorrect</span>') : 'N/A'}</td>
        `;
        
        tbody.appendChild(row);
    });
}