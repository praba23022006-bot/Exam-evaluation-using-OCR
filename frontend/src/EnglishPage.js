import React, { useState } from 'react';
import './Page.css';

// Load Puter API script dynamically
const loadPuter = () => {
  return new Promise((resolve) => {
    if (window.puter) return resolve();
    const script = document.createElement("script");
    script.src = "https://js.puter.com/v2/";
    script.onload = resolve;
    document.body.appendChild(script);
  });
};

export default function EnglishPage() {

  const [ocrText, setOcrText] = useState('');
  const [answerKey, setAnswerKey] = useState('');
  const [rubricsKey, setRubricsKey] = useState('');
  const [evaluationText, setEvaluationText] = useState('');
  const [loading, setLoading] = useState(false);
  const [previews, setPreviews] = useState([]);
  const [activePreview, setActivePreview] = useState(null);

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

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setLoading(true);
    const newPreviews = [];
    for (const file of files) {
      if (file.type === 'application/pdf' || (file.name && file.name.toLowerCase().endsWith('.pdf')) ) {
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

  const runOCROnSelected = async () => {
    const selected = previews.filter(p => p.selected);
    if (!selected.length) {
      alert('Select one or more images/pages from the left preview');
      return;
    }
    setLoading(true);

    // If only one selected, prefer puter.ai and return its raw response verbatim.
    if (selected.length === 1) {
      try {
        await loadPuter();
        const p = selected[0];
        let base64 = null;
        if (p.fromPdf) {
          base64 = p.src; // already data:image/png;base64,...
        } else if (p.fileRef) {
          base64 = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (ev) => resolve(ev.target.result);
            reader.readAsDataURL(p.fileRef);
          });
        } else {
          // fetch blob from object URL and convert
          const res = await fetch(p.src);
          const blob = await res.blob();
          base64 = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (ev) => resolve(ev.target.result);
            reader.readAsDataURL(blob);
          });
        }

        // call puter.ai; display only the first paragraph of its raw return
        try {
          const extracted = await puter.ai.img2txt(base64);
          const getFirstParagraph = (txt) => {
            if (!txt) return '';
            if (typeof txt !== 'string') {
              try { txt = String(txt); } catch { txt = JSON.stringify(txt); }
            }
            const sepIdx = txt.indexOf('\n\n');
            if (sepIdx !== -1) return txt.slice(0, sepIdx).trim();
            return txt.trim();
          };
          const firstPara = getFirstParagraph(extracted);
          setOcrText(firstPara ? `"${firstPara}"` : '""');
        } catch (err) {
          console.error('puter.ai failed, falling back to backend', err);
          await fallbackBackendOCR(selected);
        }
      } catch (err) {
        console.error('Error using puter.ai, fallback to backend', err);
        await fallbackBackendOCR(selected);
      }
    } else {
      // multiple selections: use backend OCR
      await fallbackBackendOCR(selected);
    }

    setLoading(false);
  };

  const fallbackBackendOCR = async (selected) => {
    const fd = new FormData();
    for (const p of selected) {
      if (p.fromPdf) {
        const blob = base64ToBlob(p.src);
        const filename = `${p.filename || 'pdf'}_p${p.page || 0}.png`;
        fd.append('images', blob, filename);
      } else if (p.fileRef) {
        fd.append('images', p.fileRef, p.fileRef.name);
      } else {
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
      const res = await fetch('http://localhost:5000/ocr?lang=en', { method: 'POST', body: fd });
      const data = await res.json();
      const txt = data.text || '';
      // take only first paragraph and wrap in double quotes
      const sepIdx = txt.indexOf('\n\n');
      const first = sepIdx !== -1 ? txt.slice(0, sepIdx).trim() : txt.trim();
      setOcrText(first ? `"${first}"` : '""');
    } catch (err) {
      console.error('OCR failed', err);
      setOcrText('OCR failed: ' + err);
    }
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
      await loadPuter();
      const prompt = `You are an examiner. Compare the teacher's answer and the student's answer and grade using the rubrics provided.\n\nTeacher's answer:\n"""${answerKey}"""\n\nStudent's answer:\n"""${ocrText}"""\n\nRubrics: ${rubricsKey}\n\nProvide evaluation results in plain text format (NOT JSON):\n\nEvaluation Results:\n[For each rubric criterion, provide: criterion name, marks awarded (e.g., 2/3), and brief justification]\n\nExample:\nGrammar: 2/3 - The student used mostly correct grammar with minor errors.\nSpelling: 1/2 - Several spelling mistakes throughout.\nCreativity: 4/5 - Good original thinking with relevant examples.\n\nTotal Score: [sum]/[max]\n\nProvide your response only in plain text format with justifications.`;

      const response = await puter.ai.chat(prompt, { model: 'gpt-5-nano' });
      let text = typeof response === 'string' ? response : String(response);
      setEvaluationText(text);
    } catch (err) {
      console.error('puter.ai evaluation failed', err);
      setEvaluationText('Evaluation failed: ' + err.message);
    }
    setLoading(false);
  };

  return (
    <div className="page-container">
      <div className="header">
        <h1>English OCR + Evaluation</h1>
      </div>

      <div className="upload-box dashed">
        <label>Upload Image or PDF (multiple allowed):</label>
        <input type="file" multiple accept="image/*,application/pdf" onChange={handleFiles} />
      </div>

      <div className="two-col">

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
      {loading ? <p>Extracting text...</p> : null}

        <div className="right-card">
          <h3>Extracted Text</h3>
          <textarea value={ocrText} rows="10" onChange={(e) => setOcrText(e.target.value)} />

          <button className="run-btn" onClick={evaluate}>Evaluate</button>

          <h3 style={{marginTop:12}}>Answer Key</h3>
          <textarea value={answerKey} onChange={e => setAnswerKey(e.target.value)} />

          <h4>Rubrics (format: grammar=3,correct spelling=2,creativity=5)</h4>
          <textarea value={rubricsKey} onChange={e => setRubricsKey(e.target.value)} placeholder="grammar=3,correct spelling=2,creativity=5" />

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
