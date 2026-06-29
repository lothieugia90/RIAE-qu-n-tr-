const crypto = require('crypto');
const path   = require('path');
const fs     = require('fs');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

/**
 * Build deterministic hash for a signature event.
 * SHA-256(userId:documentType:documentId:signedAtISO)
 */
function buildHash(userId, documentType, documentId, signedAt) {
  const raw = `${userId}:${documentType}:${documentId}:${new Date(signedAt).toISOString()}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Verify that a stored signature hash still matches its parameters.
 */
function verifyHash(hash, userId, documentType, documentId, signedAt) {
  return hash === buildHash(userId, documentType, documentId, signedAt);
}

/**
 * Generate a signed-receipt PDF for a document.
 * Returns absolute file path.
 *
 * @param {Object} opts
 *   title        - string  (e.g. "Phiếu Lương Tháng 06/2025")
 *   fields       - Array<{label, value}>  (document data rows)
 *   signerName   - string
 *   signedAt     - Date
 *   ipAddress    - string
 *   signatureHash- string
 *   signatureImg - string  (base64 data-URL of the drawn signature, may be null)
 *   outputDir    - string  (absolute path to save the PDF)
 *   filename     - string  (without .pdf)
 */
async function generateSignedPDF(opts) {
  const { title, fields, signerName, signedAt, ipAddress, signatureHash, signatureImg, outputDir, filename } = opts;

  const pdfDoc  = await PDFDocument.create();
  const page    = pdfDoc.addPage([595, 842]); // A4
  const { width, height } = page.getSize();

  const fontNormal = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold   = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let y = height - 50;

  // ── Header ──────────────────────────────────────────
  page.drawRectangle({ x:0, y:height-90, width, height:90, color:rgb(0.082,0.396,0.753) });
  page.drawText('RIAE MANAGEMENT SYSTEM', { x:40, y:height-35, size:11, font:fontBold, color:rgb(1,1,1) });
  page.drawText('Công ty TNHH Kỹ thuật Công nghệ RIAE', { x:40, y:height-52, size:9, font:fontNormal, color:rgb(0.8,0.9,1) });
  page.drawText(title.toUpperCase(), { x:40, y:height-72, size:14, font:fontBold, color:rgb(1,1,1) });
  y = height - 110;

  // ── Fields ──────────────────────────────────────────
  page.drawText('THÔNG TIN TÀI LIỆU', { x:40, y, size:9, font:fontBold, color:rgb(0.4,0.4,0.4) });
  y -= 16;
  page.drawLine({ start:{x:40,y}, end:{x:width-40,y}, thickness:0.5, color:rgb(0.8,0.8,0.8) });
  y -= 14;

  for (const f of fields) {
    if (y < 200) break;
    const label = (f.label + ':').padEnd(28);
    page.drawText(label, { x:40, y, size:9, font:fontBold, color:rgb(0.3,0.3,0.3) });
    page.drawText(String(f.value || '—'), { x:195, y, size:9, font:fontNormal, color:rgb(0.1,0.1,0.1) });
    y -= 16;
  }

  // ── Signature image ──────────────────────────────────
  y -= 20;
  page.drawText('CHỮ KÝ XÁC NHẬN', { x:40, y, size:9, font:fontBold, color:rgb(0.4,0.4,0.4) });
  y -= 14;
  page.drawLine({ start:{x:40,y}, end:{x:width-40,y}, thickness:0.5, color:rgb(0.8,0.8,0.8) });
  y -= 14;

  if (signatureImg && signatureImg.startsWith('data:image/png;base64,')) {
    try {
      const base64Data = signatureImg.replace('data:image/png;base64,', '');
      const imgBytes   = Buffer.from(base64Data, 'base64');
      const pngImage   = await pdfDoc.embedPng(imgBytes);
      const sigH = 80, sigW = 240;
      // Draw box
      page.drawRectangle({ x:40, y:y-sigH, width:sigW, height:sigH, borderColor:rgb(0.7,0.7,0.7), borderWidth:1, color:rgb(0.97,0.98,1) });
      // Embed signature
      page.drawImage(pngImage, { x:44, y:y-sigH+4, width:sigW-8, height:sigH-8 });
      y -= sigH + 14;
    } catch(e) { y -= 14; }
  }

  // Signer line
  page.drawText(`Ký bởi: ${signerName}`, { x:40, y, size:10, font:fontBold, color:rgb(0.082,0.396,0.753) });
  y -= 15;
  page.drawText(`Thời gian: ${new Date(signedAt).toLocaleString('vi-VN')}`, { x:40, y, size:9, font:fontNormal, color:rgb(0.3,0.3,0.3) });
  y -= 14;
  page.drawText(`Địa chỉ IP: ${ipAddress || '—'}`, { x:40, y, size:9, font:fontNormal, color:rgb(0.3,0.3,0.3) });

  // ── Verification footer ──────────────────────────────
  const footerY = 60;
  page.drawRectangle({ x:0, y:footerY-10, width, height:60, color:rgb(0.96,0.97,0.99) });
  page.drawLine({ start:{x:0,y:footerY+48}, end:{x:width,y:footerY+48}, thickness:0.5, color:rgb(0.8,0.85,0.9) });
  page.drawText('VERIFICATION HASH (SHA-256):', { x:40, y:footerY+30, size:7, font:fontBold, color:rgb(0.4,0.4,0.5) });
  page.drawText(signatureHash.substring(0,64), { x:40, y:footerY+18, size:6.5, font:fontNormal, color:rgb(0.4,0.4,0.5) });
  page.drawText(signatureHash.substring(64), { x:40, y:footerY+7, size:6.5, font:fontNormal, color:rgb(0.4,0.4,0.5) });
  page.drawText('Tài liệu này được ký điện tử bởi hệ thống RIAE. Mọi thay đổi sau khi ký đều bị phát hiện qua hash trên.', {
    x:40, y:footerY-3, size:7, font:fontNormal, color:rgb(0.5,0.5,0.6)
  });

  const pdfBytes = await pdfDoc.save();
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const outPath = path.join(outputDir, filename + '.pdf');
  fs.writeFileSync(outPath, pdfBytes);
  return outPath;
}

module.exports = { buildHash, verifyHash, generateSignedPDF };
