import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const normalize = value => String(value ?? '').replace(/\r\n/g, '\n');
const splitLines = value => normalize(value).split('\n').slice(0, 12000);
const safeName = title => (String(title || 'synapse-report').replace(/[^a-z0-9 _-]/gi, '').trim().replace(/\s+/g, '-').slice(0, 70) || 'synapse-report');
function download(blob, title, extension) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeName(title) + '.' + extension;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function docxExport(report) {
  const paragraphs = [new Paragraph({ text: report.title || 'Synapse Research Report', heading: HeadingLevel.TITLE })];
  paragraphs.push(new Paragraph({ text: 'Prepared by Synapse AI · ' + new Date(report.createdAt || Date.now()).toLocaleString() }));
  for (const line of splitLines(report.content)) {
    const trimmed = line.trim();
    if (!trimmed) { paragraphs.push(new Paragraph('')); continue; }
    const heading = /^#{1,3}\s+/.test(trimmed);
    paragraphs.push(new Paragraph({
      children: [new TextRun({ text: trimmed.replace(/^#{1,3}\s+/, ''), bold: heading })],
      ...(heading ? { heading: HeadingLevel.HEADING_2 } : {})
    }));
  }
  const blob = await Packer.toBlob(new Document({ sections: [{ children: paragraphs }] }));
  download(blob, report.title, 'docx');
}
function latinText(value) {
  // Standard PDF fonts use WinAnsi; replace unsupported glyphs instead of crashing.
  return normalize(value).replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
}
async function pdfExport(report) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 595.28, pageHeight = 841.89, margin = 50, bodySize = 10.5, lineHeight = 17;
  let page = pdf.addPage([pageWidth, pageHeight]), y = pageHeight - margin;
  function newPage() { page = pdf.addPage([pageWidth, pageHeight]); y = pageHeight - margin; }
  function draw(text, size = bodySize, strong = false) {
    if (y < margin + lineHeight) newPage();
    page.drawText(latinText(text), { x: margin, y, size, font: strong ? boldFont : font, color: rgb(0.12, 0.16, 0.21) });
    y -= strong ? 23 : lineHeight;
  }
  function wrap(value, maxWidth, fontToUse = font, size = bodySize) {
    const words = latinText(value).split(/\s+/).filter(Boolean);
    const lines = []; let line = '';
    for (let word of words) {
      while (fontToUse.widthOfTextAtSize(word, size) > maxWidth) {
        let end = word.length;
        while (end > 1 && fontToUse.widthOfTextAtSize(word.slice(0,end),size)>maxWidth) end--;
        if (line) { lines.push(line); line=''; }
        lines.push(word.slice(0,end)); word=word.slice(end);
      }
      const next = line ? line + ' ' + word : word;
      if (fontToUse.widthOfTextAtSize(next,size)>maxWidth && line) { lines.push(line); line=word; }
      else line=next;
    }
    if (line) lines.push(line);
    return lines;
  }
  for (const line of wrap(report.title || 'Synapse Research Report',pageWidth-2*margin,boldFont,17)) draw(line,17,true);
  draw('Prepared by Synapse AI',9); y -= 10;
  for (const raw of splitLines(report.content)) {
    if (!raw.trim()) { y -= lineHeight * 0.5; continue; }
    const heading = /^#{1,3}\s+/.test(raw.trim());
    const line = raw.trim().replace(/^#{1,3}\s+/, '');
    for (const wrapped of wrap(line,pageWidth-2*margin,heading?boldFont:font,bodySize)) draw(wrapped,bodySize,heading);
  }
  const bytes = await pdf.save();
  download(new Blob([bytes],{type:'application/pdf'}),report.title,'pdf');
}
window.SynapseDocumentExport = Object.freeze({docxExport,pdfExport});
