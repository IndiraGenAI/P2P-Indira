import PDFDocument from 'pdfkit';

function formatCurrency(amount) {
  return `₹${Number(amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function drawHeader(doc, payload) {
  const { company, title, docNo, status, date } = payload;
  doc
    .fontSize(16)
    .font('Helvetica-Bold')
    .fillColor('#0F172A')
    .text(company.name || 'P2P Admin Elite', 40, 35);
  doc.fontSize(9).font('Helvetica').fillColor('#334155');
  if (company.address1) doc.text(company.address1, 40, 56);
  if (company.address2) doc.text(company.address2, 40, 69);
  doc.text(`GST: ${company.gst || '—'}   PAN: ${company.pan || '—'}`, 40, 82);
  doc.moveTo(40, 98).lineTo(555, 98).strokeColor('#CBD5E1').stroke();

  doc.fontSize(15).font('Helvetica-Bold').fillColor('#0F172A').text(title, 40, 110, { align: 'center', width: 515 });
  doc.fontSize(12).font('Helvetica-Bold').text(docNo || '—', 40, 129, { align: 'center', width: 515 });
  doc.fontSize(9).font('Helvetica').fillColor('#334155');
  doc.text(`Date: ${formatDate(date)}`, 40, 148);
  doc.text(`Status: ${status || '—'}`, 440, 148, { width: 115, align: 'right' });
  doc.moveTo(40, 163).lineTo(555, 163).strokeColor('#CBD5E1').stroke();
}

function drawDetails(doc, payload) {
  const { leftDetails = [], rightDetails = [], docDetails = [] } = payload;
  let y = 175;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#0F172A').text('VENDOR DETAILS', 40, y);
  doc.text('DOCUMENT DETAILS', 300, y);
  y += 15;
  doc.font('Helvetica').fontSize(9).fillColor('#334155');
  const maxLen = Math.max(leftDetails.length, rightDetails.length);
  for (let i = 0; i < maxLen; i += 1) {
    if (leftDetails[i]) doc.text(leftDetails[i], 40, y + i * 13, { width: 240 });
    if (rightDetails[i]) doc.text(rightDetails[i], 300, y + i * 13, { width: 255 });
  }
  y += maxLen * 13 + 8;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#0F172A').text('ADDITIONAL INFO', 40, y);
  y += 14;
  doc.font('Helvetica').fontSize(9).fillColor('#334155');
  docDetails.forEach((line, idx) => doc.text(line, 40, y + idx * 13, { width: 515 }));
  return y + docDetails.length * 13 + 16;
}

function drawItemsTable(doc, payload, startY) {
  const { columns = [], items = [] } = payload;
  let y = startY;
  const tableWidth = 515;
  const colWidth = tableWidth / Math.max(1, columns.length);
  doc.rect(40, y, tableWidth, 20).fill('#1E293B');
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#FFFFFF');
  columns.forEach((c, idx) => {
    doc.text(c.header, 44 + idx * colWidth, y + 6, { width: colWidth - 8, align: c.align || 'left' });
  });
  y += 20;

  items.forEach((row, rowIdx) => {
    if (y > 710) {
      doc.addPage();
      y = 40;
    }
    if (rowIdx % 2 === 1) {
      doc.rect(40, y, tableWidth, 18).fill('#F8FAFC');
    }
    doc.font('Helvetica').fontSize(8).fillColor('#0F172A');
    columns.forEach((c, idx) => {
      const val = row[c.key] == null ? '—' : String(row[c.key]);
      doc.text(val, 44 + idx * colWidth, y + 5, { width: colWidth - 8, align: c.align || 'left' });
    });
    y += 18;
  });
  return y + 8;
}

function drawSummary(doc, payload, y) {
  const { summary = [] } = payload;
  doc.moveTo(320, y).lineTo(555, y).strokeColor('#CBD5E1').stroke();
  y += 6;
  summary.forEach((line, idx) => {
    doc.font(idx === summary.length - 1 ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor('#0F172A');
    doc.text(line.label, 360, y + idx * 14, { width: 120, align: 'right' });
    doc.text(line.value, 485, y + idx * 14, { width: 70, align: 'right' });
  });
  return y + summary.length * 14 + 10;
}

function drawFooter(doc, payload, y) {
  const { preparedBy, approvedBy } = payload;
  if (y > 730) {
    doc.addPage();
    y = 40;
  }
  doc.moveTo(40, y).lineTo(555, y).strokeColor('#CBD5E1').stroke();
  y += 10;
  doc.font('Helvetica').fontSize(9).fillColor('#334155');
  doc.text(`Prepared by: ${preparedBy || 'System'}`, 40, y);
  doc.text(`Approved by: ${approvedBy || '—'}`, 320, y, { width: 235, align: 'right' });
  y += 18;
  doc.fontSize(8).fillColor('#64748B').text('This is a system-generated document from P2P Admin Elite.', 40, y);
}

export function generateDocumentPdf(payload) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      info: {
        Title: `${payload.title} - ${payload.docNo}`,
        Author: 'P2P Admin Elite',
      },
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    drawHeader(doc, payload);
    let y = drawDetails(doc, payload);
    y = drawItemsTable(doc, payload, y);
    y = drawSummary(doc, payload, y);
    drawFooter(doc, payload, y);
    doc.end();
  });
}

export const pdfUtils = { formatCurrency, formatDate };
