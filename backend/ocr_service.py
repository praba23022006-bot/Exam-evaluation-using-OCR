from flask import Flask, request, jsonify
from flask_cors import CORS
import easyocr
from PIL import Image
import numpy as np
import io, os, shutil
from rapidfuzz import fuzz
import base64
import fitz

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

_readers = {}

def clear_old_tamil_model():
    cache_dir = os.path.expanduser("~/.EasyOCR")
    ta_dir = os.path.join(cache_dir, "model", "ta")
    if os.path.exists(ta_dir):
        try:
            shutil.rmtree(ta_dir)
        except Exception:
            pass

def get_reader(lang='en'):
    if lang in _readers:
        return _readers[lang]
    if lang == 'ta':
        clear_old_tamil_model()
        reader = easyocr.Reader(['ta'], gpu=False)
    else:
        reader = easyocr.Reader(['en'], gpu=False)
    _readers[lang] = reader
    return reader

@app.route("/ocr", methods=["POST"])
def ocr_endpoint():
    lang = request.args.get('lang', 'ta')
    # Accept multiple images. Frontend can send multiple 'images' fields.
    files = []
    if 'images' in request.files:
        files = request.files.getlist('images')
    elif 'image' in request.files:
        files = request.files.getlist('image')
    elif 'file' in request.files:
        files = request.files.getlist('file')

    if not files:
        return jsonify({"error": "No image(s) provided"}), 400

    reader = get_reader('ta' if lang == 'ta' else 'en')

    all_texts = []
    per_image_texts = []

    for f in files:
        # if PDF, extract pages then OCR each page
        try:
            content_type = f.mimetype or ''
            if 'pdf' in content_type or (f.filename and f.filename.lower().endswith('.pdf')):
                # extract pages as images
                pdf_bytes = f.read()
                try:
                    doc = fitz.open(stream=pdf_bytes, filetype='pdf')
                except Exception as e:
                    return jsonify({"error": f"Cannot open PDF: {e}"}), 400
                for page_idx in range(len(doc)):
                    page = doc.load_page(page_idx)
                    pix = page.get_pixmap(matrix=fitz.Matrix(2,2))
                    png_bytes = pix.tobytes(output='png')
                    pil_img = Image.open(io.BytesIO(png_bytes)).convert('RGB')
                    max_size = 1600
                    w,h = pil_img.size
                    if max(w,h) > max_size:
                        scale = max_size / max(w,h)
                        pil_img = pil_img.resize((int(w*scale), int(h*scale)), resample=Image.LANCZOS)
                    img_np = np.array(pil_img.convert('L'))
                    try:
                        texts = reader.readtext(img_np, detail=0, paragraph=False)
                    except Exception as e:
                        return jsonify({"error": f"EasyOCR failed: {e}"}), 500
                    per_image_texts.append({"source": f.filename + f"[page:{page_idx}]", "lines": texts})
                    all_texts.extend([t for t in texts if t.strip()])
            else:
                # image file
                try:
                    f.stream.seek(0)
                    pil_img = Image.open(f.stream).convert('RGB')
                except Exception as e:
                    return jsonify({"error": f"Cannot open image: {e}"}), 400
                max_size = 1600
                w,h = pil_img.size
                if max(w,h) > max_size:
                    scale = max_size / max(w,h)
                    pil_img = pil_img.resize((int(w*scale), int(h*scale)), resample=Image.LANCZOS)
                img_np = np.array(pil_img.convert('L'))
                try:
                    texts = reader.readtext(img_np, detail=0, paragraph=False)
                except Exception as e:
                    return jsonify({"error": f"EasyOCR failed: {e}"}), 500
                per_image_texts.append({"source": f.filename, "lines": texts})
                all_texts.extend([t for t in texts if t.strip()])
        except Exception as e:
            return jsonify({"error": f"Processing failed: {e}"}), 500

    joined = "\n".join([t.strip() for t in all_texts if t.strip()])
    return jsonify({"perImage": per_image_texts, "text": joined}), 200

@app.route("/evaluate", methods=["POST"])
def evaluate_endpoint():
    data = request.get_json(force=True)
    student_text = data.get("studentText", "")
    answer_key_raw = data.get("answerKey", "")
    marks_key_raw = data.get("marksKey", "")
    keywords_raw = data.get("keywordsKey", "")

    student_lines = [l.strip() for l in student_text.splitlines() if l.strip()]
    answer_lines = [l.strip() for l in answer_key_raw.splitlines() if l.strip()]
    marks_lines = [l.strip() for l in marks_key_raw.splitlines() if l.strip()]
    keywords_lines = [l.strip() for l in keywords_raw.splitlines() if l.strip()]

    n_questions = len(answer_lines)
    marks = []
    for i in range(n_questions):
        try:
            marks.append(float(marks_lines[i]) if i < len(marks_lines) else 1.0)
        except:
            marks.append(1.0)

    keywords_per_q = []
    for i in range(n_questions):
        if i < len(keywords_lines):
            ks = [k.strip() for k in keywords_lines[i].split(",") if k.strip()]
            keywords_per_q.append(ks)
        else:
            keywords_per_q.append([w for w in answer_lines[i].split() if w.strip()])

    question_results = []
    total_obtained = 0.0
    total_max = sum(marks)

    KEYWORD_THRESHOLD = 60

    for i in range(n_questions):
        correct_answer = answer_lines[i]
        question_keywords = keywords_per_q[i]
        question_mark = marks[i]
        student_ans = student_lines[i] if i < len(student_lines) else ""

        matched = []
        for kw in question_keywords:
            if not kw:
                continue
            score = fuzz.partial_ratio(kw, student_ans)
            matched.append((kw, score))

        matched_count = sum(1 for _, s in matched if s >= KEYWORD_THRESHOLD)
        total_keywords = len(question_keywords) if len(question_keywords) > 0 else 1

        marks_awarded = (matched_count / total_keywords) * question_mark
        overall_similarity = fuzz.token_sort_ratio(correct_answer, student_ans)

        question_results.append({
            "question_index": i + 1,
            "correct_answer": correct_answer,
            "student_answer": student_ans,
            "keywords": question_keywords,
            "keyword_matches": [{ "keyword": kw, "score": s } for kw, s in matched],
            "matched_keyword_count": matched_count,
            "total_keywords": total_keywords,
            "marksAwarded": round(marks_awarded, 2),
            "totalMarks": question_mark,
            "overall_similarity": round(overall_similarity, 1)
        })

        total_obtained += marks_awarded

    total_score = round(total_obtained, 2)

    return jsonify({
        "questionResults": question_results,
        "totalScore": total_score,
        "maxScore": total_max
    }), 200


@app.route("/extract_pdf", methods=["POST"])
def extract_pdf():
    if 'file' not in request.files and 'pdf' not in request.files:
        return jsonify({"error": "No PDF provided"}), 400
    f = request.files.get('file') or request.files.get('pdf')
    try:
        pdf_bytes = f.read()
        doc = fitz.open(stream=pdf_bytes, filetype='pdf')
    except Exception as e:
        return jsonify({"error": f"Cannot open PDF: {e}"}), 400

    pages = []
    for i in range(len(doc)):
        page = doc.load_page(i)
        pix = page.get_pixmap(matrix=fitz.Matrix(2,2))
        png_bytes = pix.tobytes(output='png')
        b64 = base64.b64encode(png_bytes).decode('ascii')
        pages.append({"page": i, "imageBase64": f"data:image/png;base64,{b64}"})

    return jsonify({"pages": pages}), 200

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
