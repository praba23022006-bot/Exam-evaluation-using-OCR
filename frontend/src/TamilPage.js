import React, { useState } from 'react';
import './Page.css';

export default function TamilPage(){
  const [ocrText, setOcrText] = useState('');
  const [answerKey, setAnswerKey] = useState('');
  const [rubricsKey, setRubricsKey] = useState('');
  const [evaluationText, setEvaluationText] = useState('');
  const [loading, setLoading] = useState(false);
  const [previews, setPreviews] = useState([]); // {id, src, filename, fileRef?, fromPdf?, page?, selected}
  const [activePreview, setActivePreview] = useState(null);

  // Handle selecting files (images or PDFs)
  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setLoading(true);

    const newPreviews = [];

    for (const file of files) {
      if (file.type === 'application/pdf' || (file.name && file.name.toLowerCase().endsWith('.pdf')) ) {
        // send PDF to backend to extract pages as images
        const fd = new FormData();
        fd.append('file', file);
        try {
          const res = await fetch('http://localhost:5000/extract_pdf', { method: 'POST', body: fd });
          const data = await res.json();
          if (data.pages && Array.isArray(data.pages)) {
            for (const p of data.pages) {
              const id = `${file.name}_p${p.page}`;
              newPreviews.push({ id, src: p.imageBase64, filename: file.name, fromPdf: true, page: p.page, selected: false });
            }
          }
        } catch (err) {
          console.error('PDF extract failed', err);
        }
      } else {
        // image file: create object URL
        const src = URL.createObjectURL(file);
        const id = `${file.name}_${Date.now()}`;
        newPreviews.push({ id, src, filename: file.name, fileRef: file, fromPdf: false, selected: false });
      }
    }

    setPreviews(prev => {
      const merged = [...prev, ...newPreviews];
      if (!activePreview && merged.length) setActivePreview(merged[0].id);
      return merged;
    });

    setLoading(false);
  };

  const toggleSelect = (id) => {
    setPreviews(prev => prev.map(p => p.id === id ? { ...p, selected: !p.selected } : p));
  };

  const base64ToBlob = (b64data) => {
    const parts = b64data.split(',');
    const mime = parts[0].match(/:(.*?);/)[1];
    const bstr = atob(parts[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  };

  const runOCROnSelected = async () => {
    const selected = previews.filter(p => p.selected);
    if (!selected.length) {
      alert('Select one or more images/pages from the left preview');
      return;
    }
    setLoading(true);
    const fd = new FormData();
    for (const p of selected) {
      if (p.fromPdf) {
        const blob = base64ToBlob(p.src);
        const filename = `${p.filename || 'pdf'}_p${p.page || 0}.png`;
        fd.append('images', blob, filename);
      } else if (p.fileRef) {
        fd.append('images', p.fileRef, p.fileRef.name);
      } else {
        // fallback: fetch blob from object URL
        try {
          const res = await fetch(p.src);
          const blob = await res.blob();
          fd.append('images', blob, p.filename || 'image.png');
        } catch (err) {
          console.error('Failed to fetch blob for', p, err);
        }
      }
    }

    try {
      const res = await fetch('http://localhost:5000/ocr?lang=ta', { method: 'POST', body: fd });
      const data = await res.json();
      setOcrText(data.text || '');
    } catch (err) {
      console.error('OCR failed', err);
      setOcrText('OCR failed: ' + err);
    }

    setLoading(false);
  };

  const evaluate = async () => {
    if (!rubricsKey || !rubricsKey.trim()) {
      alert('Please provide rubrics for evaluation');
      return;
    }
    if (!answerKey || !answerKey.trim()) {
      alert('Please provide the answer key for evaluation');
      return;
    }

    setLoading(true);
    try {
      // Load puter for tamil evaluation as well
      const script = document.createElement("script");
      script.src = "https://js.puter.com/v2/";
      script.onload = async () => {
        try {
          const prompt = `You are an examiner. Don't be too strict. Compare the teacher's answer and the student's answer and grade using the rubrics provided.\n\nTeacher's answer (in Tamil):\n"""${answerKey}"""\n\nStudent's answer (in Tamil):\n"""${ocrText}"""\n\nRubrics: ${rubricsKey}\n\nProvide evaluation results in plain text format (NOT JSON):\n\nEvaluation Results:\n[For each rubric criterion, provide: criterion name, marks awarded (e.g., 2/3), and brief justification]\n\nExample:\nGrammar: 2/3 - The student used mostly correct grammar with minor errors.\nSpelling: 1/2 - Several spelling mistakes throughout.\nCreativity: 4/5 - Good original thinking with relevant examples.\n\nTotal Score: [sum]/[max]\n\nProvide your response only in plain text format with justifications and keep the justification mostly in tamil.`;

          const response = await puter.ai.chat(prompt, { model: 'gpt-5-nano' });
          let text = typeof response === 'string' ? response : String(response);
          setEvaluationText(text);
        } catch (err) {
          console.error('puter.ai evaluation failed', err);
          setEvaluationText('Evaluation failed: ' + err.message);
        }
        setLoading(false);
      };
      if (!window.puter) document.body.appendChild(script);
    } catch (err) {
      console.error('Error loading puter', err);
      setEvaluationText('Error: Could not load evaluation service');
      setLoading(false);
    }
  };

  return (
    <div className="page-container">
      
      <div className="header">
        <h1>Tamil OCR + Evaluation</h1>
      </div>

      <div className="upload-box dashed">
        <label>Upload Handwritten Tamil Image or PDF (multiple allowed):</label>
        <input type="file" multiple accept="image/*,application/pdf" onChange={handleFiles} />
      </div>

      <div className="two-col">

        {/* LEFT SIDE — Preview */}
        <div className="left-card">
          <h3>Preview / Select Pages</h3>
          <div className="preview-column">
            <div className="large-preview">
              {activePreview ? (
                <img src={(previews.find(p=>p.id===activePreview)||{}).src} alt="preview" style={{maxWidth:'100%', maxHeight:260}} />
              ) : (
                <div className="preview-area">No preview selected</div>
              )}
            </div>

            <div className="thumbnails" style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:12}}>
              {previews.map(p => (
                <div key={p.id} className={`thumbnail ${p.selected ? 'selected' : ''}`} style={{border: p.selected ? '3px solid #6d4bd6' : '1px solid #ddd', padding:4, cursor:'pointer'}} onClick={() => { setActivePreview(p.id); toggleSelect(p.id); }}>
                  <img src={p.src} alt={p.filename} style={{width:100, height:70, objectFit:'cover', display:'block'}} />
                  <div style={{fontSize:11, textAlign:'center'}}>{p.fromPdf ? `Page ${p.page}` : p.filename}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{marginTop:12}}>
            <button className="run-btn" onClick={runOCROnSelected}>Run OCR on Selected</button>
          </div>
        </div>
      {loading ? <p>Extracting Tamil text…</p> : null }

        {/* RIGHT SIDE — Answer Key + OCR + Evaluation */}
        <div className="right-card">
          <h3>Extracted Tamil Text</h3>
          <textarea 
            value={ocrText}
            onChange={(e) => setOcrText(e.target.value)}
            rows="10"
          />

          <button className="run-btn" onClick={evaluate}>
            Evaluate
          </button>

          <h3 style={{marginTop:12}}>Answer Key</h3>
          <textarea
            value={answerKey}
            onChange={(e) => setAnswerKey(e.target.value)}
            placeholder="Teacher's correct answers, one per line"
          />

          <h4>Rubrics (format: இலக்கணம் = 3,சரியான எழுத்துப்பிழையில்லா எழுத்து = 2,படைப்பாற்றல் = 5)</h4>
          <textarea
            value={rubricsKey}
            onChange={(e) => setRubricsKey(e.target.value)}
            placeholder="இலக்கணம் = 3,சரியான எழுத்துப்பிழையில்லா எழுத்து = 2,படைப்பாற்றல் = 5"
          />

          {evaluationText && (
            <div style={{marginTop:12, padding:12, background:'#f5f5f5', borderRadius:6, whiteSpace:'pre-wrap', wordWrap:'break-word'}}>
              <h3>Evaluation Result</h3>
              <p>{evaluationText}</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
