"""Read only uploaded documents. Output JSON; never execute embedded scripts/macros."""
import json,sys,os
from pathlib import Path
p=Path(sys.argv[1]);mime=sys.argv[2];warnings=[];text=''
try:
    if mime=='application/pdf':
        import pdfplumber
        with pdfplumber.open(p) as pdf:
            for page in pdf.pages[:20]:
                part=page.extract_text() or ''
                if not part.strip():
                    try:
                        import easyocr
                        import numpy as np
                        reader=easyocr.Reader(['th','en'],gpu=False,download_enabled=False)
                        part='\n'.join(reader.readtext(np.array(page.to_image(resolution=160).original),detail=0))
                    except Exception:
                        warnings.append('หน้าสแกนยังอ่านไม่ได้ ต้องติดตั้ง EasyOCR และน้ำหนักโมเดลก่อน หรืออ่านจากต้นฉบับ')
                text+=part+'\n'
            if len(pdf.pages)>20:warnings.append('อ่านเฉพาะ 20 หน้าแรก ต้องแบ่งเอกสารส่วนที่เหลือมาประมวลผลเพิ่มเติม')
    elif mime.startswith('image/'):
        import easyocr
        reader=easyocr.Reader(['th','en'],gpu=False,download_enabled=False)
        text='\n'.join(reader.readtext(str(p),detail=0))
        warnings.append('อ่านข้อความในภาพเท่านั้น ไม่ได้อนุมานจำนวนคนหรือผลการทำงานจากภาพกิจกรรม')
    elif mime=='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
        import openpyxl
        wb=openpyxl.load_workbook(p,read_only=True,data_only=True)
        lines=[]
        for sheet in wb:
            lines.append('แผ่นงาน: '+sheet.title)
            for i,row in enumerate(sheet.iter_rows(values_only=True)):
                if i>=5000:warnings.append('ตัดที่ 5,000 แถวต่อแผ่นงาน');break
                lines.append(' | '.join('' if v is None else str(v) for v in row))
        wb.close();text='\n'.join(lines)
    elif mime=='application/vnd.ms-excel':
        import xlrd
        wb=xlrd.open_workbook(str(p));text='\n'.join(' | '.join(str(v) for v in sh.row_values(i)) for sh in wb.sheets() for i in range(min(sh.nrows,5000)))
    elif mime=='application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        import zipfile,xml.etree.ElementTree as ET
        with zipfile.ZipFile(p) as z:
            info=z.getinfo('word/document.xml')
            if info.file_size>5_000_000:raise ValueError('เอกสาร Word มีขนาดข้อมูลเกินที่กำหนด')
            root=ET.fromstring(z.read(info));ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
            text='\n'.join(''.join(t.text or '' for t in paragraph.findall('.//w:t',ns)) for paragraph in root.findall('.//w:p',ns))
    elif mime=='text/plain':text=p.read_text(encoding='utf-8-sig')
    else:warnings.append('ชนิดไฟล์นี้ยังไม่รองรับการอ่านข้อความ')
except ImportError as e:warnings.append('ยังไม่ได้ติดตั้งตัวอ่านเอกสาร: '+str(e))
except Exception as e:warnings.append('อ่านเอกสารไม่สำเร็จ: '+str(e)[:200])
if len(text)>100000:warnings.append('อ่านเฉพาะ 100,000 อักขระแรก ต้องตรวจต้นฉบับส่วนที่เหลือ')
print(json.dumps({'text':text[:100000],'warnings':warnings},ensure_ascii=False))
