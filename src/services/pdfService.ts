import { jsPDF } from "jspdf";
import { Sale, PharmacyInfo } from '../types';

export const generateReceiptPDF = (sale: Sale, info: PharmacyInfo | null) => {
  const doc = new jsPDF({ unit: 'mm', format: [80, 200] });
  const pageWidth = 80;
  const margin = 5;
  let y = 10;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(info?.name || "Pharmacy", pageWidth / 2, y, { align: 'center' });
  y += 6;
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(info?.address || "", pageWidth / 2, y, { align: 'center' });
  y += 4;
  doc.text(`Phone: ${info?.phone || ""}`, pageWidth / 2, y, { align: 'center' });
  y += 4;
  if (info?.tin) {
    doc.text(`TIN: ${info.tin}`, pageWidth / 2, y, { align: 'center' });
    y += 4;
  }
  
  y += 2;
  doc.setLineWidth(0.1);
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;

  doc.setFont("helvetica", "bold");
  doc.text(`RCPT #: ${sale.receiptNumber}`, margin, y);
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.text(`Date: ${new Date(sale.date).toLocaleString()}`, margin, y);
  y += 4;
  doc.text(`Patient: ${sale.customerName}`, margin, y);
  y += 4;
  doc.text(`Served by: ${sale.soldBy}`, margin, y);
  
  y += 3;
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;

  doc.setFont("helvetica", "bold");
  doc.text("Item Description", margin, y);
  doc.text("Qty", pageWidth - 25, y, { align: 'right' });
  doc.text("Total", pageWidth - margin, y, { align: 'right' });
  y += 4;
  doc.setFont("helvetica", "normal");

  sale.items.forEach((item: any) => {
    const name = item.name.length > 25 ? item.name.substring(0, 22) + "..." : item.name;
    doc.text(name, margin, y);
    doc.text(item.cartQty.toString(), pageWidth - 25, y, { align: 'right' });
    doc.text(((item.sellingPrice * item.cartQty) - (item.discount || 0)).toFixed(2), pageWidth - margin, y, { align: 'right' });
    y += 4;
  });

  y += 2;
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;

  doc.text("Subtotal:", margin, y);
  doc.text(sale.subTotal.toFixed(2), pageWidth - margin, y, { align: 'right' });
  y += 4;
  doc.text(`VAT (${sale.vatPercent}%):`, margin, y);
  doc.text(sale.vatAmount.toFixed(2), pageWidth - margin, y, { align: 'right' });
  y += 5;
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("TOTAL:", margin, y);
  doc.text(`${sale.grandTotal.toFixed(2)}`, pageWidth - margin, y, { align: 'right' });

  y += 15;
  doc.setFontSize(7);
  doc.setFont("helvetica", "italic");
  doc.text("Thank you for your patronage!", pageWidth / 2, y, { align: 'center' });
  y += 4;
  doc.text("System Managed Record", pageWidth / 2, y, { align: 'center' });

  doc.save(`Receipt_${sale.receiptNumber}.pdf`);
};

export const generateEndOfDaySummaryPDF = (sales: Sale[], dateStr: string, info: PharmacyInfo | null) => {
  const doc = new jsPDF();
  const margin = 20;
  let y = 30;

  // Filter sales for the selected date
  const selectedDate = new Date(dateStr).toDateString();
  const daySales = sales.filter(s => new Date(s.date).toDateString() === selectedDate && s.status !== 'VOIDED');

  // Header Background
  doc.setFillColor(15, 118, 110);
  doc.rect(0, 0, 210, 45, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(26);
  doc.setFont("helvetica", "bold");
  doc.text(info?.name || "PHARMACY DISPENSARY", margin, 25);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`${info?.address || ""} | Contact: ${info?.phone || ""}`, margin, 35);
  doc.text(`PHARMACY TIN: ${info?.tin || "N/A"}`, margin, 40);

  y = 60;
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(`END OF DAY SUMMARY: ${selectedDate}`, margin, y);
  
  y += 10;
  doc.setLineWidth(0.5);
  doc.line(margin, y - 2, 190, y - 2);
  
  const totalSalesCount = daySales.length;
  const totalGrand = daySales.reduce((sum, s) => sum + s.grandTotal, 0);
  const totalSub = daySales.reduce((sum, s) => sum + s.subTotal, 0);
  const totalVat = daySales.reduce((sum, s) => sum + s.vatAmount, 0);

  y += 10;
  doc.setFontSize(12);
  doc.text("SALES METRICS", margin, y);
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Total Transactions:`, margin + 10, y);
  doc.text(`${totalSalesCount}`, 100, y);
  y += 6;
  doc.text(`Total Subtotal:`, margin + 10, y);
  doc.text(`${totalSub.toFixed(2)}`, 100, y);
  y += 6;
  doc.text(`Total VAT:`, margin + 10, y);
  doc.text(`${totalVat.toFixed(2)}`, 100, y);
  y += 6;
  doc.setFont("helvetica", "bold");
  doc.text(`GRAND TOTAL:`, margin + 10, y);
  doc.text(`${totalGrand.toFixed(2)}`, 100, y);
  doc.setFont("helvetica", "normal");

  // Sum by Payment Method
  const paymentTotals: Record<string, number> = {};
  daySales.forEach(s => {
      s.paymentMethods.forEach(pm => {
          paymentTotals[pm.method] = (paymentTotals[pm.method] || 0) + pm.amount;
      });
  });

  y += 15;
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("TOTALS BY PAYMENT METHOD", margin, y);
  
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  
  const methods = Object.keys(paymentTotals);
  if (methods.length === 0) {
      doc.text("No payments recorded.", margin + 10, y);
      y += 6;
  } else {
      methods.forEach(method => {
          doc.text(`• ${method}:`, margin + 10, y);
          doc.text(`${paymentTotals[method].toFixed(2)}`, 100, y);
          y += 6;
      });
  }

  y += 15;
  doc.setFontSize(9);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(100, 100, 100);
  doc.text("Generated by the Pharmacy Management System", 105, 290, { align: 'center' });

  doc.save(`End_Of_Day_Summary_${dateStr}.pdf`);
};

export const generateA4AttachmentPDF = (sale: Sale, info: PharmacyInfo | null) => {
  const doc = new jsPDF();
  const margin = 20;
  let y = 30;

  // --- WATERMARK ---
  doc.setTextColor(240, 240, 240);
  doc.setFontSize(70);
  doc.setFont("helvetica", "bold");
  doc.text("ATTACHMENTS", 105, 150, { align: 'center', angle: 45 });
  doc.setTextColor(0, 0, 0); // Reset

  // Header Background
  doc.setFillColor(15, 118, 110);
  doc.rect(0, 0, 210, 45, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(26);
  doc.setFont("helvetica", "bold");
  doc.text(info?.name || "PHARMACY DISPENSARY", margin, 25);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`${info?.address || ""} | Contact: ${info?.phone || ""}`, margin, 35);
  doc.text(`PHARMACY TIN: ${info?.tin || "N/A"}`, margin, 40);
  
  y = 60;
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("BILLING & PATIENT INFO", margin, y);
  doc.text("MANIFEST REFERENCE", 130, y);
  
  y += 8;
  doc.setLineWidth(0.5);
  doc.line(margin, y - 2, 190, y - 2);
  
  doc.setFont("helvetica", "normal");
  doc.text(`Name: ${sale.customerName}`, margin, y);
  doc.text(`Invoice ID: ${sale.receiptNumber}`, 130, y);
  y += 6;
  doc.text(`CUSTOMER TIN: ${sale.customerTin || 'N/A'}`, margin, y);
  doc.text(`Dispensed Date: ${new Date(sale.date).toLocaleDateString()}`, 130, y);
  y += 6;
  doc.text(`Contact: ${sale.customerPhone || "N/A"}`, margin, y);
  doc.text(`Cashier / Op: ${sale.soldBy}`, 130, y);

  y += 20;
  doc.setFillColor(240, 240, 240);
  doc.rect(margin, y, 170, 10, 'F');
  doc.setFont("helvetica", "bold");
  doc.text("Medicine / Item Description", margin + 5, y + 7);
  doc.text("Batch", margin + 90, y + 7);
  doc.text("Qty", margin + 120, y + 7);
  doc.text("Rate", margin + 135, y + 7);
  doc.text("Ext. Price", margin + 165, y + 7, { align: 'right' });
  
  y += 10;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setDrawColor(200, 200, 200);
  
  sale.items.forEach((item) => {
    y += 10;
    if (y > 260) { doc.addPage(); y = 25; }
    doc.text(item.name.toUpperCase(), margin + 5, y);
    doc.setFontSize(8);
    doc.text(item.batchNumber || "-", margin + 90, y);
    doc.setFontSize(10);
    doc.text(item.cartQty.toString(), margin + 120, y);
    doc.text(item.sellingPrice.toFixed(2), margin + 135, y);
    doc.text(((item.sellingPrice * item.cartQty) - (item.discount || 0)).toFixed(2), margin + 165, y, { align: 'right' });
    doc.line(margin, y + 2, margin + 170, y + 2);
  });

  y += 20;
  if (y > 270) { doc.addPage(); y = 30; }
  const summaryX = 130;
  doc.setFontSize(10);
  doc.text("Sub-total:", summaryX, y);
  doc.text(`${sale.subTotal.toFixed(2)}`, margin + 165, y, { align: 'right' });
  y += 7;
  doc.text(`VAT (${sale.vatPercent}%):`, summaryX, y);
  doc.text(`${sale.vatAmount.toFixed(2)}`, margin + 165, y, { align: 'right' });
  
  y += 12;
  // --- FIXED TOTAL AMOUNT POSITIONING & CLARITY ---
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("TOTAL AMOUNT:", summaryX - 15, y); 
  doc.text(`${sale.grandTotal.toFixed(2)}`, margin + 165, y, { align: 'right' });

  y += 35;
  if (y > 275) { doc.addPage(); y = 40; }
  doc.setLineWidth(0.3);
  doc.setDrawColor(0, 0, 0);
  doc.line(margin, y, margin + 65, y);
  doc.line(125, y, 125 + 65, y);
  y += 5;
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("Released By (Sign & Stamp)", margin + 5, y);
  doc.text("Received By (Patient/Agent)", 130 + 5, y);

  // --- FOOTER DISCLAIMER ---
  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(100, 100, 100);
  doc.text("the receipt is not valid unless the fiscal receipt is attached", 105, 290, { align: 'center' });

  doc.save(`Dispensing_Attachment_${sale.receiptNumber}.pdf`);
};
